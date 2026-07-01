"""
全局呼出器 — Ctrl+~ 全局触发，零依赖（ctypes + Win32 API）

监听全局键盘 Ctrl+~，触发回调，附带鼠标坐标和当前前台窗口标题。
仅在Windows上运行，其他平台自动跳过。

注意：Win64下指针/LRESULT/WPARAM/LPARAM都是8字节，
必须显式声明argtypes/restype，否则ctypes默认用c_int(4字节)导致栈损坏。
"""
import ctypes
import threading
import time
import sys

# Win32 常量
WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
HC_ACTION = 0
CF_UNICODETEXT = 13
VK_CONTROL = 0x11
VK_OEM_3 = 0xC0  # `~ 键（ESC下方）

# Win64 安全类型
LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
HHOOK = ctypes.c_void_p


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", ctypes.c_uint),
        ("scanCode", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("message", ctypes.c_uint),
        ("wParam", WPARAM),
        ("lParam", LPARAM),
        ("time", ctypes.c_ulong),
        ("pt", ctypes.c_long * 2),
    ]


# 显式声明Win32函数类型
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

user32.SetWindowsHookExW.argtypes = [ctypes.c_int, ctypes.c_void_p, HHOOK, ctypes.c_uint]
user32.SetWindowsHookExW.restype = HHOOK

user32.UnhookWindowsHookEx.argtypes = [HHOOK]
user32.UnhookWindowsHookEx.restype = ctypes.c_int

user32.CallNextHookEx.argtypes = [HHOOK, ctypes.c_int, WPARAM, LPARAM]
user32.CallNextHookEx.restype = LRESULT

user32.GetMessageW.argtypes = [ctypes.POINTER(MSG), HHOOK, ctypes.c_uint, ctypes.c_uint]
user32.GetMessageW.restype = ctypes.c_int

user32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
user32.TranslateMessage.restype = ctypes.c_int

user32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
user32.DispatchMessageW.restype = LRESULT

user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short

user32.GetCursorPos.argtypes = [ctypes.c_void_p]
user32.GetCursorPos.restype = ctypes.c_int

user32.GetForegroundWindow.argtypes = []
user32.GetForegroundWindow.restype = ctypes.c_void_p

user32.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
user32.GetWindowTextLengthW.restype = ctypes.c_int

user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int

user32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_uint, ctypes.c_void_p]
user32.keybd_event.restype = None

user32.OpenClipboard.argtypes = [ctypes.c_void_p]
user32.OpenClipboard.restype = ctypes.c_int

user32.GetClipboardData.argtypes = [ctypes.c_uint]
user32.GetClipboardData.restype = ctypes.c_void_p

user32.CloseClipboard.argtypes = []
user32.CloseClipboard.restype = ctypes.c_int

kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalLock.restype = ctypes.c_void_p

kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
kernel32.GlobalUnlock.restype = ctypes.c_int

HOOKPROC = ctypes.WINFUNCTYPE(
    LRESULT,
    ctypes.c_int,
    WPARAM,
    LPARAM
)


class 全局呼出器:
    """监听全局 Ctrl+~ 快捷键，触发回调"""

    def __init__(self, 回调):
        self._回调 = 回调
        self._钩子句柄 = None
        self._线程 = None
        self._运行 = False
        self._上次触发 = 0.0

    def 启动(self):
        if sys.platform != "win32":
            print("⚠️ 全局呼出器仅支持Windows")
            return
        self._运行 = True
        self._线程 = threading.Thread(target=self._消息循环, daemon=True)
        self._线程.start()

    def _消息循环(self):
        """设置低级键盘钩子"""
        def 钩子回调(nCode, wParam, lParam):
            # 回调必须<1ms返回
            try:
                if nCode == HC_ACTION and wParam == WM_KEYDOWN:
                    kb = KBDLLHOOKSTRUCT.from_address(lParam)
                    if kb.vkCode == VK_OEM_3:
                        # 检查Ctrl是否按下
                        ctrl = user32.GetAsyncKeyState(VK_CONTROL)
                        if ctrl & 0x8000:
                            # 防抖：300ms内不重复触发
                            now = time.perf_counter()
                            if now - self._上次触发 > 0.3:
                                self._上次触发 = now
                                鼠标坐标 = self._获取鼠标坐标()
                                窗口标题 = self._获取前台窗口标题()
                                # 在弹窗抢焦点前，先抓取选中文本
                                选中文本 = 全局呼出器.获取选中文本()
                                if self._回调:
                                    threading.Thread(
                                        target=self._回调,
                                        args=(鼠标坐标, 窗口标题, 选中文本),
                                        daemon=True
                                    ).start()
            except Exception:
                pass
            return user32.CallNextHookEx(None, nCode, wParam, lParam)

        self._钩子函数 = HOOKPROC(钩子回调)
        self._钩子句柄 = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._钩子函数, None, 0)
        if not self._钩子句柄:
            err = ctypes.get_last_error()
            print(f"⚠️ 全局键盘钩子注册失败，错误码={err}")
            return
        print("✅ 钩子已注册，等待 Ctrl+~ 触发...")

        msg = MSG()
        while self._运行:
            ret = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret <= 0:
                break
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def _获取鼠标坐标(self):
        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
        pt = POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        return (pt.x, pt.y)

    def _获取前台窗口标题(self):
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return ""
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value

    @staticmethod
    def 获取选中文本():
        """模拟Ctrl+C获取当前选中文本"""
        旧内容 = 全局呼出器.读取剪贴板()
        user32.keybd_event(0x11, 0, 0, 0)   # Ctrl down
        user32.keybd_event(0x43, 0, 0, 0)   # C down
        user32.keybd_event(0x43, 0, 2, 0)   # C up
        user32.keybd_event(0x11, 0, 2, 0)   # Ctrl up
        time.sleep(0.1)
        新内容 = 全局呼出器.读取剪贴板()
        if 新内容 and 新内容 != 旧内容:
            return 新内容
        return ""

    @staticmethod
    def 读取剪贴板():
        if not user32.OpenClipboard(None):
            return ""
        try:
            handle = user32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return ""
            ptr = kernel32.GlobalLock(handle)
            if not ptr:
                return ""
            text = ctypes.wstring_at(ptr)
            kernel32.GlobalUnlock(handle)
            return text
        finally:
            user32.CloseClipboard()

    def 停止(self):
        self._运行 = False
        if self._钩子句柄:
            user32.UnhookWindowsHookEx(self._钩子句柄)
            self._钩子句柄 = None
