# -*- coding: utf-8 -*-
src = open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.2.0\public\js\app-minimap.js', encoding='utf-8').read().splitlines()
out = open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.2.0\tools\_scan_out.txt', 'w', encoding='utf-8')
for i, l in enumerate(src):
    if ('_sl.' in l) or ('水位' in l) or ('波浪' in l) or ('水面' in l) or ('气泡' in l) or ('clip' in l) or ('fillRect' in l) or ('waterFill' in l) or ('_sl ' in l):
        out.write('%d: %s\n' % (i+1, l.strip()[:180]))
out.close()
print('done')
