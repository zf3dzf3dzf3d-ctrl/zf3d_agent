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
    'cmd /c icacls C:\\web\\.git',
    'cmd /c icacls C:\\web\\.git\\FETCH_HEAD',
    'cmd /c dir C:\\web\\.git | findstr /i "FETCH HEAD"',
    'cmd /c echo test > C:\\web\\.git\\_perm_test.txt && type C:\\web\\.git\\_perm_test.txt',
]:
    print('==>', c)
    print(cmd(c)[1][:700])
