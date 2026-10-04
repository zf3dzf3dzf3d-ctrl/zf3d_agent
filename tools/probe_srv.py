# -*- coding: utf-8 -*-
import requests, urllib3
urllib3.disable_warnings()
KEY='__AGENT_API_KEY_ROTATED__'
BASE='https://www.zf3d.com/api/agent_api.asp'
PROX={'http':None,'https':None}
def cmd(c):
    r=requests.get(BASE,params={'key':KEY,'a':'exec_cmd','cmd':c},verify=False,timeout=120,proxies=PROX)
    return r.status_code, r.text
for c in [
    'cmd /c dir C:\\web\\sync*',
    'cmd /c icacls C:\\web\\sync_api.asp',
    'cmd /c icacls C:\\web\\buy.asp',
]:
    print(c, '=>')
    print(cmd(c)[1][:900])
