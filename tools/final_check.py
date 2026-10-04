# -*- coding: utf-8 -*-
# 最终验证：多个教程页 + 首页
import requests, urllib3
urllib3.disable_warnings()
PROX = {'http': None, 'https': None}

urls = [
    'https://www.zf3d.com/Products.asp?id=103305',
    'https://www.zf3d.com/Products.asp?id=103302',
    'https://www.zf3d.com/Products.asp?id=103300',
    'https://www.zf3d.com/Products.asp?id=102000',
    'https://www.zf3d.com/',
]
ok = True
for u in urls:
    try:
        r = requests.get(u, verify=False, timeout=60, proxies=PROX)
        bad = ('800a0cc1' in r.text) or ('no such column' in r.text)
        status = 'OK' if (r.status_code == 200 and not bad) else 'FAIL'
        if status == 'FAIL':
            ok = False
        print(status, r.status_code, len(r.content), u)
    except Exception as e:
        ok = False
        print('ERR', u, e)
print('ALL OK' if ok else 'SOME FAILED')
