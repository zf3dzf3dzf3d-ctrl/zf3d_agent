# -*- coding: utf-8 -*-
import json, os, urllib.request
url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
key = os.environ.get('ZHIPU_API_KEY', '')  # 明文 Key 已移除；请设置环境变量 ZHIPU_API_KEY，并尽快去智谱后台吊销泄露的旧 Key
payload = json.dumps({'model': 'glm-5.3-flash', 'messages': [{'role': 'user', 'content': 'hi'}], 'stream': False, 'max_tokens': 10}).encode('utf-8')
req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
try:
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=45) as r:
        print('HTTP', r.status, r.read().decode('utf-8', 'replace')[:500])
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read().decode('utf-8', 'replace')[:500])
except Exception as e:
    print('FAIL:', type(e).__name__, e)
