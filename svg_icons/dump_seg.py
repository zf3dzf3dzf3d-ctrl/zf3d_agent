# -*- coding: utf-8 -*-
import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()
i = s.find(chr(0x1F3A8))
seg = s[i:i+900]
io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\svg_icons\_seg.txt', 'w', encoding='utf-8').write(seg)
print('len', len(seg))
