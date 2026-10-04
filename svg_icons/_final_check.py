# -*- coding: utf-8 -*-
import io, re, os, collections
d = os.path.dirname(os.path.abspath(__file__))
s = io.open(os.path.join(d, '..', 'public', 'js', 'icons.js'), encoding='utf-8').read()

ids = re.findall(r'id=\\"([^"\\]+)\\"', s)
dups = [k for k, c in collections.Counter(ids).items() if c > 1]
# 找出用 hash 后缀（X+数字）的 key
hash_keys = re.findall(r'\\?"([^"\\]*)\\?"\s*:\s*\\"<svg', s)
fallback = [k for k in hash_keys if not any(c.isalnum() for c in k)]
rep = 'dups=%d %s\nfallback_keys=%d %s' % (len(dups), dups[:8], len(fallback), repr(fallback[:15]))
io.open(os.path.join(d, '_final_check.txt'), 'w', encoding='utf-8').write(rep)
print(rep)
