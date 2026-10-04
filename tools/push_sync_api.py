# -*- coding: utf-8 -*-
"""
push_sync_api.py v2 —— 防回档安全版
原则:
1. 本地是开发主战场, gitee 只做备份: 只 push, 绝不自动 merge 远端。
2. 若确需同步远端, 只允许快进 (ff-only), 且必须在凌晨同步时间窗内 (02:00-05:00)。
3. 每次远端分叉/合并都会打 tag 标记, 方便日后排查。
"""
import requests, urllib3, datetime
urllib3.disable_warnings()
KEY='__AGENT_API_KEY_ROTATED__'
BASE='https://www.zf3d.com/api/agent_api.asp'
PROX={'http':None,'https':None}

def cmd(c, t=180):
    r=requests.get(BASE,params={'key':KEY,'a':'exec_cmd','cmd':c},verify=False,timeout=t,proxies=PROX)
    return r.status_code, r.text

G='"C:\\Program Files\\Git\\cmd\\git.exe"'
now = datetime.datetime.now()

# 措施4: 同步时间窗, 白天人工工作时段禁止任何自动 merge/reset (02:00-05:00 之外一律拒绝)
IN_WINDOW = 2 <= now.hour < 5

# 措施2: fetch 远端, 先比对方向, 只 push 不 merge
fetch = ('set GIT_TERMINAL_PROMPT=0&& set GCM_INTERACTIVE=never&& '
         '%s -C C:\\web -c safe.directory=* -c credential.helper= fetch '
         'https://zf3d:a556ab9a1018c89ff28ee467855a0ed0@gitee.com/zf3d/zf3d_web.git main') % G
print('FETCH:', cmd('cmd /c ' + fetch, 240))

# 检查方向: ahead=本地领先, behind=远端领先
cnt = ('%s -C C:\\web rev-list --left-right --count main...FETCH_HEAD' % G)
sc, out = cmd('cmd /c ' + cnt)
print('COUNT:', sc, out)
try:
    ahead, behind = [int(x) for x in out.strip().split()[:2]] if sc==200 else (0,0)
except Exception:
    ahead, behind = 0, 0

if ahead > 0:
    print('PUSH:', cmd('cmd /c %s -C C:\\web push origin main' % G, 240))  # 只备份本地到远端

if behind > 0:
    # 措施5: 打标记记录这次远端分叉
    tag = 'auto-diverge-%s' % now.strftime('%Y%m%d-%H%M%S')
    cmd('cmd /c %s -C C:\\web tag %s FETCH_HEAD' % (G, tag))
    print('TAGGED:', tag, '(远端有 %d 个本地没有的提交, 已打标记)' % behind)
    if IN_WINDOW:
        # 即使在时间窗内也只允许快进, 分叉时绝不合并
        print('FF-ONLY:', cmd('cmd /c %s -C C:\\web merge --ff-only FETCH_HEAD' % G, 240))
    else:
        print('SKIP-MERGE: 不在同步时间窗(02:00-05:00), 拒绝自动合并, 请人工检查 git log FETCH_HEAD')

print('CHECK:', cmd('cmd /c findstr /i logFile C:\\web\\sync_api.asp'))
r = requests.get('https://www.zf3d.com/sync_api.asp?key=zf3d-sync-2026', verify=False, timeout=60, proxies=PROX)
print('SYNC API:', r.status_code, r.text[:500])
