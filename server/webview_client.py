#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体 - 桌面客户端窗口（pywebview 独立进程）
由 tray_server.py 通过 Popen 启动，不占用托盘主线程。
- 等服务端口就绪后再加载页面
- 无边框窗口：系统标题栏去掉，网页顶栏提供 最小化/最大化/关闭 按钮与拖动
- 单实例：已有窗口进程在跑时通知其聚焦，本进程退出
- WebView2 缺失或 pywebview 不可用时自动回退浏览器
"""
import os
import sys
import socket
import time
import subprocess
import webbrowser

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_HERE)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from config import PORT, VERSION

URL = f'http://127.0.0.1:{PORT}/'

# 单实例标记：环境变量 ZF_UI_CHILD=1 表示是聚焦通知子进程
FOCUS_ENV = 'ZF_UI_FOCUS_NOTIFY'

# 全局窗口引用，供 JS API 桥调用
_win = None


def _port_open(port, timeout=0.5):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_server(seconds=60):
    for _ in range(int(seconds / 0.3)):
        if _port_open(PORT):
            return True
        time.sleep(0.3)
    return False


class ZFWindowApi:
    """暴露给网页 JS 的窗口控制桥：pywebview.api.xxx()"""

    def minimize(self):
        if _win:
            _win.minimize()

    # 最大化状态与切换全部用 Win32 实现：frameless 窗口下 pywebview 的
    # maximized 属性/restore() 不可靠（状态不同步导致按钮无法切换）
    def _hwnd(self):
        try:
            return _win.native.Handle.ToInt64() if _win and hasattr(_win.native, 'Handle') else None
        except Exception:
            return None

    def _is_maximized(self):
        import ctypes
        hwnd = self._hwnd()
        if not hwnd:
            return False
        return bool(ctypes.windll.user32.IsZoomed(ctypes.c_void_p(hwnd)))

    def toggle_maximize(self):
        import ctypes
        hwnd = self._hwnd()
        if not hwnd:
            return
        SW_MAXIMIZE, SW_RESTORE = 3, 9
        if self._is_maximized():
            ctypes.windll.user32.ShowWindow(ctypes.c_void_p(hwnd), SW_RESTORE)
        else:
            ctypes.windll.user32.ShowWindow(ctypes.c_void_p(hwnd), SW_MAXIMIZE)

    def close(self):
        # 不真正关闭：隐藏窗口，缩到右下角托盘（后台服务由托盘常驻）
        if _win:
            try:
                _win.hide()
            except Exception:
                _win.destroy()

    def _work_area(self):
        """主显示器工作区（不含任务栏）"""
        import ctypes
        from ctypes import wintypes
        rc = wintypes.RECT()
        ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rc), 0)
        return rc

    def _clamp_pos(self, l, t, w, h):
        """限制窗口位置：至少保留 60px 在屏幕工作区内，不允许整体拖出屏幕"""
        wa = self._work_area()
        margin = 60
        l = max(wa.left - w + margin, min(l, wa.right - margin))
        t = max(wa.top, min(t, wa.bottom - margin))
        return int(l), int(t)

    def window_move(self, dx, dy):
        """网页顶栏拖动：JS 传屏幕坐标增量（限制不出屏）"""
        if _win:
            try:
                x, y = _win.x, _win.y
                w, h = _win.width, _win.height
                nx, ny = self._clamp_pos(int(x + dx), int(y + dy), int(w), int(h))
                _win.move(nx, ny)
            except Exception:
                pass

    def window_drag(self):
        """原生标题栏拖拽：交给系统处理，1:1 跟手且不受 DPI 缩放影响"""
        try:
            import ctypes
            hwnd = self._hwnd()
            if not hwnd:
                return
            WM_NCLBUTTONDOWN = 0x00A1
            HTCAPTION = 2
            user32 = ctypes.windll.user32
            user32.ReleaseCapture()
            user32.PostMessageW(ctypes.c_void_p(hwnd), WM_NCLBUTTONDOWN, HTCAPTION, 0)
        except Exception:
            pass

    def window_resize_hit(self, ht):
        """网页边缘热区触发原生缩放：ht 为 Win32 命中码
        (HTLEFT=10 HTRIGHT=11 HTTOP=12 HTTOPLEFT=13 HTTOPRIGHT=14
         HTBOTTOM=15 HTBOTTOMLEFT=16 HTBOTTOMRIGHT=17)"""
        try:
            import ctypes
            ht = int(ht)
            if not (10 <= ht <= 17):
                return
            hwnd = self._hwnd()
            if not hwnd:
                return
            WM_NCLBUTTONDOWN = 0x00A1
            user32 = ctypes.windll.user32
            user32.ReleaseCapture()
            user32.PostMessageW(ctypes.c_void_p(hwnd), WM_NCLBUTTONDOWN, ht, 0)
        except Exception:
            pass

    def gesture_begin(self, mode=0):
        """手势开始：若窗口最大化则先还原，并把还原后的窗口挪到鼠标下方（平移时），
        避免最大化状态下拖动无效或还原后窗口跳走。"""
        try:
            if mode == 0 or (10 <= int(mode) <= 17):
                if self._is_maximized():
                    self._restore_under_cursor()
        except Exception:
            pass

    def _restore_under_cursor(self):
        """还原最大化窗口，并让窗口标题栏区域对齐当前鼠标位置（防跳变）。"""
        try:
            import ctypes
            from ctypes import wintypes
            hwnd = self._hwnd()
            if not hwnd:
                return
            user32 = ctypes.windll.user32
            # 记录鼠标在窗口内的相对位置（比例）
            pt = wintypes.POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            rc = wintypes.RECT()
            user32.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rc))
            # 还原
            user32.ShowWindow(ctypes.c_void_p(hwnd), 9)  # SW_RESTORE
            # 取还原后的矩形，把窗口平移使鼠标横向比例位置不变、窗口顶边贴近鼠标
            rc2 = wintypes.RECT()
            user32.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rc2))
            w = rc2.right - rc2.left
            h = rc2.bottom - rc2.top
            nx = pt.x - int(w / 2)
            ny = max(pt.y - 20, 0)
            user32.SetWindowPos(ctypes.c_void_p(hwnd), 0, nx, ny, 0, 0, 0x0015)  # NOZORDER|NOACTIVATE|NOSIZE
        except Exception:
            pass

    def window_delta(self, dx, dy, mode=0):
        """JS 手势驱动的真实窗口移动/缩放（不依赖系统模态循环，WebView2 下可靠）。
        mode: 0=移动窗口；10..17 = Win32 边缘命中码（HTLEFT 等）"""
        try:
            import ctypes
            from ctypes import wintypes
            dx, dy, mode = int(dx), int(dy), int(mode)
            hwnd = self._hwnd()
            if not hwnd:
                return
            user32 = ctypes.windll.user32
            rc = wintypes.RECT()
            if not user32.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rc)):
                return
            SWP_FLAGS = 0x0014  # SWP_NOZORDER | SWP_NOACTIVATE
            SWP_NOSIZE = 0x0001
            if mode == 0:
                if self._is_maximized():
                    return  # 最大化状态下不移动
                # 只改位置：必须带 SWP_NOSIZE，否则 cx=cy=0 会把窗口缩到极小
                nl, nt = self._clamp_pos(rc.left + dx, rc.top + dy,
                                         rc.right - rc.left, rc.bottom - rc.top)
                user32.SetWindowPos(ctypes.c_void_p(hwnd), 0, nl, nt, 0, 0,
                                    SWP_FLAGS | SWP_NOSIZE)
                return
            if not (10 <= mode <= 17) or self._is_maximized():
                return
            l, t, r, b = rc.left, rc.top, rc.right, rc.bottom
            if mode in (10, 13, 16): l += dx
            if mode in (11, 14, 17): r += dx
            if mode in (12, 13, 14): t += dy
            if mode in (15, 16, 17): b += dy
            w = max(r - l, 480)
            h = max(b - t, 320)
            # 缩放时限制位置：左/上边缘缩放不得越过工作区
            wa = self._work_area()
            l = max(wa.left, min(l, rc.right - 480))
            t = max(wa.top, min(t, rc.bottom - 320))
            user32.SetWindowPos(ctypes.c_void_p(hwnd), 0, l, t, w, h, SWP_FLAGS)
        except Exception:
            pass

    def window_state(self):
        return 'maximized' if self._is_maximized() else 'normal'


def _inject_resize_js(window):
    """页面加载后注入边缘/四角缩放热区 JS：拖动边缘直接调 pywebview.api.window_delta，
    不依赖 WndProc 命中测试（WebView2 子窗口会吃掉鼠标消息导致拖角无效）。"""
    JS = r"""
(function(){
  /* v4：缩放/平移热区已由前端 win-controls.js 统一处理，此处不再注入，避免热区重叠冲突 */
})();
"""
    def _on_loaded():
        try:
            window.evaluate_js(JS)
        except Exception:
            pass
    try:
        window.events.loaded += _on_loaded
    except Exception as e:
        print('[WebView] 注入缩放热区失败:', e)


def _set_window_icon(window):
    """webview.start(icon=) 在 Windows/EdgeChromium 下任务栏图标不生效，
    用 Win32 WM_SETICON 直接给窗口设置图标（任务栏+Alt-Tab 都会用）。"""
    try:
        import ctypes
        hwnd = window.native.Handle.ToInt64() if hasattr(window.native, 'Handle') else None
        if not hwnd:
            return
        ico = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
        if not os.path.exists(ico):
            return
        user32 = ctypes.windll.user32
        IMAGE_ICON, LR_LOADFROMFILE = 1, 0x10
        # 大图标(0x7F)给任务栏/Alt-Tab，小图标(0x80)给窗口
        hbig = user32.LoadImageW(None, ico, IMAGE_ICON, 32, 32, LR_LOADFROMFILE)
        hsmall = user32.LoadImageW(None, ico, IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
        if hbig:
            user32.SendMessageW(ctypes.c_void_p(hwnd), 0x7F, None, ctypes.c_void_p(hbig))
        if hsmall:
            user32.SendMessageW(ctypes.c_void_p(hwnd), 0x80, None, ctypes.c_void_p(hsmall))
        # 通知任务栏刷新
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
    except Exception as e:
        print('[WebView] 设置图标失败:', e)


def _boot_window(window):
    try:
        _dark_titlebar(window)
    except Exception as e:
        print('[WebView] 窗口初始化失败:', e)
    try:
        _set_window_icon(window)
    except Exception as e:
        print('[WebView] 图标初始化失败:', e)
    # 图标保活：WebView2 在最小化/还原/多次切换窗口后会重置图标为默认，
    # 用后台线程周期性重新设置 WM_SETICON，保证任务栏图标始终是我们的标志
    import threading
    def _icon_keepalive():
        import time
        while True:
            time.sleep(3)
            try:
                _set_window_icon(window)
            except Exception:
                pass
    threading.Thread(target=_icon_keepalive, daemon=True).start()
    # 强制确保窗口可见并置前（防止初始隐藏/被其他窗口盖住导致"打开了却看不到"）
    try:
        import ctypes
        hwnd = window.native.Handle.ToInt64() if hasattr(window.native, 'Handle') else None
        if hwnd:
            user32 = ctypes.windll.user32
            user32.ShowWindow(ctypes.c_void_p(hwnd), 5)      # SW_SHOW
            user32.ShowWindow(ctypes.c_void_p(hwnd), 3)      # SW_MAXIMIZE
            user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
    except Exception as e:
        print('[WebView] 窗口显示失败:', e)
    _inject_resize_js(window)


def _run_window():
    global _win
    import webview  # noqa
    ico = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
    _win = webview.create_window(
        f'朱峰智能体无限 v{VERSION}',
        URL,
        maximized=True,          # 启动即最大化全屏显示
        background_color='#181a30',
        frameless=True,          # 去掉系统标题栏
        easy_drag=False,         # 拖动由网页顶栏接管
        text_select=True,        # 允许页面文字选中（默认 False 会全局注入 user-select:none，导致对话框文字无法框选）
        js_api=ZFWindowApi(),    # 网页可调用 pywebview.api.*
    )
    webview.start(_boot_window, _win, icon=ico if os.path.exists(ico) else None)


def _install_resize_hittest(hwnd):
    """子类化窗口过程：无边框窗口在边缘/四角返回 HT* 命中码，
    使 WS_THICKFRAME 的拖拽调大小真正可用（WebView2 子窗口会吃掉鼠标消息，
    必须在主窗口 WndProc 里做 NCHITTEST 判定）。"""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        GWL_WNDPROC = -4
        WM_NCHITTEST = 0x0084
        HTCLIENT, HTNOWHERE = 1, 0
        HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT = \
            10, 11, 12, 13, 14, 15, 16, 17
        BORDER = 8  # 边缘热区像素
        WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_void_p, ctypes.c_uint,
                                     wintypes.WPARAM, ctypes.c_int32, ctypes.c_int32)
        old_proc = user32.GetWindowLongPtrW(ctypes.c_void_p(hwnd), GWL_WNDPROC)
        WM_GETMINMAXINFO = 0x0024
        MONITOR_DEFAULTTONEAREST = 2

        def _proc(h, msg, wp, lx, ly):
            if msg == WM_NCHITTEST:
                # lx/ly 是屏幕坐标（可能为负），转窗口客户区坐标
                pt = wintypes.POINT(lx, ly)
                user32.ScreenToClient(ctypes.c_void_p(h), ctypes.byref(pt))
                user32.GetClientRect(ctypes.c_void_p(h), ctypes.byref(rc := wintypes.RECT()))
                x, y, w, hgt = pt.x, pt.y, rc.right, rc.bottom
                if 0 <= x <= w and 0 <= y <= hgt:
                    left = x < BORDER
                    right = x >= w - BORDER
                    top = y < BORDER
                    bottom = y >= hgt - BORDER
                    if top and left: return HTTOPLEFT
                    if top and right: return HTTOPRIGHT
                    if bottom and left: return HTBOTTOMLEFT
                    if bottom and right: return HTBOTTOMRIGHT
                    if left: return HTLEFT
                    if right: return HTRIGHT
                    if top: return HTTOP
                    if bottom: return HTBOTTOM
                return HTCLIENT
            if msg == WM_GETMINMAXINFO:
                # 无边框窗口最大化默认铺满整屏（盖住任务栏），Windows 会把
                # 它当全屏应用隐藏任务栏且鼠标到底部唤不出。这里把最大化
                # 尺寸限制到工作区（不含任务栏），任务栏即可正常自动唤出。
                try:
                    from ctypes import wintypes
                    class MINMAXINFO(ctypes.Structure):
                        _fields_ = [('ptReserved', wintypes.POINT),
                                    ('ptMaxSize', wintypes.POINT),
                                    ('ptMaxPosition', wintypes.POINT),
                                    ('ptMinTrackSize', wintypes.POINT),
                                    ('ptMaxTrackSize', wintypes.POINT)]
                    class MONITORINFO(ctypes.Structure):
                        _fields_ = [('cbSize', wintypes.DWORD),
                                    ('rcMonitor', wintypes.RECT),
                                    ('rcWork', wintypes.RECT),
                                    ('dwFlags', wintypes.DWORD)]
                    mmi = MINMAXINFO.from_address(int(wp))
                    mon = user32.MonitorFromWindow(
                        ctypes.c_void_p(h), MONITOR_DEFAULTTONEAREST)
                    mi = MONITORINFO()
                    mi.cbSize = ctypes.sizeof(MONITORINFO)
                    if mon and user32.GetMonitorInfoW(
                            ctypes.c_void_p(mon), ctypes.byref(mi)):
                        wa = mi.rcWork
                        mmi.ptMaxPosition.x = wa.left
                        mmi.ptMaxPosition.y = wa.top
                        mmi.ptMaxSize.x = wa.right - wa.left
                        mmi.ptMaxSize.y = wa.bottom - wa.top
                        return 0
                except Exception:
                    pass
            return user32.CallWindowProcW(old_proc, ctypes.c_void_p(h), msg, wp, lx, ly)

        # 防止回调被垃圾回收
        _install_resize_hittest._cb = WNDPROC(_proc)
        user32.SetWindowLongPtrW(
            ctypes.c_void_p(hwnd), GWL_WNDPROC,
            ctypes.cast(_install_resize_hittest._cb, ctypes.c_void_p).value)
        # 窗口可能在子类化之前就已最大化（WM_GETMINMAXINFO 已错过），
        # 这里补一次：把已最大化的窗口尺寸压回工作区，不盖任务栏
        try:
            from ctypes import wintypes
            class MONITORINFO2(ctypes.Structure):
                _fields_ = [('cbSize', wintypes.DWORD),
                            ('rcMonitor', wintypes.RECT),
                            ('rcWork', wintypes.RECT),
                            ('dwFlags', wintypes.DWORD)]
            if user32.IsZoomed(ctypes.c_void_p(hwnd)):
                mon = user32.MonitorFromWindow(
                    ctypes.c_void_p(hwnd), MONITOR_DEFAULTTONEAREST)
                mi = MONITORINFO2()
                mi.cbSize = ctypes.sizeof(MONITORINFO2)
                if mon and user32.GetMonitorInfoW(
                        ctypes.c_void_p(mon), ctypes.byref(mi)):
                    wa = mi.rcWork
                    SWP_NOZORDER = 0x0004
                    user32.SetWindowPos(ctypes.c_void_p(hwnd), None,
                        wa.left, wa.top, wa.right - wa.left, wa.bottom - wa.top,
                        SWP_NOZORDER)
        except Exception as e:
            print('[WebView] 最大化尺寸修正失败:', e)
    except Exception as e:
        print('[WebView] 边缘缩放命中测试安装失败:', e)


def _enable_resize(hwnd):
    """frameless 窗口补回 WS_THICKFRAME，恢复边缘拖拽调大小（不显示标题栏）"""
    try:
        import ctypes
        GWL_STYLE = -16
        WS_THICKFRAME = 0x00040000
        WS_MINIMIZEBOX = 0x00020000
        WS_MAXIMIZEBOX = 0x00010000
        user32 = ctypes.windll.user32
        style = user32.GetWindowLongW(ctypes.c_void_p(hwnd), GWL_STYLE)
        user32.SetWindowLongW(
            ctypes.c_void_p(hwnd), GWL_STYLE,
            style | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
        # 通知系统边框变化，使其生效
        ctypes.windll.user32.SetWindowPos(
            ctypes.c_void_p(hwnd), 0, 0, 0, 0, 0, 0x0027)
    except Exception as e:
        print('[WebView] 恢复窗口缩放边框失败:', e)


def _dark_titlebar(window):
    """窗口就绪后把标题栏切成暗色（Win10 1809+/Win11 DWM）"""
    try:
        import ctypes
        hwnd = window.native.Handle.ToInt64() if hasattr(window.native, 'Handle') else None
        if not hwnd:
            return
        _enable_resize(hwnd)
        _install_resize_hittest(hwnd)
        for attr in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE（19 为旧版值）
            v = ctypes.c_int(1)
            r = ctypes.windll.dwmapi.DwmSetWindowAttribute(
                ctypes.c_void_p(hwnd), attr, ctypes.byref(v), ctypes.sizeof(v))
            if r == 0:
                break
        # 微微刷新使生效
        ctypes.windll.user32.SetWindowPos(
            ctypes.c_void_p(hwnd), 0, 0, 0, 0, 0, 0x0027)
    except Exception as e:
        print('[WebView] 暗色标题栏设置失败:', e)


def main():
    # 聚焦通知子进程：不带窗口直接退出（Windows 下 webview 无跨进程聚焦 API，
    # 简化处理：子进程尝试用 PowerShell 激活同名窗口，然后退出）
    if os.environ.get(FOCUS_ENV) == '1':
        try:
            import ctypes
            hwnd = ctypes.windll.user32.FindWindowW(None, f'朱峰智能体无限 v{VERSION}')
            if hwnd:
                user32 = ctypes.windll.user32
                user32.ShowWindow(ctypes.c_void_p(hwnd), 5)   # SW_SHOW：从托盘隐藏中恢复
                user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
            else:
                subprocess.run([
                    'powershell', '-NoProfile', '-Command',
                    '(New-Object -ComObject WScript.Shell).AppActivate("朱峰智能体")'
                ], timeout=5)
        except Exception:
            pass
        return

    # 单实例：已有窗口进程在跑 → 发聚焦通知后退出
    import tempfile
    lock = os.path.join(tempfile.gettempdir(), f'zf_webview_{PORT}.pid')
    try:
        pid = int(open(lock).read().strip())
        if pid != os.getpid():
            import ctypes
            h = ctypes.windll.kernel32.OpenProcess(0x00100000, False, pid)
            if h:
                ctypes.windll.kernel32.CloseHandle(h)
                # 确认旧窗口进程还活着：除了发激活通知，还必须把隐藏的窗口重新显示出来
                try:
                    import ctypes
                    user32 = ctypes.windll.user32
                    hwnd = user32.FindWindowW(None, f'朱峰智能体无限 v{VERSION}')
                    if hwnd:
                        user32.ShowWindow(ctypes.c_void_p(hwnd), 5)   # SW_SHOW
                        user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
                except Exception:
                    pass
                try:
                    subprocess.run([
                        'powershell', '-NoProfile', '-Command',
                        '(New-Object -ComObject WScript.Shell).AppActivate("朱峰智能体")'
                    ], timeout=5)
                except Exception:
                    pass
                return
            else:
                # 旧进程已死，残留锁文件，删除后正常开新窗口
                try:
                    os.remove(lock)
                except Exception:
                    pass
    except Exception:
        pass

    if not _wait_server():
        print('[WebView] 服务未就绪，回退浏览器')
        webbrowser.open(URL)
        return

    try:
        with open(lock, 'w') as f:
            f.write(str(os.getpid()))
        _run_window()
    except Exception as e:
        print('[WebView] 窗口启动失败(%s)，回退浏览器' % e)
        webbrowser.open(URL)
    finally:
        try:
            os.remove(lock)
        except Exception:
            pass


if __name__ == '__main__':
    main()
