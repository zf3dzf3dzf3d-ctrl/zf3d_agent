# -*- coding: utf-8 -*-
import io, re, json
js = io.open('public/js/icons.js', encoding='utf-8').read()
m = re.search(r'var MAP = (\{.*?\});\n', js, re.S)
d = json.loads(m.group(1))
targets = ['🎭','🎩','🎸','🛸','🌟','💎','🍕','🌸','🌊','🏔','💻','🩺','🧭','🐻']
lines = []
for k in targets:
    v = d.get(k, '')
    lines.append('=== U+%04X ===' % ord(k))
    lines.append(repr(v[:160]))
io.open('svg_icons/_missing_out.txt', 'w', encoding='utf-8').write('\n'.join(lines))
print('done')
