# -*- coding: utf-8 -*-
# 通用文件直推工具：将本地文件 base64 分块推送到服务器（绕过服务器 git 拉取障碍）
# 用法: python push_files.py <本地路径> <服务器路径> [<本地路径2> <服务器路径2> ...]
import requests, urllib3, base64, sys, time
urllib3.disable_warnings()

KEY = '__AGENT_API_KEY_ROTATED__'
BASE = 'https://www.zf3d.com/api/agent_api.asp'
PROX = {'http': None, 'https': None}

def runcmd(cmd, timeout=120):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=timeout, proxies=PROX)
    return r.status_code, r.text

def push_file(local, remote):
    with open(local, 'rb') as f:
        data = f.read()
    print('== push %s (%d bytes) -> %s' % (local, len(data), remote))
    b64 = base64.b64encode(data).decode()
    tmp = 'C:\\\\web\\\\_push.b64'
    runcmd('cmd /c if exist %s del %s' % (tmp, tmp))
    chunks = [b64[i:i+600] for i in range(0, len(b64), 600)]
    print('   chunks:', len(chunks))
    for i, ch in enumerate(chunks):
        code, out = runcmd('cmd /c echo ' + ch + '>>' + tmp)
        if '"success":true' not in out:
            print('   FAIL chunk', i, out[:200]); return False
    bak = remote + '.bak-' + time.strftime('%H%M%S')
    runcmd('cmd /c copy /y "%s" "%s"' % (remote, bak))
    code, out = runcmd('cmd /c certutil -f -decode %s "%s" && del %s' % (tmp, remote, tmp))
    ok = '"success":true' in out
    print('   decode+overwrite:', 'ok' if ok else out[:300])
    # 校验大小
    code, out = runcmd('cmd /c dir "%s"' % remote)
    print('   remote:', out.strip().splitlines()[-1][:120] if out else 'N/A')
    return ok

if __name__ == '__main__':
    pairs = sys.argv[1:]
    if len(pairs) < 2 or len(pairs) % 2 != 0:
        print('usage: python push_files.py <local> <remote> [more pairs...]'); sys.exit(1)
    all_ok = True
    for i in range(0, len(pairs), 2):
        if not push_file(pairs[i], pairs[i+1]):
            all_ok = False
    sys.exit(0 if all_ok else 1)
