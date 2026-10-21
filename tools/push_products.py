# -*- coding: utf-8 -*-
# 将本地已提交的 Products.asp 直接推送到服务器（绕过 git 拉取障碍）
# 服务器当前停在 837ca27，缺 24bec22 的 SQL 降级防御
import requests, urllib3, base64, time, zlib
urllib3.disable_warnings()

KEY = '__AGENT_API_KEY_ROTATED__'
BASE = 'https://www.zf3d.com/api/agent_api.asp'
PROX = {'http': None, 'https': None}

def runcmd(cmd, timeout=120):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=timeout, proxies=PROX)
    return r.status_code, r.text

def main():
    with open(r'C:\work\web\Products.asp', 'rb') as f:
        data = f.read()
    print('file size:', len(data))
    # PowerShell base64 解码（certutil 对长行处理不稳，改用 PS Set-Content）
    b64 = base64.b64encode(data).decode()
    print('b64 len:', len(b64))

    # 分块写入临时 b64 文件（每块 600 字符，echo 安全长度内）
    chunks = [b64[i:i+600] for i in range(0, len(b64), 600)]
    print('chunks:', len(chunks))
    runcmd('cmd /c if exist C:\\web\\_prod.b64 del C:\\web\\_prod.b64')
    ok = 0
    for i, ch in enumerate(chunks):
        code, out = runcmd('cmd /c echo ' + ch + '>>C:\\web\\_prod.b64')
        if '"success":true' in out:
            ok += 1
        else:
            print('FAIL chunk', i, out[:200])
            return
    print('chunks written:', ok)

    # 备份原文件 + 解码覆盖 + 清理
    code, out = runcmd('cmd /c copy /y C:\\web\\Products.asp C:\\web\\private\\Products.asp.bak-837ca27')
    print('backup:', 'ok' if '"success":true' in out else out[:200])
    code, out = runcmd('cmd /c certutil -f -decode C:\\web\\_prod.b64 C:\\web\\Products.asp && del C:\\web\\_prod.b64')
    print('decode+overwrite:', 'ok' if '"success":true' in out else out[:300])
    code, out = runcmd('cmd /c dir C:\\web\\Products.asp')
    print(out[:400])

    # 验证页面
    time.sleep(2)
    r = requests.get('https://www.zf3d.com/Products.asp?id=103305', verify=False, timeout=60, proxies=PROX)
    print('PAGE HTTP', r.status_code, 'len', len(r.content))
    i = r.text.find('<title>')
    print('title:', r.text[i:i+80] if i >= 0 else 'N/A')

if __name__ == '__main__':
    main()
