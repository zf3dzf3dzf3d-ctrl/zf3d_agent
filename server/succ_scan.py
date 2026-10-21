# -*- coding: utf-8 -*-
import io
src = io.open('dispatch_swarm_seg1.py', encoding='utf-8').read()
lines = src.split('\n')
out = io.open('succ_scan.txt', 'w', encoding='utf-8')
for n, l in enumerate(lines, 1):
    if ('_db' in l) or ('TimeoutError' in l) or ('retry' in l.lower()) or ('except' in l):
        out.write('%d: %s\n' % (n, l.strip()[:150]))
out.close()
print('ok')
