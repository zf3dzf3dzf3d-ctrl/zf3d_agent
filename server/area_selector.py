"""
区域选择 — 全屏半透明遮罩框选工具，返回选区坐标 (x, y, w, h)
复用截图选区的 transparentcolor + 4块外区矩形机制
选区框上显示实时尺寸文字
"""
import tkinter as tk
import threading


class 区域选择:
    """全屏遮罩框选，选区内透明，选区外半透明黑色，返回坐标"""

    _透明色 = "#abcdef"
    _结果 = None
    _事件 = None

    def __init__(self, 根窗口=None):
        self._根窗口 = 根窗口
        self._遮罩 = None
        self._画布 = None
        self._起点 = None
        self._当前选区 = None
        self._屏宽 = 0
        self._屏高 = 0
        self._全屏遮罩 = None
        self._外区矩形 = []
        self._选区框 = None
        self._尺寸文字 = None

    def 弹出(self):
        """创建全屏遮罩窗口，阻塞直到用户选完或取消"""
        self._结果 = None
        self._事件 = threading.Event()

        if self._根窗口:
            self._遮罩 = tk.Toplevel(self._根窗口)
        else:
            self._遮罩 = tk.Toplevel()

        self._遮罩.overrideredirect(True)
        self._遮罩.attributes("-alpha", 0.3)
        self._遮罩.attributes("-topmost", True)

        self._屏宽 = self._遮罩.winfo_screenwidth()
        self._屏高 = self._遮罩.winfo_screenheight()
        self._遮罩.geometry(f"{self._屏宽}x{self._屏高}+0+0")
        self._遮罩.attributes("-transparentcolor", self._透明色)
        self._遮罩.configure(bg=self._透明色)

        self._画布 = tk.Canvas(
            self._遮罩, width=self._屏宽, height=self._屏高,
            bg=self._透明色, highlightthickness=0
        )
        self._画布.pack(fill="both", expand=True)
        self._画布.configure(cursor="crosshair")

        # 初始全屏遮罩
        self._全屏遮罩 = self._画布.create_rectangle(
            0, 0, self._屏宽, self._屏高,
            fill="#000000", outline=""
        )

        # 提示文字
        self._画布.create_text(
            self._屏宽 // 2, self._屏高 // 2,
            text="拖拽选择录制区域  |  ESC 取消",
            fill="#ffffff", font=("Microsoft YaHei UI", 16, "bold"),
            tags="hint"
        )

        self._画布.bind("<Button-1>", self._按下)
        self._画布.bind("<B1-Motion>", self._拖动)
        self._画布.bind("<ButtonRelease-1>", self._松开)
        self._画布.bind("<Button-3>", lambda e: self._取消())
        self._遮罩.bind("<Escape>", lambda e: self._取消())
        self._遮罩.focus_force()

        # 等待用户操作
        self._遮罩.wait_window()
        return self._结果

    def _按下(self, 事件):
        self._起点 = (事件.x, 事件.y)
        if self._全屏遮罩 is not None:
            self._画布.delete(self._全屏遮罩)
            self._全屏遮罩 = None
        self._画布.delete("hint")
        self._创建选区(事件.x, 事件.y, 事件.x, 事件.y)

    def _创建选区(self, x1, y1, x2, y2):
        self._外区矩形 = [
            self._画布.create_rectangle(0, 0, self._屏宽, y1, fill="#000000", outline=""),
            self._画布.create_rectangle(0, y2, self._屏宽, self._屏高, fill="#000000", outline=""),
            self._画布.create_rectangle(0, y1, x1, y2, fill="#000000", outline=""),
            self._画布.create_rectangle(x2, y1, self._屏宽, y2, fill="#000000", outline=""),
        ]
        self._选区框 = self._画布.create_rectangle(
            x1, y1, x2, y2,
            outline="#00aaff", width=2
        )
        w = abs(x2 - x1)
        h = abs(y2 - y1)
        self._尺寸文字 = self._画布.create_text(
            max(x1, x2), min(y1, y2) - 12,
            text=f"{w}×{h}", fill="#00aaff",
            font=("Microsoft YaHei UI", 10, "bold"),
            anchor="s"
        )

    def _更新选区(self, x1, y1, x2, y2):
        self._画布.coords(self._外区矩形[0], 0, 0, self._屏宽, y1)
        self._画布.coords(self._外区矩形[1], 0, y2, self._屏宽, self._屏高)
        self._画布.coords(self._外区矩形[2], 0, y1, x1, y2)
        self._画布.coords(self._外区矩形[3], x2, y1, self._屏宽, y2)
        self._画布.coords(self._选区框, x1, y1, x2, y2)
        w = abs(x2 - x1)
        h = abs(y2 - y1)
        self._画布.coords(self._尺寸文字, max(x1, x2), min(y1, y2) - 12)
        self._画布.itemconfig(self._尺寸文字, text=f"{w}×{h}")

    def _拖动(self, 事件):
        if not self._起点:
            return
        x1 = min(self._起点[0], 事件.x)
        y1 = min(self._起点[1], 事件.y)
        x2 = max(self._起点[0], 事件.x)
        y2 = max(self._起点[1], 事件.y)
        self._更新选区(x1, y1, x2, y2)
        self._当前选区 = (x1, y1, x2, y2)

    def _松开(self, 事件):
        if not self._当前选区:
            self._取消()
            return
        x1, y1, x2, y2 = self._当前选区
        w = x2 - x1
        h = y2 - y1
        if w < 10 or h < 10:
            self._取消()
            return
        self._结果 = {"x": x1, "y": y1, "w": w, "h": h}
        self._销毁()

    def _取消(self):
        self._结果 = None
        self._销毁()

    def _销毁(self):
        try:
            if self._遮罩:
                self._遮罩.destroy()
        except Exception:
            pass
        self._遮罩 = None
        self._画布 = None
        self._起点 = None
        self._当前选区 = None
        self._全屏遮罩 = None
        self._外区矩形 = []
        self._选区框 = None
