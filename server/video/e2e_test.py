# -*- coding: utf-8 -*-
"""video_edit 智能体工具端到端测试（走 /api/tools/video_edit）"""
import json, urllib.request, os

D = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\video'
URL = 'http://127.0.0.1:8505/api/tools/video_edit'

TESTS = [
    ('info', {'action': 'info', 'file': D + r'\e2e.mp4'}),
    ('analyze', {'action': 'analyze', 'file': D + r'\e2e.mp4', 'compact': True}),
    ('highlight', {'action': 'highlight', 'file': D + r'\e2e.mp4', 'top': 2}),
    ('desilence', {'action': 'desilence', 'file': D + r'\e2e.mp4'}),
    ('cut', {'action': 'cut', 'file': D + r'\e2e.mp4', 'start': 0, 'end': 2}),
]

results = []
for name, p in TESTS:
    req = urllib.request.Request(URL, data=json.dumps(p).encode(),
                                 headers={'Content-Type': 'application/json'})
    r = json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
    out = r.get('output') or r.get('out')
    exists = os.path.exists(out) if out else 'n/a'
    print(name, 'ok=', r.get('ok'), 'file_exists=', exists,
          ('err=' + str(r.get('error')) if not r.get('ok') else ''))
    results.append(bool(r.get('ok')))

print('VIDEO_EDIT_E2E', 'PASS' if all(results) else 'FAIL')

