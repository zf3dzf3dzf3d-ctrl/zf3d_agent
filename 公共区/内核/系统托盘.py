"""
系统托盘 — Windows托盘图标，零外部依赖（ctypes调用Win32 API）
仅在Windows平台生效，Linux/Mac自动跳过
托盘右键菜单：打开界面 | 退出
"""
import sys
import threading

# 仅Windows加载
_IS_WINDOWS = sys.platform == 'win32'


class 系统托盘:
    """纯ctypes实现的Windows系统托盘图标"""

    def __init__(self, 启动器实例=None):
        self._启动器 = 启动器实例
        self._线程 = None
        self._运行 = False
        self._提示 = "朱峰社区智能体运行中"
        self._托盘添加成功 = False

    def 启动(self, 提示: str = None):
        """启动托盘（非Windows平台静默跳过）"""
        if not _IS_WINDOWS:
            return False
        if 提示:
            self._提示 = 提示
        self._运行 = True
        self._线程 = threading.Thread(target=self._消息循环, daemon=True)
        self._线程.start()
        return True

    def _消息循环(self):
        """托盘消息循环"""
        try:
            import ctypes
            from ctypes import wintypes

            # 注册隐藏窗口类
            实例句柄 = ctypes.windll.kernel32.GetModuleHandleW(None)

            # 定义窗口过程
            WM_USER = 0x0400
            WM_DESTROY = 0x0002
            WM_COMMAND = 0x0111
            WM_APP = 0x8000
            托盘回调 = WM_APP

            # 菜单命令ID
            ID_OPEN = 1001
            ID_EXIT = 1002

            # 窗口过程函数
            @ctypes.WINFUNCTYPE(ctypes.c_long, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
            def 窗口过程(hwnd, msg, wparam, lparam):
                if msg == 托盘回调:
                    if lparam == 0x0203:  # WM_RBUTTONUP (右键弹起)
                        # 显示右键菜单
                        ctypes.windll.user32.SetForegroundWindow(hwnd)
                        菜单 = ctypes.windll.user32.CreatePopupMenu()
                        ctypes.windll.user32.AppendMenuW(菜单, 0, ID_OPEN, "🌐 打开界面")
                        ctypes.windll.user32.AppendMenuW(菜单, 0x800, 0, None)  # 分隔线
                        ctypes.windll.user32.AppendMenuW(菜单, 0, ID_EXIT, "🚪 退出")
                        # 获取鼠标位置
                        鼠标 = wintypes.POINT()
                        ctypes.windll.user32.GetCursorPos(ctypes.byref(鼠标))
                        cmd = ctypes.windll.user32.TrackPopupMenu(
                            菜单, 0x0180 | 0x0100,  # TPM_RIGHTBUTTON | TPM_RETURNCMD
                            鼠标.x, 鼠标.y, 0, hwnd, None
                        )
                        if cmd == ID_OPEN:
                            import webbrowser
                            webbrowser.open("http://localhost:8765")
                        elif cmd == ID_EXIT:
                            ctypes.windll.user32.DestroyWindow(hwnd)
                        ctypes.windll.user32.DestroyMenu(菜单)
                    return 0
                elif msg == WM_COMMAND:
                    if wparam == ID_OPEN:
                        import webbrowser
                        webbrowser.open("http://localhost:8765")
                    elif wparam == ID_EXIT:
                        ctypes.windll.user32.DestroyWindow(hwnd)
                    return 0
                elif msg == WM_DESTROY:
                    ctypes.windll.user32.PostQuitMessage(0)
                    return 0
                return ctypes.windll.user32.DefWindowProcW(hwnd, msg, wparam, lparam)

            # 注册窗口类
            类名 = "ZF3D_Agent_Tray"
            wndclass = wintypes.WNDCLASSW()
            wndclass.lpfnWndProc = 窗口过程
            wndclass.hInstance = 实例句柄
            wndclass.lpszClassName = 类名
            ctypes.windll.user32.RegisterClassW(ctypes.byref(wndclass))

            # 创建隐藏窗口
            hwnd = ctypes.windll.user32.CreateWindowExW(
                0, 类名, "智能体托盘", 0, 0, 0, 0, 0, 0, 0, 实例句柄, None
            )

            if not hwnd:
                return

            # 添加托盘图标
            NOTIFYICONDATAW = type("NOTIFYICONDATAW", (ctypes.Structure,), {
                "_fields_": [
                    ("cbSize", wintypes.DWORD),
                    ("hWnd", wintypes.HWND),
                    ("uID", wintypes.UINT),
                    ("uFlags", wintypes.UINT),
                    ("uCallbackMessage", wintypes.UINT),
                    ("hIcon", wintypes.HICON),
                    ("szTip", wintypes.WCHAR * 128),
                    ("dwState", wintypes.DWORD),
                    ("dwStateMask", wintypes.DWORD),
                    ("szInfo", wintypes.WCHAR * 256),
                    ("uVersion", wintypes.UINT),
                    ("szInfoTitle", wintypes.WCHAR * 64),
                    ("dwInfoFlags", wintypes.DWORD),
                ]
            })

            # 加载系统图标
            hIcon = ctypes.windll.user32.LoadIconW(None, 32512)  # IDI_APPLICATION

            nid = NOTIFYICONDATAW()
            nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
            nid.hWnd = hwnd
            nid.uID = 1
            nid.uFlags = 0x01 | 0x02 | 0x04  # NIF_MESSAGE | NIF_ICON | NIF_TIP
            nid.uCallbackMessage = 托盘回调
            nid.hIcon = hIcon
            nid.szTip = self._提示[:127]

            NIM_ADD = 0x00000000
            NIM_DELETE = 0x00000002
            result = ctypes.windll.user32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
            if result:
                self._托盘添加成功 = True

            # 消息循环
            msg = wintypes.MSG()
            while self._运行:
                ret = ctypes.windll.user32.GetMessageW(ctypes.byref(msg), 0, 0, 0)
                if ret <= 0:
                    break
                ctypes.windll.user32.TranslateMessage(ctypes.byref(msg))
                ctypes.windll.user32.DispatchMessageW(ctypes.byref(msg))

            # 删除托盘图标
            if self._托盘添加成功:
                ctypes.windll.user32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(nid))

        except Exception:
            pass

    def 更新提示(self, 文字: str):
        """更新托盘tooltip"""
        self._提示 = 文字[:127]

    def 停止(self):
        """停止托盘"""
        self._运行 = False
        try:
            import ctypes
            ctypes.windll.user32.PostQuitMessage(0)
        except Exception:
            pass
