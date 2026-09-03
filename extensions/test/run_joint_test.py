#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extensions/test/run_joint_test.py - MCP 网关联调脚本（可删）"""
import json, subprocess, threading, time, sys, os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

os.makedirs('private/extensions', exist_ok=True)
conf = {'servers': {
    'local-stdio': {'type': 'stdio', 'command': sys.executable,
                    'args': [os.path.abspath('extensions/test/mcp_test_server.py')]},
    'local-http':  {'type': 'http', 'url': 'http://127.0.0.1:8765'},
}}
with open('private/extensions/mcp_servers.json', 'w', encoding='utf-8') as f:
    json.dump(conf, f, ensure_ascii=False, indent=2)
print('conf written')

p = subprocess.Popen([sys.executable, 'extensions/test/mcp_test_server.py', '--http', '8765'])
time.sleep(1.5)

from extensions import mcp

class FakeHandler:
    def _send_json(self, data, code=200):
        print('[API]', json.dumps(data, ensure_ascii=False)[:400])

h = FakeHandler()
try:
    print('--- test stdio ---'); mcp.handle(h, 'POST', ['test'], {'id': 'local-stdio'})
    print('--- test http ---');  mcp.handle(h, 'POST', ['test'], {'id': 'local-http'})
    print('--- tools ---');      mcp.handle(h, 'GET', ['tools'], {})
    print('--- call stdio add ---');  mcp.handle(h, 'POST', ['call'], {'tool': 'mcp_local-stdio__add', 'arguments': {'a': 3, 'b': 4}})
    print('--- call http echo ---');  mcp.handle(h, 'POST', ['call'], {'server': 'local-http', 'name': 'echo', 'arguments': {'text': '你好朱峰'}})
finally:
    p.terminate()
print('--- JOINT TEST DONE ---')
