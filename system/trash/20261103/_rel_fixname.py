import subprocess, json, urllib.request, sys, ssl
sys.stdout.reconfigure(encoding='utf-8')
ctx = ssl._create_unverified_context()
_orig = urllib.request.urlopen
def urlopen(req, timeout): return _orig(req, timeout=timeout, context=ctx)
REPO='zf3dzf3dzf3d-ctrl/zf3d_agent'
cred = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
token = [l.split('=',1)[1] for l in cred.splitlines() if l.startswith('password=')][0]
H={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'zf3d'}
rels=json.loads(urlopen(urllib.request.Request(f'https://api.github.com/repos/{REPO}/releases/tags/v5.8.0',headers=H),60).read())
GOOD='zhufeng-agent-5.8.0-installer-v27-with-browser.exe'
for a in rels['assets']:
    print('asset:', a['id'], repr(a['name']), a['size'], a['state'])
    if a['name'] != GOOD:
        body=json.dumps({'name':GOOD}).encode()
        d=json.loads(urlopen(urllib.request.Request(f'https://api.github.com/repos/{REPO}/releases/assets/{a["id"]}',data=body,headers=H,method='PATCH'),60).read())
        print('  renamed ->', d['name'])
print('FINAL url:', rels['html_url'])
