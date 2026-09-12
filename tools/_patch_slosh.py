# -*- coding: utf-8 -*-
import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.2.0\public\js\app-minimap.js'
s = open(p, encoding='utf-8').read()

# 按行号修改（1-based）：462, 463, 487, 631, 632 附近
lines = s.split('\n')
def find(sub, start=0):
    for i in range(start, len(lines)):
        if sub in lines[i]:
            return i
    raise SystemExit('not found: ' + sub)

i1 = find('_sloshDrive)) * 0.0016')
lines[i1] = lines[i1].replace('* 0.0016', '* 0.0024')
i2 = find('* 0.028 - _sl.v * 0.018')
lines[i2] = lines[i2].replace('-_sl.off * 0.028 - _sl.v * 0.018', '-_sl.off * 0.009 - _sl.v * 0.0075')
i3 = find('_bv)) * 0.0012')
lines[i3] = lines[i3].replace('* 0.0012', '* 0.0018')
i4 = find('_sl * bw * 0.35')
lines[i4] = lines[i4].replace('bw * 0.35', 'bw * 0.8')
i5 = find('Math.abs(_sl) * 90')
lines[i5] = lines[i5].replace('Math.min(2.2, Math.abs(_sl) * 90)', 'Math.min(3, Math.abs(_sl) * 160)')

open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('patched lines:', i1+1, i2+1, i3+1, i4+1, i5+1)
