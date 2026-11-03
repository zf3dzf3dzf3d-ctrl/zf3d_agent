import subprocess, json, urllib.request, sys, os, ssl
sys.stdout.reconfigure(encoding='utf-8')
ctx = ssl._create_unverified_context()
_orig = urllib.request.urlopen
def urlopen(req, timeout): return _orig(req, timeout=timeout, context=ctx)

REPO='zf3dzf3dzf3d-ctrl/zf3d_agent'
EXE=r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_打包工具\Output\朱峰智能体无限_5.8.0_安装包_v27_带浏览器.exe'
NAME='朱峰智能体无限_5.8.0_安装包_v27_带浏览器.exe'
from urllib.parse import quote

cred = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
token = [l.split('=',1)[1] for l in cred.splitlines() if l.startswith('password=')][0]
H={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'zf3d'}

req=urllib.request.Request(f'https://api.github.com/repos/{REPO}/releases?per_page=20',headers=H)
rels=json.loads(urlopen(req,60).read())
rel=None
for r in rels:
    if r['tag_name']=='v5.8.0': rel=r; break
if rel is None:
    print('NO RELEASE, tags:', [r['tag_name'] for r in rels]); sys.exit(1)
print('FOUND id=',rel['id'],'draft=',rel['draft'],'assets=',[a['name'] for a in rel['assets']])
if any(a['name']==NAME for a in rel['assets']):
    print('ASSET ALREADY UPLOADED'); sys.exit(0)
up=rel['upload_url'].split('{')[0]
size=os.path.getsize(EXE)
print('uploading',size,'bytes ...')
data=open(EXE,'rb')
req=urllib.request.Request(up+'?name='+quote(NAME),data=data,headers={**H,'Content-Type':'application/octet-stream','Content-Length':str(size)})
a=json.loads(urlopen(req,3600).read())
print('UPLOADED state=',a.get('state'),'size=',a.get('size'))
print('download=',a.get('browser_download_url'))
