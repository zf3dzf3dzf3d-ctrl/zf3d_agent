# -*- coding: utf-8 -*-
# 尝试2：不覆盖旧文件，把新版 sync_api 部署为 sync2_api.asp（新文件，可创建）
# 然后 guanliy.asp 的按钮改为调用 /sync2_api.asp —— 但 guanliy.asp 本身也是旧文件改不了。
# 所以反过来：guanliy.asp 也一样改不了。只能让新接口直接可用，并告诉用户用新地址。
# 先验证：新文件能创建并且 asp 能执行。
import requests, urllib3, base64
urllib3.disable_warnings()
KEY='__AGENT_API_KEY_ROTATED__'
BASE='https://www.zf3d.com/api/agent_api.asp'
PROX={'http':None,'https':None}
def runcmd(c, t=120):
    r=requests.get(BASE,params={'key':KEY,'a':'exec_cmd','cmd':c},verify=False,timeout=t,proxies=PROX)
    return r.status_code, r.text

with open(r'C:\work\web\sync_api.asp','rb') as f:
    b64 = base64.b64encode(f.read()).decode()
chunks=[b64[i:i+700] for i in range(0,len(b64),700)]
first=True
for ch in chunks:
    p='>' if first else '>>'
    c,out=runcmd('cmd /c echo '+ch+' '+p+' C:\\web\\sync2.b64')
    if '"success":true' not in out:
        print('chunk fail', out[:200]); raise SystemExit
    first=False
print('chunks ok')
c,out=runcmd('cmd /c certutil -f -decode C:\\web\\sync2.b64 C:\\web\\sync2_api.asp')
print('decode:', out[:200])
c,out=runcmd('cmd /c del C:\\web\\sync2.b64 & dir C:\\web\\sync2*')
print(out[:400])
