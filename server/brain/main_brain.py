# -*- coding: utf-8 -*-
"""
主脑模块 —— 单文件真源（20261123 exec 拆分还原）

原 882 行曾按行段拆为 local_collect / llm_tools / state_loop 三段、
由门面 exec 拼接（旧"单文件≤300行"指标产物）。20261123 按策划案
Phase 0.2 按原加载顺序拼回本文件，语义零变化。
分段原文件归档于 archive/exec拆分还原备份-20261123/。
"""

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
import logging
import os
import io
import re
import json
import time
import glob
import shutil
import uuid

import psutil
import threading
import urllib.request

from util_log import get_logger

log = get_logger('main_brain')
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
        logging.debug("swallow", exc_info=True)

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
                logging.debug("swallow", exc_info=True)
    except OSError:
        logging.debug("swallow", exc_info=True)


def _save_memory(base, text):
    try:
        with open(os.path.join(_dir(base), 'memory.md'), 'w', encoding='utf-8') as f:
            f.write('# 主脑记忆（最近一次总结）\n\n' + text + '\n')
    except OSError:
        logging.debug("swallow", exc_info=True)


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
        logging.debug("swallow", exc_info=True)


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
    """【2026 用户禁令】彻底禁止自动结束/重启进程：只记录告警，绝不 taskkill，
    也绝不调用 restart_server.py。之前"疑似泄漏就自动处置"导致后台被反复
    无故重启、用户被踢出对话，永久禁用。保留函数签名兼容旧调用点。"""
    _push_event('proc_leak_auto', 'warn',
                '进程 %s(PID=%d) 疑似资源泄漏（线程 %d / 句柄 %d）——'
                '已按用户要求【不自动处置】，仅记录告警，请人工检查。'
                % (name, pid, th, hd), base)
    return False


def _check_proc_handles_threads(base):
    """周期性扫描全进程线程数/句柄数，发现疑似泄漏的进程则记录告警（不自动处置）。"""
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
                    '【系统已禁用自动处置】请人工检查该进程是否确有泄漏后再决定是否重启。'
                    % (name, pid, th, THREAD_HIGH, hd, HANDLE_HIGH,
                       _PROC_STREAK_HT, cpu), base)
        # v5.3.2 自动处置：告警同时直接处理，避免"发现问题但没人管"
        try:
            if _auto_handle_leak(name, pid, th, hd, base):
                _proc_ht_streak[pid] = 0   # 处置后重置观察期
                _proc_ht_handled.add(pid)
        except Exception:
            logging.debug("swallow", exc_info=True)


def _collect(base):
    """零侵入采集一轮，返回本轮新增事件数。"""
    n0 = len(_events)
    _collect_cpu(base)
    try:
        _check_proc_cpu(base)
    except Exception:
        logging.debug("swallow", exc_info=True)
    try:
        _check_proc_handles_threads(base)
    except Exception:
        logging.debug("swallow", exc_info=True)
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
                    logging.debug("swallow", exc_info=True)
    except Exception:
        logging.debug("swallow", exc_info=True)
    # 2. 垃圾箱 notes：1 分钟内追加的危险操作记录
    try:
        trash_notes = os.path.join(base, 'private', '垃圾箱')
        if os.path.isdir(trash_notes):
            cutoff = time.time() - _get_interval() * 2
            for p in glob.glob(os.path.join(trash_notes, '*')):
                if os.path.isfile(p) and os.path.getmtime(p) > cutoff:
                    _push_event('trash', 'warn', '垃圾箱新记录：%s' % os.path.basename(p), base)
    except Exception:
        logging.debug("swallow", exc_info=True)
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
        logging.debug("swallow", exc_info=True)
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
                        logging.debug("swallow", exc_info=True)
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
                logging.debug("swallow", exc_info=True)
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
                    if ('429' in _berr or '限流' in _berr or '速率' in _berr or '频繁' in _berr):
                        # 限流类错误是暂时的，等一等即恢复，不熔断。其错误文本常混有 403 字样
                        # （中转错误页），2026-11-24 智谱线 429 风暴即被误判为鉴权失败，把
                        # 好端端的老对话成批熔死——限流一律放行自愈。
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
                # 熔断自动解除（2026-11-24 事故复盘）：自动熔断满 10 分钟由主脑巡检自动解禁，
                # 不再把老对话永久卡死——上游风波过去后对话自愈；Key 真失效时下个周期会再次
                # 攒满失败并重新熔断，告警信号不丢。面板手动设的【不通过】不在此登记，不受影响。
                with _lock:
                    _fused = dict(_state.get('_autodisabled') or {})
                for _bid, _ts in _fused.items():
                    if time.time() - (_ts or 0) < 600:
                        continue
                    try:
                        if set_box_allowed(_bid, True,
                                           '自动熔断满10分钟，已由主脑巡检自动解除；若仍鉴权失败将再次熔断'):
                            with _lock:
                                (_state.get('_autodisabled') or {}).pop(_bid, None)
                            _push_event('chat_health', 'info',
                                        '模型箱 %s 的自动熔断已到期自动解除' % _bid, base)
                    except (OSError, TypeError, ValueError) as _rel_err:
                        # 写盘失败（磁盘/JSON 序列化）：下轮巡检会重试同一箱，不致命
                        log.info('[brain][熔断] 自动解除写盘失败(下轮巡检重试): %r' % (_rel_err,))
            except Exception as _fuse_err:
                log.error('[brain][熔断] 自动熔断执行失败: %r' % (_fuse_err,))
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
        logging.debug("swallow", exc_info=True)
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
        logging.debug("swallow", exc_info=True)
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
                    logging.debug("swallow", exc_info=True)
                errs = [ln for ln in chunk.splitlines()
                        if ('Traceback' in ln or ' ERROR ' in ln or ln.startswith('ERROR'))]
                for ln in errs[-5:]:
                    _push_event('server_log', 'error', ln.strip()[:200], base)
    except Exception:
        logging.debug("swallow", exc_info=True)
    return len(_events) - n0


# ============================ 大模型调用（独立直连，不占车道） ============================


# -*- coding: utf-8 -*-
# 拆分分段模块：由原 main_brain.py 按行段【无改动】切分，由同名门面加载合并。
# 注：本分段模块被门面加载时依赖门面已导入的 os/json/re 等；为支持隔离加载，
#     此处显式补 import re（_strip_cot 依赖）。
import re  # noqa: F401  (_strip_cot 使用)
def _load_model_cfg(base):
    try:
        cfgp = os.path.join(base, 'public', 'config', 'models.json')
        with open(cfgp, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        models = [m for m in (data.get('models') or []) if m.get('enabled')]
        if not models:
            return None
        # v5.7 修复：排除 3D 生成/视频/生图等非聊天线路，只从 chat/completions 线路中选默认
        def _is_chat(m):
            u = str(m.get('endpoint') or m.get('baseUrl') or '').lower()
            return ('chat/completions' in u) or (str(m.get('provider') or '') == 'zhufeng')
        chat_models = [m for m in models if _is_chat(m)]
        pool = chat_models or models
        # 第6轮兜底（2026-11-23）：后台改写进程两次实锤让多行同时 isDefault（relay 中转线
        # 抢数组序第一 → 村民线路 401/无工具，见 models.json isDefault 三重奏事件）。
        # 多默认时优先「非中转直连」线，全是中转才回落数组序第一；单默认行为不变。
        _defaults = [m for m in pool if m.get('isDefault')]
        if _defaults:
            _direct = [m for m in _defaults
                       if 'zf_models_relay' not in str(m.get('endpoint') or m.get('baseUrl') or '').lower()]
            model = (_direct or _defaults)[0]
        else:
            model = pool[0]
        # key：private/api_keys.json 按 provider+尾号
        key = ''
        try:
            with open(os.path.join(base, 'private', 'api_keys.json'), 'r', encoding='utf-8-sig') as f:
                keys = json.load(f)
            if isinstance(keys, dict):
                items = keys.get('keys') or keys.get('items') or []
                if isinstance(items, list):
                    tail = str(model.get('keyTail') or model.get('apiKeyTail') or '')
                    for it in items:
                        if str(it.get('tail') or '') == tail or (not tail and it.get('provider') == model.get('provider')):
                            key = str(it.get('key') or '')
                            break
                elif isinstance(items, dict):
                    # v5.7 修复：优先按「模型名称/提供方名称」精确匹配，再按 URL 特征兜底
                    mname = str(model.get('name') or '').strip()
                    pname = str(model.get('providerName') or mname).strip()
                    if mname and items.get(mname):
                        key = str(items[mname])
                    elif pname and pname != mname and items.get(pname):
                        key = str(items[pname])
                    if not key:
                        url = str(model.get('endpoint') or model.get('baseUrl') or '').lower()
                        name_map = [('bigmodel', '智谱 GLM'), ('ark', '火山方舟'), ('volces', '火山方舟'),
                                    ('deepseek', 'DeepSeek'), ('siliconflow', '硅基流动')]
                        for pat, name in name_map:
                            if pat in url and items.get(name):
                                key = str(items[name])
                                break
                    if not key:
                        for v in items.values():
                            if v:
                                key = str(v)
                                break
        except (OSError, ValueError):
            logging.debug("swallow", exc_info=True)
        # v3 dpapi 加密 key 解密（secure_store.decrypt_value，明文原样返回）
        try:
            import sys as _sys, os as _os
            _sd = _os.path.dirname(_os.path.abspath(__file__))
            if _sd not in _sys.path:
                _sys.path.insert(0, _sd)
            from secure_store import decrypt_value as _dv
            key = _dv(key)
        except Exception:
            if str(key).startswith('dpapi:'):
                key = ''  # 解密失败宁缺勿泄
        url = model.get('endpoint') or model.get('baseUrl') or ''
        return {'url': url, 'key': key, 'model': model.get('modelId') or model.get('name') or ''}
    except Exception:
        return None


def _call_llm(base, messages, max_tokens=600, temperature=0.4, tools=None):
    """独立 urllib 直连 chat/completions，失败返回 None（静默降级）。
    v4.8 带 tools 时返回原始 message dict（含 tool_calls），否则返回纯文本。"""
    cfg = _load_model_cfg(base)
    if not cfg or not cfg['url']:
        with _lock:
            _state['llm_errors'] += 1
            if not cfg:
                _state['llm_last_error'] = '未取到模型配置（模型未选择或 models.json 不可读）'
            elif not cfg['url']:
                _state['llm_last_error'] = '模型配置缺少 endpoint/baseUrl（url 为空）'
        return None
    if not cfg['key'] and 'zf_models_relay' not in str(cfg['url'] or ''):
        # 2026-11-21 i小镇收口：官方中转线路 zf_models_relay 鉴权走下方 X-ZF-Key 注入，
        # 无需 private/api_keys.json 的 Bearer key；仅非 relay 线路才因缺 key 拒发。
        with _lock:
            _state['llm_errors'] += 1
            _state['llm_last_error'] = '线路未配置 API Key（或 dpapi 解密失败），已拒绝发送：%s' % cfg['url'][:80]
        return None
    try:
        payload = {'model': cfg['model'], 'messages': messages,
                   'stream': False, 'max_tokens': max_tokens,
                   'temperature': temperature}
        if tools:
            payload['tools'] = tools
        req = urllib.request.Request(cfg['url'], data=json.dumps(payload).encode('utf-8'), method='POST')
        req.add_header('Content-Type', 'application/json')
        if cfg['key']:
            req.add_header('Authorization', 'Bearer ' + cfg['key'])
        # 【2026-10-28 修复】官方中转线路 zf_models_relay 需 X-ZF-Key + X-ZF-User 鉴权。
        # main_brain._call_llm 是独立 urllib 直连路径，2026-10-26 那次补头只改了
        # routes/mixin_proxy(_stream).py，漏了这条，导致专家团自动生成等经 main_brain
        # 的调用在默认 relay 线路上 401 no-key | loginUid=0。此处与 proxy 路径对齐。
        # 向后兼容：仅当 url 是朱峰官方中转域名才注入，第三方线路零影响。
        # 【P0-2 收编 20261123】子串判定改 security.is_zf_relay_url 域名精确匹配。
        import security as _sec
        if _sec.is_zf_relay_url(cfg['url']):
            try:
                import sys as _sys
                _srv = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                if _srv not in _sys.path:
                    _sys.path.insert(0, _srv)
                from zf3d_commands import _get_api_key as _zf_gk
                _zf_key = _zf_gk() or ''
                if _zf_key:
                    req.add_header('X-ZF-Key', _zf_key)
                    try:
                        from zf3d_heartbeat import _get_login_status as _zf_gls
                        _ls, _lu, _zf_uid = _zf_gls()
                        if _zf_uid and int(_zf_uid) > 0:
                            req.add_header('X-ZF-User', str(_zf_uid))
                    except Exception:
                        logging.debug("swallow", exc_info=True)
            except Exception as _zf_e:
                log.info('[main_brain._call_llm] relay header inject failed: %r' % _zf_e)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=60) as resp:
                data = json.loads(resp.read().decode('utf-8', errors='replace'))
        except urllib.error.HTTPError as e:
            body = ''
            try:
                body = e.read().decode('utf-8', errors='replace')[:300]
            except Exception:
                logging.debug("swallow", exc_info=True)
            with _lock:
                _state['llm_errors'] += 1
                _state['llm_last_error'] = f'HTTP {e.code} {cfg["url"][:80]} {body}'
            return None
        msg = ((data.get('choices') or [{}])[0]).get('message') or {}
        if tools:
            return msg or None
        out = str(msg.get('content') or '').strip()
        if not out:
            # 推理模型：content 为空时回退 reasoning_content
            out = str(msg.get('reasoning_content') or '').strip()
        return out or None
    except urllib.error.HTTPError as e:
        _err_body = ''
        try:
            _err_body = e.read().decode('utf-8', errors='replace')[:300]
        except Exception:
            logging.debug("swallow", exc_info=True)
        with _lock:
            _state['llm_errors'] += 1
            _state['llm_last_error'] = 'HTTP %s %s: %s' % (e.code, e.reason, _err_body)
        return None
    except Exception as e:
        with _lock:
            _state['llm_errors'] += 1
            _state['llm_last_error'] = '%s: %s' % (type(e).__name__, str(e)[:300])
        return None


# ============================ 极简工具集（v4.8 主脑就地修复能力） ============================
import subprocess

_FJ = {'type': 'string', 'description': '相对项目根目录的路径'}
BRAIN_TOOLS_SPEC = [
    {'type': 'function', 'function': {'name': 'read_file', 'description': '读取项目内文本文件（最多 8000 字符）',
        'parameters': {'type': 'object', 'properties': {'path': _FJ}, 'required': ['path']}}},
    {'type': 'function', 'function': {'name': 'write_file', 'description': '写入/覆盖项目内文本文件（原文件自动备份 .bak）',
        'parameters': {'type': 'object', 'properties': {'path': _FJ, 'content': {'type': 'string', 'description': '完整文件内容'}}, 'required': ['path', 'content']}}},
    {'type': 'function', 'function': {'name': 'run_code', 'description': '在项目根目录执行 shell 命令（限时 30 秒，输出截断 4000 字符），用于诊断与修复验证',
        'parameters': {'type': 'object', 'properties': {'code': {'type': 'string', 'description': 'shell 命令'}}, 'required': ['code']}}},
    {'type': 'function', 'function': {'name': 'search_in_files', 'description': '在项目目录内按关键词搜索文件内容（返回匹配行）',
        'parameters': {'type': 'object', 'properties': {'keyword': {'type': 'string'}, 'path': {'type': 'string', 'description': '搜索根目录，默认 server'}}, 'required': ['keyword']}}},
    {'type': 'function', 'function': {'name': 'console', 'description': '模型直连指挥台控制台。action=exec 执行 shell 命令（与指挥台同一通道，受 ZF_PYCONSOLE 与 ZF_AGENT_CONSOLE 双开关控制）；action=history 回读指挥台最近执行记录（含用户与模型的执行历史）。',
        'parameters': {'type': 'object', 'properties': {'action': {'type': 'string', 'enum': ['exec', 'history']}, 'code': {'type': 'string'}, 'limit': {'type': 'integer'}}, 'required': ['action']}}},
]

# 【2026-10-12】按开关动态组装：ZF_AGENT_CONSOLE=off 时不下发 console schema（执行层双闸仍兜底）
def _brain_tools_spec():
    _spec = list(BRAIN_TOOLS_SPEC)
    if os.environ.get('ZF_AGENT_CONSOLE', 'off').lower() != 'on':
        return [t for t in _spec if t.get('function', {}).get('name') != 'console']
    return _spec


def _safe_path(base, p):
    """路径收敛到项目根目录内，防越界。返回绝对路径或 None。"""
    p = str(p or '').strip()
    if not p:
        return None
    root = os.path.abspath(base)
    ap = os.path.abspath(os.path.join(root, p))
    if ap != root and not ap.startswith(root + os.sep):
        return None
    return ap


def _brain_tool_exec(base, name, args):
    """执行主脑工具，返回字符串结果（直接给回模型）。含埋点统计。"""
    _t0 = time.time()
    _out = _brain_tool_exec_inner(base, name, args)
    try:
        from engines.common import tool_stats
        tool_stats.record(name, 'brain', not str(_out or '').startswith(('错误', '工具执行异常')),
                          (time.time() - _t0) * 1000.0)
    except Exception:
        logging.debug("swallow", exc_info=True)
    return _out


# ---- 2026-11-22 安全专项·步骤一拆分：按工具类型抽小函数，shell=True 统一收口 _tool_shell ----
def _tool_read(base, args):
    ap = _safe_path(base, args.get('path'))
    if not ap or not os.path.isfile(ap):
        return '错误：文件不存在或路径越界：%s' % args.get('path')
    with io.open(ap, 'r', encoding='utf-8', errors='replace') as f:
        return f.read(8000)


def _tool_write(base, args):
    ap = _safe_path(base, args.get('path'))
    if not ap:
        return '错误：路径越界或为空'
    # 黑板写前检查：防多智能体并发写同一文件冲突
    try:
        from engines.common import project_blackboard as _pbb
        if _pbb.bb_enabled():
            _owner = 'main-brain:%s' % uuid.uuid4().hex[:8]
        _r = _pbb.bb_acquire('brain', [ap], _owner, role='brain:write_file', hint='')
        if not _r.get('ok'):
            _cs = _r.get('conflicts') or []
            _who = '、'.join(str(c.get('owner') or '?') for c in _cs)
            return '⛔ 黑板占用冲突：%s 正在被 %s 开发，请稍后再试或提醒用户裁决。' % (os.path.basename(ap), _who)
        try:
            _pbb.bb_release('brain', [ap], _owner)
        except Exception:
            logging.debug("swallow", exc_info=True)
    except Exception:
        logging.debug("swallow", exc_info=True)
    os.makedirs(os.path.dirname(ap) or base, exist_ok=True)
    if os.path.isfile(ap) and not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.git')):
        shutil.copy2(ap, ap + '.bak')  # 仅非 git 环境备份
    with io.open(ap, 'w', encoding='utf-8') as f:
        f.write(str(args.get('content') or ''))
    return 'OK：已写入 %s（%d 字符，原文件备份为 .bak）' % (args.get('path'), len(str(args.get('content') or '')))


def _tool_console(base, args):
    # 【2026-10-12】模型直连控制台：双开关（ZF_PYCONSOLE 总闸 + ZF_AGENT_CONSOLE 暴露闸）
    if os.environ.get('ZF_AGENT_CONSOLE', 'off').lower() != 'on':
        return 'console 工具未启用（设置环境变量 ZF_AGENT_CONSOLE=on 后重启生效）'
    try:
        from routes.mixin_pyconsole import pyconsole_exec_direct, pyconsole_history_snapshot
        if args.get('action') == 'history':
            items = pyconsole_history_snapshot(int(args.get('limit') or 20))
            if not items:
                return '（指挥台暂无执行记录）'
            return '\n'.join('[%s %s] exit=%s\n%s\n%s' % (it.get('kind'), it.get('ts'), it.get('exit'), it.get('code'), str(it.get('output') or '')[:1500]) for it in items)
        r = pyconsole_exec_direct(args.get('code'), base, kind='agent')
        if r.get('ok'):
            return 'exit=%d\n%s' % (r['exit'], str(r['output'] or '')[:3000])
        return '错误：%s' % r.get('error')
    except Exception as e:
        return 'console 工具异常：%s' % e


def _tool_shell(base, args):
    """run_code 执行：shell=True 在本模块内【仅此处出现】（后续命令审计唯一挂点）。"""
    code = str(args.get('code') or '').strip()
    if not code:
        return '错误：命令为空'
    # 路径守卫：拦截对运行环境/项目外的写、删、移动（P0 防线，异常放行不影响主流程）
    try:
        from path_guard import guard_run_code
        _allow, _msg = guard_run_code(code, base)
        if not _allow:
            return _msg
    except Exception:
        logging.debug("swallow", exc_info=True)
    # 防刷熔断：拦截无业务含义的重复占位命令（异常放行不影响主流程）
    try:
        from echo_breaker import check_echo_loop
        _blk = check_echo_loop(code)
        if _blk:
            return _blk
    except Exception:
        logging.debug("swallow", exc_info=True)
    try:
        from engines.common.shell_exec import _inject_git_c
        code = _inject_git_c(code, base)
        # P0 沙箱：统一走 Job Object 资源围栏（off/非 Windows/导入失败时直通）
        _sandbox_hit = False
        try:
            from engines.common.sandbox import sandbox_mode as _sm, run_isolated as _ri
            if _sm() == 'job':
                r = _ri(code, timeout=30, cwd=base, shell=True)  # shell=True 收口点①
                _sandbox_hit = True
        except ImportError:
            logging.debug("swallow", exc_info=True)
        if not _sandbox_hit:
            r = subprocess.run(code, shell=True, cwd=base, capture_output=True,  # shell=True 收口点②
                               timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = r.stdout.decode('utf-8', errors='replace')[:3000]
        err = r.stderr.decode('utf-8', errors='replace')[:1000]
        return 'exit=%d\nstdout:\n%s\nstderr:\n%s' % (r.returncode, out or '（空）', err or '（空）')
    except subprocess.TimeoutExpired:
        return '错误：命令超时（30 秒上限）'


def _tool_search_files(base, args):
    kw = str(args.get('keyword') or '')
    root = _safe_path(base, args.get('path') or 'server') or base
    hits = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in ('.git', 'node_modules', '__pycache__', 'private')]
        for fn in fns:
            if len(hits) >= 20:
                break
            if not fn.endswith(('.py', '.js', '.json', '.html', '.css', '.md', '.txt', '.log')):
                continue
            fp = os.path.join(dp, fn)
            try:
                with io.open(fp, 'r', encoding='utf-8', errors='replace') as f:
                    for i, ln in enumerate(f, 1):
                        if kw in ln:
                            hits.append('%s:%d: %s' % (os.path.relpath(fp, base), i, ln.strip()[:200]))
                            if len(hits) >= 20:
                                break
            except OSError:
                logging.debug("swallow", exc_info=True)
    return '\n'.join(hits) if hits else '无匹配（或超过 20 条截断）'


def _brain_tool_exec_inner(base, name, args):
    """执行主脑工具（原实现，埋点由外层 _brain_tool_exec 负责）。已按工具类型拆分为小函数，此处仅分发。"""
    try:
        if name == 'read_file':
            return _tool_read(base, args)
        if name == 'write_file':
            return _tool_write(base, args)
        if name == 'console':
            return _tool_console(base, args)
        if name == 'run_code':
            return _tool_shell(base, args)
        if name == 'search_in_files':
            return _tool_search_files(base, args)
        # 【2026-10-01 修复】智能体广场三工具接入（发帖失败"未知工具"）
        if name in ('forum_read', 'forum_write', 'forum_reply'):
            try:
                from engines.common.forum_bbs_bridge import forum_exec as _fx
                return _fx(name, args)
            except Exception as _fe:
                return '错误：广场工具加载失败 %s' % _fe
        # 【2026-10-02】图片工作台 AI 工具接入（wb_list/wb_apply，识图修图一句话完成）
        if name in ('wb_list', 'wb_apply'):
            try:
                from engines.common.workbench_bridge import workbench_exec as _wx
                return _wx(name, args)
            except Exception as _we:
                return '错误：工作台工具加载失败 %s' % _we
        return '错误：未知工具 %s' % name
    except Exception as e:
        return '工具执行异常：%s' % e


BRAIN_MAX_TOOL_ROUNDS = 8   # 单次人工对话最多工具往返轮数



SUMMARY_PROMPT = (
    '你是本项目的「主脑」：一个持续观察项目运行状态的大模型助手。'
    '下面是最近采集到的系统事件摘要（可能为空表示一切平稳）。'
    '请用中文输出一段 200 字以内的状态总结：先一句话总评，再列出需要注意的点（如有 warn/error 逐条给出建议）。'
    '语气简洁专业，不要客套。'
)


_COT_MARKERS = ('Let me analyze', 'Let me think', '<think>', '</think>',
                'First,', 'Okay,', "I'll ", "I'm going to", 'Alright,',
                'The user wants', 'I need to output', 'Let me', 'I should')


def _strip_cot(text):
    """剥离主脑输出中混入的英文思维链/推理草稿，只保留最终中文结论。

    v3 策略（修复 v2 两个 bug：取最后一个结论行会吃掉总评段；截断后不复检）：
    ① 剔除 <think>...</think>；
    ② 起点取【第一个】中文结论前缀行（保住"总评+注意点"两段式的第一段）；
    ③ 终点：从起点向后找第一个含 CoT 标记的行，截断到它之前（用标记定终点）；
    ④ 脏输出校验：中文占比过低 / 中文字数过少视为脏输出，返回 None；
    ⑤ 长度保护：超 500 字截断，末行无结尾标点视为被截断的半句，剔除；
    ⑥ 截断/剔除后【复跑】④ 校验，内容太少同样返回 None（防退化成孤行残条）。
    返回干净结论文本；判定为脏输出时返回 None（由调用方决定重试/丢弃）。
    """
    _COT_MARKERS_LOCAL = _COT_MARKERS + ('Also', 'Note:', 'Actually', 'Draft')
    def _validate(s):
        if not s:
            return None
        cjk = len(re.findall(r'[\u4e00-\u9fff]', s))
        if cjk < 15 or cjk * 10 < len(s) * 3:
            return None
        return s
    if not text:
        return None
    _CONC_PREFIX = ('总结', '总评', '结论', '注意', '问题', '建议', '状态', '本次', '当前', '项目', '系统', '无新', '无报错', '无异常')
    def _is_conclusion(s):
        if not s or not any(s.startswith(p) for p in _CONC_PREFIX):
            return False
        cjk = len(re.findall(r'[\u4e00-\u9fff]', s))
        return cjk * 10 > len(s) * 3  # 该行中文占比 > 30%
    # ① 剔除 <think>...</think>
    text = re.sub(r'<think>[\s\S]*?(</think>|$)', '', text).strip()
    if not text:
        return None
    lines = text.splitlines()
    # ② 找第一个结论行起点
    start = -1
    for i, ln in enumerate(lines):
        if _is_conclusion(ln.strip()):
            start = i
            break
    if start < 0:
        # 无任何结论前缀行：若整体中文占优且长度合理，视为干净直出
        cjk = len(re.findall(r'[\u4e00-\u9fff]', text))
        if cjk * 2 > len(text) and len(text) <= 400:
            return text
        return None
    # ③ 从起点向后找第一个含 CoT 标记的行，截断到它之前
    end = len(lines)
    for i in range(start, len(lines)):
        s = lines[i].strip()
        if s and any(m in s for m in _COT_MARKERS_LOCAL):
            end = i
            break
    out = '\n'.join(lines[start:end]).strip()
    # ④ 脏输出校验
    out = _validate(out)
    if not out:
        return None
    # ⑤ 长度保护 + 末尾半句剔除
    out = out[:500]
    last = out.rstrip().splitlines()[-1].rstrip()
    if last and not last.endswith(('。', '！', '？', '；', '：', '.', '!', '?', ';', ':', '）', ')', '"', '」')):
        out = '\n'.join(out.rstrip().splitlines()[:-1]).rstrip()
    # ⑥ 截断/剔除后复跑校验，防退化成孤行残条
    return _validate(out)


def _do_summary(base, why=''):
    """事件驱动总结：取事件池 → 调 LLM → 落盘 summaries/memory → 播报。"""
    with _lock:
        batch = _events[:]
        _events[:] = []
    if not batch and why not in ('manual', '手动触发'):
        return
    lines = ['[%s][%s][%s] %s' % (
        time.strftime('%H:%M:%S', time.localtime(e['ts'])), e['level'], e['kind'], e['text'])
        for e in batch[-40:]]
    user_msg = ('触发原因：%s\n事件池：%d 条\n\n%s' % (why or '定时', len(batch),
                '\n'.join(lines) or '（无新事件，项目平稳运行）'))
    out = _call_llm(base, [{'role': 'system', 'content': SUMMARY_PROMPT},
                           {'role': 'user', 'content': user_msg[:6000]}])
    with _lock:
        _state['llm_calls'] += 1
        _state['last_summary'] = time.time()
    if not out:
        with _lock:
            _llm_err = _state.get('llm_last_error') or '未知原因（可能未配置模型）'
        out = ('（主脑：本次大模型总结调用失败，已静默降级。事件 %d 条已记录在 events.jsonl。'
               '[失败原因] %s。%s）' % (len(batch), _llm_err, lines[-1] if lines else ''))
        out = _strip_cot(out) or ('（主脑：本次总结输出为脏数据（思维链草稿），已丢弃。事件 %d 条见 events.jsonl。）' % len(batch))
    else:
        cleaned = _strip_cot(out)
        if not cleaned:
            # 脏输出：整段思维链/英文草稿 → 重试一次（禁思考、强调纯中文直接输出）
            retry = _call_llm(base, [
                {'role': 'system', 'content': SUMMARY_PROMPT + '\n【重要】直接输出最终中文总结正文，禁止任何思考过程、英文或草稿。'},
                {'role': 'user', 'content': user_msg[:6000]}])
            with _lock:
                _state['llm_calls'] += 1
            cleaned = _strip_cot(retry) if retry else None
        out = cleaned if cleaned else ('（主脑：本次总结输出为脏数据（思维链草稿），已丢弃。事件 %d 条见 events.jsonl。）' % len(batch))
    rec = {'ts': time.time(), 'time': time.strftime('%Y-%m-%d %H:%M:%S'),
           'why': why, 'events': len(batch), 'text': out}
    _append_jsonl(os.path.join(_dir(base), 'summaries.jsonl'), rec, keep=BRAIN_KEEP)
    # 脏输出（重试后仍为思维链草稿）不覆盖 memory.md，保留上一版干净记忆
    if not out.startswith('（主脑：本次总结输出为脏数据'):
        _save_memory(base, '时间：%s\n触发：%s\n事件数：%d\n\n%s' % (rec['time'], why, len(batch), out))
    with _lock:
        _memory = out
        globals()['_memory'] = out
        _history.append({'role': 'brain', 'kind': 'summary', 'level': 'warn' if batch and
                         any(e['level'] in ('warn', 'error') for e in batch) else 'info',
                         'text': out, 'ts': rec['ts']})
        if len(_history) > 300:
            del _history[:-300]


# ============================ 人工对话（独立会话，不进用户上下文） ============================

CHAT_PROMPT = (
    '你是本项目的「主脑」，一个持续观察项目状态的助手。下面附上你最近的项目记忆与观察摘要。'
    '你拥有极简工具集（read_file / write_file / run_code / search_in_files），'
    '发现系统问题（如对话请求失败、服务报错）时应主动用工具定位并就地修复，而不是只给建议：'
    '先 read_file / search_in_files 定位，再 write_file / run_code 修复与验证，修完汇报改了什么。'
    '工具只允许操作本项目目录内的文件；不确定的事就如实说，不要编造。'
)


def brain_chat(base, text):
    text = str(text or '').strip()[:4000]
    if not text:
        return {'ok': False, 'error': 'empty'}
    with _lock:
        _history.append({'role': 'user', 'kind': 'user', 'text': text, 'ts': time.time()})
        recent = [m for m in _history[-BRAIN_CTX_TURNS:] if m.get('role') in ('user', 'brain')]
        mem = _memory
    sys_msg = CHAT_PROMPT + '\n\n[主脑记忆]\n' + (mem or '（暂无总结，项目刚被观察）')
    msgs = [{'role': 'system', 'content': sys_msg[:4000]}]
    for m in recent:
        msgs.append({'role': 'user' if m['role'] == 'user' else 'assistant',
                     'content': str(m.get('text') or '')[:2000]})
    # v4.8 工具循环：模型可多轮调用极简工具就地定位并修复问题
    tool_log = []
    out = ''  # 预初始化：轮数耗尽路径下模型可能每轮都调工具，保证 out 必有定义
    for _round in range(BRAIN_MAX_TOOL_ROUNDS):
        msg = _call_llm(base, msgs, max_tokens=1200, tools=_brain_tools_spec())
        if not msg:
            with _lock:
                _le = str(_state.get('llm_last_error') or '未知错误（可能未配置模型或网络不通）')
            out = '（主脑：大模型调用失败。最近错误：%s）' % _le[:300]
            break
        tcs = msg.get('tool_calls') or []
        content = str(msg.get('content') or '').strip()
        if not tcs:
            if not content:
                rc = str(msg.get('reasoning_content') or '').strip()
                out = rc or '（主脑：模型返回为空。）'
            else:
                out = content
            break
        # 回放 assistant 消息（含 tool_calls），再逐个执行工具
        msgs.append({'role': 'assistant', 'content': content,
                     'tool_calls': tcs})
        for tc in tcs:
            fn = ((tc.get('function') or {}).get('name')) or ''
            try:
                fargs = json.loads((tc.get('function') or {}).get('arguments') or '{}')
                if not isinstance(fargs, dict):
                    fargs = {}
            except Exception:
                fargs = {}
            result = _brain_tool_exec(base, fn, fargs)
            tool_log.append('%s(%s) -> %s' % (fn, json.dumps(fargs, ensure_ascii=False)[:200],
                                              str(result)[:200]))
            msgs.append({'role': 'tool', 'tool_call_id': tc.get('id') or '',
                         'content': str(result)[:4000]})
    else:
        out = (out or '') or '（主脑：已达工具轮数上限，已中止。已完成操作：' + '；'.join(tool_log[-5:]) + '）'
    if tool_log:
        out = out + '\n\n[本次工具操作]\n' + '\n'.join(tool_log)
    with _lock:
        _state['llm_calls'] += 1
        _history.append({'role': 'brain', 'kind': 'chat', 'level': 'info', 'text': out, 'ts': time.time()})
        if len(_history) > 300:
            del _history[:-300]
        h = _history[-150:]
    # 对话也落盘（独立文件，重启回放用）
    _append_jsonl(os.path.join(_dir(base), 'chats.jsonl'),
                  {'user': text, 'brain': out, 'ts': time.strftime('%Y-%m-%d %H:%M:%S')}, keep=1000)
    return {'ok': True, 'reply': out}


# -*- coding: utf-8 -*-
# 拆分分段模块：由原 main_brain.py 按行段【无改动】切分，由同名门面加载合并。
# ============================ 状态/控制 ============================

def get_state(base, limit=80):
    with _lock:
        st = dict(_state)
        h = _history[-limit:]
    # 补回放：历史为空时从磁盘回放（重启后）
    if not h:
        h = _replay(base, limit)
    return {'ok': True, 'state': st, 'history': h}


def _replay(base, limit):
    out = []
    try:
        sp = os.path.join(_dir(base), 'summaries.jsonl')
        if os.path.isfile(sp):
            with open(sp, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()[-20:]
            for ln in lines:
                try:
                    d = json.loads(ln)
                    out.append({'role': 'brain', 'kind': 'summary',
                                'level': 'info', 'text': d.get('text'), 'ts': d.get('ts') or 0})
                except ValueError:
                    logging.debug("swallow", exc_info=True)
        cp = os.path.join(_dir(base), 'chats.jsonl')
        if os.path.isfile(cp):
            with open(cp, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()[-20:]
            for ln in lines:
                try:
                    d = json.loads(ln)
                    out.append({'role': 'user', 'kind': 'user', 'text': d.get('user'),
                                'ts': d.get('ts') or 0})
                    out.append({'role': 'brain', 'kind': 'chat', 'level': 'info',
                                'text': d.get('brain'), 'ts': d.get('ts') or 0})
                except ValueError:
                    logging.debug("swallow", exc_info=True)
        out.sort(key=lambda m: str(m.get('ts') or 0))
        try:
            mem = open(os.path.join(_dir(base), 'memory.md'), 'r', encoding='utf-8-sig').read()
            globals()['_memory'] = mem.split('\n\n', 1)[-1]
        except OSError:
            logging.debug("swallow", exc_info=True)
    except Exception:
        logging.debug("swallow", exc_info=True)
    return out[-limit:]


def get_memory_report(base):
    """返回最近一次总结报告（供 /api/brain/report 一键复制）。"""
    with _lock:
        if _memory:
            ts = _state.get('last_summary') or 0
            return {'ok': True, 'time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts)) if ts else '',
                    'text': _memory}
    # 内存为空则读 summaries.jsonl 尾部
    path = os.path.join(_dir(base), 'summaries.jsonl')
    last = None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    last = json.loads(line)
                except Exception:
                    logging.debug("swallow", exc_info=True)
    except OSError:
        logging.debug("swallow", exc_info=True)
    if last:
        return {'ok': True, 'time': last.get('time', ''), 'text': last.get('text', ''),
                'why': last.get('why', '')}
    return {'ok': True, 'text': '', 'time': ''}


def brain_control(base, paused=None, auto_report=None, interval=None):
    global _interval
    with _lock:
        if interval is not None:
            try:
                v = max(BRAIN_INTERVAL_MIN, min(BRAIN_INTERVAL_MAX, int(interval)))
                if v != _interval:
                    _state['interval'] = v
                    _interval = v
                    _save_interval(base)
                    _push_event('brain', 'info',
                                '采集周期已调整为每 %d 秒一次（范围 %d~%d 秒，主脑面板可设置）。'
                                % (v, BRAIN_INTERVAL_MIN, BRAIN_INTERVAL_MAX), base)
            except (TypeError, ValueError):
                logging.debug("swallow", exc_info=True)
        if paused is not None:
            _state['paused'] = bool(paused)
            if _state['paused']:
                _push_event('brain', 'info', '观察已暂停（用户操作），30 分钟后自动恢复', base)
                _state['_pause_until'] = time.time() + 1800
            else:
                _state['_pause_until'] = 0
        if auto_report is not None:
            _state['auto_report'] = bool(auto_report)
        st = dict(_state)
    st.pop('_pause_until', None)
    return {'ok': True, 'state': st}


def request_manual_summary(base):
    with _lock:
        _state['paused'] = False
        _state['_pause_until'] = 0
    threading.Thread(target=_do_summary, args=(base, '手动触发'), daemon=True).start()
    return {'ok': True}


# ============================ 主循环 ============================

def _loop(base):
    _state['running'] = True
    with _lock:
        _history.append({'role': 'brain', 'kind': 'summary', 'level': 'info',
                         'text': '主脑已启动：每 %d 秒观察一次项目（零侵入只读采集，事件驱动总结，不占对话车道）。'
                                 % _interval, 'ts': time.time()})
    while True:
        try:
            time.sleep(_get_interval())
            with _lock:
                paused = _state.get('paused')
                until = _state.get('_pause_until') or 0
                if paused and until and time.time() > until:
                    _state['paused'] = False
                    paused = False
                auto = _state.get('auto_report')
            if not paused:
                n = _collect(base)
                with _lock:
                    _state['cycles'] += 1
                    _state['last_cycle'] = time.time()
                if auto:
                    with _lock:
                        has_bad = any(e['level'] in ('warn', 'error') for e in _events)
                        n_pool = len(_events)
                        last = _state.get('last_summary') or 0
                    if has_bad or n_pool >= POOL_FLUSH_N or \
                       (n_pool > 0 and time.time() - last > IDLE_SUMMARY_MIN * 60):
                        _do_summary(base, 'warn/error 事件' if has_bad else
                                    ('事件池满 %d 条' % n_pool if n_pool >= POOL_FLUSH_N else '定时巡检'))
        except Exception:
            try:
                time.sleep(5)
            except Exception:
                logging.debug("swallow", exc_info=True)


def start_brain_thread(base_dir):
    _load_interval(base_dir)
    _state['interval'] = _interval
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, args=(base_dir,), daemon=True, name='main-brain').start()
