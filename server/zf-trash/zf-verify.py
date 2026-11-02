# -*- coding: utf-8 -*-
import urllib.request, json, sys, socket
sys.stdout.reconfigure(encoding='utf-8')
# 1) API 恢复验证
try:
    j = json.load(urllib.request.urlopen('http://127.0.0.1:8570/api/models/config', timeout=10))
    ms = j.get('models', [])
    print('API models count:', len(ms))
    print([m.get('name') for m in ms][:10])
except Exception as e:
    print('api err:', e)
# 2) 转圈线路实测：CodingPlan智谱 -> zf relay
try:
    body = json.dumps({"model": "glm-5.3-flash", "messages": [{"role": "user", "content": "回复ok两个字"}], "max_tokens": 16}).encode()
    req = urllib.request.Request('https://www.zf3d.com/api/zf_models_relay.asp?model=glm-5.3-flash',
                                 data=body, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        print('relay status:', r.status)
        print(r.read()[:300].decode('utf-8', 'replace'))
except Exception as e:
    print('relay err:', repr(e))
