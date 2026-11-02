# -*- coding: utf-8 -*-
import json, os, time, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
p = 'private/api_keys.json'
st = os.stat(p)
print(p, st.st_size, time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)))
j = json.load(open(p, encoding='utf-8'))
print('top:', list(j.keys()))
meta = j.get('_meta', {})
print('meta:', json.dumps(meta, ensure_ascii=False)[:300])
keys = j.get('keys', {})
print('count:', len(keys))
for k, v in keys.items():
    if isinstance(v, dict):
        print(' ', k, 'keys=', list(v.keys()), 'keylen=', len(str(v.get('key') or '')))
    else:
        print(' ', k, 'len=', len(str(v)), str(v)[:20])
print('---backups---')
for b in glob.glob('private/backups/*')+glob.glob('private/backups/**/*api_keys*', recursive=True):
    if os.path.isfile(b):
        s2 = os.stat(b)
        print(b, s2.st_size, time.strftime('%m-%d %H:%M', time.localtime(s2.st_mtime)))
