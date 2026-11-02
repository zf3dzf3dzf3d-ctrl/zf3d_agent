# -*- coding: utf-8 -*-
import sys, hmac, hashlib, json, urllib.request
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\server')
import zf_identity as z
body = json.dumps({'user_id': 69503}).encode()
sig = (z.internal_secret() or '')
req = urllib.request.Request('http://127.0.0.1:8584/internal/issue_identity', data=body,
    headers={'Content-Type': 'application/json', 'X-ZF-Internal': sig})
try:
    print('ISSUE:', urllib.request.urlopen(req, timeout=5).read().decode())
except Exception as e:
    print('ISSUE_ERR:', e, getattr(e, 'read', lambda: b'')())
