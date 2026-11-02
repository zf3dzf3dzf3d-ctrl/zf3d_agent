# -*- coding: utf-8 -*-
import json, urllib.request, time, socket, ssl
socket.setdefaulttimeout(120)
# 1) 中转线路
body = {'model': 'glm-5.3-flash', 'messages': [{'role':'user','content':'reply ok'}], 'stream': False}
data = json.dumps({'_target_url':'https://zf3d.com/api/zf_models_relay.asp','_body':body,'_headers':{}}).encode()
req = urllib.request.Request('http://127.0.0.1:8570/api/proxy', data=data, headers={'Content-Type':'application/json'})
t = time.time()
try:
    r = urllib.request.urlopen(req)
    print('RELAY HTTP', r.status, '%.1fs' % (time.time()-t), r.read()[:200])
except Exception as e:
    print('RELAY FAIL %.1fs' % (time.time()-t), repr(e)[:200])
# 2) 直连智谱官方（模拟 CodingPlan智谱 线路）
try:
    keys = json.load(open('private/api_keys.json', encoding='utf-8'))
except Exception as e:
    keys = {}
print('keys entries:', len(keys) if isinstance(keys, dict) else '?')
