# -*- coding: utf-8 -*-
import io, re, os, json, time

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def grep(fn, pat, limit=200):
    if not os.path.exists(fn):
        print('missing ' + fn); return
    L = io.open(fn, encoding='utf-8', errors='replace').read().splitlines()
    P = re.compile(pat)
    print('===== %s (%d lines) pat=%s' % (fn, len(L), pat))
    n = 0
    for i, l in enumerate(L):
        if P.search(l):
            print('%6d: %s' % (i + 1, l.rstrip()[:160]))
            n += 1
            if n > limit: break
    print()

print('### 重启历史（.restart_out.log 全部重启标记行）')
if os.path.exists('.restart_out.log'):
    txt = io.open('.restart_out.log', encoding='utf-8', errors='replace').read().splitlines()
    for l in txt:
        if re.search(r'(无感重启开始|重启成功|重启失败|新后台已拉起|auto=)', l):
            print(l[:160])
print()

print('### combo 状态文件')
if os.path.exists('.combo_state.json'):
    print(io.open('.combo_state.json', encoding='utf-8', errors='replace').read()[:300])
print('now=', time.time())
print()

grep('tray_server.py', r'(watchdog|health|restart|_kill|Popen|sleep|def |interval|INTERVAL)')
