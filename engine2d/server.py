# -*- coding: utf-8 -*-
"""py-browser-2d 引擎服务：纯标准库，无依赖。用法: python server.py

目录约定：
- 公开区（engine2d/）：引擎本体，可随智能体发布，外人可见
- 隐私区（private/engine2d/）：游戏内容（game.html/world.js），仅本机可见
"""
import json, os
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
PRIVATE = os.path.join(os.path.dirname(ROOT), "private", "engine2d")

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        # /game/* 映射到隐私区（本机游戏内容）
        if path.startswith("/game/"):
            rel = path[len("/game/"):].split("?")[0]
            return os.path.join(PRIVATE, rel.replace("/", os.sep))
        return super().translate_path(path)

    # 资产文件接口：/api/assets/<file> 返回 assets/ 下的 JSON
    def _send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/assets":
            assets = {"ok": True, "engine": "py-browser-2d v0.1",
                      "assets": os.listdir(os.path.join(ROOT, "assets"))}
            self._send_json(assets)
            return
        if p.startswith("/api/assets/"):
            name = os.path.basename(p[len("/api/assets/"):])
            fp = os.path.join(ROOT, "assets", name)
            if os.path.isfile(fp):
                with open(fp, "rb") as f:
                    self._send_json(json.load(f))
            else:
                self._send_json({"ok": False, "error": "not found"}, 404)
            return
        if p in ("/game", "/game/"):
            self.send_response(302)
            self.send_header("Location", "/game/game.html")
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        print("[server]", fmt % args)

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    port = args.port
    print(f"引擎服务已启动(仅本机): http://localhost:{port}/")
    print(f"  引擎演示: http://localhost:{port}/index.html")
    if os.path.isdir(PRIVATE):
        print(f"  我的游戏: http://localhost:{port}/game/game.html")
    else:
        print("  (未找到 private/engine2d，游戏内容未部署)")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
