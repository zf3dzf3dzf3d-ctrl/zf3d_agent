# -*- coding: utf-8 -*-
"""
extensions/ext-demo/api.py - 阶段B 示例扩展后端

验证「文件夹即插件」动态 API 通路：extensions/__init__.py 的
_try_dynamic_api 自动把 /api/ext/ext-demo/<...> 路由到这里，无需注册。

  GET /api/ext/ext-demo/page → 面板 HTML（panel iframe 加载）
  GET /api/ext/ext-demo/ping → {ok, pong}
"""

_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:system-ui;padding:16px;color:#333}
h3{margin:0 0 8px}p{font-size:13px;line-height:1.6}
code{background:#f2f4ff;padding:2px 6px;border-radius:4px}
</style></head><body>
<h3>🧩 扩展示例面板</h3>
<p>这是 <code>extensions/ext-demo/</code> 通过 manifest(type=panel) +
动态 api.py 自动挂载的面板——主程序零改动。</p>
<p>API: <code>GET /api/ext/ext-demo/ping</code></p>
</body></html>"""


def handle(handler, method, tail, body):
    action = tail[0] if isinstance(tail, list) and tail else (tail or '')
    if method == 'GET' and action == 'ping':
        handler._send_json({'ok': True, 'pong': True, 'ext': 'ext-demo'}, 200)
        return True
    if method == 'GET' and action == 'page':
        try:
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/html; charset=utf-8')
            handler.send_header('Content-Length', str(len(_HTML.encode('utf-8'))))
            handler.end_headers()
            handler.wfile.write(_HTML.encode('utf-8'))
        except Exception:
            pass
        return True
    handler._send_json({'ok': False, 'error': 'not found'}, 404)
    return True
