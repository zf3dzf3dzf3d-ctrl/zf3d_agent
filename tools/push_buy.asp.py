# -*- coding: utf-8 -*-
# 推送 buy.asp 到服务器 C:\web\buy.asp（base64 分块 + certutil 解码）
import requests, urllib3, base64
urllib3.disable_warnings()

KEY = '__AGENT_API_KEY_ROTATED__'
BASE = 'https://www.zf3d.com/api/agent_api.asp'
PROX = {'http': None, 'https': None}

def runcmd(cmd, timeout=120):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=timeout, proxies=PROX)
    return r.status_code, r.text

def main():
    with open(r'C:\work\web\buy.asp', 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    print('b64 len:', len(b64))

    chunks = [b64[i:i+700] for i in range(0, len(b64), 700)]
    print('chunks:', len(chunks))
    first = True
    for i, ch in enumerate(chunks):
        prefix = '>' if first else '>>'
        code, out = runcmd('cmd /c echo ' + ch + ' ' + prefix + ' C:\\web\\buy.b64')
        ok = '"success":true' in out
        if not ok:
            print(f'chunk {i} FAILED:', out[:200])
            return
        first = False
    print('all chunks written')

    code, out = runcmd('cmd /c certutil -f -decode C:\\web\\buy.b64 C:\\web\\buy_new.asp')
    print('decode:', code, out[:200])
    code, out = runcmd('cmd /c robocopy C:\\web C:\\web buy_new.asp /MOV /R:1 /W:1 >nul & ren C:\\web\\buy.asp buy_old.asp & copy /y C:\\web\\buy_new.asp C:\\web\\buy.asp & del C:\\web\\buy_new.asp C:\\web\\buy.b64 2>nul')
    print('replace:', code, out[:400])

    code, out = runcmd('cmd /c dir C:\\web\\buy.asp && findstr /n "img.zf3d.com/old/Upload/zuopin" C:\\web\\buy.asp')
    print('verify:', code)
    print(out[:800])

    # 预热
    try:
        r = requests.get('https://www.zf3d.com/buy.asp?id=2247', verify=False, timeout=60, proxies=PROX)
        print('warmup:', r.status_code, len(r.text))
        print('has img url:', 'img.zf3d.com/old/Upload/zuopin' in r.text)
    except Exception as e:
        print('warmup err:', e)

if __name__ == '__main__':
    main()
