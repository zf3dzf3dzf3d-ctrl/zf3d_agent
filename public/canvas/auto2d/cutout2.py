# -*- coding: utf-8 -*-
"""按列/行拟合背景渐变并去底：对每一列，用顶部与底部像素线性插值估计背景色，
与背景色距离小于阈值视为背景。然后最大连通域 + 腐蚀羽化。"""
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

im = Image.open('char_raw.png').convert('RGB')
arr = np.asarray(im).astype(np.float32)
h, w, _ = arr.shape

top = arr[0:6].mean(axis=0)      # (w,3)
bot = arr[-6:].mean(axis=0)
v = np.linspace(0, 1, h)[:, None, None]
bg = top[None, :, :] * (1 - v) + bot[None, :, :] * v   # (h,w,3) 渐变背景估计

dist = np.linalg.norm(arr - bg, axis=2)
mask = dist > 35
print('fg px:', int(mask.sum()))
lbl, n = ndimage.label(mask)
if n > 1:
    sizes = ndimage.sum(mask, lbl, range(1, n + 1))
    mask = lbl == (sizes.argmax() + 1)
mask = ndimage.binary_closing(mask, iterations=3)
mask = ndimage.binary_fill_holes(mask)
mask = ndimage.binary_erosion(mask, iterations=1)
alpha = ndimage.gaussian_filter(mask.astype(np.float32), 1.2)
alpha = np.clip(alpha * 255 * 1.4, 0, 255).astype(np.uint8)

out = np.dstack([arr.astype(np.uint8), alpha])
img = Image.fromarray(out, 'RGBA')
ys, xs = np.nonzero(alpha > 40)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
img = img.crop((x0, y0, x1 + 1, y1 + 1))
img.save('char_cut.png')
print('saved', img.size, 'bbox', x0, x1, y0, y1)
