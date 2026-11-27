# -*- coding: utf-8 -*-
"""
evolution_watchdog.py - 进化看门狗（独立进程，不依赖 AI 循环）

背景：2026-11-24 18:08~00:18 发生过一次"进程活着但引擎/哨兵停摆 6 小时"的死机。
旧哨兵心跳靠工具调用触发，AI 一停心跳就停，形成盲区。本看门狗是独立系统进程：
  1. HTTP 探活：GET /api/chat-pool/config，连续 3 次失败判定服务假死
  2. 调度活性：检查 evolution_heartbeat.txt（由 schedule 定时任务每 60s 写），
     age > 300s 判定调度停摆
  3. 自愈动作：调用项目自带 restart_server.py 精确重启（只杀 server.py，不误杀）
  4. 防风暴：1 小时内自动重启 >=3 次仍不健康则停止自动重启，等待人工
  5. 全程留痕：server/logs/evolution_watchdog.log + server/private/evolution_events.jsonl

用法：
  启动: python\\python.exe server\\evolution_watchdog.py start
  状态: python\\python.exe server\\evolution_watchdog.py status
  停止: python\\python.exe server\\evolution_watchdog.py stop
"""
import os
import sys
import json
import time
import subprocess
import urllib.request

_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_DIR, '..'))
_PRIVATE = os.path.join(_DIR, 'private')
_LOG = os.path.join(_DIR, 'logs', 'evolution_watchdog.log')
_EVENTS = os.path.join(_PRIVATE, 'evolution_events.jsonl')
_PID = os.path.join(_PRIVATE, 'evolution_watchdog.pid')
_HB = os.path.join(_PRIVATE, 'evolution_heartbeat.txt')
_RESTARTER = os.path.join(_DIR, 'restart_server.py')
_PY = os.path.join(_ROOT, 'python', 'python.exe')

CHECK_INTERVAL = 30          # 探活周期（秒）
HTTP_TIMEOUT = 5
HTTP_FAIL_LIMIT = 3          # 连续失败次数阈值
HB_MAX_AGE = 300             # 心跳最大年龄（秒）
HB_REVIVE_COOLDOWN = 300     # 【2026-11-25 alpha】http活但心跳停时，HTTP拉活尝试最小间隔（秒）
RESTART_COOLDOWN = 300       # 两次自动重启最小间隔（秒）
RESTART_WINDOW = 3600        # 防风暴统计窗口（秒）
RESTART_WINDOW_LIMIT = 3     # 窗口内最大自动重启次数


def _log(msg):
    try:
        os.makedirs(os.path.dirname(_LOG), exist_ok=True)
        with open(_LOG, 'a', encoding='utf-8') as f:
            f.write('%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg))
    except Exception:
        pass


def _event(kind, detail):
    try:
        os.makedirs(_PRIVATE, exist_ok=True)
        rec = {'ts': time.time(), 'time': time.strftime('%Y-%m-%d %H:%M:%S'),
               'kind': kind, 'detail': detail}
        with open(_EVENTS, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception:
        pass


def _http_alive():
    """探活主服务 8620 端口。"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:8620/api/chat-pool/config',
                                    timeout=HTTP_TIMEOUT) as r:
            return (200 <= r.status < 500), ('http %s' % r.status)
    except Exception as e:
        return False, str(e)[:120]


def _hb_age():
    try:
        with open(_HB, 'r', encoding='utf-8') as f:
            return max(0.0, time.time() - float(f.read().strip() or 0))
    except Exception:
        return None  # 心跳文件不存在（可能 schedule 未启动）→ 不据此判死


def _read_recent_restarts():
    """读窗口内自动重启次数。"""
    try:
        now = time.time()
        n = 0
        with open(_EVENTS, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get('kind') == 'auto_restart' and now - float(r.get('ts', 0)) < RESTART_WINDOW:
                    n += 1
        return n
    except Exception:
        return 0


def _last_restart_ts():
    try:
        best = 0.0
        with open(_EVENTS, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get('kind') == 'auto_restart':
                    best = max(best, float(r.get('ts', 0)))
        return best
    except Exception:
        return 0.0


def _do_restart(reason):
    n = _read_recent_restarts()
    if n >= RESTART_WINDOW_LIMIT:
        _log('STORM-GUARD: 1小时内已自动重启%d次，停止自动重启，等待人工介入' % n)
        _event('storm_guard', '1小时内自动重启达%d次，暂停自愈' % n)
        return False
    if time.time() - _last_restart_ts() < RESTART_COOLDOWN:
        _log('cooldown: 距上次自动重启不足%d秒，跳过' % RESTART_COOLDOWN)
        return False
    _log('AUTO-RESTART 触发: %s' % reason)
    _event('auto_restart', reason)
    try:
        # 用项目自带 restart_server.py：精确只杀 server.py，健康检查，不误杀
        p = subprocess.run([_PY, _RESTARTER], cwd=_ROOT,
                           capture_output=True, timeout=180)
        out = (p.stdout or b'').decode('utf-8', 'replace')[-500:]
        _log('restart exit=%s out=%s' % (p.returncode, out.replace('\n', ' | ')))
    except Exception as e:
        _log('restart EXC: %s' % e)
        _event('restart_error', str(e)[:200])
    # 重启后验证
    time.sleep(10)
    ok, why = _http_alive()
    _event('restart_verify', 'alive=%s (%s)' % (ok, why))
    _log('restart verify: alive=%s (%s)' % (ok, why))
    return ok


def _hb_revive(age):
    """【2026-11-25 alpha】http 活但心跳停 = 调度线程假活（07:55 实锤：autostart 线程
    创建成功却卡死不执行，running=True 且 is_alive，手动 start 被「已在运行中」拒绝）。
    唯一正道：经 HTTP 调 schedule restart 让 server 进程内部重建线程（非外部重启服务）。
    返回 True 表示调用成功；线程是否真复活由后续轮次心跳 age 验证。"""
    try:
        req = urllib.request.Request(
            'http://127.0.0.1:8620/api/tools/schedule',
            data=json.dumps({'action': 'restart', 'name': 'evolution_heartbeat'}).encode('utf-8'),
            headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=10) as r:
            body = (r.read() or b'').decode('utf-8', 'replace')[:200]
            ok = (r.status == 200) and ('"ok"' in body and 'true' in body)
        _log('hb revive via schedule restart: status=%s body=%s' % (r.status, body))
        _event('hb_revive', 'age=%.0fs resp=%s' % (age, body[:120]))
        return ok
    except Exception as e:
        _log('hb revive EXC: %s' % e)
        _event('hb_revive_error', str(e)[:200])
        return False


def watchdog_loop():
    http_fails = 0
    hb_alerted = False
    hb_last_revive = 0.0
    _log('watchdog loop start pid=%s' % os.getpid())
    while True:
        ok, why = _http_alive()
        if ok:
            if http_fails:
                _log('http recovered after %d fails' % http_fails)
            http_fails = 0
        else:
            http_fails += 1
            _log('http FAIL %d/%d: %s' % (http_fails, HTTP_FAIL_LIMIT, why))
            if http_fails >= HTTP_FAIL_LIMIT:
                # 【防误伤活跃任务】心跳新鲜(schedule每60s在写→服务进程线程还活着)
                # 说明只是 HTTP 层假性故障，不重启，降级观察一轮；
                # 心跳也停摆(>300s 或文件缺失)才判定服务真死，执行自愈重启。
                age_now = _hb_age()
                if age_now is not None and age_now < HB_MAX_AGE:
                    _log('http三连败但心跳新鲜(age=%.0fs)→判定假性故障，本轮不重启只观察'
                         % age_now)
                    _event('http_fail_but_alive', 'hb_age=%.0fs，跳过重启' % age_now)
                    http_fails = 0
                else:
                    _do_restart('http连续%d次探活失败(心跳age=%s): %s'
                                % (http_fails, 'stale' if age_now is not None else 'missing', why))
                    http_fails = 0

        age = _hb_age()
        if age is not None and age > HB_MAX_AGE:
            if not hb_alerted:
                _log('heartbeat stale age=%.0fs -> 触发自愈检查' % age)
                _event('hb_stale', 'heartbeat age=%.0fs' % age)
            ok2, why2 = _http_alive()
            if not ok2:
                _do_restart('心跳停摆%.0fs 且 http 不通: %s' % (age, why2))
            else:
                # 【2026-11-25 alpha】http 活但心跳停：不重启服务（会误杀活进程），
                # 改为 HTTP 拉活重建假活的调度线程；hb_last_revive 冷却 300s 防重试风暴
                now = time.time()
                if now - hb_last_revive >= HB_REVIVE_COOLDOWN:
                    if _hb_revive(age):
                        hb_last_revive = now
            hb_alerted = True  # 闩（静默重复报警）+冷却双保险，失败每 HB_REVIVE_COOLDOWN 重试
        else:
            hb_alerted = False
            hb_last_revive = 0.0

        time.sleep(CHECK_INTERVAL)


def _already_running():
    try:
        with open(_PID, 'r', encoding='utf-8') as f:
            pid = int(f.read().strip())
    except Exception:
        return 0
    if os.name == 'nt':
        # 【2026-11-25 修】中文 Windows tasklist 输出为 GBK，text=True 默认 utf-8
        # 解码会在 reader thread 抛 UnicodeDecodeError → 改读 bytes 自行容错解码
        r = subprocess.run(['tasklist', '/FI', 'PID eq %d' % pid],
                           capture_output=True)
        out = (r.stdout or b'').decode('gbk', 'replace')
        return pid if ('PID' in out and str(pid) in out) else 0
    try:
        os.kill(pid, 0)
        return pid
    except Exception:
        return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'start'
    if cmd == 'status':
        pid = _already_running()
        ok, why = _http_alive()
        age = _hb_age()
        print(json.dumps({'watchdog_pid': pid, 'http_alive': ok, 'http_why': why,
                          'heartbeat_age_s': age}, ensure_ascii=False))
        return
    if cmd == 'stop':
        pid = _already_running()
        if pid and os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(pid), '/F'], capture_output=True)
        try:
            os.remove(_PID)
        except Exception:
            pass
        _log('watchdog stopped by %s' % os.getpid())
        print('stopped (pid=%s)' % pid)
        return
    # start
    alive = _already_running()
    if alive:
        print('watchdog already running pid=%s' % alive)
        return
    os.makedirs(_PRIVATE, exist_ok=True)
    with open(_PID, 'w', encoding='utf-8') as f:
        f.write(str(os.getpid()))
    try:
        watchdog_loop()
    finally:
        try:
            os.remove(_PID)
        except Exception:
            pass


if __name__ == '__main__':
    main()
