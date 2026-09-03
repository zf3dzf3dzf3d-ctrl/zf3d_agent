# -*- coding: utf-8 -*-
"""
桌面对话浮窗 — Ctrl+Shift+~ 全局呼出一个悬浮的"完整对话"窗口

和网页版对话系统 100% 一模一样：直接用 pywebview 加载本机服务器的
index.html，界面、消息流、工具调用、项目记忆全部复用，不做任何阉割。
区别只是它浮在用户桌面/文件夹上面，不用开浏览器。

快捷键：Ctrl+Shift+~（轮盘的 Ctrl+~ 不冲突）
仅 Windows；pywebview 未安装或初始化失败时静默降级，不影响主服务。
"""
import sys
import threading

窗口标题 = "朱峰社区智能体 - 桌面对话"


def _读端口():
    import json, os
    try:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "..", "private", "port.json")
        with open(p, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return int(cfg.get("api_port") or cfg.get("port") or 8765)
    except Exception:
        return 8765


class 桌面对话浮窗:
    """Ctrl+Shift+~ 呼出/隐藏悬浮对话窗口。"""

    def __init__(self, web端口=None):
        self.web端口 = web端口 or _读端口()
        self._窗口 = None
        self._可见 = False
        self._运行 = False
        self._呼出器 = None

    # ---------- 对外 ----------
    def 启动(self):
        if sys.platform != "win32":
            print("[桌面对话] 仅支持 Windows，跳过")
            return False
        try:
            import webview  # noqa: F401
        except Exception as e:
            print("[桌面对话] pywebview 未安装，跳过（pip install pywebview）:", e)
            return False

        self._运行 = True

        def 弹出回调(坐标, 标题, 选中):
            threading.Thread(target=self._切换, daemon=True).start()

        try:
            from global_hotkey import 全局呼出器
        except Exception as e:
            print("[桌面对话] 呼出器导入失败:", e)
            return False

        self._呼出器 = 全局呼出器(弹出回调, 修饰键=全局呼出器.MOD_SHIFT)
        self._呼出器.启动()

        # webview 事件循环放独立线程（窗口初始隐藏，首次热键时显示）
        t = threading.Thread(target=self._webview循环, daemon=True)
        t.start()
        print("[桌面对话] 就绪：Ctrl+Shift+~ 呼出/隐藏完整对话悬浮窗")
        return True

    def 停止(self):
        self._运行 = False
        if self._呼出器:
            self._呼出器.停止()
        try:
            if self._窗口:
                self._窗口.destroy()
        except Exception:
            pass

    # ---------- 内部 ----------
    def _webview循环(self):
        try:
            import webview
            self._窗口 = webview.create_window(
                窗口标题,
                f"http://127.0.0.1:{self.web端口}/",
                width=1150, height=780,
                hidden=True, on_top=True, min_size=(720, 520),
            )
            webview.start(gui="edgechromium")
        except Exception as e:
            print("[桌面对话] webview 启动失败(不影响主服务):", e)
            self._窗口 = None

    def _切换(self):
        if not self._窗口:
            return
        try:
            if self._可见:
                self._窗口.hide()
                self._可见 = False
            else:
                self._窗口.show()
                self._可见 = True
        except Exception as e:
            print("[桌面对话] 切换窗口失败:", e)
