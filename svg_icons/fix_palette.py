# -*- coding: utf-8 -*-
import io, shutil

p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()

start = s.find('"🎨"')
assert start > 0, 'palette key not found'
end = s.find('</svg>', start)
assert end > 0
end += len('</svg>')
old = s[start:end]

new_svg = ('"🎨":"<svg class=\\"zf-svg\\" viewBox=\\"1 1 22 22\\" width=\\"1.18em\\" height=\\"1.18em\\" '
 'style=\\"vertical-align:-0.14em\\" aria-hidden=\\"true\\">'
 '<defs><linearGradient id=\\"gPal\\" x1=\\"0\\" y1=\\"0\\" x2=\\"0\\" y2=\\"1\\">'
 '<stop offset=\\"0\\" stop-color=\\"#FFB3D1\\"/><stop offset=\\"1\\" stop-color=\\"#F06292\\"/></linearGradient></defs>'
 '<path d="M12 3c5.2 0 9.5 3.9 9.5 8.8 0 2.9-2.1 4.7-4.4 4.7h-2.3c-1.4 0-2.4 1.4-1.7 2.7.8 1.4-.3 2.8-1.6 2.8C6.2 22 2.5 17.6 2.5 12.6 2.5 7.2 6.8 3 12 3z" fill="url(#gPal)"/>'
 '<circle cx="7.2" cy="9.4" r="1.6" fill="#FFEB3B" stroke="#F9A825" stroke-width=".5"/>'
 '<circle cx="12" cy="7.2" r="1.6" fill="#4FC3F7" stroke="#0288D1" stroke-width=".5"/>'
 '<circle cx="16.8" cy="9.6" r="1.6" fill="#81C784" stroke="#388E3C" stroke-width=".5"/>'
 '<circle cx="6.8" cy="14.6" r="1.6" fill="#FF8A65" stroke="#D84315" stroke-width=".5"/>'
 '</svg>')

shutil.copy(p, p + '.bak')
s2 = s[:start] + new_svg + s[end:]
io.open(p, 'w', encoding='utf-8').write(s2)
print('replaced ok, old len', len(old), '-> new len', len(new_svg))
