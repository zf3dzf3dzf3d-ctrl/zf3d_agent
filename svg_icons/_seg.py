# -*- coding: utf-8 -*-
import io
js = io.open('public/js/icons.js', encoding='utf-8').read()
# 找注入/替换逻辑（最后 2000 字符通常是运行时代码）
lines = []
lines.append(repr(js[-2500:]))
io.open('svg_icons/_missing_out.txt', 'w', encoding='utf-8').write('\n'.join(lines))
print('ok')
