"""
截图选区 — 全屏半透明遮罩框选工具（tkinter实现，零依赖）

弹出后全屏半透明黑色遮罩，鼠标变十字光标，
用户拖拽框选区域，松开后返回选区截图的base64。
选区内透明（无遮罩），选区外半透明黑色遮罩。
"""
import tkinter as tk
import io
import base64


class 截图选区:
    """全屏半透明遮罩框选，选区内透明，选区外半透明黑色"""

    # 透明色键（用显眼的假色避免与实际内容冲突）
    _透明色 = "#abcdef"

    def __init__(self, 回调, 根窗口=None):
        """
        回调: function(base64_str 或 None)
        根窗口: 可选的Tk根窗口，用于创建Toplevel
        """
        self._回调 = 回调
        self._根窗口 = 根窗口
        self._遮罩 = None
        self._画布 = None
        self._起点 = None
        self._当前选区 = None
        self._屏宽 = 0
        self._屏高 = 0
        self._全屏遮罩 = None    # 初始全屏遮罩矩形
        self._外区矩形 = []      # 4个外区遮罩矩形（上/下/左/右）
        self._选区框 = None      # 选区边框

    def 弹出(self):
        """创建全屏遮罩窗口"""
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

        # transparentcolor 使该颜色的像素完全透明且穿透点击
        # alpha 使非透明色像素半透明 → 外区遮罩呈半透明黑色，选区内完全透明
        self._遮罩.attributes("-transparentcolor", self._透明色)
        self._遮罩.configure(bg=self._透明色)

        self._画布 = tk.Canvas(
            self._遮罩, width=self._屏宽, height=self._屏高,
            bg=self._透明色, highlightthickness=0
        )
        self._画布.pack(fill="both", expand=True)
        self._画布.configure(cursor="crosshair")

        # 初始全屏遮罩（用户点击前整个屏幕都是半透明黑色）
        self._全屏遮罩 = self._画布.create_rectangle(
            0, 0, self._屏宽, self._屏高,
            fill="#000000", outline=""
        )

        self._画布.bind("<Button-1>", self._按下)
        self._画布.bind("<B1-Motion>", self._拖动)
        self._画布.bind("<ButtonRelease-1>", self._松开)
        self._画布.bind("<Button-3>", lambda e: self._取消())
        self._遮罩.bind("<Escape>", lambda e: self._取消())
        self._遮罩.focus_force()

    def _按下(self, 事件):
        self._起点 = (事件.x, 事件.y)
        # 删除初始全屏遮罩，切换为4块外区遮罩
        if self._全屏遮罩 is not None:
            self._画布.delete(self._全屏遮罩)
            self._全屏遮罩 = None
        self._清除选区()
        self._创建选区(事件.x, 事件.y, 事件.x, 事件.y)

    def _创建选区(self, x1, y1, x2, y2):
        """创建4块外区遮罩 + 选区边框，选区内部留空（透明）"""
        self._外区矩形 = [
            self._画布.create_rectangle(0, 0, self._屏宽, y1, fill="#000000", outline=""),       # 上
            self._画布.create_rectangle(0, y2, self._屏宽, self._屏高, fill="#000000", outline=""), # 下
            self._画布.create_rectangle(0, y1, x1, y2, fill="#000000", outline=""),               # 左
            self._画布.create_rectangle(x2, y1, self._屏宽, y2, fill="#000000", outline=""),       # 右
        ]
        self._选区框 = self._画布.create_rectangle(
            x1, y1, x2, y2,
            outline="#00aaff", width=2
        )

    def _更新选区(self, x1, y1, x2, y2):
        """更新4块外区遮罩坐标 + 选区边框坐标"""
        self._画布.coords(self._外区矩形[0], 0, 0, self._屏宽, y1)
        self._画布.coords(self._外区矩形[1], 0, y2, self._屏宽, self._屏高)
        self._画布.coords(self._外区矩形[2], 0, y1, x1, y2)
        self._画布.coords(self._外区矩形[3], x2, y1, self._屏宽, y2)
        self._画布.coords(self._选区框, x1, y1, x2, y2)

    def _清除选区(self):
        for r in self._外区矩形:
            self._画布.delete(r)
        self._外区矩形 = []
        if self._选区框 is not None:
            self._画布.delete(self._选区框)
            self._选区框 = None

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
        if x2 - x1 < 5 or y2 - y1 < 5:
            self._取消()
            return
        try:
            from PIL import ImageGrab
            # 先隐藏遮罩再截图，否则遮罩覆盖了顶层窗口
            self._遮罩.withdraw()
            self._遮罩.update()
            import time
            time.sleep(0.15)
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
        self._起点 = None
        self._当前选区 = None
        self._全屏遮罩 = None
        self._外区矩形 = []
        self._选区框 = None
