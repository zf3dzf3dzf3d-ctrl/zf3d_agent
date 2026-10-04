# -*- coding: utf-8 -*-
# 拆分分段模块：由原 main_brain.py 按行段【无改动】切分，由同名门面加载合并。
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
主脑（Main Brain）v1 —— 项目级常驻观察者 + 事件驱动总结器 + 独立对话会话

【设计红线（坑1/坑2 防线，改代码前必读）】
坑1 · 大模型调用成本与车道占用：
  - 60 秒一轮只做【本地采集】（读文件、拼快照），绝不每轮都调大模型；
  - 大模型总结是【事件驱动 + 节流】：仅当出现 warn/error 事件、或事件池积累满
    POOL_FLUSH_N 条、或距上次总结超过 IDLE_SUMMARY_MIN 分钟且有新事件时才触发；
  - 总结 prompt 强制小而短（事件摘要行，非原文），失败静默降级（只落盘不重试轰炸）；
  - 总结调用走独立 urllib 直连，【不占用】chat_gate 车道，不影响正常对话。
坑2 · 上下文污染：
  - 主脑的一切消息（自动播报/总结/人工对话）【独立落盘】private/brain/，
    【绝不写入】用户对话的 history / ChatBox / agent 上下文；
  - 人工对话上下文回放只带最近 BRAIN_CTX_TURNS 轮 + memory.md 摘要，超限截断防爆炸；
  - events.jsonl 按天滚动，summaries.jsonl 只保留尾部 BRAIN_KEEP 条。
【采集清单（零侵入：只读文件与已有状态，不 hook 业务代码）】
  - 垃圾箱记录        private/垃圾箱/notes（若存在）
  - 工具结果打回存档  private/tool_result_archive/*.json（新文件数）
  - 闸门车道状态      chat_gate.status_snapshot()（内存直读）
  - 服务端错误        server.log 尾部新增的 ERROR/Traceback 行（若存在）
  - 任务清单          private/agent_steps/*.json（活跃会话数，只数不改）
【对外接口（给 routes 层用）】
  start_brain_thread(base_dir)      随 server.py 启动 daemon 线程
  get_state()  -> dict              运行状态 + 最近消息流（ summaries+chats 合并）
  brain_chat(text) -> dict         人工对话（带 memory.md 上下文，独立会话）
  brain_control(paused=None, auto_report=None) -> dict
"""
import os
import io
import re
import json
import time
import glob
import threading
import urllib.request

BRAIN_INTERVAL_DEFAULT = 60    # 采集周期默认值（秒）：1 分钟一轮，节省 token
POOL_FLUSH_N = 8               # 事件池积累 N 条触发一次总结
IDLE_SUMMARY_MIN = 30          # 无告警时最长 X 分钟必须总结一次（有新事件才算）
BRAIN_CTX_TURNS = 12           # 人工对话回放的最大消息条数
BRAIN_KEEP = 400               # summaries.jsonl 保留条数上限
MAX_EVENT_TEXT = 300           # 单条事件文本截断

_lock = threading.RLock()

# v4.6 主脑自动处置：卡死对话自动强制回收（True=开启）
_auto_recover = True
_recovered = {}   # ticket -> ts（防重复处置记录）
_started = False
_events = []                   # 事件池（未总结）
_history = []                  # 对话窗消息流 [{role, text, kind, ts}]  kind: auto/user/brain/summary
_memory = ''                   # 最近一次总结正文（memory.md）
_state = {
    'running': False, 'paused': False, 'auto_report': True, 'interval': BRAIN_INTERVAL_DEFAULT,
    'cycles': 0, 'last_cycle': 0, 'last_summary': 0,
    'llm_calls': 0, 'llm_errors': 0, 'events_total': 0,
}
_seen = {}                     # 去重表 {key: ts}

BRAIN_INTERVAL_MIN = 20        # 采集周期下限（秒），防止采集过密打爆 IO
BRAIN_INTERVAL_MAX = 600       # 采集周期上限（秒）
_interval = BRAIN_INTERVAL_DEFAULT   # 运行期实际采集周期（秒），可被 brain_control 修改


def _get_interval():
    return _interval


def _load_interval(base):
    """启动时从 private/brain/config.json 恢复采集周期。"""
    global _interval
    try:
        with open(os.path.join(_dir(base), 'config.json'), 'r', encoding='utf-8') as f:
            d = json.load(f)
        v = int(d.get('interval') or BRAIN_INTERVAL_DEFAULT)
        _interval = max(BRAIN_INTERVAL_MIN, min(BRAIN_INTERVAL_MAX, v))
    except Exception:
        _interval = BRAIN_INTERVAL_DEFAULT
    return _interval


def _save_interval(base):
    try:
        with open(os.path.join(_dir(base), 'config.json'), 'w', encoding='utf-8') as f:
            json.dump({'interval': _interval}, f, ensure_ascii=False)
    except Exception:
        pass

# ============================ 落盘 ============================

def _dir(base):
    d = os.path.join(base, 'private', 'brain')
    os.makedirs(d, exist_ok=True)
    return d


def _append_jsonl(path, obj, keep=None):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
        if keep:
            try:
                with open(path, 'r', encoding='utf-8-sig') as f:
                    lines = f.readlines()[-keep:]
                tmp = path + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    f.writelines(lines)
                os.replace(tmp, path)
            except OSError:
                pass
    except OSError:
        pass


def _save_memory(base, text):
    try:
        with open(os.path.join(_dir(base), 'memory.md'), 'w', encoding='utf-8') as f:
            f.write('# 主脑记忆（最近一次总结）\n\n' + text + '\n')
    except OSError:
        pass


# ============================ 采集器 ============================

def _dedup_key(kind, text):
    return kind + '|' + re.sub(r'\d+', 'N', text)[:120]


def _push_event(kind, level, text, base):
    """level: info/warn/error。去重窗口 5 分钟。"""
    now = time.time()
    key = _dedup_key(kind, text)
    with _lock:
        if now - _seen.get(key, 0) < 300:
            return
        _seen[key] = now
        # 去重表防膨胀
        if len(_seen) > 400:
            for k in list(_seen)[:200]:
                if now - _seen[k] > 600:
                    _seen.pop(k, None)
        _events.append({'kind': kind, 'level': level, 'text': text[:MAX_EVENT_TEXT], 'ts': now})
        _state['events_total'] += 1
        _history.append({'role': 'event', 'kind': kind, 'level': level,
                         'text': text[:MAX_EVENT_TEXT], 'ts': now})
        if len(_history) > 300:
            del _history[:-300]
    _append_jsonl(os.path.join(_dir(base), 'events.jsonl'),
                  {'kind': kind, 'level': level, 'text': text[:MAX_EVENT_TEXT],
                   'ts': time.strftime('%Y-%m-%d %H:%M:%S')}, keep=2000)


# ============================ CPU 监控（v4.7）============================

_cpu_last = 0.0          # 上次采样时间
_cpu_val = 0.0           # 上次采样值
_cpu_high_streak = 0     # 连续高于阈值的轮数
CPU_HIGH = 95            # 阈值（%）
CPU_STREAK_NEED = 2      # 连续 N 轮超阈值才告警/处置

# 本智能体服务自己的进程（启动时记录 PID，绝不误杀自己）
_self_pid = os.getpid()


def _is_zf_trash_proc(p):
    """判定是否为朱峰智能体系统遗留的垃圾 python 进程：
    python/pythonw 解释器、非本服务 PID、命令行里带本项目路径（旧脚本/旧服务残留）。"""
    try:
        if p.pid == _self_pid:
            return False
        name = (p.info.get('name') or '').lower()
        if 'python' not in name:
            return False
        cl = (p.info.get('cmdline') or [])
        if not cl:
            return False
        cmdline = ' '.join(cl)
        if '朱峰智能体智能体' not in cmdline:
            return False
        # 当前服务自己带 server/run.py 或 run.py，且是最新启动的——保护活服务
        if 'server\\run.py' in cmdline or 'server/run.py' in cmdline:
            try:
                cur = psutil.Process(_self_pid)
                curcl = ' '.join(cur.info.get('cmdline') or [])
                # 只有命令行完全相同才可能是自己（不同启动时间视为残留）
                if cmdline == curcl and p.create_time() < (cur.create_time() - 60):
                    return True
                return False
            except Exception:
                return False
        return True
    except Exception:
        return False


def _collect_cpu(base):
    """采集 CPU 使用率；连续超阈值则记录事件，并允许杀死遗留垃圾进程。"""
    global _cpu_last, _cpu_val, _cpu_high_streak
    try:
        import psutil
    except Exception:
        return
    now = time.time()
    try:
        if now - _cpu_last < 1:
            return
        _cpu_val = psutil.cpu_percent(interval=None)
        _cpu_last = now
    except Exception:
        return
    if _cpu_val < CPU_HIGH:
        _cpu_high_streak = 0
        return
    _cpu_high_streak += 1
    if _cpu_high_streak < CPU_STREAK_NEED:
        return
    _push_event('cpu', 'warn', '系统 CPU 使用率 %.1f%% 超过 %d%%（连续 %d 轮）'
                % (_cpu_val, CPU_HIGH, _cpu_high_streak), base)
    # 处置：只杀确认是朱峰智能体遗留的垃圾 python 进程
    try:
        procs = psutil.process_iter(['pid', 'name', 'cmdline'])
        for p in procs:
            if _is_zf_trash_proc(p):
                cl = ' '.join(p.info.get('cmdline') or [])[:150]
                p.kill()
                _push_event('cpu_kill', 'warn',
                            '已杀死朱峰智能体遗留垃圾进程 PID=%d（CPU 高负载处置）：%s' % (p.pid, cl), base)
    except Exception:
        pass


# 单进程高占用检查（v5.3）：某进程占用 ≥50% CPU 连续 2 轮则报警并给建议
PROC_CPU_HIGH = 50
_PROC_STREAK = 2
_proc_cpu_last = {}      # pid -> (上次采样时间, 上次 cpu_times)
_proc_high = {}          # pid -> 连续超阈值轮数
_proc_check_last = 0.0


def _check_proc_cpu(base):
    """逐进程 CPU 采样（增量法，无阻塞），发现单进程 ≥50% 持续超阈值则报警。"""
    import psutil
    global _proc_check_last
    now = time.time()
    if now - _proc_check_last < 5:      # 最少间隔 5s，保证增量窗口
        return
    _proc_check_last = now
    top = []
    try:
        for p in psutil.process_iter(['pid', 'name']):
            try:
                t = p.cpu_times()
                last = _proc_cpu_last.get(p.pid)
                _proc_cpu_last[p.pid] = (now, (t.user + t.system))
                if last is None:
                    continue
                dt = now - last[0]
                if dt <= 0:
                    continue
                pct = (t.user + t.system - last[1]) / dt * 100.0
                if pct >= 1.0:
                    top.append((pct, p.pid, p.info.get('name') or '?'))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        return
    # 清理已退出进程的缓存
    if len(_proc_cpu_last) > 500:
        _proc_cpu_last.clear()
    top.sort(reverse=True)
    high_pids = {pid for pct, pid, _ in top if pct >= PROC_CPU_HIGH}
    for pid in list(_proc_high):
        if pid not in high_pids:
            _proc_high.pop(pid, None)
    for pct, pid, name in top:
        if pct < PROC_CPU_HIGH:
            break
        _proc_high[pid] = _proc_high.get(pid, 0) + 1
        if _proc_high[pid] != _PROC_STREAK:
            continue
        others = '、'.join('%s(%.0f%%)' % (n, pc) for pc, _, n in top[:3] if _ != pid)
        _push_event('proc_cpu', 'error',
                    '进程 %s(PID=%d) 占用 CPU %.0f%%，超过 50%% 阈值（持续 %d 轮）。其余高占用：%s。'
                    '建议：1) 在任务管理器确认该进程是否为预期程序；'
                    '2) 若是未知/可疑程序，先杀毒扫描再处理；'
                    '3) 若为后台闲置程序（更新器/索引服务），可在其设置中关闭自启；'
                    '4) 确认无影响后再结束该进程，勿盲目结束系统进程。'
                    % (name, pid, pct, _PROC_STREAK, others or '无'), base)


# 线程数/句柄数泄漏监控（v5.3.1）：定位"越用越卡"
# 线程 >120 或 句柄 >3000 连续 3 轮则写日志告警，并给出 CPU 最高的线程来源进程
THREAD_HIGH = 120
HANDLE_HIGH = 3000
_PROC_STREAK_HT = 3
_proc_ht_streak = {}     # pid -> 连续超阈值轮数
_proc_ht_last = {}       # pid -> (threads, handles) 上次快照
_proc_ht_check_last = 0.0
_proc_ht_handled = set()  # 已自动处置过的 pid，每个 pid 只自动处置一次

# v5.3.4 系统/常见应用白名单（模块级，供线程/句柄扫描与自动处置共用）
_SYS_PROC_WHITELIST = {'system', 'system idle process', 'csrss.exe', 'wininit.exe',
                 'winlogon.exe', 'services.exe', 'lsass.exe', 'smss.exe',
                 'svchost.exe', 'explorer.exe', 'dwm.exe', 'python.exe',
                 # 常见用户应用白名单：QQ 等多进程 GUI 程序线程/句柄天然偏高，禁止自动 taskkill（仅报警观察）
                 'qq.exe', 'qqbrowser.exe', 'weixin.exe', 'wechat.exe', 'wechatappex.exe',
                 'chrome.exe', 'msedge.exe', 'firefox.exe', 'firefox_bin.exe',
                 'tim.exe', 'dingtalk.exe', 'feishu.exe', 'wps.exe', 'wpscloudsvr.exe',
                 'steam.exe', 'epicgameslauncher.exe', 'thunder.exe', 'cloudmusic.exe',
                 'kugou.exe', 'potplayer.exe', 'everything.exe', 'snipaste.exe',
                 'node.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'conhost.exe'}


def _auto_handle_leak(name, pid, th, hd, base):
    """v5.3.2 自动处置：发现疑似泄漏进程时，不等人工确认直接处理。
    策略：
    - 本项目相关 python/server 进程 → 调用 restart_server.py 重启后台（带锁，安全）
    - 其他非系统进程（浏览器等）     → taskkill /F 结束该进程（不杀进程树，避免误伤）
    - 系统关键进程白名单             → 只告警，不动手
    每个 PID 只自动处置一次（_proc_ht_handled），处置后重置计数。
    """
    import subprocess, sys, os as _os
    sys_whitelist = {'system', 'system idle process', 'csrss.exe', 'wininit.exe',
                     'winlogon.exe', 'services.exe', 'lsass.exe', 'smss.exe',
                     'svchost.exe', 'explorer.exe', 'dwm.exe', 'python.exe',
                     # v5.3.3 常见用户应用白名单：QQ 等多进程 GUI 程序线程/句柄天然偏高，禁止自动 taskkill（仅报警观察）
                     'qq.exe', 'qqbrowser.exe', 'weixin.exe', 'wechat.exe', 'wechatappex.exe',
                     'chrome.exe', 'msedge.exe', 'firefox.exe', 'firefox_bin.exe',
                     'tim.exe', 'dingtalk.exe', 'feishu.exe', 'wps.exe', 'wpscloudsvr.exe',
                     'steam.exe', 'epicgameslauncher.exe', 'thunder.exe', 'cloudmusic.exe',
                     'kugou.exe', 'potplayer.exe', 'everything.exe', 'snipaste.exe',
                     'node.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'conhost.exe'}
    n = (name or '').lower()
    if n in sys_whitelist:
        _push_event('proc_leak_auto', 'warn',
                    '进程 %s(PID=%d) 属系统/主服务进程，不自动结束，仅持续观察。'
                    % (name, pid), base)
        return False
    action = ''
    try:
        if 'python' in n:
            # 本项目后台进程：走统一带锁重启脚本
            script = _os.path.join(_os.path.dirname(_os.path.dirname(
                _os.path.abspath(__file__))), 'restart_server.py')
            if _os.path.exists(script):
                subprocess.Popen([sys.executable, script],
                                 cwd=_os.path.dirname(script),
                                 creationflags=0x00000008)  # DETACHED_PROCESS
                action = '已自动调用 restart_server.py 重启后台服务'
            else:
                subprocess.Popen(['taskkill', '/F', '/PID', str(pid)],
                                 creationflags=0x00000008)
                action = '已自动 taskkill 结束泄漏的 python 进程'
        else:
            subprocess.Popen(['taskkill', '/F', '/PID', str(pid)],
                             creationflags=0x00000008)
            action = '已自动 taskkill 结束泄漏进程'
    except Exception as e:
        _push_event('proc_leak_auto', 'error',
                    '自动处置进程 %s(PID=%d) 失败：%s，请人工处理。' % (name, pid, e), base)
        return False
    _push_event('proc_leak_auto', 'warn',
                '%s（原状态：线程 %d / 句柄 %d）。若 shortly 后复发将再次告警。'
                % (action, th, hd), base)
    return True


def _check_proc_handles_threads(base):
    """周期性扫描全进程线程数/句柄数，发现疑似泄漏的进程则告警，并自动处置。"""
    import psutil
    global _proc_ht_check_last
    now = time.time()
    if now - _proc_ht_check_last < 10:   # 最少间隔 10s，避免频繁全表扫描
        return
    _proc_ht_check_last = now
    alerts = []          # (name, pid, threads, handles, cpu_pct)
    try:
        for p in psutil.process_iter(['pid', 'name']):
            try:
                # v5.3.4 修复监控误报：System Idle Process（PID 0，线程/句柄数天然巨大）
                # 及系统/常用软件白名单进程直接跳过，不进入告警计数
                _pname = (p.info.get('name') or '').lower()
                if p.info['pid'] in (0, 4) or _pname in ('system idle process', 'system'):
                    continue
                if _pname in _SYS_PROC_WHITELIST:
                    continue
                th = p.num_threads()
                hd = p.num_handles() if hasattr(p, 'num_handles') else 0
                if th > THREAD_HIGH or hd > HANDLE_HIGH:
                    try:
                        cpu = p.cpu_percent(interval=None)
                    except Exception:
                        cpu = 0.0
                    alerts.append((p.info.get('name') or '?', p.pid, th, hd, cpu))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        return
    # 清理已退出进程的缓存
    live = {a[1] for a in alerts}
    for pid in list(_proc_ht_streak):
        if pid not in live:
            _proc_ht_streak.pop(pid, None)
            _proc_ht_last.pop(pid, None)
    _proc_ht_handled.intersection_update(live)
    for name, pid, th, hd, cpu in alerts:
        if pid in _proc_ht_handled:
            continue  # 已自动处置过，等其退出/重启后由清理逻辑解除标记
        _proc_ht_streak[pid] = _proc_ht_streak.get(pid, 0) + 1
        _proc_ht_last[pid] = (th, hd)
        if _proc_ht_streak[pid] != _PROC_STREAK_HT:
            continue
        _push_event('proc_leak', 'error',
                    '进程 %s(PID=%d) 疑似资源泄漏：线程 %d（阈值 %d）、句柄 %d（阈值 %d），'
                    '已连续 %d 轮超阈值，CPU 当前 %.0f%%。'
                    '建议：1) 若为本项目相关进程（python/server），优先重启该模块；'
                    '2) 若为浏览器/其他程序，尝试重启该程序；'
                    '3) 若反复出现，记录进程名以便后续专项排查。'
                    % (name, pid, th, THREAD_HIGH, hd, HANDLE_HIGH,
                       _PROC_STREAK_HT, cpu), base)
        # v5.3.2 自动处置：告警同时直接处理，避免"发现问题但没人管"
        try:
            if _auto_handle_leak(name, pid, th, hd, base):
                _proc_ht_streak[pid] = 0   # 处置后重置观察期
                _proc_ht_handled.add(pid)
        except Exception:
            pass


def _collect(base):
    """零侵入采集一轮，返回本轮新增事件数。"""
    n0 = len(_events)
    _collect_cpu(base)
    try:
        _check_proc_cpu(base)
    except Exception:
        pass
    try:
        _check_proc_handles_threads(base)
    except Exception:
        pass
    # 1. 工具结果打回存档：1 分钟内的新文件
    try:
        arch = os.path.join(base, 'private', 'tool_result_archive')
        if os.path.isdir(arch):
            cutoff = time.time() - _get_interval() * 2
            news = [p for p in glob.glob(os.path.join(arch, '*.json'))
                    if os.path.getmtime(p) > cutoff]
            for p in news[:3]:
                try:
                    with open(p, 'r', encoding='utf-8-sig') as f:
                        d = json.load(f)
                    _push_event('tool_reject', 'warn',
                                '工具结果被打回存档：%s（%s）' % (
                                    d.get('tool') or os.path.basename(p),
                                    str(d.get('reason') or '')[:120]), base)
                except (OSError, ValueError):
                    pass
    except Exception:
        pass
    # 2. 垃圾箱 notes：1 分钟内追加的危险操作记录
    try:
        trash_notes = os.path.join(base, 'private', '垃圾箱')
        if os.path.isdir(trash_notes):
            cutoff = time.time() - _get_interval() * 2
            for p in glob.glob(os.path.join(trash_notes, '*')):
                if os.path.isfile(p) and os.path.getmtime(p) > cutoff:
                    _push_event('trash', 'warn', '垃圾箱新记录：%s' % os.path.basename(p), base)
    except Exception:
        pass
    # 3. 闸门车道状态（内存直读，不占车道）
    try:
        import sys as _sys
        gp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if gp not in _sys.path:
            _sys.path.insert(0, gp)
        from chat_gate import status_snapshot
        snap = status_snapshot() or {}
        lanes = snap.get('lanes_detail') or []
        queued = int(snap.get('queue_len') or 0)
        if queued >= 6:
            _push_event('gate', 'warn', '闸门排队积压：%d 个请求排队（%d 车道）' % (queued, len(lanes)), base)
    except Exception:
        pass
    # 5. 对话健康监控：卡死的对话 + 长时间挂起/排队的请求
    try:
        act = snap.get('active') or snap.get('active_list') or []
        for it in act:
            if not isinstance(it, dict):
                continue
            st = it.get('state')
            box = it.get('box') or it.get('model') or '?'
            key = 'act_%s_%s' % (it.get('ticket'), st)
            if st == 'running' and (it.get('run_now') or 0) > 300:
                _push_event('chat_health', 'warn',
                            '对话疑似卡死：%s 已运行 %d 秒无响应（>5 分钟）' % (box, int(it['run_now'])), base)
                # v4.6 自动处置：运行超 10 分钟直接强制回收（闸门有 30 分钟兜底，这里提前介入）
                tk = it.get('ticket')
                if _auto_recover and (it.get('run_now') or 0) > 600 and tk:
                    try:
                        from chat_gate import force_recover
                        if force_recover(tk, '主脑自动处置：运行超 10 分钟无响应'):
                            with _lock:
                                _recovered[tk] = time.time()
                            _push_event('chat_health', 'error',
                                        '已自动强制回收卡死请求：%s（ticket=%s）' % (box, tk), base)
                    except Exception:
                        pass
            elif st == 'queued' and (it.get('wait_now') or 0) > 120:
                _push_event('chat_health', 'warn',
                            '对话请求排队过久：%s 已等待 %d 秒' % (box, int(it['wait_now'])), base)
            elif st == 'holding' and (it.get('hold_left') or 0) > 240:
                _push_event('chat_health', 'warn',
                            '对话长时间挂起（holding）：%s 剩余 %d 秒' % (box, int(it['hold_left'])), base)
        # 模型失败统计（对话错误痕迹）：fail 计数在 boxes 每个对话框条目里
        fails = sum(int((b.get('fail') or 0)) for b in (snap.get('boxes') or [])
                    if isinstance(b, dict))
        try:
            fails = int(fails)
        except (TypeError, ValueError):
            fails = 0
        with _lock:
            last_fail = _state.get('_last_fail_count') or 0
        if fails > last_fail:
            # v4.7 失败详情定位：从 boxes/history 里找最近失败条目，把模型箱/错误/时间直接带给主脑，便于就地修复
            _detail = ''
            try:
                _cand = [b for b in (snap.get('boxes') or [])
                         if isinstance(b, dict) and (int(b.get('fail') or 0) > 0)]
                # 按「最近失败时间优先、fail 次数次之」排序：避免陈旧高失败箱带偏主脑（v4.9）
                _cand.sort(key=lambda b: (int(b.get('last_fail_ts') or 0),
                                          int(b.get('fail') or 0)), reverse=True)
                if _cand:
                    _b = _cand[0]
                    _detail = ('失败次数最多的模型箱=%s | fail=%s | 状态=%s | 最近错误=%s | 失败时间=%s'
                               % (_b.get('box', _b.get('name', '?')), _b.get('fail'),
                                  _b.get('state', '?'),
                                  str(_b.get('last_fail_err') or _b.get('last_error') or _b.get('error') or '未见记录')[:200],
                                  (time.strftime('%H:%M:%S', time.localtime(_b['last_fail_ts']))
                                   if _b.get('last_fail_ts') else '未知')))
            except Exception:
                pass
            _push_event('chat_health', 'error',
                        ('检测到 %d 次新的对话请求失败（累计失败 %d）' % (fails - last_fail, fails))
                        + (('[详情] ' + _detail) if _detail else '（未能在 boxes 中定位失败明细，请查看闸门 lanes/history）'), base)
            # v4.8 自动熔断：同一模型箱鉴权类错误（HTTP 401/403）累计 fail>=5 时自动禁用该箱，
            # 后续请求被闸门 403 拒绝，避免持续无效重试刷屏。每箱只熔断一次，修复 Key 后在面板重新启用。
            # 注：判据是「累计失败次数」+「最近一次错误为鉴权类」（保守取向：若最后一次错误非鉴权类则不熔断）。
            try:
                from chat_gate import set_box_allowed
                _THRESH = 5
                for _b in (snap.get('boxes') or []):
                    if not isinstance(_b, dict):
                        continue
                    _bid = str(_b.get('box') or '')
                    _bfail = int(_b.get('fail') or 0)
                    _berr = str(_b.get('last_fail_err') or _b.get('last_error') or _b.get('error') or '')
                    if not _bid or _bfail < _THRESH:
                        continue
                    if ('401' not in _berr and '403' not in _berr and '鉴权' not in _berr):
                        continue
                    with _lock:
                        _dis = _state.get('_autodisabled') or {}
                    if _dis.get(_bid):
                        continue
                    if set_box_allowed(_bid, False,
                                       note='主脑自动熔断：鉴权类错误累计失败 %d 次，请检查该箱上游 API Key/额度后在闸门面板重新启用' % _bfail):
                        with _lock:
                            _state.setdefault('_autodisabled', {})[_bid] = time.time()
                        _push_event('chat_health', 'error',
                                    '已自动熔断模型箱 %s（fail=%d，最近错误=%s）：后续请求将被 403 拒绝，修复 Key 后请在闸门面板重新启用。'
                                    % (_bid, _bfail, _berr[:80]), base)
            except Exception as _fuse_err:
                print('[brain][熔断] 自动熔断执行失败: %r' % (_fuse_err,))
            # v4.7 自动处置：连续周期新增失败 >= 2 时，提示主脑直接执行修复动作
            with _lock:
                _new_fails = fails - last_fail
                _consec = (_state.get('_consec_fails') or 0) + 1
                _state['_consec_fails'] = _consec
            # 修复：仅在"本周期确实有新增失败"时递增连续计数，否则清零。
            # 原实现只要 fails>last_fail 就递增 consec，导致计数把"累积失败总数"
            # 当成新增失败，一旦某箱失败计数不清零，就会永久连续报 error。
            if _new_fails >= 1:
                _consec = (_state.get('_consec_new_fail') or 0) + 1
            else:
                _consec = 0
            with _lock:
                _state['_consec_new_fail'] = _consec
            if _consec >= 2 and _new_fails >= 2:
                _push_event('chat_health', 'error',
                            '连续 %d 个周期出现新失败（本轮 %d 次）：建议主脑直接修复——probe 上游模型可用性、临时禁用失败率最高的模型箱、或切换备用 lane。' % (_consec, _new_fails), base)
            with _lock:
                _state['_last_fail_count'] = fails
    except Exception:
        pass
    # 6. 对话沉默检测：sessions 表有活跃会话但 chat_history 长时间无新消息且车道在忙
    try:
        import sqlite3 as _sq
        dbp = os.path.join(os.path.dirname(base), 'private', 'db', 'zf3d_canvas.db')
        if not os.path.isfile(dbp):
            dbp = os.path.join(base, 'private', 'db', 'zf3d_canvas.db')
        if os.path.isfile(dbp):
            with _sq.connect(dbp, timeout=2) as _c:
                row = _c.execute('SELECT MAX(created_at) FROM chat_history').fetchone()
            last_msg = (row[0] / 1000.0) if row and row[0] else 0  # 毫秒时间戳转秒
            running_n = sum(1 for i in (act or []) if isinstance(i, dict) and i.get('state') == 'running')
            with _lock:
                prev_running = _state.get('_prev_running') or 0
                _state['_prev_running'] = running_n
            # 上轮在跑、这轮停了、但最近 10 分钟对话没有任何新消息 => 对话可能死掉
            if prev_running > 0 and running_n == 0 and last_msg and time.time() - last_msg > 600:
                _push_event('chat_health', 'error',
                            '对话疑似死亡：请求结束但超过 %d 分钟无任何新消息落库'
                            % int((time.time() - last_msg) / 60), base)
    except Exception:
        pass
    # 4. server.log 尾部错误行（增量读取）
    try:
        logp = os.path.join(base, 'server.log')
        if os.path.isfile(logp):
            posf = os.path.join(_dir(base), '.logpos')
            pos = 0
            try:
                with open(posf, 'r') as f:
                    pos = int(f.read().strip() or 0)
            except (OSError, ValueError):
                pos = max(0, os.path.getsize(logp) - 200000)  # 首次只看尾部 200KB
            size = os.path.getsize(logp)
            if size > pos:
                with open(logp, 'rb') as f:
                    f.seek(pos)
                    chunk = f.read(min(size - pos, 500000)).decode('utf-8', errors='replace')
                try:
                    with open(posf, 'w') as f:
                        f.write(str(size))
                except OSError:
                    pass
                errs = [ln for ln in chunk.splitlines()
                        if ('Traceback' in ln or ' ERROR ' in ln or ln.startswith('ERROR'))]
                for ln in errs[-5:]:
                    _push_event('server_log', 'error', ln.strip()[:200], base)
    except Exception:
        pass
    return len(_events) - n0


# ============================ 大模型调用（独立直连，不占车道） ============================

