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


# ==== 截图画布/标注弹窗（方法体原样搬移）====


class 画布Mixin:
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
                except Exception: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except Exception: pass
        步进()

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

    def _画布松开(self, 事件):
        if self._截图绘图形状:
            self._截图绘图列表.append(self._截图绘图形状)
            self._截图绘图形状 = None
        self._截图绘图起点 = None

    def _画布拖动(self, 事件):
        if not self._截图绘图起点 or not self._截图绘图形状:
            return
        x1, y1 = self._截图绘图起点
        self._截图画布.coords(self._截图绘图形状, x1, y1, 事件.x, 事件.y)

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

    def _选择绘图颜色(self):
        from tkinter import colorchooser
        结果 = colorchooser.askcolor(title="选择绘图颜色")
        if 结果 and 结果[1]:
            self._绘图颜色 = 结果[1]

    def _撤销绘图(self):
        if self._截图绘图列表:
            self._截图画布.delete(self._截图绘图列表.pop())

    def _切换截图工具(self, 工具):
        self._截图绘图工具 = "无" if self._截图绘图工具 == 工具 else 工具

