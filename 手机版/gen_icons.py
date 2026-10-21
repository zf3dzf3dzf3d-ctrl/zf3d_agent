# -*- coding: utf-8 -*-
from PIL import Image, ImageDraw
import os

base = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.5\mobile-app\app\src\main\res'

def draw_icon(size, safe=1.0):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top, bot = (41, 98, 255), (123, 47, 247)
    for y in range(size):
        t = y / size
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))
    s = size * safe
    lw = max(2, int(s * 0.07))
    r = s * 0.30
    cx = cy = size / 2
    d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255,255,255,255), width=lw)
    d.ellipse([cx-s*0.10, cy-s*0.10, cx+s*0.10, cy+s*0.10], fill=(255,255,255,255))
    d.line([(cx-r*0.8, cy-r*0.85), (cx-r*1.15, cy-r*1.3)], fill=(255,255,255,255), width=lw)
    d.line([(cx+r*0.8, cy-r*0.85), (cx+r*1.15, cy-r*1.3)], fill=(255,255,255,255), width=lw)
    return img

sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for name, sz in sizes.items():
    p = os.path.join(base, 'mipmap-' + name)
    os.makedirs(p, exist_ok=True)
    draw_icon(sz).save(os.path.join(p, 'ic_launcher.png'))
    draw_icon(sz).save(os.path.join(p, 'ic_launcher_round.png'))

# 自适应图标前景层：108dp 全画布，内容只占中间 1/2（安全区 66dp），缩到任何形状都不缺
def draw_fore(size):
    return draw_icon(size, safe=0.55)

fg = os.path.join(base, 'mipmap-xxxhdpi')
os.makedirs(fg, exist_ok=True)
draw_fore(432).save(os.path.join(fg, 'ic_launcher_foreground.png'))

# 背景层：纯渐变色（用大图存 png 更保险）
bg = Image.new('RGB', (432, 432))
d = ImageDraw.Draw(bg)
for y in range(432):
    t = y / 432
    c = tuple(int((41 + (123-41)*t), ), ) if False else tuple(int(41+(123-41)*t) for _ in (0,)) 
bg2 = Image.new('RGB', (432, 432))
d2 = ImageDraw.Draw(bg2)
for y in range(432):
    t = y / 432
    c = (int(41+(123-41)*t), int(98+(47-98)*t), int(255+(247-255)*t))
    d2.line([(0, y), (432, y)], fill=c)
bg2.save(os.path.join(fg, 'ic_launcher_background.png'))

os.makedirs(os.path.join(base, 'mipmap-anydpi-v26'), exist_ok=True)
with open(os.path.join(base, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
    f.write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
''')
with open(os.path.join(base, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), 'w', encoding='utf-8') as f:
    f.write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
''')
print('ALL DONE')
