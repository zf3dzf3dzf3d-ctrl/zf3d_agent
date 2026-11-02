# -*- coding: utf-8 -*-
import json, urllib.request, time, socket, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
socket.setdefaulttimeout(45)
def probe(name, url, key=None, model='glm-5.3-flash'):
    body = {'model': model, 'messages': [{'role':'user','content':'reply ok'}], 'stream': False}
    h = {'Content-Type':'application/json'}
    if key: h['Authorization'] = 'Bearer ' + key
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=h)
    t = time.time()
    try:
        r = urllib.request.urlopen(req)
        c = r.read()[:200]
        print(name, 'HTTP', r.status, '%.1fs' % (time.time()-t), c[:150])
    except Exception as e:
        print(name, 'FAIL %.1fs' % (time.time()-t), repr(e)[:200])

probe('zf-relay', 'https://www.zf3d.com/api/zf_models_relay.asp?model=glm-5.3-flash')
# read zhipu key
try:
    raw = json.load(open('private/api_keys.json', encoding='utf-8'))
    kp = None
    for k, v in raw.items():
        if isinstance(v, dict) and 'key' in v:
            if 'CodingPlan' in k or 'zhipu' in k.lower() or '智谱' in k:
                kp = v['key']; print('found key entry:', k, 'len', len(kp or ''))
    if kp:
        probe('bigmodel-direct', 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', kp)
    else:
        print('no zhipu key found; top keys:', list(raw.keys()))
except Exception as e:
    print('keyfile err', repr(e))
