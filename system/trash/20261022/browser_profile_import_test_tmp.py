# -*- coding: utf-8 -*-
import json, sys, os
sys.path.insert(0, r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server")
import browser_profile_import as m
r = m.list_candidates()
cands = r.get('candidates', [])
tgt = [c for c in cands if '5.6' in c['name']]
print('5.6 units:', len(tgt))
c = tgt[0]
run = m.run_import(c['dir'], profile_path=c['profile_path'])
print('RUN ok=%s added=%s renamed=%s err=%s' % (run.get('ok'), run.get('added'), run.get('renamed'), run.get('err')))
# 验证落地
dst = m._profile_dir(m._project_root())
hits = []
for root, dirs, files in os.walk(dst or '.'):
    for f in files:
        if f in ('Local State', 'Login Data', 'Cookies'):
            hits.append(os.path.relpath(os.path.join(root, f), dst))
print('LANDING files:', len(hits))
for h in hits[:8]:
    print(' -', h)
# 再跑一次验证保守性（全部应变 rename）
run2 = m.run_import(c['dir'], profile_path=c['profile_path'])
print('RERUN ok=%s added=%s renamed=%s（保守性验证）' % (run2.get('ok'), run2.get('added'), run2.get('renamed')))
