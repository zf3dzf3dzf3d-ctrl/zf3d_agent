#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网络守护模块 - network_guard
监控上游 AI 代理请求的连通性：
  - 连接失败/超时 → 记录"断网开始时间"
  - 连接成功 → 清零
  - 断网持续超过 AUTO_RESTART_MINUTES（默认10分钟）→ 自动重启后台服务器

由 mixin_proxy / mixin_proxy_stream 在每次上游请求后调用 report()。
"""
import os
import sys
import json
import time
import threading
import subprocess
import urllib.request

# 本机 API 端口（供心跳探针用）：读 private/port.json，兼容 api_port/port
def _api_port():
    try:
        with open(os.path.join(BASE_DIR, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        return int(cfg.get('api_port') or cfg.get('port') or 8558)
    except Exception:
        return 8558

PORT = _api_port()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(BASE_DIR, 'private', 'network_guard_state.json')
STATE_LOCK = threading.Lock()

# 【方案C·P1-3】状态内存化：断网计时是高频读写路径（每次上游请求都触发 report()），
# 旧实现每次都读+写 JSON 文件，引入磁盘 IO 和锁竞争。
# 新实现：状态常驻内存（_STATE），仅在"状态翻转"时落盘一次：
#   - 正常→断网（开始计时）
#   - 断网→恢复（清零）
#   - 触发重启/升级标记变化
# 进程重启后若断网仍在持续，下游请求会重新 report(False) 自然恢复计时，可接受。

# 断网持续多少分钟后自动重启（可在 private/network_guard.json 覆盖）
DEFAULT_AUTO_RESTART_MINUTES = 10
CFG_PATH = os.path.join(BASE_DIR, 'private', 'network_guard.json')

# 自动重启连续失败达到该次数后，升级为"拉起备用版本 + 自动修复"流程
MAX_RESTART_FAILURES = 2
# 断网持续达到阈值的该倍数后，同样升级为备用版本流程（防止重启卡死无限等）
ESCALATE_MULTIPLIER = 2


def _load_cfg():
    try:
        with open(CFG_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state):
    """状态翻转时才调用（不再每请求写盘）"""
    try:
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        with open(STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(state, f)
    except Exception:
        pass


def _load_state():
    try:
        with open(STATE_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {}


# 内存态（受 STATE_LOCK 保护），启动时读一次文件以尽量延续跨重启的断网计时
_STATE = None


def _state():
    """获取内存态（懒加载，进程生命周期内只读盘一次）"""
    global _STATE
    if _STATE is None:
        with STATE_LOCK:
            if _STATE is None:
                _STATE = _load_state()
    return _STATE


# 心跳探针内存态（仅供 get_status / 前端倒计时展示；不与 STATE_LOCK 混用）
_HB = {'fails': 0, 'interval': 30, 'max_fails': 6, 'last_ok': 0.0}


def get_status():
    """返回当前断网状态 {down: bool, since: ts, down_seconds: n}
    另附心跳探针状态：fails 连续失败次数，est_restart_sec 预计还有多少秒触发自救重启（-1=未在倒计时）。"""
    st = _state()
    down_since = st.get('down_since')
    if not down_since:
        base = {'down': False, 'since': 0, 'down_seconds': 0}
    else:
        base = {
            'down': True,
            'since': down_since,
            'down_seconds': int(time.time() - down_since),
        }
    try:
        hb = dict(_HB)
        fails = int(hb.get('fails', 0))
        max_fails = int(hb.get('max_fails', 4)) or 4
        interval = float(hb.get('interval', 30)) or 30
        # 自救开关关闭时不倒计时（否则前端会显示"约0秒后自救"却不动手）
        enabled = _load_cfg().get('auto_restart_enabled', True)
        est = (max_fails - fails) * interval if (fails > 0 and enabled) else -1
        base['heartbeat'] = {
            'fails': fails,
            'max_fails': max_fails,
            'last_ok': hb.get('last_ok', 0),
            'est_restart_sec': est,
        }
    except Exception:
        pass
    return base


def report(ok, err=''):
    """上游请求结束后上报。ok=True 连接正常；ok=False 连接失败/超时。
    断网持续超过阈值时触发一次自动重启（用状态文件防重复触发）。
    【2026-10-16 死锁修复】旧版：print 在 STATE_LOCK 锁内，stdout 管道一旦
    无人读取（缓冲写满）print 永久阻塞 → 持锁不放 → 全站 /api/proxy 挂死。
    新版：① 抢锁带 0.5s 超时，抢不到直接跳过（上报是尽力而为，宁丢勿堵）；
         ② 所有 print 移到锁外；③ 落盘移到锁外（先在锁内拷贝快照）。"""
    now = time.time()
    cfg = _load_cfg()
    threshold_min = float(cfg.get('auto_restart_minutes', DEFAULT_AUTO_RESTART_MINUTES))
    enabled = cfg.get('auto_restart_enabled', True)

    logs = []           # 锁外统一打印
    trigger = None      # ('restart'|'escalate') 锁外起线程
    down_seconds = 0.0

    if not STATE_LOCK.acquire(timeout=0.5):
        return {'down': not ok, 'triggered': False, 'skipped': True}  # 锁忙：丢弃本次上报，绝不阻塞请求线程
    try:
        st = _state()
        down_since = st.get('down_since') or 0
        if ok:
            if down_since:
                st.clear()
                _dirty = True
                logs.append('[NetworkGuard] 网络恢复，断网计时清零')
            return {'down': False, 'triggered': False}

        # 失败
        _dirty = False
        if not down_since:
            down_since = now
            st['down_since'] = down_since
            st['last_err'] = str(err)[:200]
            _dirty = True
            logs.append('[NetworkGuard] ⚠️ 检测到上游连接失败，开始计时: %s' % str(err)[:120])

        down_seconds = now - down_since
        if not enabled:
            return {'down': True, 'triggered': False, 'down_seconds': down_seconds}

        restart_failures = int(st.get('restart_failures', 0))

        # 防重复触发：已标记触发就不再触发
        if st.get('restart_triggered'):
            # 但如果断网时间已超过 2 倍阈值（说明重启也没能修复），升级为备用版本流程
            if down_seconds >= threshold_min * 60 * ESCALATE_MULTIPLIER and not st.get('escalated'):
                st['escalated'] = True
                _dirty = True
                logs.append('[NetworkGuard] 🚨 重启后断网仍未恢复（%d 秒 ≥ %d 分钟），升级为备用版本流程' %
                      (int(down_seconds), int(threshold_min * ESCALATE_MULTIPLIER)))
                trigger = 'escalate'
                return {'down': True, 'triggered': True, 'escalated': True, 'down_seconds': down_seconds}
            return {'down': True, 'triggered': False, 'down_seconds': down_seconds}

        if down_seconds >= threshold_min * 60:
            st['restart_triggered'] = True
            _dirty = True
            logs.append('[NetworkGuard] ❌ 断网已持续 %d 秒（≥%d分钟），触发自动重启后台网络' % (int(down_seconds), int(threshold_min)))
            trigger = 'restart'
            return {'down': True, 'triggered': True, 'down_seconds': down_seconds}

        return {'down': True, 'triggered': False, 'down_seconds': down_seconds}
    finally:
        # 快照拷贝后立刻放锁；落盘/打印全部在锁外做
        try:
            snap = dict(_state()) if _STATE is not None else {}
        except Exception:
            snap = {}
        STATE_LOCK.release()
        if snap:
            _save_state(snap)
        for m in logs:
            print(m)
        if trigger == 'restart':
            threading.Thread(target=_do_restart, daemon=True).start()
        elif trigger == 'escalate':
            threading.Thread(target=_do_escalate, daemon=True).start()


def _do_restart():
    """【2026-05 解禁改造】用户已明确要求：全卡死/断网超时 → 自动重启后台自救。
    前提与保险：
    1. 配置开关 private/network_guard.json 的 auto_restart_enabled（默认 true）；
    2. 连续失败 ≥ AUTO_RESTART_MAX_FAILURES(3) 次熔断，只报警不动手；
    3. 24 小时内最多 AUTO_RESTART_MAX_PER_DAY(3) 次，防死循环；
    4. 只跑 restart_server.py --auto（独立进程，仅杀 server.py 的 PID，
       托盘/前台窗口进程绝不在杀名单内，前台保持）。
    """
    cfg = _load_cfg()
    if not cfg.get('auto_restart_enabled', True):
        print('[NetworkGuard] ⚠️ 触发自动重启，但 auto_restart_enabled=false，仅记录日志。')
        return
    # 熔断：连续失败计数
    with STATE_LOCK:
        st = _state()
        fails = int(st.get('restart_failures', 0))
        now = time.time()
        # 24h 滚动窗口计数
        day = [t for t in st.get('restarts_today', []) if now - t < 86400]
        if len(day) >= 3:
            print('[NetworkGuard] 🛑 24小时内已自动重启 %d 次，熔断保护触发，不再重启，需人工检查。' % len(day))
            return
    print('[NetworkGuard] 🔁 触发自动重启后台（仅 server.py，托盘/前台保持）...')
    with STATE_LOCK:
        st2 = _state()
        st2['restarts_today'] = day + [now]
        _save_state(st2)
    exe = sys.executable or 'python'
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'restart_server.py')
    try:
        flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        subprocess.Popen([exe, script, '--auto'],
                         cwd=os.path.dirname(script),
                         creationflags=flags,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print('[NetworkGuard] ❌ 拉起 restart_server.py 失败: %s' % e)


def _probe_liveness(lport, timeout=5):
    """探独立存活端口。返回 True=进程活着。失败（连不上/超时/非200）返回 False。"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/liveness' % lport, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def _probe_health(timeout=10):
    """探主端口 /api/health（业务侧响应）。True=业务接口正常应答。"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % PORT, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def start_heartbeat_probe():
    """【治本·防误关】双端口心跳探针。
    旧版只探主端口 /api/health，而它由 DBHandler 处理、与 SSE/代理/DB 共享线程池与
    accept 队列：一旦 DB 单写锁长时间被占或并发打满，这个静态接口也连不上 → 误判
    "后台全卡死"→ 自动重启（即"后台被关"的真正来源之一）。

    新版分工：
      - 主端口 /api/health 仅用于观测"业务是否繁忙/卡顿"，不再单独据此判死；
      - 独立存活端口 /liveness（health_liveness，独立线程，绝不碰业务锁/DB）才是
        "进程活没活"的权威判据。
      仅当【存活端口也连续失败】才认定进程真死 → _do_restart()。
      存活端口在跑但主端口慢 → 只记日志提示"业务繁忙/可能 DB 锁"，不重启。
    约束（10-16 死锁教训）：daemon 线程、绝不碰 STATE_LOCK/项目内锁、print 在锁外。
    若存活探针未能启动（端口冲突等），lport=None → 自动回退到旧的主端口判定，
    并把阈值放宽，避免新机制反而导致误关。"""
    interval = 30.0
    max_fails = 6            # 放宽：4 → 6（约 3 分钟才判死，滤掉 DB 锁/GC 等瞬时抖动）
    lport = None
    try:
        cfg = _load_cfg()
        interval = float(cfg.get('heartbeat_interval_sec', 30))
        max_fails = int(cfg.get('heartbeat_fail_threshold', 6))
    except Exception:
        pass
    # 仅当存活探针确实成功启动时，才启用双端口权威判定
    try:
        import health_liveness
        if health_liveness.is_running():
            lport = health_liveness.liveness_port()
    except Exception:
        lport = None
    _HB.update({'interval': interval, 'max_fails': max_fails})

    def _probe():
        fails = 0
        # 启动宽限 90s，等服务完全就绪再开始计数
        time.sleep(90)
        while True:
            if lport is not None:
                alive = _probe_liveness(lport)
                busy = _probe_health()
                if alive:
                    _HB['last_ok'] = time.time()
                    if fails >= max_fails:
                        print('[HeartBeat] 心跳恢复（此前连续失败 %d 次）' % fails)
                    fails = 0
                    _HB['fails'] = 0
                    if not busy:
                        # 进程活着但业务接口没应答：大概率 DB 单写锁/并发打满，提示但不重启
                        print('[HeartBeat] ⚠️ 进程存活但 /api/health 未及时应答（疑似 DB 锁/业务繁忙），不判死、不重启')
                else:
                    fails += 1
                    _HB['fails'] = fails
                    print('[HeartBeat] ⚠️ 存活探针无响应（进程疑死，连续 %d/%d 次）' % (fails, max_fails))
                    if fails >= max_fails:
                        cfg2 = _load_cfg()
                        if cfg2.get('auto_restart_enabled', True):
                            print('[HeartBeat] ❌ 存活端口连续 %d 次无响应，判定进程真死，触发自动重启自救' % fails)
                            fails = 0
                            try:
                                _do_restart()
                            except Exception as e:
                                print('[HeartBeat] 触发重启异常: %s' % e)
                        else:
                            fails = max_fails
            else:
                # 回退：存活探针不可用 → 用主端口判定，但沿用放宽后的 max_fails
                ok = _probe_health()
                if ok:
                    _HB['last_ok'] = time.time()
                    if fails >= max_fails:
                        print('[HeartBeat] 心跳恢复（此前连续失败 %d 次）' % fails)
                    fails = 0
                    _HB['fails'] = 0
                else:
                    fails += 1
                    _HB['fails'] = fails
                    print('[HeartBeat] ⚠️ /api/health 无响应（连续 %d/%d 次）' % (fails, max_fails))
                    if fails >= max_fails:
                        cfg2 = _load_cfg()
                        if cfg2.get('auto_restart_enabled', True):
                            print('[HeartBeat] ❌ 连续 %d 次无响应，判定后台全卡死，触发自动重启自救' % fails)
                            fails = 0
                            try:
                                _do_restart()
                            except Exception as e:
                                print('[HeartBeat] 触发重启异常: %s' % e)
                        else:
                            fails = max_fails
            time.sleep(interval)

    t = threading.Thread(target=_probe, name='heartbeat-probe', daemon=True)
    t.start()
    if lport is not None:
        print('[HeartBeat] 心跳探针已启动：每 %ss 探一次，存活端口=%d（权威判死），主端口=%d/api/health（仅观测），连续 %d 次存活失败才重启' % (interval, lport, PORT, max_fails))
    else:
        print('[HeartBeat] 心跳探针已启动（回退：存活端口不可用）：每 %ss 探一次 /api/health，连续 %d 次失败自动重启' % (interval, max_fails))


def report_restart_result(success):
    """重启结束后由外部上报结果：成功→清空失败计数；失败→计数+1，达到阈值升级备用版本流程。
    【2026-10-16 死锁修复】print 移到锁外（同 report）。"""
    _logs = []
    with STATE_LOCK:
        st = _state()
        if success:
            if st.get('restart_failures'):
                st.pop('restart_failures', None)
                _save_state(st)
                _logs.append('[NetworkGuard] 重启成功，失败计数清零')
            return
        n = int(st.get('restart_failures', 0)) + 1
        st['restart_failures'] = n
        _save_state(st)
        if n >= MAX_RESTART_FAILURES and not st.get('escalated'):
            st['escalated'] = True
            _save_state(st)
            _logs.append('[NetworkGuard] 🚨 自动重启连续失败 %d 次，升级为备用版本流程' % n)
    # 【死锁修复】print 移到锁外
    for m in _logs:
        print(m)
    if st.get('escalated') and n >= MAX_RESTART_FAILURES:
        threading.Thread(target=_do_escalate, daemon=True).start()


def _do_escalate():
    """【用户禁令】彻底禁止升级/拉起备用版本：它同样会杀后台进程踢用户下线。
    现在只记录日志提醒，不做任何自动操作，需人工处理。"""
    print('[NetworkGuard] ⚠️ 触发备用版本升级流程，已按用户要求【不自动升级】，仅记录日志，需人工处理。')
