# -*- coding: utf-8 -*-
# 验证线上 Products 页面是否恢复
import requests, urllib3
urllib3.disable_warnings()
PROX = {'http': None, 'https': None}

r = requests.get('https://www.zf3d.com/Products.asp?id=103305', verify=False, timeout=60, proxies=PROX)
print('HTTP', r.status_code, 'len', len(r.content))
body = r.text
for kw in ['xinbaidushucai', '800a0cc1', '错误', 'no such column']:
    print(repr(kw), 'in page:', kw in body)
# title
i = body.find('<title>')
print('title:', body[i:i+120] if i >= 0 else 'N/A')
