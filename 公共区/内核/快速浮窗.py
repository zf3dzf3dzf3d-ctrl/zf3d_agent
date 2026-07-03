"""
快速浮窗 — 轮盘式快捷助手（tkinter Canvas实现，零依赖）

Ctrl+~ 呼出 → 以鼠标为中心展开轮盘 → 选择动作 → 流式回答 + TTS
不走对话模块，直接调用模型直连器.发送消息流式()，极低延迟。
带轻量记忆：用户画像dict引用 + 本地环形缓冲（最近5轮）。

视觉：黑色系半透明，扇区无图标纯文字，hover时背景跟随变色，
      展开缩放动画+淡入淡出，带边框。
"""
import tkinter as tk
import math
import threading
import time
import io
import base64
import sys
import ctypes
import json

# DPI感知：确保tkinter坐标和系统鼠标坐标一致（否则高DPI下中心偏移）
if sys.platform == 'win32':
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def _截图base64():
    from PIL import ImageGrab
    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# 颜色工具
def _hex到rgb(颜色):
    return int(颜色[1:3], 16), int(颜色[3:5], 16), int(颜色[5:7], 16)

def _rgb到hex(r, g, b):
    return f"#{min(255,max(0,r)):02x}{min(255,max(0,g)):02x}{min(255,max(0,b)):02x}"

def _混色(c1, c2, t):
    """线性混合两个颜色，t=0→c1, t=1→c2"""
    r1,g1,b1 = _hex到rgb(c1)
    r2,g2,b2 = _hex到rgb(c2)
    return _rgb到hex(int(r1+(r2-r1)*t), int(g1+(g2-g1)*t), int(b1+(b2-b1)*t))


class 快速浮窗:

    def __init__(self, 配置, 模型直连器, 获取画像回调, TTS回调, 获取对话历史回调=None, 追加到对话回调=None):
        self.配置 = 配置
        self.模型直连器 = 模型直连器
        self.获取用户画像 = 获取画像回调
        self.TTS回调 = TTS回调
        self.获取对话历史 = 获取对话历史回调 or (lambda: [])
        self.追加到对话 = 追加到对话回调 or (lambda u, a: None)
        self.半径 = 配置.get("轮盘半径", 72)
        self.中心圆半径 = 配置.get("中心圆半径", 26)
        self.透明度 = 配置.get("透明度", 0.88)
        self.动画毫秒 = 配置.get("展开动画毫秒", 150)
        self.字体大小 = max(4, 配置.get("字体大小", 12))
        # 配色（从配置读取，有默认值）
        self.扇区默认色 = 配置.get("扇区默认色", "#1c1c28")
        self.扇区hover色 = 配置.get("扇区hover色", "#3a3a52")
        self.边框色 = 配置.get("边框色", "#444466")
        self.中心圆色 = 配置.get("中心圆色", "#15151c")
        self.中心圆hover色 = 配置.get("中心圆hover色", "#2a2a3a")
        self.文字色 = 配置.get("文字色", "#aaaacc")
        self.文字hover色 = 配置.get("文字hover色", "#ffffff")
        self.朗读激活色 = "#1a3a22"  # 朗读中扇区微微变绿亮
        self.朗读hover色 = "#2a5a3a"   # 朗读中hover绿色更亮

        self.对话缓冲 = []
        self.缓冲上限 = 配置.get("记忆", {}).get("快速对话缓冲轮数", 5)

        self._根窗口 = None
        self._线程 = None
        self._运行 = False
        self._弹窗 = None
        self._画布 = None
        self._当前hover = -1
        self._扇区列表 = []
        self._中心 = (0, 0)
        self._当前窗口标题 = ""
        self._回答文本 = None
        self._选中文本 = ""
        self._正在朗读 = False
        self._点击锁 = False

    def 启动(self):
        self._运行 = True
        self._线程 = threading.Thread(target=self._tk主循环, daemon=True)
        self._线程.start()

    def _tk主循环(self):
        try:
            self._根窗口 = tk.Tk()
            self._根窗口.withdraw()
            # 启动持续TTS状态检测，与轮盘开关无关
            self._启动朗读检测()
            self._根窗口.mainloop()
        except Exception as e:
            print(f"快速浮窗Tk异常: {e}")

    def 弹出(self, 鼠标坐标, 窗口标题, 选中文本=""):
        if not self._根窗口:
            return
        self._中心 = 鼠标坐标
        self._当前窗口标题 = 窗口标题
        self._选中文本 = 选中文本
        # 全部在Tk主线程中执行，确保顺序正确
        def 安全创建():
            if self._弹窗:
                self._强制关闭弹窗()
            self._创建弹窗()
        self._根窗口.after(0, 安全创建)

    def _同步朗读状态(self):
        """异步从服务器查询TTS状态，不阻塞Tk线程"""
        def 查询():
            try:
                import urllib.request
                端口 = self.配置.get("网页端口", 8765)
                req = urllib.request.Request(f"http://localhost:{端口}/api/tts-status")
                resp = urllib.request.urlopen(req, timeout=2)
                data = json.loads(resp.read().decode("utf-8"))
                状态 = data.get("正在播放", False)
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._更新朗读显示(状态))
            except Exception:
                pass
        threading.Thread(target=查询, daemon=True).start()

    def _更新朗读显示(self, 状态):
        """更新朗读状态，仅轮盘模式生效"""
        if getattr(self, '_弹窗模式', '') != '轮盘':
            return
        旧状态 = self._正在朗读
        self._正在朗读 = 状态
        if 旧状态 != 状态 and self._弹窗 and self._画布:
            旧hover = self._当前hover
            self._画布.delete("all")
            self._绘制轮盘()
            if 旧hover >= 0:
                self._高亮扇区(旧hover)
                self._当前hover = 旧hover

    def _创建弹窗(self):
        if self._弹窗:
            return
        self._弹窗模式 = '轮盘'
        边距 = 24
        窗口大小 = (self.半径 + 边距) * 2
        x = self._中心[0] - 窗口大小 // 2
        y = self._中心[1] - 窗口大小 // 2

        self._弹窗 = tk.Toplevel(self._根窗口)
        self._弹窗.overrideredirect(True)
        self._弹窗.geometry(f"{窗口大小}x{窗口大小}+{x}+{y}")
        self._弹窗.attributes("-alpha", 0.0)
        self._弹窗.attributes("-topmost", True)
        self._弹窗.configure(bg="#abcdef")
        self._弹窗.attributes("-transparentcolor", "#abcdef")
        self._当前hover = -1

        # 异步同步朗读状态，不阻塞弹窗创建
        self._同步朗读状态()

        self._画布 = tk.Canvas(
            self._弹窗, width=窗口大小, height=窗口大小,
            bg="#abcdef", highlightthickness=0
        )
        self._画布.pack(fill="both", expand=True)
        self._绘制轮盘()
        self._画布.bind("<Motion>", self._鼠标移动)
        self._画布.bind("<Button-1>", self._点击)
        self._画布.bind("<Button-3>", lambda e: self._关闭())
        self._画布.bind("<MouseWheel>", self._滚轮事件)
        self._画布.bind("<Leave>", self._延迟关闭)
        self._弹窗.bind("<Escape>", lambda e: self._关闭())
        self._展开动画()
        self._弹窗.focus_force()

    def _绘制轮盘(self):
        self._扇区列表 = []
        扇区配置 = self.配置.get("扇区", [])
        n = len(扇区配置)
        if n == 0:
            return
        边距 = 24
        cx = self.半径 + 边距
        cy = self.半径 + 边距
        self._中心x = cx
        self._中心y = cy
        扇区角度 = 360 / n

        for i, 扇区 in enumerate(扇区配置):
            角度起始 = -90 + 扇区角度 * i
            原名 = 扇区.get("名称", "")
            是朗读扇区 = 原名 == "朗读"
            if 是朗读扇区 and self._正在朗读:
                名称 = "停读"
            else:
                名称 = 原名[:2]
            是空扇区 = 原名[:2] == "空"
            if 是空扇区:
                填充色 = "#abcdef"
            elif 是朗读扇区 and self._正在朗读:
                填充色 = self.朗读激活色
            else:
                填充色 = self.扇区默认色
            arc_id = self._画布.create_arc(
                cx - self.半径, cy - self.半径,
                cx + self.半径, cy + self.半径,
                start=-角度起始, extent=-扇区角度,
                fill=填充色, outline="", width=0
            )
            if not 是空扇区:
                线角 = math.radians(角度起始)
                self._画布.create_line(
                    cx, cy,
                    cx + self.半径 * math.cos(线角),
                    cy + self.半径 * math.sin(线角),
                    fill="#0a0a0e", width=2
                )
            中角 = math.radians(角度起始 + 扇区角度 / 2)
            文字r = self.半径 * 0.62
            ix = cx + 文字r * math.cos(中角)
            iy = cy + 文字r * math.sin(中角)
            文字id = self._画布.create_text(
                ix, iy, text="" if 是空扇区 else 名称,
                fill=self.文字色,
                font=("Microsoft YaHei UI", 8, "bold"),
                justify="center"
            )
            self._扇区列表.append({
                "arc_id": arc_id, "文字id": 文字id,
                "配置": 扇区,
                "角度起始": 角度起始, "角度结束": 角度起始 + 扇区角度
            })

        self._画布.create_oval(
            cx - self.半径, cy - self.半径,
            cx + self.半径, cy + self.半径,
            fill="", outline=self.边框色, width=2
        )
        self._中心圆 = self._画布.create_oval(
            cx - self.中心圆半径, cy - self.中心圆半径,
            cx + self.中心圆半径, cy + self.中心圆半径,
            fill=self.中心圆色, outline=self.边框色, width=1
        )

    def _鼠标移动(self, 事件):
        dx = 事件.x - self._中心x
        dy = 事件.y - self._中心y
        距离 = math.sqrt(dx * dx + dy * dy)

        if 距离 < self.中心圆半径:
            if self._当前hover != -1:
                self._取消高亮(self._当前hover)
                self._当前hover = -1
            self._画布.itemconfig(self._中心圆, fill=self.中心圆hover色)
            return
        self._画布.itemconfig(self._中心圆, fill=self.中心圆色)

        if 距离 < self.半径:
            角度 = math.degrees(math.atan2(dy, dx))
            for i, 扇区 in enumerate(self._扇区列表):
                if 扇区["配置"].get("名称", "")[:2] == "空":
                    continue
                if self._角度在范围内(角度, 扇区["角度起始"], 扇区["角度结束"]):
                    if self._当前hover != i:
                        if self._当前hover >= 0:
                            self._取消高亮(self._当前hover)
                        self._高亮扇区(i)
                        self._当前hover = i
                    return

        if self._当前hover >= 0:
            self._取消高亮(self._当前hover)
            self._当前hover = -1

        # 鼠标移出轮盘范围，自动关闭
        if 距离 > self.半径 + 20:
            self._关闭()

    def _角度在范围内(self, 角度, 起始, 结束):
        while 角度 < 0:
            角度 += 360
        起 = 起始 % 360
        止 = 结束 % 360
        if 起 < 止:
            return 起 <= 角度 < 止
        else:
            return 角度 >= 起 or 角度 < 止

    def _高亮扇区(self, i):
        扇区 = self._扇区列表[i]
        原名 = 扇区["配置"].get("名称", "")
        if 原名 == "朗读" and self._正在朗读:
            self._画布.itemconfig(扇区["arc_id"], fill=self.朗读hover色)
        else:
            self._画布.itemconfig(扇区["arc_id"], fill=self.扇区hover色)
        self._画布.itemconfig(扇区["文字id"], fill=self.文字hover色,
                              font=("Microsoft YaHei UI", 9, "bold"))

    def _取消高亮(self, i):
        扇区 = self._扇区列表[i]
        原名 = 扇区["配置"].get("名称", "")
        if 原名 == "朗读" and self._正在朗读:
            self._画布.itemconfig(扇区["arc_id"], fill=self.朗读激活色)
        else:
            self._画布.itemconfig(扇区["arc_id"], fill=self.扇区默认色)
        self._画布.itemconfig(扇区["文字id"], fill=self.文字色,
                              font=("Microsoft YaHei UI", 8, "bold"))

    def _点击(self, 事件):
        if self._当前hover == -1:
            self._关闭()
            return
        动作 = self._扇区列表[self._当前hover]["配置"]["名称"]
        self._执行动作(动作)

    def _延迟关闭(self, 事件=None):
        """鼠标离开时延迟100ms关闭，再检查鼠标是否真的在窗口外"""
        def 检查():
            if not self._弹窗:
                return
            try:
                x = self._弹窗.winfo_pointerx() - self._弹窗.winfo_rootx()
                y = self._弹窗.winfo_pointery() - self._弹窗.winfo_rooty()
                w = self._弹窗.winfo_width()
                h = self._弹窗.winfo_height()
                if x < 0 or y < 0 or x > w or y > h:
                    self._关闭()
            except Exception:
                pass
        if self._弹窗:
            self._弹窗.after(100, 检查)

    def _滚轮事件(self, 事件):
        if not self._扇区列表:
            return
        当前 = self._当前hover if self._当前hover >= 0 else 0
        if -事件.delta > 0:
            下一个 = (当前 - 1) % len(self._扇区列表)
        else:
            下一个 = (当前 + 1) % len(self._扇区列表)
        if 下一个 != self._当前hover:
            if self._当前hover >= 0:
                self._取消高亮(self._当前hover)
            self._高亮扇区(下一个)
            self._当前hover = 下一个

    # ============ 动作执行 ============

    def _执行动作(self, 动作):
        选中文本 = self._选中文本

        if 动作 == "空":
            return

        elif 动作 == "翻译":
            if not 选中文本:
                self._关闭()
                self._显示气泡("没有选中文本")
                return
            self._关闭()
            self._根窗口.after(100, lambda: self._显示翻译弹窗(选中文本))

        elif 动作 == "截图":
            self._关闭()
            self._根窗口.after(300, lambda: self._启动截图选区2())

        elif 动作 == "问答":
            self._过渡到输入区()

        elif 动作 in ("朗读", "停读"):
            if self._正在朗读:
                self._关闭()
                self._停止朗读()
            elif 动作 == "朗读":
                if 选中文本:
                    self._正在朗读 = True
                    self._关闭()
                    self.TTS回调(选中文本)
                else:
                    self._关闭()
                    self._显示气泡("没有选中文本")

        else:
            消息 = [{"role": "user", "content": 选中文本 or 动作}]
            提示词 = self.配置.get("系统提示词", "你是快速助手，简洁回答。")
            self._过渡到回答区()
            self._启动LLM(消息, 提示词)

    # ============ 截图选区 ============

    def _启动识图(self):
        """关闭轮盘后截图识图"""
        try:
            图片b64 = _截图base64()
        except ImportError:
            self._新建回答弹窗("需要安装Pillow")
            return
        except Exception as e:
            self._新建回答弹窗(f"截图失败: {e}")
            return
        消息 = [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{图片b64}"}},
            {"type": "text", "text": "简洁描述图片内容"}
        ]}]
        提示词 = "你是图片分析助手，简洁描述图片内容。"
        self._新建回答弹窗()
        self._启动LLM(消息, 提示词)

    def _启动截图选区(self, 取字=False):
        try:
            from 截图选区 import 截图选区
            self._截图选区器 = 截图选区(
                回调=lambda b64: self._截图完成(b64, 取字),
                根窗口=self._根窗口
            )
            self._截图选区器.弹出()
        except Exception as e:
            self._新建回答弹窗(f"截图选区启动失败: {e}")

    def _启动截图选区2(self):
        try:
            from 截图选区 import 截图选区
            self._截图选区器 = 截图选区(
                回调=lambda b64: self._截图完成2(b64),
                根窗口=self._根窗口
            )
            self._截图选区器.弹出()
        except Exception as e:
            self._新建回答弹窗(f"截图选区启动失败: {e}")

    def _截图完成2(self, 图片b64):
        if not 图片b64:
            return
        self._根窗口.after(100, lambda: self._显示截图弹窗(图片b64))

    def _显示截图弹窗(self, 图片b64):
        self._强制关闭弹窗()
        宽, 高 = 640, 560
        x = self._中心[0] - 宽 // 2
        y = self._中心[1] - 高 // 2
        if x < 10: x = 10
        if y < 10: y = 10
        self._弹窗 = tk.Toplevel(self._根窗口)
        self._弹窗.overrideredirect(True)
        self._弹窗.geometry(f"{宽}x{高}+{x}+{y}")
        self._弹窗.attributes("-alpha", 0.0)
        self._弹窗.attributes("-topmost", True)
        self._弹窗.configure(bg="#15151c")

        主frame = tk.Frame(self._弹窗, bg="#15151c")
        主frame.pack(fill="both", expand=True)

        标题栏 = tk.Frame(主frame, bg="#1c1c28", height=28)
        标题栏.pack(fill="x")
        标题文字 = tk.Label(标题栏, text="📷 截图工具", bg="#1c1c28", fg="#8888aa",
                         font=("Microsoft YaHei UI", 9, "bold"))
        标题文字.pack(side="left", padx=8)
        关闭按钮 = tk.Button(标题栏, text="✕", command=self._关闭,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=8)
        关闭按钮.pack(side="right")

        self._拖拽起始 = None
        self._拖拽窗口起始 = (x, y)
        def 开始拖拽(e):
            self._拖拽起始 = (e.x_root, e.y_root)
            self._拖拽窗口起始 = (self._弹窗.winfo_x(), self._弹窗.winfo_y())
        def 拖拽中(e):
            if self._拖拽起始:
                self._弹窗.geometry(f"+{self._拖拽窗口起始[0] + (e.x_root - self._拖拽起始[0])}+{self._拖拽窗口起始[1] + (e.y_root - self._拖拽起始[1])}")
        标题栏.bind("<Button-1>", 开始拖拽)
        标题文字.bind("<Button-1>", 开始拖拽)
        标题栏.bind("<B1-Motion>", 拖拽中)
        标题文字.bind("<B1-Motion>", 拖拽中)

        # 绘图工具栏
        工具栏 = tk.Frame(主frame, bg="#1a1a28", height=32)
        工具栏.pack(fill="x")
        self._截图绘图工具 = "无"
        self._截图绘图起点 = None
        self._截图绘图形状 = None
        self._截图绘图列表 = []
        self._绘图颜色 = "#ff4444"
        self._绘图粗细 = tk.IntVar(value=4)

        工具配置 = [("➖", "直线"), ("▭", "矩形"), ("○", "圆形"), ("➤", "箭头")]
        for 图标, 名称 in 工具配置:
            tk.Button(工具栏, text=图标, width=3,
                bg="#1a1a28", fg="#aaaacc", font=("Microsoft YaHei UI", 10),
                bd=0, highlightthickness=0, activebackground="#333355",
                activeforeground="white", cursor="hand2",
                command=lambda n=名称: self._切换截图工具(n)).pack(side="left", padx=2, pady=4)
        tk.Button(工具栏, text="🎨", width=3,
            bg="#1a1a28", fg="#aaaacc", font=("Microsoft YaHei UI", 10),
            bd=0, highlightthickness=0, activebackground="#333355",
            activeforeground="white", cursor="hand2",
            command=self._选择绘图颜色).pack(side="left", padx=2, pady=4)
        粗细frame = tk.Frame(工具栏, bg="#1a1a28")
        粗细frame.pack(side="left", padx=4)
        tk.Button(粗细frame, text="－", width=2,
            bg="#1a1a28", fg="#aaaacc", font=("Microsoft YaHei UI", 9),
            bd=0, highlightthickness=0, activebackground="#333355",
            activeforeground="white", cursor="hand2",
            command=lambda: self._绘图粗细.set(max(1, self._绘图粗细.get() - 1))).pack(side="left")
        self._粗细标签 = tk.Label(粗细frame, textvariable=self._绘图粗细, bg="#1a1a28", fg="#ffaa44",
            font=("Microsoft YaHei UI", 9, "bold"), width=2)
        self._粗细标签.pack(side="left", padx=2)
        tk.Button(粗细frame, text="＋", width=2,
            bg="#1a1a28", fg="#aaaacc", font=("Microsoft YaHei UI", 9),
            bd=0, highlightthickness=0, activebackground="#333355",
            activeforeground="white", cursor="hand2",
            command=lambda: self._绘图粗细.set(min(20, self._绘图粗细.get() + 1))).pack(side="left")
        tk.Button(工具栏, text="↩️", width=3,
            bg="#1a1a28", fg="#aaaacc", font=("Microsoft YaHei UI", 10),
            bd=0, highlightthickness=0, activebackground="#333355",
            activeforeground="white", cursor="hand2",
            command=self._撤销绘图).pack(side="left", padx=2, pady=4)

        # 主体：左图片 + 右结果
        主体 = tk.Frame(主frame, bg="#15151c")
        主体.pack(fill="both", expand=True)

        # 左侧图片画布
        左侧 = tk.Frame(主体, bg="#0d0d14")
        左侧.pack(side="left", fill="both", expand=True, padx=1, pady=1)
        self._截图画布 = tk.Canvas(左侧, bg="#0d0d14", highlightthickness=0, cursor="crosshair")
        self._截图画布.pack(fill="both", expand=True)

        try:
            import base64 as b64mod
            from PIL import Image, ImageTk
            from io import BytesIO
            图片数据 = b64mod.b64decode(图片b64)
            self._截图原始图 = Image.open(BytesIO(图片数据))
            # 初始缩放到适合窗口大小（NEAREST=马赛克效果）
            初始缩放图 = self._截图原始图.copy()
            初始缩放图.thumbnail((宽 // 2 + 96, 高 - 28 - 36 - 40), Image.NEAREST)
            self._截图预览图 = ImageTk.PhotoImage(初始缩放图)
            self._截图画布.config(width=初始缩放图.width, height=初始缩放图.height)
            self._截图图片id = self._截图画布.create_image(0, 0, anchor="nw", image=self._截图预览图)
            self._截图缩放 = 1.0
            self._截图基础宽 = 初始缩放图.width
            self._截图基础高 = 初始缩放图.height
            self._截图偏移x = 0
            self._截图偏移y = 0
            self._截图中键起点 = None
        except Exception as e:
            self._截图画布.create_text(200, 60, text=f"[图片预览失败: {e}]", fill="#666688",
                                        font=("Microsoft YaHei UI", 9))
            self._截图预览图 = None
            self._截图pil图片 = None
            self._截图图片id = None

        self._截图画布.bind("<Button-1>", self._画布按下)
        self._截图画布.bind("<B1-Motion>", self._画布拖动)
        self._截图画布.bind("<ButtonRelease-1>", self._画布松开)
        self._截图画布.bind("<MouseWheel>", self._画布滚轮)
        self._截图画布.bind("<Button-2>", self._画布中键按下)
        self._截图画布.bind("<B2-Motion>", self._画布中键拖动)
        self._截图画布.bind("<ButtonRelease-2>", self._画布中键松开)

        # 右侧结果文本区（带滚动条）
        右侧 = tk.Frame(主体, bg="#0d0d14", width=宽 // 2 - 100)
        右侧.pack(side="right", fill="both", padx=1, pady=1)
        右侧.pack_propagate(False)
        tk.Label(右侧, text="结果", bg="#0d0d14", fg="#556677",
            font=("Microsoft YaHei UI", 8, "bold")).pack(anchor="w", padx=8, pady=(4, 0))
        结果frame = tk.Frame(右侧, bg="#0d0d14")
        结果frame.pack(fill="both", expand=True, padx=2, pady=2)
        self._截图结果文本 = tk.Text(结果frame, bg="#0d0d14", fg="#ccccdd",
            font=("Microsoft YaHei UI", 10), wrap="word",
            padx=8, pady=6, highlightthickness=0, borderwidth=0, spacing1=4, spacing3=4)
        self._截图结果文本.pack(side="left", fill="both", expand=True)
        滚动条 = tk.Scrollbar(结果frame, command=self._截图结果文本.yview,
            bg="#1c1c28", troughcolor="#0d0d14", activebackground="#333355",
            highlightthickness=0, bd=0, width=8)
        滚动条.pack(side="right", fill="y")
        self._截图结果文本.config(yscrollcommand=滚动条.set)
        self._截图结果文本.tag_config("标题", foreground="#4488cc", font=("Microsoft YaHei UI", 9, "bold"))
        self._截图结果文本.tag_config("段落", foreground="#ccccdd", font=("Microsoft YaHei UI", 10), spacing3=8)

        # 底部按钮栏
        按钮栏 = tk.Frame(主frame, bg="#1a1a28", height=36)
        按钮栏.pack(fill="x", side="bottom")

        def 识别文字():
            self._截图结果文本.delete("1.0", "end")
            self._截图结果文本.insert("end", "识别中...", "标题")
            最终b64 = self._获取编辑后图片b64(图片b64)
            self._截图识别模式 = "识别"
            def 回调(文本):
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._显示截图结果(文本))
            threading.Thread(target=self._本地OCR, args=(最终b64, 回调), daemon=True).start()

        def 翻译文字():
            self._截图结果文本.delete("1.0", "end")
            self._截图结果文本.insert("end", "识别中...", "标题")
            self._截图识别模式 = "翻译"
            最终b64 = self._获取编辑后图片b64(图片b64)
            # 先本地OCR识别，再让LLM翻译
            def ocr回调(识别文本):
                if not 识别文本 or "未检测" in 识别文本 or "失败" in 识别文本:
                    if self._根窗口:
                        self._根窗口.after(0, lambda: self._显示截图结果(识别文本 or "未检测到文字"))
                    return
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._截图结果文本.delete("1.0", "end"))
                    self._根窗口.after(0, lambda: self._截图结果文本.insert("end", "翻译中...", "标题"))
                # 用LLM翻译识别出的文字
                消息 = [{"role": "user", "content": f"将以下文字翻译：如果是中文则翻译为英文，如果是英文则翻译为中文。按原文段落分行输出译文，每段之间空一行，不加编号不加解释：\n{识别文本}"}]
                提示词 = "你是翻译助手，按段落翻译文字。"
                def 流式回调(片段):
                    if self._根窗口:
                        self._根窗口.after(0, lambda: self._追加截图结果(片段))
                threading.Thread(target=self._翻译LLM调用, args=(消息, 提示词, 流式回调), daemon=True).start()
            threading.Thread(target=self._本地OCR, args=(最终b64, ocr回调), daemon=True).start()

        def 保存图片():
            try:
                from tkinter import filedialog
                路径 = filedialog.asksaveasfilename(
                    defaultextension=".png", filetypes=[("PNG", "*.png")], title="保存截图")
                if 路径:
                    最终b64 = self._获取编辑后图片b64(图片b64)
                    import base64 as b64mod
                    with open(路径, "wb") as f:
                        f.write(b64mod.b64decode(最终b64))
                    self._显示气泡("图片已保存")
            except Exception as e:
                self._显示气泡(f"保存失败: {e}")

        def 复制到剪贴板():
            try:
                最终b64 = self._获取编辑后图片b64(图片b64)
                self._复制图片到剪贴板(最终b64)
                self._显示气泡("已复制到剪贴板")
            except Exception as e:
                self._显示气泡(f"复制失败: {e}")

        for 文字, bg, fg, cmd in [
            ("📝 识别", "#2a3a2a", "#aacc88", 识别文字),
            ("🔤 翻译", "#2a2a4a", "#88aacc", 翻译文字),
            ("💾 保存", "#3a2a1a", "#ccaa66", 保存图片),
            ("📋 复制", "#1a2a3a", "#66aacc", 复制到剪贴板),
        ]:
            tk.Button(按钮栏, text=文字, command=cmd,
                bg=bg, fg=fg, font=("Microsoft YaHei UI", 8, "bold"),
                bd=0, highlightthickness=0, activebackground="#333355",
                activeforeground="white", cursor="hand2", padx=8, pady=6).pack(side="left", padx=4, pady=4)

        # 截图完成自动复制到剪贴板
        self._根窗口.after(300, lambda: self._复制图片到剪贴板(图片b64))

        self._弹窗.bind("<Escape>", lambda e: self._关闭())
        self._弹窗.focus_force()

        当前 = [0.0]
        def 步进():
            当前[0] += 0.12
            if 当前[0] >= self.透明度:
                try: self._弹窗.attributes("-alpha", self.透明度)
                except: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except: pass
        步进()

    def _切换截图工具(self, 工具):
        self._截图绘图工具 = "无" if self._截图绘图工具 == 工具 else 工具

    def _选择绘图颜色(self):
        from tkinter import colorchooser
        结果 = colorchooser.askcolor(title="选择绘图颜色")
        if 结果 and 结果[1]:
            self._绘图颜色 = 结果[1]

    def _撤销绘图(self):
        if self._截图绘图列表:
            self._截图画布.delete(self._截图绘图列表.pop())

    def _画布按下(self, 事件):
        if self._截图绘图工具 == "无":
            return
        self._截图绘图起点 = (事件.x, 事件.y)
        w = self._绘图粗细.get()
        if self._截图绘图工具 == "箭头":
            self._截图绘图形状 = self._截图画布.create_line(事件.x, 事件.y, 事件.x, 事件.y, fill=self._绘图颜色, width=w, arrow="last")
        elif self._截图绘图工具 == "直线":
            self._截图绘图形状 = self._截图画布.create_line(事件.x, 事件.y, 事件.x, 事件.y, fill=self._绘图颜色, width=w)
        elif self._截图绘图工具 == "矩形":
            self._截图绘图形状 = self._截图画布.create_rectangle(事件.x, 事件.y, 事件.x, 事件.y, outline=self._绘图颜色, width=w)
        elif self._截图绘图工具 == "圆形":
            self._截图绘图形状 = self._截图画布.create_oval(事件.x, 事件.y, 事件.x, 事件.y, outline=self._绘图颜色, width=w)

    def _画布拖动(self, 事件):
        if not self._截图绘图起点 or not self._截图绘图形状:
            return
        x1, y1 = self._截图绘图起点
        self._截图画布.coords(self._截图绘图形状, x1, y1, 事件.x, 事件.y)

    def _画布松开(self, 事件):
        if self._截图绘图形状:
            self._截图绘图列表.append(self._截图绘图形状)
            self._截图绘图形状 = None
        self._截图绘图起点 = None

    def _画布滚轮(self, 事件):
        """滚轮缩放，跟随鼠标中心"""
        if not self._截图原始图:
            return
        旧缩放 = self._截图缩放
        if 事件.delta > 0:
            self._截图缩放 = min(10.0, self._截图缩放 * 1.15)
        else:
            self._截图缩放 = max(0.1, self._截图缩放 / 1.15)
        if abs(self._截图缩放 - 旧缩放) < 0.001:
            return
        # 以鼠标为中心缩放
        鼠标x = self._截图画布.canvasx(事件.x)
        鼠标y = self._截图画布.canvasy(事件.y)
        ratio = self._截图缩放 / 旧缩放
        self._截图偏移x = 鼠标x - (鼠标x - self._截图偏移x) * ratio
        self._截图偏移y = 鼠标y - (鼠标y - self._截图偏移y) * ratio
        self._刷新截图缩放()

    def _刷新截图缩放(self):
        if not self._截图原始图:
            return
        from PIL import Image, ImageTk
        w = max(1, int(self._截图基础宽 * self._截图缩放))
        h = max(1, int(self._截图基础高 * self._截图缩放))
        缩放图 = self._截图原始图.resize((w, h), Image.NEAREST)
        self._截图预览图 = ImageTk.PhotoImage(缩放图)
        self._截图画布.itemconfig(self._截图图片id, image=self._截图预览图)
        self._截图画布.coords(self._截图图片id, self._截图偏移x, self._截图偏移y)

    def _画布中键按下(self, 事件):
        self._截图中键起点 = (事件.x, 事件.y)

    def _画布中键拖动(self, 事件):
        if not self._截图中键起点:
            return
        dx = 事件.x - self._截图中键起点[0]
        dy = 事件.y - self._截图中键起点[1]
        self._截图偏移x += dx
        self._截图偏移y += dy
        self._截图中键起点 = (事件.x, 事件.y)
        self._截图画布.coords(self._截图图片id, self._截图偏移x, self._截图偏移y)

    def _画布中键松开(self, 事件):
        self._截图中键起点 = None

    def _获取编辑后图片b64(self, 原始b64):
        if not self._截图绘图列表 or not self._截图原始图:
            return 原始b64
        try:
            from PIL import Image, ImageDraw
            import base64 as b64mod
            from io import BytesIO
            图片数据 = b64mod.b64decode(原始b64)
            图片 = Image.open(BytesIO(图片数据))
            # 画布显示的图片宽度 vs 原始图片宽度 = 缩放比
            显示宽 = self._截图基础宽 * self._截图缩放
            缩放比 = 图片.width / max(1, 显示宽)
            draw = ImageDraw.Draw(图片)
            for 形状id in self._截图绘图列表:
                coords = self._截图画布.coords(形状id)
                if len(coords) < 4:
                    continue
                # 画布坐标减去偏移 = 图片内坐标，再乘缩放比 = 原始图片坐标
                x1 = (coords[0] - self._截图偏移x) * 缩放比
                y1 = (coords[1] - self._截图偏移y) * 缩放比
                x2 = (coords[2] - self._截图偏移x) * 缩放比
                y2 = (coords[3] - self._截图偏移y) * 缩放比
                tp = self._截图画布.type(形状id)
                if tp == "rectangle":
                    颜色 = self._截图画布.itemcget(形状id, "outline")
                    w = max(1, int(float(self._截图画布.itemcget(形状id, "width") or 4) * 缩放比))
                    draw.rectangle([x1, y1, x2, y2], outline=颜色, width=w)
                elif tp == "oval":
                    颜色 = self._截图画布.itemcget(形状id, "outline")
                    w = max(1, int(float(self._截图画布.itemcget(形状id, "width") or 4) * 缩放比))
                    draw.ellipse([x1, y1, x2, y2], outline=颜色, width=w)
                elif tp == "line":
                    颜色 = self._截图画布.itemcget(形状id, "fill")
                    w = max(1, int(float(self._截图画布.itemcget(形状id, "width") or 4) * 缩放比))
                    draw.line([x1, y1, x2, y2], fill=颜色, width=w)
                    if self._截图画布.itemcget(形状id, "arrow"):
                        self._画箭头(draw, x1, y1, x2, y2, 颜色, w)
            buf = BytesIO()
            图片.save(buf, format="PNG")
            return b64mod.b64encode(buf.getvalue()).decode()
        except Exception as e:
            print(f"渲染绘图到图片失败: {e}")
            return 原始b64

    def _画箭头(self, draw, x1, y1, x2, y2, 颜色, w=4):
        import math
        角度 = math.atan2(y2 - y1, x2 - x1)
        长 = 20 + w * 2
        for 偏移 in [math.radians(150), math.radians(-150)]:
            draw.line([x2, y2, x2 + 长 * math.cos(角度 + 偏移), y2 + 长 * math.sin(角度 + 偏移)], fill=颜色, width=w)
        # 填充三角形箭头头部
        p1 = (x2 + 长 * math.cos(角度 + math.radians(150)), y2 + 长 * math.sin(角度 + math.radians(150)))
        p2 = (x2 + 长 * math.cos(角度 - math.radians(150)), y2 + 长 * math.sin(角度 - math.radians(150)))
        draw.polygon([p1, (x2, y2), p2], fill=颜色)

    def _复制图片到剪贴板(self, 图片b64):
        try:
            import base64 as b64mod
            import io
            from PIL import Image
            pil_img = Image.open(io.BytesIO(b64mod.b64decode(图片b64)))
            pil_img.load()
            output = io.BytesIO()
            pil_img.save(output, "BMP")
            data = output.getvalue()[14:]
            output.close()
            ctypes.windll.user32.OpenClipboard(0)
            ctypes.windll.user32.EmptyClipboard()
            ctypes.windll.user32.SetClipboardData(8, data)
            ctypes.windll.user32.CloseClipboard()
        except Exception as e:
            print(f"复制图片到剪贴板失败: {e}")

    def _本地OCR(self, 图片b64, 回调):
        """本地OCR识别，优先Tesseract，回退Windows OCR(winsdk)"""
        try:
            import base64 as b64mod
            import io
            from PIL import Image
            pil_img = Image.open(io.BytesIO(b64mod.b64decode(图片b64)))
            if pil_img.width < 1000:
                倍数 = 1000 / pil_img.width
                pil_img = pil_img.resize((1000, int(pil_img.height * 倍数)), Image.LANCZOS)
            # 优先Tesseract
            try:
                import pytesseract
                import shutil as _shutil
                import os as _os
                for 路径 in [
                    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                    _shutil.which("tesseract"),
                ]:
                    if 路径 and _os.path.exists(路径):
                        pytesseract.pytesseract.tesseract_cmd = 路径
                        break
                文本 = pytesseract.image_to_string(pil_img, lang="chi_sim+eng")
                回调(文本.strip() or "未检测到文字")
                return
            except Exception as e:
                print(f"Tesseract失败: {e}")
            # 回退：Windows OCR (winsdk)
            文本 = self._windows_ocr_winsdk(pil_img)
            回调(文本 or "未检测到文字")
        except Exception as e:
            回调(f"识别失败: {e}")

    def _windows_ocr_winsdk(self, pil_img):
        """使用winsdk调用Windows自带OCR API"""
        try:
            import asyncio
            import tempfile
            import os
            from winsdk.windows.media.ocr import OcrEngine
            from winsdk.windows.globalization import Language
            from winsdk.windows.graphics.imaging import BitmapDecoder
            from winsdk.windows.storage import StorageFile, FileAccessMode

            tmp = os.path.join(tempfile.gettempdir(), "_zf3d_ocr_tmp.png")
            pil_img.save(tmp, "PNG")

            async def _ocr():
                file = await StorageFile.get_file_from_path_async(tmp)
                stream = await file.open_async(FileAccessMode.READ)
                decoder = await BitmapDecoder.create_async(stream)
                bitmap = await decoder.get_software_bitmap_async()
                engine = OcrEngine.try_create_from_language(Language("zh-CN"))
                if not engine:
                    engine = OcrEngine.try_create_from_user_profile_languages()
                if not engine:
                    return ""
                result = await engine.recognize_async(bitmap)
                return result.text

            文本 = asyncio.run(_ocr())
            os.remove(tmp)
            return 文本.strip()
        except Exception as e:
            print(f"Windows OCR失败: {e}")
            return ""

    def _翻译LLM调用(self, 消息, 提示词, 回调):
        """纯文本翻译LLM调用，不需要vision"""
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=回调)
        if not 结果.get("成功"):
            错误 = 结果.get('错误', '未知错误')
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加截图结果(f"\n❌ 翻译失败: {错误}"))

    def _显示截图结果(self, 文本):
        """显示OCR/识别结果到右侧文本区"""
        try:
            self._截图结果文本.delete("1.0", "end")
            标题 = "📝 识别结果\n\n" if getattr(self, '_截图识别模式', '') == "识别" else "🔤 翻译结果\n\n"
            self._截图结果文本.insert("end", 标题, "标题")
            self._截图结果文本.insert("end", 文本, "段落")
            self._截图结果文本.see("end")
        except Exception:
            pass

    def _截图LLM调用(self, 消息, 提示词, 回调):
        # 检查当前模型是否支持vision，不支持则找已配密钥的vision模型
        原模型 = self.模型直连器.当前模型名
        需要切换 = False
        模型列表 = self.模型直连器.模型配置列表
        当前配置 = next((m for m in 模型列表 if m.get("名称") == 原模型), {})
        if not 当前配置.get("支持vision", False):
            # 找一个支持vision且已配密钥的模型
            for m in 模型列表:
                if m.get("支持vision", False):
                    密钥列表 = self.模型直连器.密钥配置.get("密钥列表", {})
                    模型密钥 = 密钥列表.get(m.get("名称", ""), {})
                    有密钥 = any(v for v in 模型密钥.values() if v)
                    if 有密钥:
                        self.模型直连器.切换模型(m["名称"])
                        需要切换 = True
                        break
            if not 需要切换:
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._追加截图结果("❌ 当前模型不支持图片识别，请在设置中配置一个支持vision的模型（如通义千问/智谱/Kimi/豆包/OpenAI/Claude/Gemini）"))
                return
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=回调)
        if 需要切换:
            self.模型直连器.切换模型(原模型)
        if not 结果.get("成功"):
            错误 = 结果.get('错误', '未知错误')
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加截图结果(f"\n❌ 错误: {错误}"))

    def _追加截图结果(self, 片段):
        try:
            全文 = self._截图结果文本.get("1.0", "end")
            if "识别中..." in 全文 or "翻译中..." in 全文:
                self._截图结果文本.delete("1.0", "end")
                标题 = "📝 识别结果\n\n" if getattr(self, '_截图识别模式', '') == "识别" else "🔤 翻译结果\n\n"
                self._截图结果文本.insert("end", 标题, "标题")
            self._截图结果文本.insert("end", 片段, "段落")
            self._截图结果文本.see("end")
        except Exception as e:
            print(f"追加截图结果异常: {e}")
            pass

    def _显示翻译弹窗(self, 原文):
        """翻译专用弹窗：原文/译文/介绍/造句 + 拖拽 + 语音 + 滚动条"""
        self._强制关闭弹窗()
        宽, 高 = 420, 520
        x = self._中心[0] - 宽 // 2
        y = self._中心[1] - 高 // 2
        if x < 10: x = 10
        if y < 10: y = 10
        self._弹窗 = tk.Toplevel(self._根窗口)
        self._弹窗.overrideredirect(True)
        self._弹窗.geometry(f"{宽}x{高}+{x}+{y}")
        self._弹窗.attributes("-alpha", 0.0)
        self._弹窗.attributes("-topmost", True)
        self._弹窗.configure(bg="#15151c")
        self._画布 = tk.Canvas(self._弹窗, width=宽, height=高, bg="#15151c", highlightthickness=0)
        self._画布.pack(fill="both", expand=True)

        标题栏 = self._画布.create_rectangle(0, 0, 宽, 28, fill="#1c1c28", outline="")
        标题文字 = self._画布.create_text(12, 14, text="🔤 快速翻译", fill="#8888aa",
                                font=("Microsoft YaHei UI", 9, "bold"), anchor="w")
        语音按钮 = tk.Button(self._画布, text="🔊 朗读原文", command=lambda: self.TTS回调(原文),
            bg="#1c1c28", fg="#aaaacc", font=("Microsoft YaHei UI", 7),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=4)
        self._画布.create_window(宽 - 90, 14, window=语音按钮)
        关闭按钮 = tk.Button(self._画布, text="✕", command=self._关闭,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=8)
        self._画布.create_window(宽 - 16, 14, window=关闭按钮)

        self._拖拽起始 = None
        self._拖拽窗口起始 = (x, y)
        def 开始拖拽(e):
            self._拖拽起始 = (e.x_root, e.y_root)
            self._拖拽窗口起始 = (self._弹窗.winfo_x(), self._弹窗.winfo_y())
        def 拖拽中(e):
            if self._拖拽起始:
                self._弹窗.geometry(f"+{self._拖拽窗口起始[0] + (e.x_root - self._拖拽起始[0])}+{self._拖拽窗口起始[1] + (e.y_root - self._拖拽起始[1])}")
        self._画布.tag_bind(标题栏, "<Button-1>", 开始拖拽)
        self._画布.tag_bind(标题文字, "<Button-1>", 开始拖拽)
        self._画布.tag_bind(标题栏, "<B1-Motion>", 拖拽中)
        self._画布.tag_bind(标题文字, "<B1-Motion>", 拖拽中)

        # 内容区：单个可滚动Text + 自定义滚动条
        内容frame = tk.Frame(self._弹窗, bg="#15151c")
        self._画布.create_window(0, 30, anchor="nw", window=内容frame, width=宽, height=高 - 30)

        self._翻译结果文本 = tk.Text(内容frame, bg="#15151c", fg="#ccccdd",
            font=("Microsoft YaHei UI", 11), wrap="word",
            padx=14, pady=10, highlightthickness=0, borderwidth=0,
            spacing1=4, spacing3=4)
        self._翻译结果文本.pack(side="left", fill="both", expand=True)

        滚动条 = tk.Scrollbar(内容frame, command=self._翻译结果文本.yview,
            bg="#1c1c28", troughcolor="#0d0d14", activebackground="#333355",
            highlightthickness=0, bd=0, width=8)
        滚动条.pack(side="right", fill="y")
        self._翻译结果文本.config(yscrollcommand=滚动条.set)

        # 插入标签
        self._翻译结果文本.tag_config("标签原文", foreground="#556677", font=("Microsoft YaHei UI", 8, "bold"))
        self._翻译结果文本.tag_config("标签译文", foreground="#4488cc", font=("Microsoft YaHei UI", 8, "bold"))
        self._翻译结果文本.tag_config("标签介绍", foreground="#66aa66", font=("Microsoft YaHei UI", 8, "bold"))
        self._翻译结果文本.tag_config("标签造句", foreground="#cc9944", font=("Microsoft YaHei UI", 8, "bold"))
        self._翻译结果文本.tag_config("原文", foreground="#7788aa", font=("Microsoft YaHei UI", 9))
        self._翻译结果文本.tag_config("译文", foreground="#e0e0e8", font=("Microsoft YaHei UI", 13, "bold"))
        self._翻译结果文本.tag_config("介绍", foreground="#aabb99", font=("Microsoft YaHei UI", 9))
        self._翻译结果文本.tag_config("造句", foreground="#d4c4a0", font=("Microsoft YaHei UI", 9))

        self._翻译原文缓存 = 原文
        self._翻译流式缓冲 = ""

        self._弹窗.bind("<Escape>", lambda e: self._关闭())
        self._弹窗.focus_force()

        当前 = [0.0]
        def 步进():
            当前[0] += 0.12
            if 当前[0] >= self.透明度:
                try: self._弹窗.attributes("-alpha", self.透明度)
                except: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except: pass
        步进()

        提示词 = """你是翻译助手。请翻译以下内容：如果是英文则翻译为中文，如果是中文则翻译为英文。
返回以下格式（严格用标记分隔）：
【译文】翻译结果
【介绍】词性、语法、用法说明（1-2句话简述）
【造句】2-3个常用造句，每行一个，格式：原文句子 — 对应翻译"""
        消息 = [{"role": "user", "content": f"翻译以下内容：\n{原文}"}]

        def 流式回调(片段):
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加翻译文本2(片段))

        def 完成回调(完整回复):
            if self._根窗口:
                self._根窗口.after(0, lambda: self._解析翻译结果2(完整回复))

        消息 = self._注入记忆(消息)
        threading.Thread(target=self._翻译流式调用, args=(消息, 提示词, 流式回调, 完成回调), daemon=True).start()

    def _追加翻译文本2(self, 片段):
        """流式追加到结果文本区"""
        try:
            self._翻译流式缓冲 += 片段
            self._翻译结果文本.insert("end", 片段, "译文")
            self._翻译结果文本.see("end")
        except Exception:
            pass

    def _解析翻译结果2(self, 完整回复):
        """解析LLM返回的标记格式，用tag分段着色重新显示"""
        try:
            译文 = ""
            介绍 = ""
            造句 = ""
            当前段 = None
            for 行 in 完整回复.split("\n"):
                行 = 行.strip()
                if 行.startswith("【译文】"):
                    当前段 = "译文"
                    译文 = 行[4:].strip()
                elif 行.startswith("【介绍】"):
                    当前段 = "介绍"
                    介绍 = 行[4:].strip()
                elif 行.startswith("【造句】"):
                    当前段 = "造句"
                    造句 = 行[4:].strip()
                elif 当前段 == "译文":
                    译文 += "\n" + 行
                elif 当前段 == "介绍":
                    介绍 += "\n" + 行
                elif 当前段 == "造句":
                    造句 += "\n" + 行

            self._翻译结果文本.config(state="normal")
            self._翻译结果文本.delete("1.0", "end")
            self._翻译结果文本.insert("end", "📄 原文\n", "标签原文")
            self._翻译结果文本.insert("end", (self._翻译原文缓存 or "") + "\n\n", "原文")
            self._翻译结果文本.insert("end", "📝 译文\n", "标签译文")
            self._翻译结果文本.insert("end", (译文.strip() or 完整回复) + "\n\n", "译文")
            if 介绍.strip():
                self._翻译结果文本.insert("end", "📖 介绍\n", "标签介绍")
                self._翻译结果文本.insert("end", 介绍.strip() + "\n\n", "介绍")
            if 造句.strip():
                self._翻译结果文本.insert("end", "✏️ 常用造句\n", "标签造句")
                self._翻译结果文本.insert("end", 造句.strip() + "\n", "造句")
        except Exception:
            self._翻译结果文本.config(state="normal")
            self._翻译结果文本.delete("1.0", "end")
            self._翻译结果文本.insert("end", 完整回复, "译文")

    def _翻译流式调用(self, 消息, 提示词, 流式回调, 完成回调):
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=流式回调)
        完整回复 = 结果.get("回复内容", "") if 结果.get("成功") else f"错误: {结果.get('错误', '未知错误')}"
        完成回调(完整回复)

    def _显示气泡(self, 文本):
        """在鼠标旁显示一个临时气泡提示，2秒后自动消失"""
        气泡 = tk.Toplevel(self._根窗口)
        气泡.overrideredirect(True)
        气泡.attributes("-topmost", True)
        气泡.attributes("-alpha", 0.0)
        气泡.configure(bg="#3a1a1a")
        标签 = tk.Label(
            气泡, text=文本, fg="#ffaaaa", bg="#3a1a1a",
            font=("Microsoft YaHei UI", 10), padx=14, pady=8
        )
        标签.pack()
        气泡.update_idletasks()
        w = 气泡.winfo_reqwidth()
        h = 气泡.winfo_reqheight()
        x = self._中心[0] - w // 2
        y = self._中心[1] - h - 70
        if y < 10: y = self._中心[1] + 20
        气泡.geometry(f"{w}x{h}+{x}+{y}")
        # 淡入
        当前 = [0.0]
        def 渐显():
            当前[0] += 0.15
            if 当前[0] >= 0.9:
                气泡.attributes("-alpha", 0.9)
            else:
                try:
                    气泡.attributes("-alpha", 当前[0])
                    气泡.after(16, 渐显)
                except Exception:
                    pass
        渐显()
        # 2秒后淡出关闭
        def 关闭():
            渐减 = [0.9]
            def 渐隐():
                渐减[0] -= 0.1
                if 渐减[0] <= 0:
                    气泡.destroy()
                else:
                    try:
                        气泡.attributes("-alpha", 渐减[0])
                        气泡.after(16, 渐隐)
                    except Exception:
                        气泡.destroy()
            渐隐()
        气泡.after(2000, 关闭)

    # ============ LLM调用 ============

    def _启动LLM(self, 消息, 提示词, 是问答=False, 问答原文=None):
        消息 = self._注入记忆(消息)
        # 问答模式：注入主对话最近N轮历史
        if 是问答:
            主历史 = self.获取对话历史()
            if 主历史:
                # 取最近10轮（20条消息），转成LLM消息格式
                最近 = 主历史[-20:]
                历史消息 = []
                for msg in 最近:
                    角色 = msg.get("角色", "")
                    内容 = msg.get("内容", "")
                    if 角色 == "用户":
                        历史消息.append({"role": "user", "content": 内容})
                    elif 角色 == "助手":
                        历史消息.append({"role": "assistant", "content": 内容})
                # 历史在前，当前问题在后
                消息 = 历史消息 + 消息
        def 回调(片段):
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加文本(片段))
        threading.Thread(
            target=self._流式调用,
            args=(消息, 提示词, 回调, 是问答, 问答原文),
            daemon=True
        ).start()

    def _注入记忆(self, 消息):
        记忆配置 = self.配置.get("记忆", {})
        注入列表 = []
        if 记忆配置.get("注入用户画像", True):
            画像 = self.获取用户画像()
            if 画像:
                兴趣 = 画像.get("兴趣关键词", {})
                偏好 = 画像.get("学习到的偏好", {})
                摘要 = f"[用户画像] 兴趣: {list(兴趣.keys())[:5]} 偏好: {list(偏好.keys())[:5]}"
                注入列表.append({"role": "system", "content": 摘要})
        if self.对话缓冲:
            注入列表.extend(self.对话缓冲[-self.缓冲上限:])
        return 注入列表 + 消息

    def _流式调用(self, 消息, 提示词, 回调, 是问答=False, 问答原文=None):
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=回调
        )
        完整回复 = 结果.get("回复内容", "") if 结果.get("成功") else f"错误: {结果.get('错误', '未知错误')}"
        最后消息 = 消息[-1]
        原文 = 最后消息.get("content", "")
        if isinstance(原文, str):
            self.对话缓冲.append({"role": "user", "content": 原文})
        self.对话缓冲.append({"role": "assistant", "content": 完整回复})
        # 问答模式：回写到主对话历史
        if 是问答 and 问答原文 and 结果.get("成功"):
            self.追加到对话(问答原文, 完整回复)
        # 自动朗读（标题栏小喇叭开启时，独立于轮盘朗读状态）
        if getattr(self, '_自动朗读', False) and 完整回复:
            self.TTS回调(完整回复)
        if self._根窗口:
            self._根窗口.after(0, lambda: self._追加文本("\n"))

    def _停止朗读(self):
        import urllib.request
        try:
            端口 = self.配置.get("网页端口", 8765)
            req = urllib.request.Request(
                f"http://localhost:{端口}/api/tts-stop",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass
        self._正在朗读 = False

    def _启动朗读检测(self):
        """持续每秒检查TTS是否还在播放（仅轮盘模式更新显示）"""
        def 检查():
            try:
                import urllib.request
                端口 = self.配置.get("网页端口", 8765)
                req = urllib.request.Request(f"http://localhost:{端口}/api/tts-status")
                resp = urllib.request.urlopen(req, timeout=2)
                data = json.loads(resp.read().decode("utf-8"))
                状态 = data.get("正在播放", False)
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._更新朗读显示(状态))
            except Exception:
                pass  # 网络失败不改变当前状态
            if self._根窗口:
                self._根窗口.after(1000, 检查)
        if self._根窗口:
            self._根窗口.after(1000, 检查)

    # ============ UI: 弹窗复用为回答区 ============

    def _创建回答区内容(self, 宽, 高, 初始文本=""):
        """在当前弹窗的画布上绘制问答UI：上=回复区(滚动)，下=输入框+发送+语音"""
        self._弹窗模式 = '问答'
        self._画布.delete("all")
        self._画布.configure(bg="#15151c")

        # 布局：标题28 + 回复区(弹性) + 底栏80
        底栏高 = 64
        回复高 = 高 - 28 - 底栏高

        # 自动朗读开关（右上角小喇叭），默认开启，独立于轮盘朗读
        self._自动朗读 = True

        # 标题栏
        标题栏 = self._画布.create_rectangle(0, 0, 宽, 28, fill="#1c1c28", outline="", tags=("titlebar",))
        标题文字 = self._画布.create_text(12, 14, text="快速助手", fill="#666688",
                                font=("Microsoft YaHei UI", 8, "bold"), anchor="w", tags=("titlebar",))

        # 小喇叭按钮（标题栏右侧）
        def 切换朗读():
            self._自动朗读 = not self._自动朗读
            朗读按钮.config(
                text="🔊" if self._自动朗读 else "🔇",
                bg="#2a3a1a" if self._自动朗读 else "#1c1c28",
                fg="#aacc88" if self._自动朗读 else "#666688")

        朗读按钮 = tk.Button(
            self._画布,
            text="🔊" if self._自动朗读 else "🔇",
            command=切换朗读,
            bg="#2a3a1a" if self._自动朗读 else "#1c1c28",
            fg="#aacc88" if self._自动朗读 else "#666688",
            font=("Microsoft YaHei UI", 9),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=6
        )
        self._画布.create_window(宽 - 138, 14, window=朗读按钮)

        # 复制按钮
        def 复制():
            try:
                文本 = self._回答文本.get("1.0", "end")
                self._弹窗.clipboard_clear()
                self._弹窗.clipboard_append(文本)
            except Exception:
                pass
        复制按钮 = tk.Button(
            self._画布, text="复制", command=复制,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 7),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=6
        )
        self._画布.create_window(宽 - 90, 14, window=复制按钮)
        # 关闭按钮
        关闭按钮 = tk.Button(
            self._画布, text="✕", command=self._关闭,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=8
        )
        self._画布.create_window(宽 - 18, 14, window=关闭按钮)

        # 回复区frame：Text + Scrollbar
        回复frame = tk.Frame(self._弹窗, bg="#15151c")
        self._画窗_回复 = self._画布.create_window(
            0, 28, anchor="nw", window=回复frame, width=宽, height=回复高)
        self._回答文本 = tk.Text(
            回复frame, bg="#15151c", fg="#ccccdd",
            font=("Microsoft YaHei UI", 10), wrap="word",
            padx=12, pady=8, highlightthickness=0, borderwidth=0,
            spacing1=4, spacing3=4, insertbackground="#ccccdd", insertwidth=2,
            state="disabled"
        )
        self._回答文本.pack(side="left", fill="both", expand=True)
        滚动条 = tk.Scrollbar(回复frame, command=self._回答文本.yview,
            bg="#1c1c28", troughcolor="#0d0d14", activebackground="#333355",
            highlightthickness=0, bd=0, width=8)
        滚动条.pack(side="right", fill="y")
        self._回答文本.config(yscrollcommand=滚动条.set)

        # 多轮对话标签样式：用户亮蓝靠右有背景，机器人白色靠左有背景
        self._回答文本.tag_config("user", foreground="#aaccff",
            font=("Microsoft YaHei UI", 10), spacing1=8, spacing3=8,
            justify="right", lmargin1=50, lmargin2=50,
            background="#1a2a3a")
        self._回答文本.tag_config("bot", foreground="#e0e0e8",
            font=("Microsoft YaHei UI", 10), spacing1=8, spacing3=8,
            background="#1a1a28")

        if 初始文本:
            self._回答文本.config(state="normal")
            self._回答文本.insert("end", 初始文本)
            self._回答文本.config(state="disabled")

        # 滚轮：回复区上下滚动（不调窗口高度）
        self._回答文本.bind("<MouseWheel>", lambda e: self._回答文本.yview_scroll(int(-e.delta/120), "units"))

        # 底栏frame：输入框(左) + 录音/发送按钮(右并排)
        底栏 = tk.Frame(self._弹窗, bg="#0d0d14")
        self._画窗_底栏 = self._画布.create_window(
            0, 28 + 回复高, anchor="nw", window=底栏, width=宽, height=底栏高)
        底栏.pack_propagate(False)
        底栏.configure(width=宽, height=底栏高)

        输入框 = tk.Text(
            底栏, bg="#0d0d14", fg="#ccccdd",
            font=("Microsoft YaHei UI", 10), wrap="word",
            padx=10, pady=8, highlightthickness=1,
            highlightbackground="#333355", borderwidth=0,
            insertbackground="#ccccdd", insertwidth=2
        )
        输入框.place(x=4, y=4, relwidth=0.68, width=-8, relheight=1, height=-8)

        # 按钮区：发送按钮（全宽）
        按钮区 = tk.Frame(底栏, bg="#0d0d14")
        按钮区.place(relx=0.68, x=4, rely=0, relwidth=0.32, width=-8, relheight=1)

        def 提交():
            文本 = 输入框.get("1.0", "end").strip()
            if not 文本:
                return
            上下文 = f"[当前程序: {self._当前窗口标题}]"
            消息 = [{"role": "user", "content": f"{上下文}\n{文本}"}]
            提示词 = self.配置.get("系统提示词", "你是快速助手，简洁回答。")
            # 追加到回复区而非清空，支持多轮对话
            self._回答文本.config(state="normal")
            当前内容 = self._回答文本.get("1.0", "end").strip()
            if 当前内容:
                self._回答文本.insert("end", f"\n👤 {文本}\n", "user")
            else:
                self._回答文本.insert("end", f"👤 {文本}\n", "user")
            self._回答文本.insert("end", "🤖 ", "bot")
            self._回答文本.config(state="disabled")
            self._回答文本.see("end")
            输入框.delete("1.0", "end")
            self._启动LLM(消息, 提示词, 是问答=True, 问答原文=文本)

        发送按钮 = tk.Button(
            按钮区, text="发送", command=提交,
            bg="#2a4a6a", fg="#ddeeff", font=("Microsoft YaHei UI", 7, "bold"),
            bd=0, highlightthickness=0, activebackground="#3a5a8a",
            activeforeground="white", cursor="hand2"
        )
        发送按钮.pack(fill="both", expand=True, pady=6, padx=4)

        # Enter提交，Shift+Enter换行
        输入框.bind("<Return>", lambda e: (提交(), "break"))
        输入框.bind("<Shift-Return>", lambda e: None)
        输入框.focus_set()

        # 拖拽（标题栏区域）
        self._拖拽起始 = None
        self._拖拽窗口起始 = (self._弹窗.winfo_x(), self._弹窗.winfo_y())
        def 开始拖拽(e):
            self._拖拽起始 = (e.x_root, e.y_root)
            self._拖拽窗口起始 = (self._弹窗.winfo_x(), self._弹窗.winfo_y())
        def 拖拽中(e):
            if self._拖拽起始:
                self._弹窗.geometry(f"+{self._拖拽窗口起始[0] + (e.x_root - self._拖拽起始[0])}+{self._拖拽窗口起始[1] + (e.y_root - self._拖拽起始[1])}")
        for item in self._画布.find_withtag("titlebar"):
            self._画布.tag_bind(item, "<Button-1>", 开始拖拽)
            self._画布.tag_bind(item, "<B1-Motion>", 拖拽中)

        self._画布.unbind("<Motion>")
        self._画布.unbind("<Leave>")
        self._画布.bind("<Button-1>", lambda e: None)
        self._弹窗.unbind("<FocusOut>")
        self._弹窗.bind("<Escape>", lambda e: self._关闭())

    def _过渡到回答区(self, 初始文本=""):
        """轮盘弹窗直接过渡为问答区（回复区+输入框），不销毁"""
        if not self._弹窗:
            self._新建回答弹窗(初始文本)
            return
        宽, 高 = 460, 380
        x = self._中心[0] - 宽 // 2
        y = self._中心[1] - 高 // 2
        if x < 10: x = 10
        if y < 10: y = 10
        # 先隐藏再改尺寸，避免闪烁
        self._弹窗.attributes("-alpha", 0.0)
        self._弹窗.geometry(f"{宽}x{高}+{x}+{y}")
        self._弹窗.configure(bg="#15151c")
        self._弹窗.attributes("-transparentcolor", "")
        self._创建回答区内容(宽, 高, 初始文本)
        # 淡入
        当前 = [0.0]
        def 步进():
            当前[0] += 0.12
            if 当前[0] >= self.透明度:
                try: self._弹窗.attributes("-alpha", self.透明度)
                except: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except: pass
        步进()

    def _新建回答弹窗(self, 初始文本=""):
        """截图完成后创建全新的回答弹窗"""
        self._强制关闭弹窗()
        宽, 高 = 460, 380
        x = self._中心[0] - 宽 // 2
        y = self._中心[1] - 高 // 2
        if x < 10: x = 10
        if y < 10: y = 10
        self._弹窗 = tk.Toplevel(self._根窗口)
        self._弹窗.overrideredirect(True)
        self._弹窗.geometry(f"{宽}x{高}+{x}+{y}")
        self._弹窗.attributes("-alpha", 0.0)
        self._弹窗.attributes("-topmost", True)
        self._弹窗.configure(bg="#15151c")
        self._画布 = tk.Canvas(
            self._弹窗, width=宽, height=高,
            bg="#15151c", highlightthickness=0
        )
        self._画布.pack(fill="both", expand=True)
        self._创建回答区内容(宽, 高, 初始文本)
        self._弹窗.focus_force()
        # 淡入
        当前 = [0.0]
        def 步进():
            当前[0] += 0.12
            if 当前[0] >= self.透明度:
                try: self._弹窗.attributes("-alpha", self.透明度)
                except: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except: pass
        步进()

    # ============ UI: 问答输入区 ============

    def _过渡到输入区(self):
        """轮盘弹窗过渡为问答区（回复区在上+输入框在下）"""
        self._过渡到回答区()

    def _追加文本(self, 片段):
        try:
            self._回答文本.config(state="normal")
            self._回答文本.insert("end", 片段, "bot")
            self._回答文本.config(state="disabled")
            self._回答文本.see("end")
        except Exception:
            pass

    # ============ 动画 + 关闭 ============

    def _展开动画(self):
        总帧 = max(1, 200 // 16)  # 0.2秒
        帧 = [0]
        上次 = [0.3]
        # 先缩到最小
        self._画布.scale("all", self._中心x, self._中心y, 0.3, 0.3)
        def 步进():
            帧[0] += 1
            t = min(1.0, 帧[0] / 总帧)
            ease = 1 - (1 - t) ** 3
            目标 = 0.3 + 0.7 * ease
            delta = 目标 / 上次[0]
            上次[0] = 目标
            alpha = self.透明度 * ease
            try:
                self._弹窗.attributes("-alpha", alpha)
                self._画布.scale("all", self._中心x, self._中心y, delta, delta)
                if t < 1.0:
                    self._弹窗.after(16, 步进)
            except Exception:
                pass
        步进()

    def _关闭(self, 事件=None):
        if not self._弹窗:
            return
        总帧 = max(1, 200 // 16)  # 0.2秒
        帧 = [0]
        上次 = [1.0]
        def 步进():
            帧[0] += 1
            t = min(1.0, 帧[0] / 总帧)
            ease = t ** 3
            目标 = 1.0 - 0.7 * ease
            delta = 目标 / 上次[0]
            上次[0] = 目标
            alpha = self.透明度 * (1 - ease)
            try:
                self._弹窗.attributes("-alpha", alpha)
                self._画布.scale("all", self._中心x, self._中心y, delta, delta)
                if t < 1.0:
                    self._弹窗.after(16, 步进)
                else:
                    self._强制关闭弹窗()
            except Exception:
                self._强制关闭弹窗()
        步进()

    def _强制关闭弹窗(self):
        if self._弹窗:
            try:
                self._弹窗.destroy()
            except Exception:
                pass
            self._弹窗 = None
            self._画布 = None
            self._回答文本 = None
            self._当前hover = -1

    def 停止(self):
        self._运行 = False
        self._强制关闭弹窗()
        if self._根窗口:
            try:
                self._根窗口.quit()
                self._根窗口.destroy()
            except Exception:
                pass
            self._根窗口 = None
