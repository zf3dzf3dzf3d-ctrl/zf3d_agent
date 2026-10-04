# -*- coding: utf-8 -*-
# 按 buy.asp 的成功手法推送 sync_api.asp：ren 旧文件 -> copy 新文件
import requests, urllib3, base64
urllib3.disable_warnings()

KEY = '__AGENT_API_KEY_ROTATED__'
BASE = 'https://www.zf3d.com/api/agent_api.asp'
PROX = {'http': None, 'https': None}

def runcmd(cmd, timeout=120):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=timeout, proxies=PROX)
    return r.status_code, r.text

def main():
    with open(r'C:\work\web\sync_api.asp', 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    chunks = [b64[i:i+700] for i in range(0, len(b64), 700)]
    print('chunks:', len(chunks))
    first = True
    for i, ch in enumerate(chunks):
        prefix = '>' if first else '>>'
        code, out = runcmd('cmd /c echo ' + ch + ' ' + prefix + ' C:\\web\\sync.b64')
        if '"success":true' not in out:
            print(f'chunk {i} FAILED:', out[:200]); return
        first = False
    print('chunks written')

    code, out = runcmd('cmd /c certutil -f -decode C:\\web\\sync.b64 C:\\web\\sync_new.asp')
    print('decode:', 'OK' if '命令成功完成' in out or 'successfully' in out.lower() else out[:300])

    code, out = runcmd('cmd /c robocopy C:\\web C:\\web sync_new.asp /MOV /R:1 /W:1 >nul & ren C:\\web\\sync_api.asp sync_api_old.asp & copy /y C:\\web\\sync_new.asp C:\\web\\sync_api.asp & del C:\\web\\sync_new.asp C:\\web\\sync.b64 2>nul')
    print('replace:', out[:400])

    code, out = runcmd('cmd /c dir C:\\web\\sync_api.asp & findstr /n "logFile" C:\\web\\sync_api.asp')
    print('verify:', out[:800])

    try:
        r = requests.get('https://www.zf3d.com/sync_api.asp?key=zf3d-sync-2026', verify=False, timeout=90, proxies=PROX)
        print('SYNC API:', r.status_code)
        print(r.text[:600])
    except Exception as e:
        print('sync err:', e)

if __name__ == '__main__':
    main()
