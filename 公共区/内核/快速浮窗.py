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

    def __init__(self, 配置, 模型直连器, 获取画像回调, TTS回调):
        self.配置 = 配置
        self.模型直连器 = 模型直连器
        self.获取用户画像 = 获取画像回调
        self.TTS回调 = TTS回调
        self.半径 = 配置.get("轮盘半径", 72)
        self.中心圆半径 = 配置.get("中心圆半径", 26)
        self.透明度 = 配置.get("透明度", 0.88)
        self.动画毫秒 = 配置.get("展开动画毫秒", 150)
        self.字体大小 = max(4, 配置.get("字体大小", 12))
        # 黑色系配色
        self.扇区默认色 = "#1c1c28"
        self.扇区hover色 = "#3a3a52"
        self.边框色 = "#444466"
        self.中心圆色 = "#15151c"
        self.中心圆hover色 = "#2a2a3a"
        self.文字色 = "#aaaacc"
        self.文字hover色 = "#ffffff"

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

    def 启动(self):
        self._运行 = True
        self._线程 = threading.Thread(target=self._tk主循环, daemon=True)
        self._线程.start()

    def _tk主循环(self):
        try:
            self._根窗口 = tk.Tk()
            self._根窗口.withdraw()
            self._根窗口.mainloop()
        except Exception as e:
            print(f"快速浮窗Tk异常: {e}")

    def 弹出(self, 鼠标坐标, 窗口标题, 选中文本=""):
        if not self._根窗口:
            return
        if self._弹窗:
            self._根窗口.after(0, self._强制关闭弹窗)
        self._中心 = 鼠标坐标
        self._当前窗口标题 = 窗口标题
        self._选中文本 = 选中文本
        self._根窗口.after(0, self._创建弹窗)

    def _创建弹窗(self):
        if self._弹窗:
            return
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
        self._弹窗.bind("<Escape>", lambda e: self._关闭())
        self._弹窗.bind("<FocusOut>", lambda e: self._关闭())
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
            名称 = 扇区.get("名称", "")
            arc_id = self._画布.create_arc(
                cx - self.半径, cy - self.半径,
                cx + self.半径, cy + self.半径,
                start=角度起始, extent=扇区角度,
                fill=self.扇区默认色, outline="", width=0
            )
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
                ix, iy, text=名称,
                fill=self.文字色,
                font=("Microsoft YaHei UI", self.字体大小, "bold"),
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
        self._画布.itemconfig(扇区["arc_id"], fill=self.扇区hover色)
        self._画布.itemconfig(扇区["文字id"], fill=self.文字hover色,
                              font=("Microsoft YaHei UI", self.字体大小 + 1, "bold"))

    def _取消高亮(self, i):
        扇区 = self._扇区列表[i]
        self._画布.itemconfig(扇区["arc_id"], fill=self.扇区默认色)
        self._画布.itemconfig(扇区["文字id"], fill=self.文字色,
                              font=("Microsoft YaHei UI", self.字体大小, "bold"))

    def _点击(self, 事件):
        if self._当前hover == -1:
            self._关闭()
            return
        动作 = self._扇区列表[self._当前hover]["配置"]["名称"]
        self._执行动作(动作)

    def _滚轮事件(self, 事件):
        if not self._扇区列表:
            return
        当前 = self._当前hover if self._当前hover >= 0 else 0
        # 反转滚轮方向：之前是+改成-
        if -事件.delta > 0:
            下一个 = (当前 + 1) % len(self._扇区列表)
        else:
            下一个 = (当前 - 1) % len(self._扇区列表)
        if 下一个 != self._当前hover:
            if self._当前hover >= 0:
                self._取消高亮(self._当前hover)
            self._高亮扇区(下一个)
            self._当前hover = 下一个

    # ============ 动作执行 ============

    def _执行动作(self, 动作):
        选中文本 = self._选中文本

        if 动作 == "翻译":
            if not 选中文本:
                self._过渡到回答区("没有选中文本")
                return
            消息 = [{"role": "user", "content": f"翻译到中文，只输出译文：\n{选中文本}"}]
            提示词 = "你是翻译助手，只输出译文，不加解释。"
            self._过渡到回答区()
            self._启动LLM(消息, 提示词)

        elif 动作 == "截图翻译":
            self._关闭()
            self._根窗口.after(300, lambda: self._启动截图选区(取字=False))

        elif 动作 == "识图":
            self._关闭()
            self._根窗口.after(300, lambda: self._启动识图())

        elif 动作 == "截图取字":
            self._关闭()
            self._根窗口.after(300, lambda: self._启动截图选区(取字=True))

        elif 动作 == "问答":
            self._过渡到输入区()

        elif 动作 == "朗读":
            self._关闭()
            if self._正在朗读:
                self._停止朗读()
            elif 选中文本:
                self._正在朗读 = True
                self.TTS回调(选中文本)

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

    def _截图完成(self, 图片b64, 取字):
        if not 图片b64:
            self._新建回答弹窗("已取消截图")
            return
        if 取字:
            消息 = [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{图片b64}"}},
                {"type": "text", "text": "提取图片中的所有文字，只输出纯文字内容，不加解释"}
            ]}]
            提示词 = "你是一个OCR工具，只提取图片中的文字，保持原有格式。"
        else:
            消息 = [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{图片b64}"}},
                {"type": "text", "text": "翻译图片中的文字到中文，只输出译文。"}
            ]}]
            提示词 = "你是翻译助手，翻译图片中的文字到中文，只输出译文。"
        # 在Tk主线程中创建弹窗并启动LLM
        self._根窗口.after(100, lambda: self._新建回答弹窗())
        self._根窗口.after(300, lambda: self._启动LLM(消息, 提示词))

    # ============ LLM调用 ============

    def _启动LLM(self, 消息, 提示词):
        消息 = self._注入记忆(消息)
        def 回调(片段):
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加文本(片段))
        threading.Thread(target=self._流式调用, args=(消息, 提示词, 回调), daemon=True).start()

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

    def _流式调用(self, 消息, 提示词, 回调):
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=回调
        )
        完整回复 = 结果.get("回复内容", "") if 结果.get("成功") else f"错误: {结果.get('错误', '未知错误')}"
        最后消息 = 消息[-1]
        原文 = 最后消息.get("content", "")
        if isinstance(原文, str):
            self.对话缓冲.append({"role": "user", "content": 原文})
        self.对话缓冲.append({"role": "assistant", "content": 完整回复})
        if self.配置.get("自动朗读", False) and 完整回复:
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

    # ============ UI: 弹窗复用为回答区 ============

    def _过渡到回答区(self, 初始文本=""):
        """轮盘弹窗直接过渡为回答区，不销毁"""
        if not self._弹窗:
            self._新建回答弹窗(初始文本)
            return
        宽, 高 = 360, 180
        x = self._中心[0] - 宽 // 2
        y = self._中心[1] - 高 // 2
        if x < 10: x = 10
        if y < 10: y = 10
        self._弹窗.geometry(f"{宽}x{高}+{x}+{y}")
        self._弹窗.configure(bg="#15151c")
        self._弹窗.attributes("-transparentcolor", "")
        # 移除轮盘的事件绑定，防止 FocusOut 误关闭
        self._弹窗.unbind("<FocusOut>")
        self._画布.delete("all")
        self._画布.configure(bg="#15151c")
        self._画布.create_rectangle(0, 0, 宽, 24, fill="#1c1c28", outline="")
        self._画布.create_text(12, 12, text="快速助手", fill="#666688",
                                font=("Microsoft YaHei UI", 8, "bold"), anchor="w")
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
        self._画布.create_window(宽 - 60, 12, window=复制按钮)
        # 关闭按钮
        关闭按钮 = tk.Button(
            self._画布, text="✕", command=self._关闭,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=8
        )
        self._画布.create_window(宽 - 18, 12, window=关闭按钮)
        self._回答文本 = tk.Text(
            self._画布, bg="#15151c", fg="#ccccdd",
            font=("Microsoft YaHei UI", self.字体大小), wrap="word",
            padx=12, pady=8, highlightthickness=0, borderwidth=0
        )
        self._画布.create_window(0, 24, anchor="nw", window=self._回答文本, width=宽, height=高 - 24)
        if 初始文本:
            self._回答文本.insert("end", 初始文本)
        self._画布.unbind("<Motion>")
        self._画布.bind("<Button-1>", lambda e: None)
        # 回答区只绑Escape关闭，不绑FocusOut（否则点击Text内部会触发关闭）
        self._弹窗.bind("<Escape>", lambda e: self._关闭())

    def _新建回答弹窗(self, 初始文本=""):
        """截图完成后创建全新的回答弹窗"""
        self._强制关闭弹窗()
        宽, 高 = 360, 180
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
        self._画布.create_rectangle(0, 0, 宽, 24, fill="#1c1c28", outline="")
        self._画布.create_text(12, 12, text="快速助手", fill="#666688",
                                font=("Microsoft YaHei UI", 8, "bold"), anchor="w")
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
        self._画布.create_window(宽 - 60, 12, window=复制按钮)
        关闭按钮 = tk.Button(
            self._画布, text="✕", command=self._关闭,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=8
        )
        self._画布.create_window(宽 - 18, 12, window=关闭按钮)
        self._回答文本 = tk.Text(
            self._画布, bg="#15151c", fg="#ccccdd",
            font=("Microsoft YaHei UI", self.字体大小), wrap="word",
            padx=12, pady=8, highlightthickness=0, borderwidth=0
        )
        self._画布.create_window(0, 24, anchor="nw", window=self._回答文本, width=宽, height=高 - 24)
        if 初始文本:
            self._回答文本.insert("end", 初始文本)
        self._画布.bind("<Button-1>", lambda e: None)
        self._弹窗.bind("<Escape>", lambda e: self._关闭())
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
        """轮盘弹窗过渡为输入框"""
        if not self._弹窗:
            return
        宽, 高 = 360, 120
        x = self._中心[0] - 宽 // 2
        y = self._中心[1] - 高 // 2
        if x < 10: x = 10
        if y < 10: y = 10
        self._弹窗.geometry(f"{宽}x{高}+{x}+{y}")
        self._弹窗.configure(bg="#15151c")
        self._弹窗.attributes("-transparentcolor", "")
        self._弹窗.unbind("<FocusOut>")
        self._画布.delete("all")
        self._画布.configure(bg="#15151c")
        self._画布.create_rectangle(0, 0, 宽, 24, fill="#1c1c28", outline="")
        self._画布.create_text(12, 12, text="快速问答", fill="#666688",
                                font=("Microsoft YaHei UI", 8, "bold"), anchor="w")
        关闭按钮 = tk.Button(
            self._画布, text="✕", command=self._关闭,
            bg="#1c1c28", fg="#666688", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=8
        )
        self._画布.create_window(宽 - 18, 12, window=关闭按钮)
        输入框 = tk.Text(
            self._画布, bg="#0d0d14", fg="#ccccdd",
            font=("Microsoft YaHei UI", self.字体大小), wrap="word",
            padx=10, pady=8, highlightthickness=1,
            highlightbackground="#333355", borderwidth=0, height=4
        )
        self._画布.create_window(10, 30, anchor="nw", window=输入框, width=宽 - 20)
        def 提交():
            文本 = 输入框.get("1.0", "end").strip()
            if not 文本:
                return
            上下文 = f"[当前程序: {self._当前窗口标题}]"
            消息 = [{"role": "user", "content": f"{上下文}\n{文本}"}]
            提示词 = self.配置.get("系统提示词", "你是快速助手，简洁回答。")
            self._过渡到回答区()
            self._启动LLM(消息, 提示词)
        提交按钮 = tk.Button(
            self._画布, text="发送", command=提交,
            bg="#2a2a4a", fg="#aaaacc", font=("Microsoft YaHei UI", 8, "bold"),
            bd=0, highlightthickness=0, activebackground="#3a3a5a",
            activeforeground="white", cursor="hand2", padx=12
        )
        self._画布.create_window(宽 - 60, 高 - 16, window=提交按钮)
        # Enter提交，Shift+Enter换行
        输入框.bind("<Return>", lambda e: (提交(), "break"))
        输入框.bind("<Shift-Return>", lambda e: None)
        self._画布.unbind("<Motion>")
        self._画布.bind("<Button-1>", lambda e: None)
        self._弹窗.bind("<Escape>", lambda e: self._关闭())
        输入框.focus_set()

    def _追加文本(self, 片段):
        try:
            self._回答文本.insert("end", 片段)
            self._回答文本.see("end")
        except Exception:
            pass

    # ============ 动画 + 关闭 ============

    def _展开动画(self):
        总帧 = max(1, self.动画毫秒 // 16)
        帧 = [0]
        def 步进():
            帧[0] += 1
            t = min(1.0, 帧[0] / 总帧)
            ease = 1 - (1 - t) ** 3
            alpha = self.透明度 * ease
            try:
                self._弹窗.attributes("-alpha", alpha)
                if t < 1.0:
                    self._弹窗.after(16, 步进)
            except Exception:
                pass
        步进()

    def _关闭(self, 事件=None):
        if not self._弹窗:
            return
        当前 = [self.透明度]
        def 步进():
            当前[0] -= 0.12
            if 当前[0] <= 0:
                self._强制关闭弹窗()
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
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
