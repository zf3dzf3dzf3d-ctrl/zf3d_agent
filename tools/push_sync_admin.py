# -*- coding: utf-8 -*-
# 部署 sync_admin.asp 到服务器（新文件名，可创建）
import requests, urllib3, base64
urllib3.disable_warnings()
KEY='__AGENT_API_KEY_ROTATED__'
BASE='https://www.zf3d.com/api/agent_api.asp'
PROX={'http':None,'https':None}
def runcmd(c, t=120):
    r=requests.get(BASE,params={'key':KEY,'a':'exec_cmd','cmd':c},verify=False,timeout=t,proxies=PROX)
    return r.status_code, r.text
with open(r'C:\work\web\sync_admin.asp','rb') as f:
    b64=base64.b64encode(f.read()).decode()
chunks=[b64[i:i+700] for i in range(0,len(b64),700)]
first=True
for ch in chunks:
    p='>' if first else '>>'
    c,out=runcmd('cmd /c echo '+ch+' '+p+' C:\\web\\sa.b64')
    if '"success":true' not in out:
        print('chunk fail'); raise SystemExit
    first=False
print('chunks ok')
c,out=runcmd('cmd /c certutil -f -decode C:\\web\\sa.b64 C:\\web\\sync_admin.asp & del C:\\web\\sa.b64')
print(out[:250])
# 实测同步（这次在服务器端触发，会显示 fetch 结果）
r=requests.get('https://www.zf3d.com/sync2_api.asp?key=zf3d-sync-2026', verify=False, timeout=90, proxies=PROX)
print('SYNC2 RESULT:', r.status_code)
print(r.text[:600])
