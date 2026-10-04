# -*- coding: utf-8 -*-
import re, io, os, sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0'
s = io.open(os.path.join(ROOT,'public/js/icons.js'), encoding='utf-8').read()
i = s.find('MAP = {'); j = s.find('};', i)
body = s[i+6:j+1]
import json
MAP = json.loads(body)
have = set(MAP.keys())
print('MAP_COUNT', len(have))
emoji_re = re.compile('[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]')
found = {}
for dirpath, dirs, files in os.walk(os.path.join(ROOT,'public')):
    dirs[:] = [d for d in dirs if d not in ('node_modules','.git')]
    for f in files:
        if not f.endswith(('.html','.js','.css')): continue
        p = os.path.join(dirpath,f)
        if p.endswith('icons.js'): continue
        t = io.open(p, encoding='utf-8', errors='ignore').read()
        # strip svg content to avoid counting? fine
        for e in emoji_re.findall(t):
            if e not in have:
                found[e] = found.get(e,0)+1
missing = sorted(found.items(), key=lambda x:-x[1])
print('MISSING_UNIQUE', len(missing))
for e,c in missing:
    print(e, 'U+%04X'%ord(e), c)
