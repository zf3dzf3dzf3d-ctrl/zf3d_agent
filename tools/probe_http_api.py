# -*- coding: utf-8 -*-
import requests, urllib3
urllib3.disable_warnings()
KEY='__AGENT_API_KEY_ROTATED__'
PROX={'http':None,'https':None}
# http 试试
try:
    r = requests.get('http://www.zf3d.com/api/agent_api.asp', params={'key':KEY,'a':'exec_cmd','cmd':'cmd /c whoami'}, verify=False, timeout=30, proxies=PROX)
    print('HTTP:', r.status_code, r.text[:200])
except Exception as e:
    print('HTTP err:', e)
try:
    r = requests.get('http://zf3d.com/api/agent_api.asp', params={'key':KEY,'a':'exec_cmd','cmd':'cmd /c whoami'}, verify=False, timeout=30, proxies=PROX)
    print('HTTP bare:', r.status_code, r.text[:200])
except Exception as e:
    print('bare err:', e)
