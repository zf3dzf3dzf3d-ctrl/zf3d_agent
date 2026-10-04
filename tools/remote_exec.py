# -*- coding: utf-8 -*-
# 远程执行：全参数走 GET QueryString
import sys, requests, urllib3
urllib3.disable_warnings()

BASE = 'http://8.138.95.7/api/agent_api.asp'
KEY = '__AGENT_API_KEY_ROTATED__'

def runcmd(cmd, timeout=90):
    r = requests.get(BASE, params={'key': KEY, 'a': 'exec_cmd', 'cmd': cmd}, verify=False, timeout=timeout, proxies={'http': None, 'https': None})
    return r.status_code, r.text

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'ver'
    code, out = runcmd(cmd)
    print('HTTP', code)
    print(out[:3000])

