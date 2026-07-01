"""
截图选区 — 全屏半透明遮罩框选工具（tkinter实现，零依赖）

弹出后全屏半透明黑色遮罩，鼠标变十字光标，
用户拖拽框选区域，松开后返回选区截图的base64。
"""
import tkinter as tk
import io
import base64


class 截图选区:
    """全屏半透明遮罩框选，选区内透明，选区外半透明黑色"""

    def __init__(self, 回调, 根窗口=None):
        """
        回调: function(base64_str 或 None)
        根窗口: 可选的Tk根窗口，用于创建Toplevel
        """
        self._回调 = 回调
        self._根窗口 = 根窗口
        self._遮罩 = None
        self._画布 = None
        self._选区 = None
        self._起点 = None
        self._当前选区 = None

    def 弹出(self):
        """创建全屏遮罩窗口"""
        if self._根窗口:
            self._遮罩 = tk.Toplevel(self._根窗口)
        else:
            self._遮罩 = tk.Toplevel()
        self._遮罩.overrideredirect(True)
        self._遮罩.attributes("-alpha", 0.25)
        self._遮罩.attributes("-topmost", True)
        self._遮罩.configure(bg="black")

        屏宽 = self._遮罩.winfo_screenwidth()
        屏高 = self._遮罩.winfo_screenheight()
        self._遮罩.geometry(f"{屏宽}x{屏高}+0+0")

        self._画布 = tk.Canvas(
            self._遮罩, width=屏宽, height=屏高,
            bg="black", highlightthickness=0
        )
        self._画布.pack(fill="both", expand=True)
        self._画布.configure(cursor="crosshair")

        self._画布.bind("<Button-1>", self._按下)
        self._画布.bind("<B1-Motion>", self._拖动)
        self._画布.bind("<ButtonRelease-1>", self._松开)
        self._画布.bind("<Button-3>", lambda e: self._取消())
        self._遮罩.bind("<Escape>", lambda e: self._取消())
        self._遮罩.focus_force()

    def _按下(self, 事件):
        self._起点 = (事件.x, 事件.y)
        if self._选区:
            self._画布.delete(self._选区)
        self._选区 = self._画布.create_rectangle(
            事件.x, 事件.y, 事件.x, 事件.y,
            outline="#00aaff", width=2
        )

    def _拖动(self, 事件):
        if not self._起点 or not self._选区:
            return
        x1 = min(self._起点[0], 事件.x)
        y1 = min(self._起点[1], 事件.y)
        x2 = max(self._起点[0], 事件.x)
        y2 = max(self._起点[1], 事件.y)
        self._画布.coords(self._选区, x1, y1, x2, y2)
        self._当前选区 = (x1, y1, x2, y2)

    def _松开(self, 事件):
        if not self._当前选区:
            self._取消()
            return
        x1, y1, x2, y2 = self._当前选区
        if x2 - x1 < 5 or y2 - y1 < 5:
            self._取消()
            return
        try:
            from PIL import ImageGrab
            img = ImageGrab.grab(bbox=(x1, y1, x2, y2))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            图片b64 = base64.b64encode(buf.getvalue()).decode()
        except Exception as e:
            print(f"截图失败: {e}")
            图片b64 = None
        self._销毁()
        if self._回调:
            self._回调(图片b64)

    def _取消(self):
        self._销毁()
        if self._回调:
            self._回调(None)

    def _销毁(self):
        try:
            if self._遮罩:
                self._遮罩.destroy()
        except Exception:
            pass
        self._遮罩 = None
        self._画布 = None
        self._选区 = None
        self._起点 = None
        self._当前选区 = None
