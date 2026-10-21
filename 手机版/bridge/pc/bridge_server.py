# -*- coding: utf-8 -*-
"""峰控桥 PC 接收端（手机 Termux 备份上传 / 文件双向共享 / 简单远程命令）

启动：pythonw server/.../pc/bridge_server.py   （默认端口 8765）
接口：
  POST /upload?name=xx   手机上传备份（raw body），存 bridge_store/
  GET  /latest           手机拉回最近一份备份
  GET  /list             列出已备份文件
  GET  /download?name=x  下载指定备份
  POST /cmd  {"cmd":"..."}  受限远程命令（白名单），返回 stdout
"""
import json, os, re, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_store")
os.makedirs(STORE, exist_ok=True)

# 远程命令白名单：峰控手机端只能跑这些前缀的命令
ALLOWED = [
    ("dir ", 60), ("type ", 10), ("tasklist", 15),
    ("python ", 120), ("pip ", 300), ("git ", 120),
    ("tree ", 30), ("systeminfo", 15), ("ipconfig", 10),
    ("netstat", 15),
]

LOCK = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _safe_name(self, name):
        name = os.path.basename(name or "unnamed.bin")
        return re.sub(r'[\\/:*?"<>|]', "_", name)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/list":
            files = sorted(os.listdir(STORE))
            return self._json({"ok": True, "files": files})
        if u.path == "/latest":
            files = sorted(os.listdir(STORE))
            if not files:
                return self._json({"ok": False, "err": "no backups"}, 404)
            name = files[-1]
            with open(os.path.join(STORE, name), "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if u.path == "/download":
            name = self._safe_name(q.get("name", [""])[0])
            p = os.path.join(STORE, name)
            if not os.path.isfile(p):
                return self._json({"ok": False, "err": "not found"}, 404)
            with open(p, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if u.path == "/ping":
            return self._json({"ok": True, "msg": "峰控桥 PC 端在线"})
        self._json({"ok": False, "err": "unknown path"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""
        if u.path == "/upload":
            name = self._safe_name(q.get("name", ["upload_%s.bin" % os.path.getpid()])[0])
            with LOCK:
                with open(os.path.join(STORE, name), "wb") as f:
                    f.write(body)
            return self._json({"ok": True, "saved": name, "size": len(body)})
        if u.path == "/cmd":
            try:
                cmd = json.loads(body.decode("utf-8")).get("cmd", "")
            except Exception:
                return self._json({"ok": False, "err": "bad json"}, 400)
            hit = next((t for p, t in ALLOWED if cmd.startswith(p)), None)
            if hit is None:
                return self._json({"ok": False, "err": "命令不在白名单", "allowed": [p for p, _ in ALLOWED]}, 403)
            try:
                r = subprocess.run(cmd, shell=True, capture_output=True, timeout=hit,
                                   encoding="utf-8", errors="replace", cwd=os.path.dirname(os.path.dirname(os.path.dirname(STORE))))
                return self._json({"ok": True, "code": r.returncode,
                                   "out": (r.stdout or "")[-8000:], "err": (r.stderr or "")[-2000:]})
            except subprocess.TimeoutExpired:
                return self._json({"ok": False, "err": "timeout"}, 504)
        self._json({"ok": False, "err": "unknown path"}, 404)

if __name__ == "__main__":
    port = int(os.environ.get("BRIDGE_PORT", "8765"))
    print(f"峰控桥 PC 端已启动: http://0.0.0.0:{port}  (ping: /ping)")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
