# -*- coding: utf-8 -*-
import os, hashlib, collections
root = os.path.join('private', '记忆')
h = collections.defaultdict(list); n = 0
for dp, _, fs in os.walk(root):
    for f in fs:
        if f.lower().endswith('.md'):
            p = os.path.join(dp, f); n += 1
            try: h[hashlib.md5(open(p,'rb').read()).hexdigest()].append(p)
            except Exception: pass
dups = [v for v in h.values() if len(v) > 1]
with open('system/trash/20261027/audit_recheck.txt','w',encoding='utf-8') as out:
    out.write('files: %d groups: %d redundant: %d\n' % (n, len(dups), sum(len(v)-1 for v in dups)))
    for v in dups[:10]: out.write(' | '.join(v) + '\n')
