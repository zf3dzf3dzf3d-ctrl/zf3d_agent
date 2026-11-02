# -*- coding: utf-8 -*-
import re
t = open('public/js/icons.js', encoding='utf-8').read()
# find literal backslash-quote-amp sequences inside values
pat = re.compile(r'&quot;')
hits = [m.start() for m in pat.finditer(t)]
print('quot-entity count:', len(hits))
for h in hits[:3]:
    print(repr(t[max(0,h-300):h+60]))
print('---')
# also check double-backslash sequences
d2 = re.compile(r'\\\\"')
hits2 = [m.start() for m in d2.finditer(t)]
print('double-backslash count:', len(hits2))
for h in hits2[:3]:
    print(repr(t[max(0,h-200):h+80]))
