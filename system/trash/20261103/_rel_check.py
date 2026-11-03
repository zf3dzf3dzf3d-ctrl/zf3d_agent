import subprocess, json, urllib.request, sys, os
sys.stdout.reconfigure(encoding='utf-8')
cred = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
token = [l.split('=',1)[1] for l in cred.splitlines() if l.startswith('password=')][0]
req = urllib.request.Request('https://api.github.com/repos/zf3dzf3dzf3d-ctrl/zf3d_agent/releases/tags/v5.8.0', headers={'Authorization':'Bearer '+token,'User-Agent':'zf3d'})
try:
    d = json.loads(urllib.request.urlopen(req, timeout=60).read())
    print('EXISTS id=%d assets=%d' % (d['id'], len(d['assets'])))
    print('url=', d['html_url'])
    with open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\_upload_url.txt','w') as f:
        f.write(d['upload_url'].split('{')[0])
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read()[:300])
