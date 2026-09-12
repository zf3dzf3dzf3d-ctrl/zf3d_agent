"""
快速浮窗 - 截图/识图/翻译/OCR Mixin（从 quick_wheel.py 拆出）

依赖宿主类提供：self._根窗口, self._弹窗, self._中心, self.配置,
self.模型直连器, self._强制关闭弹窗(), self._新建回答弹窗(), self._启动LLM(),
self._显示气泡(), self._追加文本()
"""
import tkinter as tk
import math
import io
import base64

from quick_wheel_utils import _截图base64


# ==== 以下方法体原样搬移（无改动），仅按职责拆分文件 ====


class 翻译Mixin:
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

        # 绑定 Ctrl+C 复制和 Ctrl+A 全选
        def _翻译复制(e):
            try:
                选中 = self._翻译结果文本.get("sel.first", "sel.last")
                self._弹窗.clipboard_clear()
                self._弹窗.clipboard_append(选中)
            except tk.TclError:
                pass
            return "break"
        def _翻译全选(e):
            self._翻译结果文本.tag_add("sel", "1.0", "end")
            return "break"
        self._翻译结果文本.bind("<Control-c>", _翻译复制)
        self._翻译结果文本.bind("<Control-C>", _翻译复制)
        self._翻译结果文本.bind("<Control-a>", _翻译全选)
        self._翻译结果文本.bind("<Control-A>", _翻译全选)

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
                except Exception: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except Exception: pass
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

    def _翻译LLM调用(self, 消息, 提示词, 回调):
        """纯文本翻译LLM调用，不需要vision"""
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=回调)
        if not 结果.get("成功"):
            错误 = 结果.get('错误', '未知错误')
            if self._根窗口:
                self._根窗口.after(0, lambda: self._追加截图结果(f"\n❌ 翻译失败: {错误}"))

    def _翻译流式调用(self, 消息, 提示词, 流式回调, 完成回调):
        结果 = self.模型直连器.发送消息流式(
            消息列表=消息, 系统提示词=提示词, 流式回调=流式回调)
        完整回复 = 结果.get("回复内容", "") if 结果.get("成功") else f"错误: {结果.get('错误', '未知错误')}"
        完成回调(完整回复)

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

    def _追加翻译文本2(self, 片段):
        """流式追加到结果文本区"""
        try:
            self._翻译流式缓冲 += 片段
            self._翻译结果文本.insert("end", 片段, "译文")
            self._翻译结果文本.see("end")
        except Exception:
            pass

    def _启动截图选区2(self):
        try:
            from screenshot_capture import 截图选区
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

