# -*- coding: utf-8 -*-
import io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
os.chdir(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
ls = open('public/canvas/进化树/viewer.html', encoding='utf-8').read().splitlines()
out = '\n'.join('%d: %s' % (i + 861, l[:200]) for i, l in enumerate(ls[860:942]))
open('server/system/tmpout.txt', 'w', encoding='utf-8').write(out)
print('ok', len(ls))
