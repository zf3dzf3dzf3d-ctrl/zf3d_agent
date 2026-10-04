# -*- coding: utf-8 -*-
"""给 favicon.ico 加圆角透明遮罩（桌面/任务栏图标圆角化）"""
import sys, os
from PIL import Image, ImageDraw, IcoImagePlugin

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'favicon.ico')

ico = IcoImagePlugin.IcoFile(open(SRC, 'rb'))
sizes = ico.sizes()
print('ico frames:', sizes)

def rounded(im, s):
    im = im.convert('RGBA').resize((s, s), Image.LANCZOS)
    mask = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(mask)
    r = max(2, s // 5)  # 圆角半径约 20%
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    im.putalpha(mask)
    return im

out = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
imgs = []
for w, h in sizes:
    frame = ico.getimage((w, h))
    imgs.append(rounded(frame, max(w, h)))
out.save(SRC, format='ICO', sizes=[(s.size[0], s.size[1]) for s in imgs], append_images=imgs)
# Pillow ICO 保存只认一张基准图+sizes，直接用 append 保存
im_all = imgs[-1] if imgs else None
print('done ->', SRC)
