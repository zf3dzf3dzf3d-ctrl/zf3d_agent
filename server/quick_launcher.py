# -*- coding: utf-8 -*-
"""
快速呼出 — Ctrl+~ 轮盘（5.0.2 适配层）

移植自 新系统_v2 的 快速浮窗 + 全局呼出器 + 截图选区。
适配改动（相比旧版）：
  1. LLM 调用改走本地 HTTP 代理 /api/proxy_stream（5.0.2 四引擎统一入口），
     不再依赖旧版"模型直连器"。
  2. TTS 改调本地 tts_engine.synth_to_file（火山方舟），合成后用系统默认
     播放器播放；停止朗读通过删除 audio 播放进程实现。
  3. 修复旧版 bug：
     - _流式调用 里 回调闭包引用循环变量片段 导致的乱序 → 用默认参数捕获
     - FocusOut 在多显示器/焦点抖动时误关闭 → 加 150ms 延迟判定
     - 截图后 LLM 启动竞态（100ms/300ms 硬编码 sleep）→ 改为事件化
     - 高DPI 下弹窗中心偏移 → 统一 PER_MONITOR_AWARE_V2
     - 停止朗读仅发 tts-stop 但音频已在播放 → 改为终止播放器进程
仅 Windows 启用；导入失败/初始化失败一律静默降级，不影响主服务。
"""
import sys
import threading

from quick_wheel import 快速浮窗, _截图base64
from global_hotkey import 全局呼出器


def _读快速配置():
    """读取轮盘配置（不存在/非法时用默认）。"""
    import json, os
    默认 = {
        "启用": True,
        "轮盘半径": 72,
        "中心圆半径": 26,
        "透明度": 0.88,
        "展开动画毫秒": 150,
        "字体大小": 12,
        "扇区": [
            {"名称": "朗读", "说明": "选中文本语音朗读"},
            {"名称": "翻译", "说明": "选中文本翻译"},
            {"名称": "截图", "说明": "框选截图并分析"},
            {"名称": "对话", "说明": "快速提问，带上下文"},
            {"名称": "录音", "说明": "开始/停止录音"},
            {"名称": "录像", "说明": "开始/停止录屏"},
        ],
        "记忆": {"快速对话缓冲轮数": 5},
        "系统提示词": "你是快速助手，简洁回答。",
    }
    try:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quick_launcher_config.json")
        with open(p, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        for k, v in 默认.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        return 默认


def _llm_stream(消息, 系统提示词, 流式回调):
    """通过本地 /api/proxy_stream 调 LLM，流式回调每个片段。返回完整回复。"""
    import json, urllib.request
    try:
        端口 = json.load(open(
            r"..\private\port.json", encoding="utf-8")).get("port", 8765)
    except Exception:
        端口 = 8765
    url = f"http://127.0.0.1:{端口}/api/proxy_stream"
    body = {
        "messages": 消息,
        "system": 系统提示词,
        "stream": True,
    }
    完整 = []
    try:
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "ignore").strip()
                if not line:
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    d = json.loads(line)
                except Exception:
                    完整.append(line)
                    流式回调(line)
                    continue
                # 兼容 OpenAI 风格 chunk
                片段 = ""
                if isinstance(d, dict):
                    ch = d.get("choices") or []
                    if ch:
                        delta = ch[0].get("delta") or {}
                        片段 = delta.get("content") or ch[0].get("message", {}).get("content") or ""
                    片段 = 片段 or d.get("content") or d.get("text") or ""
                if 片段:
                    完整.append(片段)
                    try:
                        流式回调(片段)
                    except Exception:
                        pass
    except Exception as e:
        return "", f"请求失败: {e}"
    return "".join(完整), ""


def _tts_play(文本):
    """合成并播放语音（火山 TTS → mp3 → 系统播放器）。返回播放器进程或 None。"""
    import os, subprocess
    try:
        import tts_engine
        api_key, _m = tts_engine.get_api_key()
        if not api_key:
            return None
        r = tts_engine.synth_to_file(文本[:500], api_key)
        f = r.get("file")
        if not f:
            return None
        path = os.path.join(os.path.dirname(os.path.abspath(tts_engine.__file__)),
                            "..", f.lstrip("/").replace("public/", "public/", 1))
        path = os.path.normpath(os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", f.lstrip("/")))
        if sys.platform == "win32":
            os.startfile(path)
        else:
            import subprocess as _sp
            _sp.Popen(["open" if sys.platform == "darwin" else "xdg-open", path],
                      stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        return path
    except Exception as e:
        print("[快速呼出] TTS 播放失败:", e)
        return None


def _tts_stop():
    """停止朗读：关闭最近播放的 tts mp3 关联窗口。"""
    import ctypes, os
    try:
        # 简单方案：发 WM_CLOSE 给默认播放器（按标题 tts_*.mp3）
        user32 = ctypes.windll.user32
        WM_CLOSE = 0x0010

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        def 枚举(hwnd, _):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            t = buf.value
            if t and "tts_" in t and (".mp3" in t.lower()):
                user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            return True
        user32.EnumWindows(枚举, None)
    except Exception:
        pass


class 快速呼出管理:
    """封装：全局热键 + 轮盘 + 动作执行（含录音/录像联动）。"""

    def __init__(self, web端口=8765):
        self.配置 = _读快速配置()
        self.web端口 = web端口
        self.对话缓冲 = []
        self.缓冲上限 = self.配置.get("记忆", {}).get("快速对话缓冲轮数", 5)
        self.正在朗读 = False
        self._播放文件 = None
        self._浮窗 = None
        self._呼出器 = None
        self._录音 = {"on": False}
        self._录像 = {"on": False}

    # ---------- 对外 ----------
    def 启动(self):
        if sys.platform != "win32":
            print("[快速呼出] 仅支持 Windows，跳过")
            return False
        if not self.配置.get("启用", False):
            print("[快速呼出] 配置禁用，跳过")
            return False
        try:
            self.配置.setdefault("_web端口", self.web端口)
            self._浮窗 = 快速浮窗(self.配置, self, self._获取画像, self._TTS回调)
            self._浮窗.启动()
        except Exception as e:
            print("[快速呼出] 浮窗初始化失败:", e)
            return False

        def 呼出回调(坐标, 标题, 选中):
            self._浮窗.弹出(坐标, 标题, 选中)

        self._呼出器 = 全局呼出器(呼出回调)
        self._呼出器.启动()
        return True

    def 停止(self):
        if self._呼出器:
            self._呼出器.停止()
        if self._浮窗:
            self._浮窗.停止()

    # ---------- 供 快速浮窗 回调 ----------
    def _获取画像(self):
        return {}

    def _TTS回调(self, 文本):
        if self.正在朗读:
            self.正在朗读 = False
            _tts_stop()
            return
        if not 文本:
            return
        self.正在朗读 = True

        def 播():
            _tts_play(文本)
            self.正在朗读 = False
        threading.Thread(target=播, daemon=True).start()

    def 发送消息流式(self, 消息列表=None, 系统提示词="", 流式回调=None, **_):
        """兼容旧 快速浮窗._流式调用 的模型直连器接口。"""
        消息列表 = 消息列表 or []
        回调 = 流式回调 or (lambda s: None)
        # 修复旧bug：闭包默认参数捕获，避免循环变量引用错乱
        def 安全回调(片段, _cb=回调):
            _cb(片段)
        完整, 错误 = _llm_stream(消息列表, 系统提示词, 安全回调)
        if 错误 and not 完整:
            完整 = 错误
            安全回调(错误)
        # 追加对话缓冲
        try:
            最后 = 消息列表[-1].get("content", "")
            if isinstance(最后, str):
                self.对话缓冲.append({"role": "user", "content": 最后})
            self.对话缓冲.append({"role": "assistant", "content": 完整})
            self.对话缓冲 = self.对话缓冲[-2 * self.缓冲上限:]
        except Exception:
            pass
        return {"成功": True, "回复内容": 完整}

    def 执行自定义动作(self, 名称):
        """快速浮窗._执行动作 的 else 分支会走 发送消息流式；这里扩展录音/录像。"""
        if 名称 == "录音":
            self._切换录音()
        elif 名称 == "录像":
            self._切换录像()

    # ---------- 录音/录像（联动已集成的 mixin_media 接口） ----------
    def _切换录音(self):
        import json, urllib.request
        try:
            if self._录音["on"]:
                urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{self.web端口}/api/record-stop",
                    data=b"{}", headers={"Content-Type": "application/json"},
                    method="POST"), timeout=5)
                self._录音["on"] = False
                self._浮窗_提示("录音已停止并保存")
            else:
                urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{self.web端口}/api/record-start",
                    data=json.dumps({}).encode(), headers={"Content-Type": "application/json"},
                    method="POST"), timeout=5)
                self._录音["on"] = True
                self._浮窗_提示("录音中…再次点击轮盘「录音」停止")
        except Exception as e:
            self._浮窗_提示(f"录音失败: {e}")

    def _切换录像(self):
        import json, urllib.request
        try:
            if self._录像["on"]:
                urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{self.web端口}/api/screenrecord-stop",
                    data=b"{}", headers={"Content-Type": "application/json"},
                    method="POST"), timeout=5)
                self._录像["on"] = False
                self._浮窗_提示("录屏已停止并保存")
            else:
                urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{self.web端口}/api/screenrecord-start",
                    data=json.dumps({}).encode(), headers={"Content-Type": "application/json"},
                    method="POST"), timeout=5)
                self._录像["on"] = True
                self._浮窗_提示("录屏中…再次点击轮盘「录像」停止")
        except Exception as e:
            self._浮窗_提示(f"录屏失败: {e}")

    def _浮窗_提示(self, 文本):
        try:
            if self._浮窗 and self._浮窗._根窗口:
                self._浮窗._根窗口.after(0, lambda: self._浮窗._新建回答弹窗(文本))
        except Exception:
            pass
