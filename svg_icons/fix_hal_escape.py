# -*- coding: utf-8 -*-
# 重写 build_icons_js.py 第88行 HAL SVG 为干净字符串
p = 'svg_icons/build_icons_js.py'
lines = open(p, encoding='utf-8').read().split('\n')
svg = ("<svg class='zf-svg' viewBox='1 1 22 22' width='1.18em' height='1.18em' "
 "style='vertical-align:-0.22em' aria-hidden='true'>"
 "<defs>"
 "<linearGradient id='gHAL_X9001' x1='0' y1='0' x2='0' y2='1'>"
 "<stop offset='0' stop-color='#4A4A52'/><stop offset='1' stop-color='#141418'/></linearGradient>"
 "<radialGradient id='gHALEye_X9001'>"
 "<stop offset='0' stop-color='#FFD0C8'/><stop offset='0.35' stop-color='#FF3B23'/>"
 "<stop offset='1' stop-color='#8E0F04'/></radialGradient></defs>"
 "<rect x='3' y='5.5' width='18' height='13' rx='3.2' fill='url(#gHAL_X9001)' stroke='#000' stroke-opacity='.5' stroke-width='.6'/>"
 "<rect x='4.2' y='6.6' width='15.6' height='1.6' rx='0.8' fill='#fff' opacity='.12'/>"
 "<circle cx='12' cy='12.4' r='4.6' fill='url(#gHALEye_X9001)'/>"
 "<circle cx='12' cy='12.4' r='5.4' fill='none' stroke='#FF5A40' stroke-opacity='.4' stroke-width='.9'/>"
 "<circle cx='10.4' cy='10.8' r='1.1' fill='#fff' opacity='.75'/></svg>")
lines[87] = "mapping[chr(0x1F3AD)] = %r" % svg
open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('rewritten ok')
