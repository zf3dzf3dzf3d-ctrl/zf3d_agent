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


from quick_wheel_screenshot import 截图翻译Mixin
from quick_wheel_translate import 翻译Mixin
from quick_wheel_answer import 回答区Mixin


class 快速浮窗(回答区Mixin, 翻译Mixin, 截图翻译Mixin):

    def __init__(self, 配置, 模型直连器, 获取画像回调, TTS回调, 获取对话历史回调=None, 追加到对话回调=None):
        self.配置 = 配置
        self.模型直连器 = 模型直连器
        self.获取用户画像 = 获取画像回调
        self.TTS回调 = TTS回调
        self.获取对话历史 = 获取对话历史回调 or (lambda: [])
        self.追加到对话 = 追加到对话回调 or (lambda u, a: None)
        self.半径 = 配置.get("轮盘半径", 72)
        self.中心圆半径 = 配置.get("中心圆半径", 26)
        self.透明度 = 配置.get("透明度", 1.0)
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
        # 网页端口：5.0.4 适配，优先从配置顶层的"网页端口"读（快速呼出管理会注入），否则默认8765
        self.配置.setdefault("网页端口", 配置.get("_web端口", 8765))

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
        self._正在录音 = False
        self._正在录屏 = False
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
        # 弹出前同步录音/录屏状态
        threading.Thread(target=lambda: (self._同步录音状态(), self._同步录屏状态()), daemon=True).start()
        # 全部在Tk主线程中执行，确保顺序正确
        def 安全创建():
            if self._弹窗:
                self._强制关闭弹窗()
            self._创建弹窗()
        self._根窗口.after(0, 安全创建)

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
            是录音扇区 = 原名 == "录音"
            是录屏扇区 = 原名 == "录屏"
            if 是朗读扇区 and self._正在朗读:
                名称 = "停读"
            elif 是录音扇区 and self._正在录音:
                名称 = "停录"
            elif 是录屏扇区 and self._正在录屏:
                名称 = "停录"
            else:
                名称 = 原名[:2]
            是空扇区 = 原名[:2] == "空"
            if 是空扇区:
                填充色 = "#abcdef"
            elif 是朗读扇区 and self._正在朗读:
                填充色 = self.朗读激活色
            elif 是录音扇区 and self._正在录音:
                填充色 = "#3a1a1a"
            elif 是录屏扇区 and self._正在录屏:
                填充色 = "#1a3a1a"
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

        elif 动作 in ("录音", "停录"):
            self._关闭()
            # 先查后端实际状态（防止轮盘状态与后端不同步）
            self._同步录音状态()
            self._根窗口.after(200, lambda: self._切换录音())

        elif 动作 in ("录屏", "停录"):
            self._关闭()
            self._同步录屏状态()
            self._根窗口.after(200, lambda: self._切换录屏())

        else:
            消息 = [{"role": "user", "content": 选中文本 or 动作}]
            提示词 = self.配置.get("系统提示词", "你是快速助手，简洁回答。")
            self._过渡到回答区()
            self._启动LLM(消息, 提示词)

    # ============ 录音/录屏 ============

    def _同步录音状态(self):
        """从后端查询录音实际状态"""
        import urllib.request, json as _json
        端口 = self.配置.get("网页端口", 8765)
        try:
            req = urllib.request.Request(
                f"http://localhost:{端口}/api/record-status",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            resp = urllib.request.urlopen(req, timeout=2)
            数据 = _json.loads(resp.read().decode("utf-8"))
            if 数据.get("成功"):
                self._正在录音 = 数据.get("录制中", False)
        except Exception:
            pass

    def _同步录屏状态(self):
        """从后端查询录屏实际状态"""
        import urllib.request, json as _json
        端口 = self.配置.get("网页端口", 8765)
        try:
            req = urllib.request.Request(
                f"http://localhost:{端口}/api/screenrecord-status",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            resp = urllib.request.urlopen(req, timeout=2)
            数据 = _json.loads(resp.read().decode("utf-8"))
            if 数据.get("成功"):
                self._正在录屏 = 数据.get("录制中", False)
        except Exception:
            pass

    def _切换录音(self):
        """切换录音状态：未录制→开始，录制中→停止"""
        import urllib.request, json as _json
        端口 = self.配置.get("网页端口", 8765)
        try:
            if self._正在录音:
                req = urllib.request.Request(
                    f"http://localhost:{端口}/api/record-stop",
                    data=_json.dumps({"音量倍数": 5.0}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=30)
                数据 = _json.loads(resp.read().decode("utf-8"))
                self._正在录音 = False
                保存路径 = 数据.get("路径", "")
                提示 = "✅ 录音已停止"
                if 保存路径:
                    提示 += f"\n📁 {保存路径}"
                self._显示气泡(提示)
            else:
                req = urllib.request.Request(
                    f"http://localhost:{端口}/api/record-start",
                    data=_json.dumps({"保存目录": "", "设备索引": -1}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=5)
                数据 = _json.loads(resp.read().decode("utf-8"))
                if 数据.get("成功"):
                    self._正在录音 = True
                    设备 = 数据.get("设备名", "")
                    self._显示气泡(f"🔴 录音中..." + (f"\n🎤 {设备}" if 设备 else ""))
                else:
                    self._显示气泡(f"❌ {数据.get('错误', '录音启动失败')}")
        except Exception as e:
            self._显示气泡(f"❌ 录音错误: {e}")

    def _切换录屏(self):
        """切换录屏状态：未录制→开始，录制中→停止"""
        import urllib.request, json as _json
        端口 = self.配置.get("网页端口", 8765)
        try:
            if self._正在录屏:
                req = urllib.request.Request(
                    f"http://localhost:{端口}/api/screenrecord-stop",
                    data=_json.dumps({}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=300)
                数据 = _json.loads(resp.read().decode("utf-8"))
                self._正在录屏 = False
                保存路径 = 数据.get("路径", "")
                提示 = "✅ 录屏已停止"
                if 保存路径:
                    提示 += f"\n📁 {保存路径}"
                self._显示气泡(提示)
            else:
                # 读取后端保存的录屏设置（跟随主页的设置）
                设置 = {"x": 0, "y": 0, "w": 0, "h": 0, "保存目录": ""}
                try:
                    sreq = urllib.request.Request(
                        f"http://localhost:{端口}/api/screenrecord-settings",
                        data=b"{}",
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    sresp = urllib.request.urlopen(sreq, timeout=2)
                    sdata = _json.loads(sresp.read().decode("utf-8"))
                    if sdata.get("成功"):
                        设置.update(sdata.get("设置", {}))
                except Exception:
                    pass
                req = urllib.request.Request(
                    f"http://localhost:{端口}/api/screenrecord-start",
                    data=_json.dumps(设置).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=10)
                数据 = _json.loads(resp.read().decode("utf-8"))
                if 数据.get("成功"):
                    self._正在录屏 = True
                    self._显示气泡("🎬 录屏中...\n⏹ 再次点击停止")
                else:
                    self._显示气泡(f"❌ {数据.get('错误', '录屏启动失败')}")
        except Exception as e:
            self._显示气泡(f"❌ 录屏错误: {e}")

    # ============ LLM调用 ============

    def _过渡到输入区(self):
        """轮盘弹窗过渡为问答区（回复区在上+输入框在下）"""
        self._过渡到回答区()

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
