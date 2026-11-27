# -*- coding: utf-8 -*-
"""util_desktop_confirm.py - 本机桌面原生确认框（2026-11-24）

解决的问题：本地服务的写接口对回环请求免认证（同机进程互信是产品边界），但浏览器里
打开的恶意网页可以用表单/无跨域请求向这些接口发 POST。对“设锁/拆锁”这类改变保护
状态的接口，光靠服务端日志留痕不够——需要一个**跨站请求绝对发不出来**的确认动作：
在用户面前的原生窗口里点一次按钮。

接口：ask(title, text, timeout=120) -> bool
  True  = 用户在原生窗口点了确认
  False = 拒绝 / 超时 / 弹不出窗口（弹不出 = 拿不到确认 = 拒绝，宁可误拒）
测试：环境变量 ZF_DESKTOP_CONFIRM 置 '1'/'0' 可强制结果（仅测试用，进程内读取）。
消费方：应用锁的设锁/拆锁接口（server/routes/ 下的 i隐私处理器）。
"""
import logging
import os
import subprocess
import sys
import time

log = logging.getLogger("util_desktop_confirm")

# 小时预算：防自动化流程频繁触发弹窗骚扰用户
_HOURLY_BUDGET = 6
_budget_window_start = 0.0
_budget_used = 0

_CONFIRM_CODE = (
    'import sys\n'
    'import tkinter as tk\n'
    'from tkinter import messagebox\n'
    'root = tk.Tk()\n'
    'root.withdraw()\n'
    'root.attributes("-topmost", True)\n'
    'ok = messagebox.askyesno(sys.argv[1], sys.argv[2], parent=root)\n'
    'root.destroy()\n'
    'raise SystemExit(0 if ok else 1)\n'
)


def ask(title, text, timeout=120):
    global _budget_window_start, _budget_used
    now = time.time()
    if now - _budget_window_start >= 3600:
        _budget_window_start = now
        _budget_used = 0
    if _budget_used >= _HOURLY_BUDGET:
        log.warning("confirm popup budget exhausted (%d/%d), auto-deny"
                    % (_budget_used, _HOURLY_BUDGET))
        return False
    _budget_used += 1
    """弹原生确认框并等待用户选择。"""
    forced = str(os.environ.get('ZF_DESKTOP_CONFIRM') or '').strip()
    if forced in ('0', '1'):
        return forced == '1'
    try:
        proc = subprocess.Popen(
            [sys.executable, '-c', _CONFIRM_CODE, str(title), str(text)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except OSError:
        return False    # 弹不出窗口 = 拿不到确认 = 拒绝
    try:
        rc = proc.wait(timeout=max(5, int(timeout)))
    except subprocess.TimeoutExpired:
        proc.kill()
        return False
    return rc == 0
