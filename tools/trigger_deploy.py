# -*- coding: utf-8 -*-
import requests, urllib3, json
urllib3.disable_warnings()
PROX = {'http': None, 'https': None}

secret = '3277b70cc5cbcc483e995fe137db44ce28a36b77ec22dd6e0bc9ee1e3d35321a'

# 多种变体试
variants = [
    secret,
    secret.upper(),
    secret + '\r\n',
]
body = {
    "hook_name": "push_hooks",
    "ref": "refs/heads/main",
    "after": "716b9ad",
    "before": "b07658c",
    "event_name": "push",
}
for i, pwd in enumerate(variants):
    body['password'] = pwd
    r = requests.post('https://www.zf3d.com/deploy_webhook.asp', data=json.dumps(body).encode('utf-8'),
                      verify=False, timeout=60, proxies=PROX)
    print(i, r.status_code, r.text[:200])
    if r.status_code == 202:
        break

# 也试 X-Gitee-Event 头方式
headers = {'X-Gitee-Event': 'Push Hook'}
body['password'] = secret
r = requests.post('https://www.zf3d.com/deploy_webhook.asp', data=json.dumps(body).encode('utf-8'),
                  headers=headers, verify=False, timeout=60, proxies=PROX)
print('header way:', r.status_code, r.text[:200])
