#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体 - Windows 托盘常驻启动器
后台线程运行 server.py 的 main()，主线程显示右下角托盘图标。
托盘右键菜单：打开主界面 / 重启服务 / 退出。
用法：python tray_server.py   （或打包 exe 后双击）
"""
import os
import sys
import threading
import webbrowser
import socket
import time
import subprocess

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_PROJECT_ROOT = os.path.dirname(_HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from config import HOST, PORT, VERSION


def _port_open(port, timeout=0.5):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout):
            return True
    except OSError:
        return False


def _open_ui():
    """优先用 pywebview 独立窗口（桌面客户端），失败回退浏览器。
    单实例：已有窗口进程则发聚焦通知，不再开新窗口。"""
    exe = sys.executable
    script = os.path.join(_HERE, 'webview_client.py')
    if not os.path.exists(script):
        webbrowser.open(f'http://127.0.0.1:{PORT}/')
        return
    # 窗口进程单实例检测：扫描 python 进程命令行是否已带 webview_client.py
    try:
        import ctypes, ctypes.wintypes
        kernel32 = ctypes.windll.kernel32
        # 简单方案：用锁文件 + PID 存活检测
        import tempfile
        lock = os.path.join(tempfile.gettempdir(), f'zf_webview_{PORT}.pid')
        alive = False
        if os.path.exists(lock):
            try:
                pid = int(open(lock).read().strip())
                # OpenProcess 成功且未退出视为存活
                SYNCHRONIZE = 0x00100000
                h = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
                if h:
                    kernel32.CloseHandle(h)
                    alive = True
                else:
                    # 进程已死：清掉残留锁文件
                    try:
                        os.remove(lock)
                    except Exception:
                        pass
            except Exception:
                alive = False
        if alive:
            env = dict(os.environ)
            env['ZF_UI_FOCUS_NOTIFY'] = '1'
            subprocess.Popen([exe, script], env=env,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        subprocess.Popen([exe, script], cwd=_PROJECT_ROOT,
                         creationflags=flags)
        # 延迟写入 PID 锁（窗口进程自己也会写，这里兜底）
        return
    except Exception:
        pass
    webbrowser.open(f'http://127.0.0.1:{PORT}/')


def _make_icon_image():
    """优先用项目 public/favicon.ico，没有就用程序生成的蓝色方块图标"""
    ico_path = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
    if os.path.exists(ico_path):
        try:
            from PIL import Image
            return Image.open(ico_path).convert('RGBA')
        except Exception:
            pass
    # 优先用项目自带 logo 图标
    ico = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
    if os.path.exists(ico):
        try:
            from PIL import Image as _PILImage
            return _PILImage.open(ico)
        except Exception:
            pass
    from PIL import Image, ImageDraw
    img = Image.new('RGBA', (64, 64), (25, 118, 210, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([12, 26, 52, 50], fill=(255, 255, 255, 230))
    d.polygon([(32, 10), (52, 26), (12, 26)], fill=(255, 255, 255, 230))
    return img


def main():
    import pystray
    from pystray import Menu, MenuItem as Item

    # 已有实例在跑则先等它退出（重启场景，最多等 10 秒），仍在则直接打开界面
    for _ in range(20):
        if not _port_open(PORT):
            break
        time.sleep(0.5)
    if _port_open(PORT):
        print(f'[Tray] 端口 {PORT} 已有服务在运行，直接打开界面')
        _open_ui()
        return

    stop_event = threading.Event()

    def _run_server():
        import server as server_mod
        try:
            server_mod.main()
        except Exception as e:
            print('[Tray] 服务线程异常:', e)

    def _on_open(icon, item):
        # 等服务就绪再开页面
        for _ in range(50):
            if _port_open(PORT):
                break
            time.sleep(0.3)
        _open_ui()

    def _on_restart(icon, item):
        stop_event.set()
        try:
            import server as server_mod
            from hot_reload import get_hot_reloader
            hr = get_hot_reloader()
            if hr:
                hr.stop()
        except Exception:
            pass
        # 重新拉起自己（无窗口），再退出当前进程，实现真正的"重启"
        try:
            exe = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
            if not os.path.exists(exe):
                exe = sys.executable
            subprocess.Popen([exe, os.path.abspath(__file__)], cwd=_PROJECT_ROOT,
                             creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0)
                             | getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except Exception as e:
            print('[Tray] 重启失败，仅退出:', e)
        icon.stop()
        os._exit(0)

    def _kill_ui_process():
        """退出时一并结束主界面窗口进程（webview_client）。"""
        try:
            import tempfile, ctypes
            lock = os.path.join(tempfile.gettempdir(), f'zf_webview_{PORT}.pid')
            if os.path.exists(lock):
                pid = int(open(lock).read().strip())
                kernel32 = ctypes.windll.kernel32
                PROCESS_TERMINATE = 0x0001
                h = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
                if h:
                    kernel32.TerminateProcess(h, 0)
                    kernel32.CloseHandle(h)
                try:
                    os.remove(lock)
                except OSError:
                    pass
        except Exception as e:
            print('[Tray] 关闭窗口进程失败:', e)

    def _on_quit(icon, item):
        stop_event.set()
        try:
            import server as server_mod
            from hot_reload import get_hot_reloader
            hr = get_hot_reloader()
            if hr:
                hr.stop()
        except Exception:
            pass
        _kill_ui_process()
        icon.stop()
        os._exit(0)

    t = threading.Thread(target=_run_server, name='zf-server', daemon=True)
    t.start()

    # 启动时自动打开主界面（后台等端口就绪，不阻塞托盘显示）
    threading.Thread(target=_on_open, args=(None, None),
                     name='zf-autopen', daemon=True).start()

    icon = pystray.Icon(
        name='zf_agent',
        icon=_make_icon_image(),
        title=f'朱峰智能体 v{VERSION} (端口 {PORT})',
        menu=Menu(
            Item('还原主界面', _on_open, default=True),
            Item('关闭', _on_quit),
        ),
    )
    print(f'[Tray] 托盘已启动，服务端口 {PORT}，右键图标可操作')
    icon.run()


if __name__ == '__main__':
    main()
