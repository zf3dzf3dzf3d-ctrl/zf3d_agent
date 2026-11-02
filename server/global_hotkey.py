# -*- coding: utf-8 -*-
"""
global_hotkey.py — 系统级全局热键守护
======================================
监听全局快捷键（不依赖任何窗口焦点，浏览器/任何前台窗口都拦不走）：
  Ctrl+Alt+R  →  调用 restart_server.py 无感重启后台
  Ctrl+Alt+K  →  关闭 AI 浏览器会话（释放被抢走的快捷键/焦点）

由 .启动朱峰智能体无限.bat 隐藏窗口常驻启动；也可手动运行：
  python server\\global_hotkey.py
"""

import os
import sys
import time
import subprocess
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(BASE_DIR, 'server')
try:
    from platform_compat import py_exe as _compat_py_exe
    PY_EXE = _compat_py_exe(BASE_DIR)
except Exception:
    PY_EXE = os.path.join(BASE_DIR, 'python', 'python.exe')
RESTART_PY = os.path.join(SERVER_DIR, 'restart_server.py')
LOG_FILE = os.path.join(SERVER_DIR, '.global_hotkey.log')

_last_trigger = 0.0


def log(msg):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8', errors='replace') as f:
            f.write('[%s] %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg))
    except Exception:
        pass


def _close_browser_sessions():
    """让后台关闭 AI 浏览器（Playwright）全部会话，释放系统快捷键/焦点。"""
    import json
    import urllib.request
    try:
        with open(os.path.join(BASE_DIR, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        port = int(cfg.get('api_port') or cfg.get('port') or 8000)
        urllib.request.urlopen('http://127.0.0.1:%d/api/browser/close?all=true' % port, timeout=5)
        log('Ctrl+Alt+K: 已请求关闭浏览器会话')
    except Exception as e:
        log('Ctrl+Alt+K 失败: %s' % e)


def _on_hotkey(name):
    global _last_trigger
    now = time.time()
    if now - _last_trigger < 3:   # 3 秒防抖
        return
    _last_trigger = now
    log('触发热键 %s' % name)
    if name == 'restart':
        if sys.platform == 'win32':
            subprocess.Popen([PY_EXE, RESTART_PY], cwd=SERVER_DIR,
                             creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            subprocess.Popen([PY_EXE, RESTART_PY], cwd=SERVER_DIR)
    elif name == 'close_browser':
        threading.Thread(target=_close_browser_sessions, daemon=True).start()


def main():
    try:
        from pynput import keyboard
    except ImportError:
        log('pynput 未安装，热键守护退出')
        return
    log('全局热键守护启动: Ctrl+Alt+R=重启后台, Ctrl+Alt+K=关闭AI浏览器')

    def on_press(key):
        try:
            with keyboard.Controller() as _kc:  # noqa: 仅确保模块可用
                pass
        except Exception:
            pass
        try:
            ctrl = key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r) or \
                getattr(key, 'ctrl', False)
        except Exception:
            ctrl = False
        # pynput GlobalHotKeys 更简洁，这里其实用不上 on_press 逻辑
        return

    # 用官方 GlobalHotKeys：跨窗口全局生效
    def _restart():
        _on_hotkey('restart')

    def _closeb():
        _on_hotkey('close_browser')

    hotkeys = {
        '<ctrl>+<alt>+r': _restart,
        '<ctrl>+<alt>+k': _closeb,
    }
    try:
        with keyboard.GlobalHotKeys(hotkeys) as h:
            h.join()
    except Exception as e:
        log('热键监听异常退出: %s' % e)


if __name__ == '__main__':
    main()
