# -*- coding: utf-8 -*-
# 上传迁移页到服务器并触发执行
import requests, urllib3, base64, time
urllib3.disable_warnings()

KEY = '__AGENT_API_KEY_ROTATED__'
BASE = 'https://www.zf3d.com/api/agent_api.asp'
PROX = {'http': None, 'https': None}

def runcmd(cmd, timeout=120):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=timeout, proxies=PROX)
    return r.status_code, r.text

def main():
    with open(r'C:\work\web\migrate_xinbaidushucai.asp', 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    print('b64 len:', len(b64))

    # write b64 to server file (echo may hit length limit, split into chunks)
    chunks = [b64[i:i+700] for i in range(0, len(b64), 700)]
    first = True
    for ch in chunks:
        prefix = '>' if first else '>>'
        code, out = runcmd('cmd /c echo ' + ch + ' ' + prefix + ' C:\\web\\migrate.b64')
        print('chunk write:', code, ('ok' if '"success":true' in out else out[:200]))
        first = False

    # decode & cleanup
    code, out = runcmd('cmd /c certutil -f -decode C:\\web\\migrate.b64 C:\\web\\migrate_xinbaidushucai.asp && del C:\\web\\migrate.b64')
    print('decode:', code, out[:300])

    # verify file
    code, out = runcmd('cmd /c dir C:\\web\\migrate_xinbaidushucai.asp')
    print('verify:', code)
    print(out[:600])

    # trigger migration via HTTP
    r = requests.get('https://www.zf3d.com/migrate_xinbaidushucai.asp', params={'key': KEY}, verify=False, timeout=120, proxies=PROX)
    print('migrate HTTP', r.status_code)
    print(r.text[:1500])

if __name__ == '__main__':
    main()
