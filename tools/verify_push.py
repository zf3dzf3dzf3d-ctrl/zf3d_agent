# -*- coding: utf-8 -*-
import requests, urllib3
urllib3.disable_warnings()
KEY = '__AGENT_API_KEY_ROTATED__'
BASE = 'https://www.zf3d.com/api/agent_api.asp'
PROX = {'http': None, 'https': None}

def runcmd(cmd):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=60, proxies=PROX)
    return r.text

print(runcmd('cmd /c dir C:\\web\\api\\community.asp C:\\web\\assets\\js\\api.js'))
r = requests.get('https://www.zf3d.com/api/community.asp', params={'a': 'latest_aigc'}, verify=False, timeout=60, proxies=PROX)
print('latest_aigc HTTP', r.status_code, 'len', len(r.content))
print(r.text[:200])
r2 = requests.get('https://www.zf3d.com/assets/js/api.js', verify=False, timeout=60, proxies=PROX)
print('api.js HTTP', r2.status_code, 'len', len(r2.content), 'has aigc_more:', 'aigc_more' in r2.text)
