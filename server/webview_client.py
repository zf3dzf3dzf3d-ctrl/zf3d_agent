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
import tempfile
import time
import ctypes
import threading
import subprocess
import webbrowser

# 【桌面窗口修复 2026-10-25】5.7.0 自带 Python 的 site-packages 中：
#   1) pythonnet 为被 pip 卸载一半的损坏残留，import clr 直接失败
#   2) pywebview 为新版，其 winforms 后端引用 .NET 8 WinForms，
#      而 ContextMenu 类型在 .NET 8 中已删除 → TypeLoadException
# 另一条隐藏根因：本进程对系统 TEMP 目录无写权限（沙箱/受限令牌），
#   tempfile.gettempdir() 直接抛 FileNotFoundError → 还没 import pywebview
#   就在 main() 建锁文件时崩溃 → tray_server 探测失败回退浏览器。
# 修复 A：优先把 5.6.0 发布版（pythonnet 3.2.1 + 旧版 pywebview，已验证可用）
#   的 site-packages 插到 sys.path 最前，本进程的 clr/pywebview 全走 5.6 可用版本。
# 修复 B：TEMP 不可写时，启动最早期重定向 TMP/TEMP 到项目内 temp 目录。
def _fix_temp_dir():
    """系统 TEMP 不可写时重定向到项目内 temp（存在且可写），否则不动。"""
    try:
        import tempfile
        tempfile.gettempdir()
        return  # 系统 TEMP 可用
    except Exception:
        pass
    _proj_tmp = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'temp'))
    try:
        os.makedirs(_proj_tmp, exist_ok=True)
        _probe = os.path.join(_proj_tmp, '.zf_probe')
        with open(_probe, 'w') as f:
            f.write('ok')
        os.remove(_probe)
        os.environ['TMP'] = _proj_tmp
        os.environ['TEMP'] = _proj_tmp
        import tempfile
        tempfile.tempdir = None  # 强制失效缓存，让 gettempdir() 重新解析
    except Exception:
        pass  # 项目内也不可写，维持原样

_fix_temp_dir()

_SITE56 = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))),
    '朱峰社区智能体无限_5.6.0_发布版', 'python', 'Lib', 'site-packages'))
if os.path.isdir(_SITE56):
    sys.path.insert(0, _SITE56)

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_HERE)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from config import PORT, VERSION

URL = f'http://127.0.0.1:{PORT}/'


def open_url_maximized(url):
    """回退浏览器路径：优先用 --start-maximized 启动 Edge/Chrome（初始即最大化），
    失败才退回 webbrowser.open（默认非最大化窗口）。【初始最大化修复 2026-10-27】"""
    import subprocess
    pf = os.environ.get('PROGRAMFILES', r'C:\Program Files')
    pfx86 = os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')
    candidates = [
        os.path.join(pfx86, r'Microsoft\Edge\Application\msedge.exe'),
        os.path.join(pf, r'Microsoft\Edge\Application\msedge.exe'),
        os.path.join(pf, r'Google\Chrome\Application\chrome.exe'),
        os.path.join(pfx86, r'Google\Chrome\Application\chrome.exe'),
    ]
    for exe in candidates:
        if os.path.isfile(exe):
            try:
                subprocess.Popen('"%s" --start-maximized "%s"' % (exe, url),
                                 close_fds=True)
                return True
            except Exception:
                continue
    webbrowser.open(url)
    return False

# 单实例标记：环境变量 ZF_UI_CHILD=1 表示是聚焦通知子进程
FOCUS_ENV = 'ZF_UI_FOCUS_NOTIFY'

# 全局窗口引用，供 JS API 桥调用
_win = None


def _keep_display_awake():
    """后台线程：持续向系统声明「显示器保持唤醒」，防止息屏/变暗。
    仅阻止息屏（ES_DISPLAY_REQUIRED），不阻止系统睡眠，
    进程退出时由 finally 恢复 ES_CONTINUOUS 默认行为。"""
    try:
        import ctypes
        ES_CONTINUOUS = 0x80000000
        ES_DISPLAY_REQUIRED = 0x00000002
        kernel32 = ctypes.windll.kernel32
        kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED)
        while True:
            time.sleep(60)
            # 周期性重申，防止被其他状态覆盖
            kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED)
    except Exception as e:
        print('[WebView] 防息屏线程失败:', e)
    finally:
        try:
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
        except Exception:
            pass


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


# 【启动闪屏 2026-11-14】双击启动 → 立刻弹出居中闪屏（进度条动画+黑白主题自适应），
# 服务端口就绪 → 渐隐销毁。失败静默跳过，绝不影响主启动流程。
_SPLASH = None


def _start_splash_early():
    """main() 最早期调用：先起闪屏，再等服务。"""
    global _SPLASH
    try:
        from splash_window import start_splash
        _SPLASH = start_splash()
        if _SPLASH:
            _SPLASH.set_status('正在启动服务…')
    except Exception as e:
        print('[Splash] 闪屏启动失败(忽略):', e)


def _splash_update(msg):
    if _SPLASH:
        try:
            _SPLASH.set_status(msg)
        except Exception:
            pass


def _splash_finish():
    global _SPLASH
    if _SPLASH:
        try:
            _SPLASH.set_status('启动完成')
            _SPLASH.finish()
            _SPLASH._t.join(timeout=3)  # 等 Tk 线程结束再退出进程，防 Tcl 跨线程崩溃
        except Exception:
            pass
        _SPLASH = None


class ZFWindowApi:
    """暴露给网页 JS 的窗口控制桥：pywebview.api.xxx()"""

    def minimize(self):
        if _win:
            _win.minimize()

    # ==================== 【窗口大小记忆 2026-12】 ====================
    # 用户诉求：还原态的窗口大小/位置要成为默认设置——下次打开仍是这个大小。
    # 方案：手势结束（平移/缩放松手）时把还原态几何写入
    # server/data/window_geom.json（运行时目录，已 gitignore）；下次启动还原时应用。
    _GEOM_FILE = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'data', 'window_geom.json'))

    def _save_geom(self, l, t, w, h):
        """还原态几何落盘（物理像素）。失败静默：记忆失败不影响使用。"""
        try:
            import json
            os.makedirs(os.path.dirname(self._GEOM_FILE), exist_ok=True)
            with open(self._GEOM_FILE, 'w', encoding='utf-8') as f:
                json.dump({'x': int(l), 'y': int(t), 'w': int(w), 'h': int(h),
                           'ts': int(time.time())}, f)
        except Exception:
            pass

    def _load_geom(self):
        """读取还原态几何存档；无存档/解析失败返回 None。"""
        try:
            import json
            with open(self._GEOM_FILE, 'r', encoding='utf-8') as f:
                d = json.load(f)
            l = int(d.get('x', 0))
            t = int(d.get('y', 0))
            w = int(d.get('w', 0))
            h = int(d.get('h', 0))
            if w >= 480 and h >= 320:  # 与 window_delta 的最小尺寸兜底一致
                return (l, t, w, h)
        except Exception:
            pass
        return None

    def save_window_geom(self):
        """JS 桥入口：当前为还原态时，把窗口几何存为默认设置。"""
        try:
            if self._visually_maximized():
                return False  # 最大化中不覆盖存档
        except Exception:
            return False
        try:
            from ctypes import wintypes
            hwnd = self._hwnd()
            if not hwnd:
                return False
            rc = wintypes.RECT()
            if not ctypes.windll.user32.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rc)):
                return False
            self._save_geom(rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top)
            return True
        except Exception:
            return False

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

    def _geo_covers_workarea(self, tol=8):
        """窗口几何是否已铺满所在显示器目标区（物理像素）。
        用于识别 WebView2 布局覆盖造成的"状态位与几何不同步"：
        - 状态 zoomed 但几何是小窗（用户看到偏移小窗，点最大化按钮第一次像"还原"）
        - 状态 normal 但几何已铺满（视觉上已最大化）"""
        import ctypes
        from ctypes import wintypes
        hwnd = self._hwnd()
        if not hwnd:
            return False
        u = ctypes.windll.user32
        mon = u.MonitorFromWindow(ctypes.c_void_p(hwnd), 2)  # MONITOR_DEFAULTTONEAREST
        if not mon:
            return False

        class MI(ctypes.Structure):
            _fields_ = [('cbSize', wintypes.DWORD),
                        ('rcMonitor', wintypes.RECT),
                        ('rcWork', wintypes.RECT),
                        ('dwFlags', wintypes.DWORD)]
        mi = MI()
        mi.cbSize = ctypes.sizeof(MI)
        if not u.GetMonitorInfoW(ctypes.c_void_p(mon), ctypes.byref(mi)):
            return False
        try:
            cover = _cover_taskbar()
        except Exception:
            cover = False
        rc = mi.rcMonitor if cover else mi.rcWork

        class RC(ctypes.Structure):
            _fields_ = [('l', ctypes.c_long), ('t', ctypes.c_long),
                        ('r', ctypes.c_long), ('b', ctypes.c_long)]
        rect = RC()
        if not u.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rect)):
            return False
        off = (abs(rect.l - rc.left) + abs(rect.t - rc.top) +
               abs(rect.r - rc.right) + abs(rect.b - rc.bottom))
        return off <= tol

    def _visually_maximized(self):
        """视觉最大化 = 状态位最大化 或 几何已铺满（两者其一即可）。"""
        return self._is_maximized() or self._geo_covers_workarea()

    def toggle_maximize(self):
        import ctypes
        from ctypes import wintypes
        hwnd = self._hwnd()
        if not hwnd:
            return
        user32 = ctypes.windll.user32
        SW_MAXIMIZE, SW_RESTORE = 3, 9
        # 【状态-几何不同步修复 2026-11-XX】状态位 zoomed 但几何是小窗（偏移小窗）时，
        # 旧逻辑直接 SW_RESTORE → 窗口缩回 Windows 记录的旧正常矩形，用户看到
        # "第一次点像还原，再点才最大化"。现改为：这种脏状态先修复为真正的最大化
        # （restore→铺满→重新 maximize），下次点击才是真正的还原。
        if self._is_maximized() and not self._geo_covers_workarea():
            user32.ShowWindow(ctypes.c_void_p(hwnd), SW_RESTORE)
            try:
                mon = user32.MonitorFromWindow(ctypes.c_void_p(hwnd), 2)
                if mon:
                    class MI2(ctypes.Structure):
                        _fields_ = [('cbSize', wintypes.DWORD),
                                    ('rcMonitor', wintypes.RECT),
                                    ('rcWork', wintypes.RECT),
                                    ('dwFlags', wintypes.DWORD)]
                    mi2 = MI2(); mi2.cbSize = ctypes.sizeof(MI2)
                    if user32.GetMonitorInfoW(ctypes.c_void_p(mon), ctypes.byref(mi2)):
                        rc2 = mi2.rcMonitor if _cover_taskbar() else mi2.rcWork
                        user32.SetWindowPos(ctypes.c_void_p(hwnd), 0,
                                            rc2.left, rc2.top,
                                            rc2.right - rc2.left, rc2.bottom - rc2.top,
                                            0x0004)
            except Exception:
                pass
            user32.ShowWindow(ctypes.c_void_p(hwnd), SW_MAXIMIZE)
            return
        if self._is_maximized():
            user32.ShowWindow(ctypes.c_void_p(hwnd), SW_RESTORE)
            # 【还原矩形修复】SW_MAXIMIZE 后又 SetWindowPos 改尺寸，可能污染
            # Windows 内部"最大化还原矩形"，SW_RESTORE 会回到错误位置。
            # 【窗口大小记忆 2026-12】还原时优先应用存档几何（用户的"默认设置"，
            # 手势结束时由 save_window_geom 落盘）；无存档时退回旧行为：
            # 用最大化前 GetWindowPlacement 记下的正常态矩形强制纠正。
            saved = self._load_geom()
            if saved:
                try:
                    l, t, w, h = self._clamp_pos(saved[0], saved[1], saved[2], saved[3])
                    user32.SetWindowPos(ctypes.c_void_p(hwnd), 0, l, t, w, h,
                                        0x0004)  # SWP_NOZORDER
                except Exception:
                    pass
            else:
                saved = getattr(self, '_saved_normal_rect', None)
                if saved:
                    try:
                        user32.SetWindowPos(ctypes.c_void_p(hwnd), 0,
                                            saved[0], saved[1], saved[2], saved[3],
                                            0x0004)  # SWP_NOZORDER
                    except Exception:
                        pass
            return
        # 记住最大化前的正常态位置尺寸，供还原时纠正（见上方还原分支）
        try:
            class WP1(ctypes.Structure):
                _fields_ = [('length', ctypes.c_uint),
                            ('flags', ctypes.c_uint),
                            ('showCmd', ctypes.c_uint),
                            ('ptMinPosition', wintypes.POINT),
                            ('ptMaxPosition', wintypes.POINT),
                            ('rcNormalPosition', wintypes.RECT),
                            ('rcMonitor', wintypes.RECT)]
            wp = WP1()
            wp.length = ctypes.sizeof(WP1)
            if user32.GetWindowPlacement(ctypes.c_void_p(hwnd), ctypes.byref(wp)):
                r = wp.rcNormalPosition
                self._saved_normal_rect = (r.left, r.top,
                                           r.right - r.left, r.bottom - r.top)
        except Exception:
            self._saved_normal_rect = None
        user32.ShowWindow(ctypes.c_void_p(hwnd), SW_MAXIMIZE)
        # 【多屏修复】ShowWindow 的最大化目标屏由 WM_GETMINMAXINFO 决定，
        # 但子类化可能未安装（早期异常/非桌面客户端路径），此时最大化只会
        # 落在主屏或尺寸不对。这里兜底：按窗口当前所在显示器铺满该屏，
        # 保证任意屏幕（多显示器/DPI 缩放）都能正确最大化。
        try:
            MONITOR_DEFAULTTONEAREST = 2

            class MONITORINFO3(ctypes.Structure):
                _fields_ = [('cbSize', wintypes.DWORD),
                            ('rcMonitor', wintypes.RECT),
                            ('rcWork', wintypes.RECT),
                            ('dwFlags', wintypes.DWORD)]
            mon = user32.MonitorFromWindow(ctypes.c_void_p(hwnd), MONITOR_DEFAULTTONEAREST)
            mi = MONITORINFO3()
            mi.cbSize = ctypes.sizeof(MONITORINFO3)
            if mon and user32.GetMonitorInfoW(ctypes.c_void_p(mon), ctypes.byref(mi)):
                rc = mi.rcMonitor if _cover_taskbar() else mi.rcWork
                user32.SetWindowPos(ctypes.c_void_p(hwnd), 0,
                                    rc.left, rc.top,
                                    rc.right - rc.left, rc.bottom - rc.top,
                                    0x0004)  # SWP_NOZORDER
        except Exception:
            pass

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
            # 【窗口大小记忆 2026-12】还原最大化后优先应用存档几何（用户的"默认
            # 大小"，手势结束时落盘），随后仍按鼠标位置平移（防跳变行为不变）。
            _g = self._load_geom()
            if _g:
                try:
                    _l, _t, _w, _h = self._clamp_pos(_g[0], _g[1], _g[2], _g[3])
                    user32.SetWindowPos(ctypes.c_void_p(hwnd), 0,
                                        _l, _t, _w, _h, 0x0004)
                except Exception:
                    pass
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
        # 【视觉一致性修复】返回"视觉最大化"状态（状态位或几何铺满任一），
        # 避免状态位与几何不同步时前端按钮状态错乱。
        return 'maximized' if self._visually_maximized() else 'normal'

    def reload_page(self):
        """网页 JS 可调用的刷新入口：重新加载当前 URL（桌面版无浏览器刷新按钮/F5 默认无效）。"""
        try:
            if _win:
                _win.load_url(URL)
                return True
        except Exception as e:
            print('[WebView] reload_page 失败:', e)
        return False


def _inject_resize_js(window):
    """页面加载后注入边缘/四角缩放热区 JS：拖动边缘直接调 pywebview.api.window_delta，
    不依赖 WndProc 命中测试（WebView2 子窗口会吃掉鼠标消息导致拖角无效）。"""
    JS = r"""
(function(){
  /* v5：桌面版刷新快捷键——F5 / Ctrl+R 调用 pywebview.api.reload_page() 重新加载页面，
     解决桌面版（无边框 pywebview 窗口）无法刷新界面、前端卡死状态无法清除的问题 */
  if (window.__zfReloadBound) return;
  window.__zfReloadBound = true;
  function doReload(){
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.reload_page) {
        window.pywebview.api.reload_page();
        return;
      }
    } catch(e) {}
    location.reload();  // 浏览器版兜底
  }
  window.__zfReload = doReload;
  document.addEventListener('keydown', function(e){
    if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
      doReload();
    }
  }, true);
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


def _set_app_user_model_id():
    """显式设置 AUMID，确保固定到任务栏时与快捷方式分组一致，图标不会变成 Python 默认图标。
    【v2 2026-11-22】旧 AUMID 在 shell AppResolver 缓存里残留了 Python 图标关联，
    换新 AUMID 强制全新解析（与 tray_server 保持一致）。"""
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('ZF.ZhuFengAgentInfinity.v2')
    except Exception:
        pass


def _set_window_icon(window):
    """用 Win32 WM_SETICON (0x80) 直接给窗口设置图标（任务栏+Alt-Tab 都会用）。
    wParam: ICON_BIG=1 / ICON_SMALL=0。
    注意：绝不调用 SHChangeNotify(SHCNE_ASSOCCHANGED)——它会让整个桌面
    刷新图标（肉眼可见的一闪），已完全移除，改由 AUMID + WM_SETICON 保证图标。"""
    global _icon_handles
    try:
        import ctypes
        hwnd = window.native.Handle.ToInt64() if hasattr(window.native, 'Handle') else None
        if not hwnd:
            return False
        ico = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
        if not os.path.exists(ico):
            return False
        user32 = ctypes.windll.user32
        IMAGE_ICON, LR_LOADFROMFILE = 1, 0x10
        # WM_SETICON (0x80)：wParam 1=大图标(任务栏/Alt-Tab)，0=小图标(窗口标题栏)
        hbig = user32.LoadImageW(None, ico, IMAGE_ICON, 32, 32, LR_LOADFROMFILE)
        hsmall = user32.LoadImageW(None, ico, IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
        ok = False
        if hbig:
            user32.SendMessageW(ctypes.c_void_p(hwnd), 0x80, 1, ctypes.c_void_p(hbig))
            ok = True
        if hsmall:
            user32.SendMessageW(ctypes.c_void_p(hwnd), 0x80, 0, ctypes.c_void_p(hsmall))
            ok = True
        # 释放上一轮加载的旧图标句柄，避免补设时句柄泄漏
        old = _icon_handles
        _icon_handles = (hbig, hsmall)
        if old:
            for h in old:
                if h:
                    user32.DestroyIcon(ctypes.c_void_p(h))
        return ok
    except Exception as e:
        print('[WebView] 设置图标失败:', e)
        return False


# _icon_lost() 死代码已删除：原本用于周期性 WM_GETICON 轮询检测图标丢失，
# 已确认是画面闪烁诱因，且无任何调用者。图标只在 _boot_window 启动时设置一次，
# 严禁在此文件添加任何周期性图标检测/重设逻辑（会导致任务栏图标重绘闪烁）。


def _boot_window(window):
    try:
        _dark_titlebar(window)
    except Exception as e:
        print('[WebView] 窗口初始化失败:', e)
    try:
        _set_window_icon(window)
    except Exception as e:
        print('[WebView] 图标初始化失败:', e)
    # 图标保活线程已彻底移除（用户反馈画面会闪）：每 10 秒的 WM_GETICON
    # 查询在异常时会误判"图标丢失"并重发 WM_SETICON，任务栏图标随之
    # 重绘一闪。图标只在启动时设置一次即可，不做任何轮询。
    # 强制确保窗口可见并置前（防止初始隐藏/被其他窗口盖住导致"打开了却看不到"）
    try:
        import ctypes
        hwnd = window.native.Handle.ToInt64() if hasattr(window.native, 'Handle') else None
        if hwnd:
            user32 = ctypes.windll.user32
            user32.ShowWindow(ctypes.c_void_p(hwnd), 5)      # SW_SHOW
            user32.ShowWindow(ctypes.c_void_p(hwnd), 3)      # SW_MAXIMIZE
            user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
            # 【修复：初始窗口出现在左上角而非最大化】frameless 窗口的
            # maximized=True 与过早的 SW_MAXIMIZE 会被 webview 后续布局
            # 覆盖回 0,0 小窗。这里改为多次延迟"强制最大化+按所在显示器
            # 工作区铺满"双保险（幂等）：SW_MAXIMIZE 保证状态位，SetWindowPos
            # 保证几何位置，任何时机的布局覆盖都会被下一次重试纠正。
            def _force_max(hwnd64=hwnd, guard=False):
                # guard=True：守护轮询模式，只纠正"状态是最大化但几何偏移"，
                # 非最大化（用户手动还原）直接跳过，绝不强行最大化。
                import ctypes as _c
                from ctypes import wintypes as _wt
                try:
                    u = ctypes.windll.user32
                    MONITOR_DEFAULTTONEAREST = 2

                    class _MI(_c.Structure):
                        _fields_ = [('cbSize', _wt.DWORD),
                                    ('rcMonitor', _wt.RECT),
                                    ('rcWork', _wt.RECT),
                                    ('dwFlags', _wt.DWORD)]

                    class _RC(_c.Structure):
                        _fields_ = [('l', _c.c_long), ('t', _c.c_long),
                                    ('r', _c.c_long), ('b', _c.c_long)]

                    def _target_rect():
                        mon = u.MonitorFromWindow(_c.c_void_p(hwnd64), MONITOR_DEFAULTTONEAREST)
                        mi = _MI()
                        mi.cbSize = _c.sizeof(_MI)
                        if not (mon and u.GetMonitorInfoW(_c.c_void_p(mon), _c.byref(mi))):
                            return None
                        _cover = False
                        try:
                            _cover = _taskbar_autohide()
                        except Exception:
                            _cover = False
                        return mi.rcMonitor if _cover else mi.rcWork

                    def _rect_off(rect, tgt):
                        # 当前窗口矩形与目标工作区矩形的总偏差（物理像素）
                        return (abs(rect.l - tgt.left) + abs(rect.t - tgt.top) +
                                abs(rect.r - tgt.right) + abs(rect.b - tgt.bottom))

                    rc = _target_rect()
                    if rc is None:
                        u.ShowWindow(_c.c_void_p(hwnd64), 3)  # SW_MAXIMIZE
                        return

                    _rect = _RC()
                    ok = bool(u.GetWindowRect(_c.c_void_p(hwnd64), _c.byref(_rect)))
                    _pl = _wt.WINDOWPLACEMENT()
                    _pl.length = _c.sizeof(_pl)
                    _is_max = bool(u.GetWindowPlacement(_c.c_void_p(hwnd64), _c.byref(_pl))) and _pl.showCmd == 3
                    if guard and not _is_max:
                        return  # 守护模式：用户已还原窗口，不打扰
                    _geo_ok = ok and _rect_off(_rect, rc) <= 8

                    if _is_max and _geo_ok:
                        return  # 状态+几何都正确，幂等退出
                    if _is_max and not _geo_ok:
                        # 【偏移小窗修复 2026-11-10】状态位是最大化但几何被
                        # WebView2 布局覆盖成偏移小窗（用户现象：距左上角
                        # 几百像素）。旧守护只查状态位，此情况永不纠正。
                        # 先 SW_RESTORE 脱离最大化态再 SetWindowPos，
                        # 避免在最大化态改几何污染还原矩形，最后重新最大化。
                        u.ShowWindow(_c.c_void_p(hwnd64), 9)   # SW_RESTORE
                        u.SetWindowPos(_c.c_void_p(hwnd64), 0,
                                       rc.left, rc.top,
                                       rc.right - rc.left, rc.bottom - rc.top,
                                       0x0004)  # SWP_NOZORDER
                        u.ShowWindow(_c.c_void_p(hwnd64), 3)   # SW_MAXIMIZE
                        return
                    u.ShowWindow(_c.c_void_p(hwnd64), 3)       # SW_MAXIMIZE
                    u.SetWindowPos(_c.c_void_p(hwnd64), 0,
                                   rc.left, rc.top,
                                   rc.right - rc.left, rc.bottom - rc.top,
                                   0x0004)  # SWP_NOZORDER
                except Exception:
                    pass

            def _re_maximize(hwnd64=hwnd):
                import time as _t
                # 布局覆盖可能发生在任意时机（WebView2 页面加载完仍可能再覆盖一次），
                # 多点重试（幂等）+ 长期守护。
                # 【修复 2026-11-10】旧版：1) 兜底轮询用了未定义的 _c → NameError
                # 线程静默死亡；2) 只查 showCmd 状态位，几何偏移永不纠正。
                # 现改为状态+几何双查；_force_max 内部幂等：已正确最大化时立即返回，
                # 不会覆盖用户手动还原的窗口。
                # 【冷启动修复】首次双击启动时 WebView2 冷缓存布局覆盖可能晚于
                # 固定守护窗口，故改为无限期低频守护（每 2 秒一次），只纠正
                # "状态是最大化但几何偏移"的情况，绝不强行最大化用户还原的窗口。
                for _delay in (0.3, 0.8, 1.5, 2.5, 4.0, 6.0):
                    _t.sleep(_delay)
                    _force_max(hwnd64)  # 启动期：非最大化也纠正（目标是启动即最大化）
                # 无限期守护：低频轮询，guard=True 只修最大化态偏移，
                # 用户手动还原的窗口（showCmd != 3）直接跳过，绝不强行最大化。
                while True:
                    _t.sleep(2.0)
                    _force_max(hwnd64, guard=True)
            threading.Thread(target=_re_maximize, daemon=True).start()
    except Exception as e:
        print('[WebView] 窗口显示失败:', e)
    _inject_resize_js(window)


def _run_window():
    global _win
    import webview  # noqa
    ico = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
    # 【启动即最大化修复 2026-11-11】旧版只传 maximized=True 不给初始几何，
    # pywebview 先按默认 800x600 居中创建窗口，WebView2 首次布局覆盖发生在
    # _boot_window 守护启动之前 → 用户看到"初始不在0,0、没最大化，要点两次"。
    # 现直接按主屏物理尺寸创建（x=0,y=0 全屏矩形），即使最大化状态位被
    # 布局覆盖弄丢，窗口几何也是铺满的；随后 _boot_window 的 SW_MAXIMIZE
    # 只需补状态位即可，一次到位。
    _scr_w, _scr_h = 1280, 720  # 兜底默认（取不到时）
    try:
        _scr_w = ctypes.windll.user32.GetSystemMetrics(0)   # SM_CXSCREEN
        _scr_h = ctypes.windll.user32.GetSystemMetrics(1)   # SM_CYSCREEN
        if not _scr_w or not _scr_h:
            _scr_w, _scr_h = 1280, 720
    except Exception:
        pass
    _win = webview.create_window(
        f'朱峰智能体无限 v{VERSION}',
        URL,
        x=0, y=0,                # 初始位置固定主屏左上角
        width=_scr_w, height=_scr_h,  # 初始几何=主屏全屏
        maximized=True,          # 启动即最大化全屏显示
        background_color='#181a30',
        frameless=True,          # 去掉系统标题栏
        easy_drag=False,         # 拖动由网页顶栏接管
        text_select=True,        # 允许页面文字选中（默认 False 会全局注入 user-select:none，导致对话框文字无法框选）
        js_api=ZFWindowApi(),    # 网页可调用 pywebview.api.*
    )
    _set_app_user_model_id()
    webview.start(_boot_window, _win, icon=ico if os.path.exists(ico) else None)


def _taskbar_autohide():
    """任务栏是否为自动隐藏模式（ABS_AUTOHIDE）。自动隐藏时 rcWork==整屏，
    最大化窗口会铺满全屏，被系统判为全屏窗口导致任务栏无法自动弹出。"""
    try:
        import ctypes
        class APPBARDATA(ctypes.Structure):
            _fields_ = [('cbSize', ctypes.c_ulong), ('hWnd', ctypes.c_void_p),
                        ('uCallbackMessage', ctypes.c_ulong), ('uEdge', ctypes.c_ulong),
                        ('rc', ctypes.wintypes.RECT), ('lParam', ctypes.c_long)]
        abd = APPBARDATA()
        abd.cbSize = ctypes.sizeof(APPBARDATA)
        # SHAppBarMessage(ABM_GETSTATE=4)
        return bool(ctypes.windll.shell32.SHAppBarMessage(4, ctypes.byref(abd)) & 0x1)
    except Exception:
        return False


def _cover_taskbar():
    """最大化/还原时是否铺满整个屏幕（盖住任务栏）。默认 True = 真全屏。
    需要恢复旧行为（让出任务栏）时，启动前设环境变量 ZF_UI_COVER_TASKBAR=0。"""
    return os.environ.get('ZF_UI_COVER_TASKBAR', '1') != '0'


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
                # 默认铺满整个显示器（真全屏，盖住任务栏）。
                # ZF_UI_COVER_TASKBAR=0 时退回旧行为：限制到工作区（不含任务栏），
                # 任务栏可正常自动唤出。
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
                        if _cover_taskbar():
                            rm = mi.rcMonitor
                            ml, mt, mr, mb = rm.left, rm.top, rm.right, rm.bottom
                        else:
                            wa = mi.rcWork
                            if _taskbar_autohide():
                                wa.bottom = min(wa.bottom, mi.rcMonitor.bottom - 1)
                            ml, mt, mr, mb = wa.left, wa.top, wa.right, wa.bottom
                        mmi.ptMaxPosition.x = ml
                        mmi.ptMaxPosition.y = mt
                        mmi.ptMaxSize.x = mr - ml
                        mmi.ptMaxSize.y = mb - mt
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
        # 这里补一次：按全屏/工作区策略重设已最大化窗口的尺寸
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
                    rect = mi.rcMonitor if _cover_taskbar() else mi.rcWork
                    if not _cover_taskbar() and _taskbar_autohide():
                        rect.bottom = min(rect.bottom, mi.rcMonitor.bottom - 1)
                    SWP_NOZORDER = 0x0004
                    user32.SetWindowPos(ctypes.c_void_p(hwnd), None,
                        rect.left, rect.top, rect.right - rect.left,
                        rect.bottom - rect.top, SWP_NOZORDER)
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


def _force_foreground(hwnd):
    """可靠地把窗口带到最前。Windows 禁止后台进程 SetForegroundWindow 抢焦点
    （会被静默拒绝，任务栏只闪烁），先模拟一次 ALT 按键即可绕过该限制。"""
    try:
        user32 = ctypes.windll.user32
        # 托盘「还原主界面」：无论窗口处于隐藏（点×缩到托盘）、最小化还是普通
        # 状态，都先 SW_SHOW 确保可见，再 SW_MAXIMIZE 最大化显示，
        # 避免还原后窗口不可见（单用 SW_SHOW 对隐藏/最小化恢复不可靠）。
        user32.ShowWindow(ctypes.c_void_p(hwnd), 5)   # SW_SHOW：确保可见
        user32.ShowWindow(ctypes.c_void_p(hwnd), 3)   # SW_MAXIMIZE：最大化显示
        user32.keybd_event(0x12, 0, 0, 0)             # ALT down
        user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
        user32.keybd_event(0x12, 0, 2, 0)             # ALT up
        # 双保险：仍失败则 TOPMOST 置顶再取消
        if user32.GetForegroundWindow() != hwnd:
            HWND_TOPMOST, HWND_NOTOPMOST, SWP_FLAGS = -1, -2, 0x0043
            user32.SetWindowPos(ctypes.c_void_p(hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS)
            user32.SetWindowPos(ctypes.c_void_p(hwnd), HWND_NOTOPMOST, 0, 0, 0, 0, SWP_FLAGS)
    except Exception:
        pass


def _activate_via_powershell():
    """用 PowerShell 激活窗口（无黑窗：CREATE_NO_WINDOW）"""
    subprocess.run([
        'powershell', '-NoProfile', '-Command',
        '(New-Object -ComObject WScript.Shell).AppActivate("朱峰智能体")'
    ], timeout=5,
       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def _open_kiosk_fallback(reason=''):
    """Edge kiosk 真全屏兜底：桌面级全屏（无边框/无任务栏），F11/Alt+F4 退出。
    pywebview 因 WebView2 交互 DLL 与 .NET 8 不兼容而失败时使用。"""
    if reason:
        print('[WebView] 窗口启动失败(%s)，尝试 Edge kiosk 全屏' % reason)
    import subprocess
    edge_paths = [
        os.path.join(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'),
                     r'Microsoft\Edge\Application\msedge.exe'),
        os.path.join(os.environ.get('PROGRAMFILES', r'C:\Program Files'),
                     r'Microsoft\Edge\Application\msedge.exe'),
    ]
    for exe in edge_paths:
        if os.path.isfile(exe):
            try:
                # 注意：列表参数形式(含空格/短路径)会导致 Edge 闪退(3221226505)，
                # 必须用引号包裹的命令行字符串形式启动（实测有效）
                kiosk_dir = os.path.join(tempfile.gettempdir(), 'zf_kiosk')
                cmd = ('"{exe}" --kiosk "{url}" --edge-kiosk-type=fullscreen '
                       '--no-first-run --disable-features=msSmartScreen '
                       '--user-data-dir="{dir}"').format(exe=exe, url=URL, dir=kiosk_dir)
                subprocess.Popen(cmd, close_fds=True)
                return True
            except Exception:
                pass
    # kiosk 不可用时也走最大化浏览器兜底（原 webbrowser.open 默认非最大化）
    open_url_maximized(URL)
    return False


def _find_window_by_title(title):
    """按标题找窗口，FindWindowW 找不到时（隐藏窗口可能查不到）用
    EnumWindows 兜底——EnumWindows 能遍历到隐藏的顶层窗口。"""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, title)
        if hwnd:
            return hwnd
        result = []
        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def _cb(h, _l):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(h, buf, 256)
            if buf.value == title:
                result.append(h)
                return False  # 找到即停
            return True
        user32.EnumWindows(_cb, 0)
        return result[0] if result else None
    except Exception:
        return None


def main():
    # 聚焦通知子进程：不带窗口直接退出（Windows 下 webview 无跨进程聚焦 API，
    # 子进程用 Win32 找到窗口后唤醒+置前，然后退出）
    if os.environ.get(FOCUS_ENV) == '1':
        try:
            hwnd = _find_window_by_title(f'朱峰智能体无限 v{VERSION}')
            if hwnd:
                _force_foreground(hwnd)  # 内含 SW_SHOW 唤醒隐藏窗口
            else:
                _activate_via_powershell()
        except Exception:
            pass
        return

    # 单实例：已有窗口进程在跑 → 发聚焦通知后退出
    # 【修复 2026-11-09】残留锁 + PID 复用误判：旧窗口进程死掉后锁文件没删，
    #   新进程启动时 OpenProcess(旧PID) 因该 PID 已被其他进程（如 powershell）
    #   复用而"能打开" → 误判窗口还活着，静默退出 → 主界面不显示。
    #   修复：除了 OpenProcess，还要验证 ① 进程名是 python/pythonw，
    #   ② 该 PID 的命令行确实含 webview_client.py（查不到时视为死进程清锁）。
    import tempfile
    lock = os.path.join(tempfile.gettempdir(), f'zf_webview_{PORT}.pid')
    def _pid_is_our_webview(pid):
        """验证 PID 是否真的是本项目的 webview 窗口进程（防 PID 复用误判）"""
        if pid == os.getpid():
            return True
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x00100000, False, pid)
        if not h:
            return False
        ctypes.windll.kernel32.CloseHandle(h)
        # ① 进程名必须是 python/pythonw（PID 复用成其他程序时直接判死）
        try:
            import subprocess as _sp
            _pl = (
                # Get-CimInstance：Win11 24H2 起已移除 wmic，优先走 CIM（【用户拍板 2026-11-12】）
                f"Get-CimInstance Win32_Process -Filter 'ProcessId={pid}' "
                "| Select-Object Name,CommandLine | ConvertTo-Json"
            )
            try:
                out = _sp.run(['powershell', '-NoProfile', '-Command', _pl],
                              capture_output=True, text=True, timeout=8,
                              creationflags=0x08000000).stdout  # CREATE_NO_WINDOW 防 GUI 闪黑框
            except Exception:
                out = ''
            if not out.strip():
                # 降级分支：老系统（CIM cmdlet 缺失/PowerShell 过旧）回退 wmic
                out = _sp.run(['wmic', 'process', 'where', f'ProcessId={pid}',
                               'get', 'Name,CommandLine', '/format:list'],
                              capture_output=True, text=True, timeout=5,
                              creationflags=0x08000000).stdout  # CREATE_NO_WINDOW
            _low = out.lower()
            _conservative = False  # 查询失败保守模式：跳过双因子，只留窗口标题兜底
            if 'python' in _low:
                pass  # 命中目标进程特征，继续下方 webview_client 校验
            elif ('no instance' in _low) or ('name' in _low and 'commandline' in _low):
                # 明确"查无此进程"（wmic No Instance）或明确是其他程序（有结构化字段但非 python）
                # → 旧进程确实已死/PID 被复用，正常判死删锁
                return False
            else:
                # 查询失败产出垃圾文本（如本地化错误进 stdout、PowerShell 策略报错）：
                # 白名单语义：只有明确命中才判活/判死，未知格式一律保守 →
                # 跳过双因子校验，防误删锁开出双实例（勿往此处追加黑名单枚举）
                _conservative = True
                # 【加固 2026-11-12 第5轮】保守模式失败终点闭环：若标题窗口也不存在，
                # 说明旧进程实际已死 → 判死清锁。否则锁文件永久残留，双击永远只走
                # 激活路径静默退出，用户级不可用（反驳师第4轮实查定罪 L1059 hwnd=None）。
                try:
                    if not _find_window_by_title(f'朱峰智能体无限 v{VERSION}'):
                        print('[SingleInstance] PID校验保守模式且标题窗口不存在 → 判死清锁')
                        return False
                    print('[SingleInstance] PID校验进入保守模式（查询输出异常），标题窗口存在 → 视为存活')
                except Exception:
                    pass
            # ② 命令行需含 webview_client.py（不同版本目录都算，防误杀其他版本窗口）
            if not _conservative and 'webview_client' not in out.lower():
                return False
        except Exception:
            # wmic 查询失败时保守回退：只用窗口标题兜底（下方 FindWindow 逻辑）
            pass
        return True
    try:
        pid = int(open(lock).read().strip())
        if _pid_is_our_webview(pid):
            # 确认旧窗口进程还活着：除了发激活通知，还必须把隐藏的窗口重新显示出来
            try:
                hwnd = _find_window_by_title(f'朱峰智能体无限 v{VERSION}')
                if hwnd:
                    _force_foreground(hwnd)  # 内含 SW_SHOW 唤醒隐藏窗口
            except Exception:
                pass
            try:
                _activate_via_powershell()
            except Exception:
                pass
            return
        else:
            # 旧进程已死（或 PID 被其他程序复用），残留锁文件，删除后正常开新窗口
            try:
                os.remove(lock)
            except Exception:
                pass
    except Exception:
        pass

    # 【DPI 感知声明 2026-11】必须尽早声明 per-monitor DPI 感知：
    # 未声明时 Windows 对窗口坐标做 DPI 虚拟化缩放，GetMonitorInfoW 返回的
    # 工作区与 SetWindowPos 的目标坐标系不一致 → 最大化铺满出现偏差/留边。
    # 声明后全部使用真实物理像素，任意分辨率（含 3K/4K 大屏、多屏）都精确铺满。
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_DPI_AWARE
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()  # 旧系统兜底
    except Exception:
        pass

    # 【启动闪屏 2026-11-14】最先弹闪屏：双击后毫秒级出现进度条界面
    _start_splash_early()

    # 防息屏守护尽早启动：服务等待期间(可能数十秒)也不息屏不变暗。
    # 守护线程为 daemon，若后续回退浏览器/进程退出，线程随之终止，
    # OS 会在进程结束时自动清除执行状态，无需手动恢复。
    threading.Thread(target=_keep_display_awake, daemon=True).start()

    if not _wait_server():
        print('[WebView] 服务未就绪，回退浏览器')
        _splash_finish()
        open_url_maximized(URL)
        return

    _splash_update('正在加载界面…')

    # 【闪屏提前关闭修复 2026-11-14】服务就绪、主窗口即将创建时就关闭闪屏。
    # 旧版把 _splash_finish() 放在 finally（webview.start 阻塞到窗口关闭才返回），
    # 导致主界面已显示而闪屏进度条还挂着，只能等 60 秒兜底自动关闭。
    _splash_finish()

    try:
        with open(lock, 'w') as f:
            f.write(str(os.getpid()))
        _run_window()
    except Exception as e:
        _open_kiosk_fallback(e)
    finally:
        _splash_finish()  # 幂等：_SPLASH 已为 None 时无操作
        try:
            os.remove(lock)
        except Exception:
            pass


if __name__ == '__main__':
    main()
