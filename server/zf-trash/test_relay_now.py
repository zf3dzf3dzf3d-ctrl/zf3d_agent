# -*- coding: utf-8 -*-
import json, urllib.request, time, sys
sys.stdout.reconfigure(encoding='utf-8', errors='ignore')
t0 = time.time()
body = {'_relay': 'zfglm-flash',
        '_body': {'model': 'glm-5.3-flash',
                  'messages': [{'role': 'user', 'content': 'reply ok only'}],
                  'stream': False}}
req = urllib.request.Request('http://127.0.0.1:8570/api/proxy',
                             data=json.dumps(body).encode(),
                             headers={'Content-Type': 'application/json'})
try:
    r = urllib.request.urlopen(req, timeout=60)
    print('HTTP', r.status, '%.1fs' % (time.time()-t0))
    print(r.read().decode('utf-8', 'ignore')[:600])
except Exception as e:
    print('FAIL %.1fs' % (time.time()-t0), repr(e)[:200])
