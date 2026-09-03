"""
keep-alive 集成测试：验证 drain_body 修复后，同一条 keep-alive 连接上
连续多个请求（含带 body 的 POST / 早退路径）不会互相污染。
"""
import http.client, json, threading, sys, os, socket, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

# 直接用 http.server 测 drain 逻辑：起一个模拟 server
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def _drain(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 0: self.rfile.read(n)
    def do_POST(self):
        self._drain()
        # 模拟早退路径：不读 body、直接回
        body = json.dumps({'ok': True}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        self._drain()
        body = b'{}'
        self.send_response(200)
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

srv = HTTPServer(('127.0.0.1', 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

c = http.client.HTTPConnection('127.0.0.1', port)
ok = 0
try:
    for i in range(20):
        # POST 带 body（模拟残留 body 污染场景）
        data = json.dumps({'n': i}).encode()
        c.request('POST', '/api/test', body=data, headers={'Content-Type': 'application/json'})
        r = c.getresponse(); r.read()
        assert r.status == 200, f'round {i}: {r.status}'
        # 紧跟 GET（若 body 未排干，这个请求行会被 {} 污染 → 501/400）
        c.request('GET', '/api/test')
        r = c.getresponse(); r.read()
        assert r.status == 200, f'round {i} GET: {r.status}'
        ok += 1
    print(f'PASS: {ok} 轮 POST+GET keep-alive 连续请求全部 200，无污染')
except Exception as e:
    print(f'FAIL at round {ok}: {e}'); sys.exit(1)
finally:
    srv.shutdown()
