#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zf-bridge-lite：ZCode「无限桌面」一键唤起的本地轻服务（v0.1 骨架）
- 纯 Python 标准库，单文件，零第三方依赖（pywebview 为窗口壳可选依赖，缺失自动退回系统浏览器）
- 静态托管无限桌面 UI（默认代理到主项目 public/ 目录，可 --root 指定）
- 动态端口 + private/port.json 端口登记（与主服务同机制，读 zf_port 字段避免冲突）
- /api/health 健康检查；/api/echo 对话注入最小 API（白名单制，默认不挂记忆读取）
"""
import argparse
import http.server
import json
import os
import socket
import sys
import threading
import urllib.request
from pathlib import Path

ROOT_HINT = Path(__file__).resolve().parents[5]  # 0=bridge_lite 1=zf-infinite-desktop 2=zf-zcode 3=integrations 4=server 5=项目根
PORT_FILE = ROOT_HINT / "private" / "port.json"
UI_ENTRY = "index.html"


def pick_port(preferred=0):
    if preferred == 0:
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port
    return preferred


def register_port(port):
    try:
        data = {}
        if PORT_FILE.exists():
            data = json.loads(PORT_FILE.read_text("utf-8"))
        data["zf_bridge_lite"] = port
        PORT_FILE.parent.mkdir(parents=True, exist_ok=True)
        PORT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    except Exception as e:
        print(f"[bridge-lite] 端口登记失败(不影响运行): {e}")


def make_handler(static_root):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(static_root), **kw)

        def log_message(self, fmt, *args):
            pass  # 静默

        def _json(self, obj, code=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/api/health":
                return self._json({"ok": True, "service": "zf-bridge-lite", "version": "0.1.0"})
            if self.path.startswith("/api/"):
                return self._json({"ok": False, "error": "unknown api"}, 404)
            return super().do_GET()

        def do_POST(self):
            if self.path == "/api/echo":
                n = int(self.headers.get("Content-Length") or 0)
                try:
                    payload = json.loads(self.rfile.read(n) or b"{}")
                except Exception:
                    return self._json({"ok": False, "error": "bad json"}, 400)
                msg = str(payload.get("message", ""))[:4000]
                # P0 骨架：只回显确认通道通；引擎桥(D6-8)在此接朱峰线路/ZCode GLM
                return self._json({"ok": True, "echo": msg, "engine": payload.get("engine", "zhufeng")})
            return self._json({"ok": False, "error": "unknown api"}, 404)

    return Handler


def open_in_browser(url):
    os.startfile(url) if sys.platform == "win32" else __import__("webbrowser").open(url)


def launch_window(url):
    """pywebview 原生窗口；WebView2/依赖缺失 → 退回系统浏览器"""
    try:
        import webview  # pywebview
        webview.create_window("朱峰无限桌面", url, width=1440, height=900)
        print("[bridge-lite] pywebview 原生窗口已唤起")
        webview.start()
        return True
    except Exception as e:
        print(f"[bridge-lite] pywebview 不可用({e})，退回系统浏览器")
        open_in_browser(url)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="0=动态端口")
    ap.add_argument("--root", default=str(ROOT_HINT / "public"), help="静态 UI 根目录")
    args, extra = ap.parse_known_args()
    mcp_mode = "--mcp" in extra

    static_root = Path(args.root)
    if not static_root.exists():
        print(f"[bridge-lite] 警告: 静态目录不存在 {static_root}，用临时目录兜底")
        import tempfile
        static_root = Path(tempfile.mkdtemp(prefix="zf-ui-"))
        (static_root / UI_ENTRY).write_text("<h1>zf-bridge-lite 运行中（未找到 UI 资源）</h1>", "utf-8")

    port = pick_port(args.port)
    register_port(port)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(static_root))
    url = f"http://127.0.0.1:{port}/{UI_ENTRY}"
    print(f"[bridge-lite] listening 127.0.0.1:{port}  ui={url}")
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    if mcp_mode:  # MCP 宿主模式：只当后台服务，不弹窗
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
    else:
        launch_window(url)


if __name__ == "__main__":
    main()
