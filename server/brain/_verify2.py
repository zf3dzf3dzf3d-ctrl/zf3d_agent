# -*- coding: utf-8 -*-
import json, urllib.request
url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
key = 'efd7bc0708f24b19aed98d72b83dba83.9X0HnhpubSK6JrI9'
payload = json.dumps({'model': 'glm-5.3-flash', 'messages': [{'role': 'user', 'content': 'hi'}], 'stream': False, 'max_tokens': 10}).encode('utf-8')
req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
try:
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=45) as r:
        print('HTTP', r.status, r.read().decode('utf-8', 'replace')[:500])
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read().decode('utf-8', 'replace')[:500])
except Exception as e:
    print('FAIL:', type(e).__name__, e)
