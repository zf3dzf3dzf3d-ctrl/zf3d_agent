# -*- coding: utf-8 -*-
import json, sys
sys.path.insert(0, r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server")
import browser_profile_import as m
r = m.list_candidates()
print(json.dumps(r, ensure_ascii=False)[:2000])
# 再测 5.6.0 的 scan
src = None
for c in r.get('candidates', []):
    if '5.6' in c['name'] or '5.5' in c['name']:
        src = c['dir']; break
if src:
    s = m.scan_import(src)
    print('SCAN', json.dumps(s, ensure_ascii=False)[:1200])
else:
    print('NO_OLD_CAND')
