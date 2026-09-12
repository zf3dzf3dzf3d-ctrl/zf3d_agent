# -*- coding: utf-8 -*-
"""把抠好的人物水平居中到 768x768 画布、底部贴地(留 2% 边距)，重建 parts.json 锚点坐标体系。
新的全局坐标 = 人物在新画布中的位置。之后 split_parts.py 直接使用新 char_cut.png。"""
from PIL import Image
import numpy as np

im = Image.open('char_cut.png').convert('RGBA')
a = np.array(im)[:, :, 3]
ys, xs = np.nonzero(a > 30)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
im = im.crop((x0, y0, x1 + 1, y1 + 1))
W, H = im.size
print('cropped:', im.size)

CV = 768
canvas = Image.new('RGBA', (CV, CV), (0, 0, 0, 0))
px = (CV - W) // 2                 # 水平居中
py = CV - int(CV * 0.02) - H       # 底部留 2% 贴地
canvas.paste(im, (px, py))
canvas.save('char_cut.png')
print('centered at', px, py, '-> canvas 768x768')
