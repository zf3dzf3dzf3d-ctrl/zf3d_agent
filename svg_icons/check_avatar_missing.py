# -*- coding: utf-8 -*-
import io, re, json
js = io.open('public/js/icons.js', encoding='utf-8').read()
m = re.search(r'var MAP = (\{.*?\});\n', js, re.S)
mapobj = json.loads(m.group(1))
targets = ['🎭','🎩','🎸','🛸','🌟','💎','🍕','🌸','🌊','🏔','💻','🩺','🧭']
lines = []
for e in targets:
    k = e in mapobj
    val = mapobj.get(e, '')[:60] if k else ''
    lines.append('%s inMap=%s svgLen=%d %s' % ('U+%04X'%ord(e), k, len(mapobj.get(e,'')), 'ok' if k and '<svg' in val else 'BAD:'+val))
io.open('svg_icons/_missing_out.txt','w',encoding='utf-8').write('\n'.join(lines))
print('done')
