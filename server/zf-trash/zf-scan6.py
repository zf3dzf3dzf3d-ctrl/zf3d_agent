# -*- coding: utf-8 -*-
import json, sys, os, time, glob
sys.stdout.reconfigure(encoding='utf-8')
p = 'public/config/models.json'
if os.path.exists(p):
    st = os.stat(p)
    print(p, st.st_size, time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)))
    j = json.load(open(p, encoding='utf-8-sig'))
    if isinstance(j, dict):
        print('top:', list(j.keys()))
        models = j.get('models') or j.get('items') or []
    else:
        models = j
    print('count:', len(models))
    for m in models[:60]:
        if isinstance(m, dict):
            print(' -', m.get('name'), '|', m.get('type'), '|', str(m.get('baseUrl') or m.get('url') or '')[:60])
else:
    print('missing', p)
print('---backups---')
for b in glob.glob('public/config/models.json*') + glob.glob('**/models.json.bak*', recursive=True):
    if os.path.isfile(b):
        s2 = os.stat(b)
        print(b, s2.st_size, time.strftime('%m-%d %H:%M', time.localtime(s2.st_mtime)))
