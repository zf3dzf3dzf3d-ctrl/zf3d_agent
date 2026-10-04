# -*- coding: utf-8 -*-
import re, io, os, sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0'
s = io.open(os.path.join(ROOT,'public/js/icons.js'), encoding='utf-8').read()
keys = re.findall(r"'([^']+)':", s)
print('MAP_COUNT', len(keys))
print(' '.join(sorted(set(keys))))
print('---SCAN---')
# scan js/html for emojis not in map
emoji_re = re.compile('[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u2190-\u21FF\u2934\u2935\u3030\u303D\u3297\u3299]')
have = set(keys)
found = {}
for dirpath, dirs, files in os.walk(os.path.join(ROOT,'public')):
    dirs[:] = [d for d in dirs if d not in ('node_modules','.git')]
    for f in files:
        if not f.endswith(('.html','.js','.css')): continue
        p = os.path.join(dirpath,f)
        if 'icons.js' in p: continue
        try: t = io.open(p, encoding='utf-8', errors='ignore').read()
        except: continue
        for e in set(emoji_re.findall(t)):
            if e == '\ufe0f': continue
            if e not in have:
                found.setdefault(e, []).append(os.path.relpath(p, ROOT))
for e, ps in sorted(found.items(), key=lambda x:-len(x[1])):
    print(repr(e), 'U+%04X'%ord(e), len(ps), ps[0], '|', ps[1] if len(ps)>1 else '')
