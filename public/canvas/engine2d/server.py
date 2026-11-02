# -*- coding: utf-8 -*-
"""py-browser-2d 引擎服务：纯标准库，无依赖。用法: python server.py

目录约定：
- 公开区（engine2d/）：引擎本体，可随智能体发布，外人可见
- 隐私区（private/engine2d/）：游戏内容（game.html/world.js），仅本机可见
"""
import json, os
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
PRIVATE = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "private", "engine2d")

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
        # /games/<名字>/... 映射到根目录旁的 games/ 文件夹（每个游戏独立目录）
        if path.startswith("/games/"):
            rel = path[len("/games/"):].split("?")[0]
            return os.path.join(ROOT, "games", rel.replace("/", os.sep))
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
        # 热重载 SSE：监听 scripts/ 目录文件变化，推 {file, code}
        if p == "/api/hotreload/stream":
            import time
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            scripts_dir = os.path.join(ROOT, "scripts")
            mtimes = {}
            try:
                while True:
                    if os.path.isdir(scripts_dir):
                        for f in os.listdir(scripts_dir):
                            if not f.endswith(".js"): continue
                            fp = os.path.join(scripts_dir, f)
                            m = os.path.getmtime(fp)
                            if mtimes.get(f) != m:
                                is_new = f in mtimes
                                mtimes[f] = m
                                if is_new:  # 首轮全量只记录基线，之后变化才推送
                                    code = open(fp, "r", encoding="utf-8-sig", errors="replace").read()
                                    payload = json.dumps({"file": f, "code": code}, ensure_ascii=False)
                                    self.wfile.write(f"data: {payload}\n\n".encode())
                                    self.wfile.flush()
                    time.sleep(1.0)
            except Exception:
                pass  # 客户端断开
            return
        # 场景 JSON 保存/加载：/api/scenes 与 /api/scenes/<名字>
        if p == "/api/scenes":
            scenes_dir = os.path.join(ROOT, "scenes")
            os.makedirs(scenes_dir, exist_ok=True)
            self._send_json({"scenes": [f[:-5] for f in os.listdir(scenes_dir) if f.endswith(".json")]})
            return
        if p.startswith("/api/scenes/"):
            name = os.path.basename(p[len("/api/scenes/"):])
            fp = os.path.join(ROOT, "scenes", name + ".json")
            if p.endswith(".json") or True:
                if self.command == "GET":
                    if os.path.isfile(fp):
                        data = open(fp, "r", encoding="utf-8-sig").read()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Content-Length", str(len(data.encode())))
                        self.end_headers()
                        self.wfile.write(data.encode())
                    else:
                        self._send_json({"ok": False, "error": "not found"}, 404)
                    return
        super().do_GET()

    def do_POST(self):
        p = self.path.split("?")[0]
        if p.startswith("/api/scenes/"):
            name = os.path.basename(p[len("/api/scenes/"):])
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            try:
                json.loads(body)  # 校验合法 JSON
                os.makedirs(os.path.join(ROOT, "scenes"), exist_ok=True)
                fp = os.path.join(ROOT, "scenes", name + ".json")
                open(fp, "w", encoding="utf-8").write(body)
                self._send_json({"ok": True, "name": name})
            except ValueError as e:
                self._send_json({"ok": False, "error": "JSON 无效: " + str(e)}, 400)
            return
        self._send_json({"ok": False, "error": "unknown endpoint"}, 404)

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
