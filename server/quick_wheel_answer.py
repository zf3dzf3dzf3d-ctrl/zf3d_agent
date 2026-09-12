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


# 配色/截屏工具函数已拆至 quick_wheel_utils.py
from quick_wheel_utils import _截图base64, _hex到rgb, _rgb到hex, _混色  # noqa: F401 (向后兼容)


# ==== 以下方法体原样搬移（无改动），仅按职责拆分文件 ====


class 回答区Mixin:
    def _创建回答区内容(self, 宽, 高, 初始文本=""):
        """在当前弹窗的画布上绘制问答UI：上=回复区(滚动)，下=输入框+发送+语音"""
        self._弹窗模式 = '问答'
        self._画布.delete("all")
        self._画布.configure(bg="#0a0a14")

        # 布局：标题28 + 回复区(弹性) + 底栏80
        底栏高 = 64
        回复高 = 高 - 28 - 底栏高

        # 自动朗读开关（右上角小喇叭），默认开启，独立于轮盘朗读
        self._自动朗读 = True

        # 标题栏
        标题栏 = self._画布.create_rectangle(0, 0, 宽, 28, fill="#101020", outline="", tags=("titlebar",))
        标题文字 = self._画布.create_text(12, 14, text="快速助手", fill="#8888aa",
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
            bg="#1a2a1a" if self._自动朗读 else "#101020",
            fg="#aacc88" if self._自动朗读 else "#8888aa",
            font=("Microsoft YaHei UI", 9),
            bd=0, highlightthickness=0, activebackground="#333344",
            activeforeground="white", cursor="hand2", padx=6
        )
        self._画布.create_window(宽 - 138, 14, window=朗读按钮)

        # 复制按钮
        def 复制():
            try:
                文本 = self._回答文本.get("1.0", "end-1c")
                self._弹窗.clipboard_clear()
                self._弹窗.update()  # 确保clipboard操作生效
                self._弹窗.clipboard_append(文本)
                self._弹窗.update()
            except Exception as e:
                print(f"复制文本失败: {e}")
        复制按钮 = tk.Button(
            self._画布, text="复制", command=复制,
            bg="#101020", fg="#8888aa", font=("Microsoft YaHei UI", 7),
            bd=0, highlightthickness=0, activebackground="#2a2a44",
            activeforeground="white", cursor="hand2", padx=6
        )
        self._画布.create_window(宽 - 90, 14, window=复制按钮)
        # 关闭按钮
        关闭按钮 = tk.Button(
            self._画布, text="✕", command=self._关闭,
            bg="#101020", fg="#8888aa", font=("Microsoft YaHei UI", 8),
            bd=0, highlightthickness=0, activebackground="#2a2a44",
            activeforeground="white", cursor="hand2", padx=8
        )
        self._画布.create_window(宽 - 18, 14, window=关闭按钮)

        # 回复区frame：Text + Scrollbar
        回复frame = tk.Frame(self._弹窗, bg="#0a0a14")
        self._画窗_回复 = self._画布.create_window(
            0, 28, anchor="nw", window=回复frame, width=宽, height=回复高)
        self._回答文本 = tk.Text(
            回复frame, bg="#0a0a14", fg="#c8c8e0",
            font=("Microsoft YaHei UI", 10), wrap="word",
            padx=12, pady=8, highlightthickness=0, borderwidth=0,
            spacing1=4, spacing3=4, insertbackground="#c8c8e0", insertwidth=2,
            state="normal", cursor="xterm"
        )
        self._回答文本.pack(side="left", fill="both", expand=True)
        滚动条 = tk.Scrollbar(回复frame, command=self._回答文本.yview,
            bg="#101020", troughcolor="#0a0a14", activebackground="#2a2a44",
            highlightthickness=0, bd=0, width=8)
        滚动条.pack(side="right", fill="y")
        self._回答文本.config(yscrollcommand=滚动条.set)

        # 回复区按普通文本处理，允许直接编辑以及系统原生的 Ctrl+C/X/V/A。

        # 右键菜单：复制/剪切/粘贴/全选/复制全部
        def _显示右键菜单(e):
            菜单 = tk.Menu(self._弹窗, tearoff=0, bg="#101020", fg="#aaaacc",
                          activebackground="#2a2a44", activeforeground="white",
                          bd=0, relief="flat")
            def _复制():
                self._回答文本.event_generate("<<Copy>>")
            def _剪切():
                self._回答文本.event_generate("<<Cut>>")
            def _粘贴():
                self._回答文本.event_generate("<<Paste>>")
            def _全选文本():
                self._回答文本.tag_add("sel", "1.0", "end")
            def _复制全部():
                self._弹窗.clipboard_clear()
                self._弹窗.clipboard_append(self._回答文本.get("1.0", "end-1c"))
            菜单.add_command(label="📋 复制", command=_复制)
            菜单.add_command(label="✂ 剪切", command=_剪切)
            菜单.add_command(label="📌 粘贴", command=_粘贴)
            菜单.add_command(label="📋 全选", command=_全选文本)
            菜单.add_separator()
            菜单.add_command(label="📋 复制全部", command=_复制全部)
            菜单.tk_popup(e.x_root, e.y_root)
            return "break"
        self._回答文本.bind("<Button-3>", _显示右键菜单)

        # 多轮对话标签样式：用户亮蓝靠右有背景，机器人白色靠左有背景
        self._回答文本.tag_config("user", foreground="#aaccff",
            font=("Microsoft YaHei UI", 10), spacing1=8, spacing3=8,
            justify="right", lmargin1=50, lmargin2=50,
            background="#1a2a3a")
        self._回答文本.tag_config("bot", foreground="#e0e0e8",
            font=("Microsoft YaHei UI", 10), spacing1=8, spacing3=8,
            background="#1a1a28")

        if 初始文本:
            self._回答文本.insert("end", 初始文本)

        # 滚轮：回复区上下滚动（不调窗口高度）
        self._回答文本.bind("<MouseWheel>", lambda e: self._回答文本.yview_scroll(int(-e.delta/120), "units"))

        # 底栏frame：输入框(左) + 录音/发送按钮(右并排)
        底栏 = tk.Frame(self._弹窗, bg="#0a0a14")
        self._画窗_底栏 = self._画布.create_window(
            0, 28 + 回复高, anchor="nw", window=底栏, width=宽, height=底栏高)
        底栏.pack_propagate(False)
        底栏.configure(width=宽, height=底栏高)

        输入框 = tk.Text(
            底栏, bg="#12121e", fg="#c8c8e0",
            font=("Microsoft YaHei UI", 10), wrap="word",
            padx=10, pady=8, highlightthickness=1,
            highlightbackground="#2a2a44", highlightcolor="#4a6aaa", borderwidth=0,
            insertbackground="#c8c8e0", insertwidth=2
        )
        输入框.place(x=4, y=4, relwidth=0.68, width=-8, relheight=1, height=-8)

        # 按钮区：发送按钮（全宽）
        按钮区 = tk.Frame(底栏, bg="#0a0a14")
        按钮区.place(relx=0.68, x=4, rely=0, relwidth=0.32, width=-8, relheight=1)

        def 提交():
            文本 = 输入框.get("1.0", "end").strip()
            if not 文本:
                return
            上下文 = f"[当前程序: {self._当前窗口标题}]"
            消息 = [{"role": "user", "content": f"{上下文}\n{文本}"}]
            提示词 = self.配置.get("系统提示词", "你是快速助手，简洁回答。")
            # 追加到回复区而非清空，支持多轮对话
            当前内容 = self._回答文本.get("1.0", "end").strip()
            if 当前内容:
                self._回答文本.insert("end", f"\n👤 {文本}\n", "user")
            else:
                self._回答文本.insert("end", f"👤 {文本}\n", "user")
            self._回答文本.insert("end", "🤖 ", "bot")
            self._回答文本.see("end")
            输入框.delete("1.0", "end")
            self._启动LLM(消息, 提示词, 是问答=True, 问答原文=文本)

        发送按钮 = tk.Button(
            按钮区, text="发送", command=提交,
            bg="#2a4a8a", fg="#e0e8ff", font=("Microsoft YaHei UI", 11, "bold"),
            bd=0, highlightthickness=0, activebackground="#1a3a7a",
            activeforeground="#e0e8ff", cursor="hand2", relief="flat"
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
        self._画布.unbind("<Button-1>")
        self._画布.unbind("<Button-3>")
        self._画布.unbind("<MouseWheel>")
        self._弹窗.unbind("<FocusOut>")
        self._弹窗.bind("<Escape>", lambda e: self._关闭())

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
                except Exception: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except Exception: pass
        步进()

    # ============ UI: 问答输入区 ============

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
                except Exception: pass
            else:
                try:
                    self._弹窗.attributes("-alpha", 当前[0])
                    self._弹窗.after(16, 步进)
                except Exception: pass
        步进()

    def _追加文本(self, 片段):
        try:
            self._回答文本.insert("end", 片段, "bot")
            self._回答文本.see("end")
        except Exception:
            pass

    # ============ 动画 + 关闭 ============

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

    def _启动朗读检测(self):
        """持续每秒检查TTS是否还在播放（仅轮盘模式更新显示）"""
        def 检查():
            try:
                import urllib.request
                端口 = self.配置.get("网页端口", 8765)
                req = urllib.request.Request(f"http://localhost:{端口}/api/tts-status")
                resp = urllib.request.urlopen(req, timeout=2)
                data = json.loads(resp.read().decode("utf-8"))
                状态 = data.get("轮盘播放", False)
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._更新朗读显示(状态))
            except Exception:
                pass  # 网络失败不改变当前状态
            if self._根窗口:
                self._根窗口.after(1000, 检查)
        if self._根窗口:
            self._根窗口.after(1000, 检查)

    # ============ UI: 弹窗复用为回答区 ============

    def _更新朗读显示(self, 状态):
        """更新朗读状态，仅轮盘模式生效。不全量重绘，避免与展开动画冲突。"""
        if getattr(self, '_弹窗模式', '') != '轮盘':
            return
        旧状态 = self._正在朗读
        self._正在朗读 = 状态
        if 旧状态 != 状态 and self._弹窗 and self._画布:
            # 只更新朗读扇区的颜色和文字，不delete/all重绘
            for 扇区 in self._扇区列表:
                原名 = 扇区["配置"].get("名称", "")
                if 原名 == "朗读":
                    if 状态:
                        self._画布.itemconfig(扇区["arc_id"], fill=self.朗读激活色)
                        self._画布.itemconfig(扇区["文字id"], text="停读")
                    else:
                        self._画布.itemconfig(扇区["arc_id"], fill=self.扇区默认色)
                        self._画布.itemconfig(扇区["文字id"], text="朗读")

    def _同步朗读状态(self):
        """异步从服务器查询TTS状态，不阻塞Tk线程"""
        def 查询():
            try:
                import urllib.request
                端口 = self.配置.get("网页端口", 8765)
                req = urllib.request.Request(f"http://localhost:{端口}/api/tts-status")
                resp = urllib.request.urlopen(req, timeout=2)
                data = json.loads(resp.read().decode("utf-8"))
                状态 = data.get("轮盘播放", False)
                if self._根窗口:
                    self._根窗口.after(0, lambda: self._更新朗读显示(状态))
            except Exception:
                pass
        threading.Thread(target=查询, daemon=True).start()

    def _停止朗读(self):
        # 5.0.4 适配：没有 /api/wheel-tts-stop 接口，改走管理器的 _tts_stop（关闭 tts mp3 播放器窗口）
        管理器 = self.模型直连器
        if hasattr(管理器, "_tts_stop"):
            try:
                管理器._tts_stop()
            except Exception:
                pass
        self._正在朗读 = False

