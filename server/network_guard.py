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
import json
import time
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(BASE_DIR, 'private', 'network_guard_state.json')
STATE_LOCK = threading.Lock()

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


def get_status():
    """返回当前断网状态 {down: bool, since: ts, down_seconds: n}"""
    with STATE_LOCK:
        st = _load_state()
    down_since = st.get('down_since')
    if not down_since:
        return {'down': False, 'since': 0, 'down_seconds': 0}
    return {
        'down': True,
        'since': down_since,
        'down_seconds': int(time.time() - down_since),
    }


def report(ok, err=''):
    """上游请求结束后上报。ok=True 连接正常；ok=False 连接失败/超时。
    断网持续超过阈值时触发一次自动重启（用状态文件防重复触发）。"""
    now = time.time()
    cfg = _load_cfg()
    threshold_min = float(cfg.get('auto_restart_minutes', DEFAULT_AUTO_RESTART_MINUTES))
    enabled = cfg.get('auto_restart_enabled', True)

    with STATE_LOCK:
        st = _load_state()
        down_since = st.get('down_since') or 0
        if ok:
            if down_since:
                st = {}
                _save_state(st)
                print('[NetworkGuard] 网络恢复，断网计时清零')
            return {'down': False, 'triggered': False}

        # 失败
        if not down_since:
            down_since = now
            _save_state({'down_since': down_since, 'last_err': str(err)[:200]})
            print('[NetworkGuard] ⚠️ 检测到上游连接失败，开始计时: %s' % str(err)[:120])

        down_seconds = now - down_since
        if not enabled:
            return {'down': True, 'triggered': False, 'down_seconds': down_seconds}

        restart_failures = int(st.get('restart_failures', 0))

        # 防重复触发：已标记触发就不再触发
        if st.get('restart_triggered'):
            # 但如果断网时间已超过 2 倍阈值（说明重启也没能修复），升级为备用版本流程
            if down_seconds >= threshold_min * 60 * ESCALATE_MULTIPLIER and not st.get('escalated'):
                st['escalated'] = True
                _save_state(st)
                print('[NetworkGuard] 🚨 重启后断网仍未恢复（%d 秒 ≥ %d 分钟），升级为备用版本流程' %
                      (int(down_seconds), int(threshold_min * ESCALATE_MULTIPLIER)))
                threading.Thread(target=_do_escalate, daemon=True).start()
                return {'down': True, 'triggered': True, 'escalated': True, 'down_seconds': down_seconds}
            return {'down': True, 'triggered': False, 'down_seconds': down_seconds}

        if down_seconds >= threshold_min * 60:
            st['restart_triggered'] = True
            _save_state(st)
            print('[NetworkGuard] ❌ 断网已持续 %d 秒（≥%d分钟），触发自动重启后台网络' % (int(down_seconds), int(threshold_min)))
            threading.Thread(target=_do_restart, daemon=True).start()
            return {'down': True, 'triggered': True, 'down_seconds': down_seconds}

        return {'down': True, 'triggered': False, 'down_seconds': down_seconds}


def _do_restart():
    """独立进程执行重启：先等2秒让当前响应返回，再拉起重启脚本。"""
    try:
        import subprocess
        import sys
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'restart_server.py')
        subprocess.Popen(
            [sys.executable, script, '--auto'],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == 'win32' else 0,
        )
        # 重启后由下次 report() 检查结果；这里不做同步等待
    except Exception as e:
        print('[NetworkGuard] 重启失败: %s' % e)


def report_restart_result(success):
    """重启结束后由外部上报结果：成功→清空失败计数；失败→计数+1，达到阈值升级备用版本流程。"""
    with STATE_LOCK:
        st = _load_state()
        if success:
            if st.get('restart_failures'):
                st.pop('restart_failures', None)
                _save_state(st)
                print('[NetworkGuard] 重启成功，失败计数清零')
            return
        n = int(st.get('restart_failures', 0)) + 1
        st['restart_failures'] = n
        _save_state(st)
        if n >= MAX_RESTART_FAILURES and not st.get('escalated'):
            st['escalated'] = True
            _save_state(st)
            print('[NetworkGuard] 🚨 自动重启连续失败 %d 次，升级为备用版本流程' % n)
            threading.Thread(target=_do_escalate, daemon=True).start()


def _do_escalate():
    """升级流程：拉起备用版本提供服务 + 自动修复本版本（独立线程调用）。"""
    try:
        import time as _t
        _t.sleep(2)
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import backup_version
        backup_version.escalate()
    except Exception as e:
        print('[NetworkGuard] 备用版本升级流程异常: %s' % e)
