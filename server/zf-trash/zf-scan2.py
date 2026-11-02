# -*- coding: utf-8 -*-
import json, os, glob, time, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'zf_models_cache.json'
j = json.load(open(p, encoding='utf-8'))
print(type(j).__name__, list(j.keys())[:15] if isinstance(j, dict) else len(j))
print(json.dumps(j, ensure_ascii=False)[:2500])
print('---backups---')
for b in glob.glob('zf_models_cache*'):
    st = os.stat(b)
    print(b, st.st_size, time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)))
