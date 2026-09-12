#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
最小 MCP 测试 server（仅用于 extensions/mcp.py 联调，可整体删除）

用法：
  stdio 模式:  python mcp_test_server.py
  http  模式:  python mcp_test_server.py --http 8765

实现 MCP 规范最小子集：initialize / tools/list / tools/call
提供两个演示工具：
  - echo    {text}        → 原样返回
  - add     {a, b}        → 数字相加
"""
import sys
import json
from urllib.parse import urlparse, parse_qs

TOOLS = [
    {
        'name': 'echo',
        'description': '原样返回输入文本',
        'inputSchema': {'type': 'object',
                        'properties': {'text': {'type': 'string', 'description': '要回显的文本'}},
                        'required': ['text']},
    },
    {
        'name': 'add',
        'description': '两数相加',
        'inputSchema': {'type': 'object',
                        'properties': {'a': {'type': 'number'}, 'b': {'type': 'number'}},
                        'required': ['a', 'b']},
    },
]


def call_tool(name, args):
    if name == 'echo':
        return {'content': [{'type': 'text', 'text': str(args.get('text', ''))}]}
    if name == 'add':
        return {'content': [{'type': 'text', 'text': str(float(args.get('a', 0)) + float(args.get('b', 0)))}]}
    return {'content': [{'type': 'text', 'text': 'unknown tool: ' + name}], 'isError': True}


def handle(rpc):
    m = rpc.get('method')
    rid = rpc.get('id')
    if m == 'initialize':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {
            'protocolVersion': '2024-11-05',
            'capabilities': {'tools': {}},
            'serverInfo': {'name': 'zf-mcp-test', 'version': '1.0'}}}
    if m == 'tools/list':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'tools': TOOLS}}
    if m == 'tools/call':
        p = rpc.get('params') or {}
        return {'jsonrpc': '2.0', 'id': rid, 'result': call_tool(p.get('name'), p.get('arguments') or {})}
    if rid is not None:
        return {'jsonrpc': '2.0', 'id': rid, 'error': {'code': -32601, 'message': 'method not found: ' + str(m)}}
    return None


def serve_stdio():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        resp = handle(req)
        if resp:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
            sys.stdout.flush()


def serve_http(port):
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class H(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_POST(self):
            n = int(self.headers.get('Content-Length', 0))
            try:
                req = json.loads(self.rfile.read(n).decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_response(400); self._cors(); self.end_headers()
                return
            resp = handle(req)
            body = json.dumps(resp, ensure_ascii=False).encode('utf-8') if resp else b''
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    HTTPServer(('127.0.0.1', int(port)), H).serve_forever()


if __name__ == '__main__':
    if '--http' in sys.argv:
        i = sys.argv.index('--http')
        port = sys.argv[i + 1] if i + 1 < len(sys.argv) else '8765'
        print('[zf-mcp-test] http://127.0.0.1:%s' % port, file=sys.stderr)
        serve_http(port)
    else:
        serve_stdio()
