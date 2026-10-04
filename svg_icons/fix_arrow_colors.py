# -*- coding: utf-8 -*-
# 统一四个粗箭头 ⬆⬇⬅➡ 的配色：全部使用同一蓝色系渐变，
# 旋转角度保持各自方向（➡ 0 / ⬆ -90 / ⬇ 90 / ⬅ 180）。
import io, json, re, sys
sys.stdout.reconfigure(encoding='utf-8')
P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(P, encoding='utf-8').read()
i = s.find('MAP = {'); j = s.find('};', i)
MAP = json.loads(s[i+6:j+1])

HEAD = '<svg class="zf-svg" viewBox="1 1 22 22" width="1.18em" height="1.18em" style="vertical-align:-0.22em" aria-hidden="true">'
ARROW = ('<defs><linearGradient id="gArrowBlue" x1="0" y1="0" x2="0" y2="1">'
         '<stop offset="0" stop-color="#64B5F6"/><stop offset="1" stop-color="#1565C0"/>'
         '</linearGradient></defs>'
         '<g transform="rotate({rot} 12 12)">'
         '<path d="M4 10h11l-3.2-3.2a1.4 1.4 0 012-2l6 6a1.4 1.4 0 010 2l-6 6a1.4 1.4 0 01-2-2L15 13H4a1.4 1.4 0 010-2.8z" '
         'fill="url(#gArrowBlue)"/></g>')
TAIL = '</svg>'

for key, rot in [('➡', 0), ('⬆', -90), ('⬇', 90), ('⬅', 180)]:
    svg = HEAD + ARROW.format(rot=rot) + TAIL
    MAP[key] = svg
    vs = key + '\ufe0f'   # 带 VS16 变体选择符的别名
    if vs in MAP:
        MAP[vs] = svg

new_body = 'MAP = ' + json.dumps(MAP, ensure_ascii=False, separators=(',', ':')) + ';'
s2 = s[:i] + new_body + s[j+1:]
io.open(P, 'w', encoding='utf-8').write(s2)
print('OK, total icons:', len(MAP))
