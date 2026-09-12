# -*- coding: utf-8 -*-
"""彻底清理残留背景：alpha>140 视为前景，取最大连通域，再以该连通域
的适度膨胀区裁剪原图，重建羽化 alpha。"""
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

im = Image.open('char_cut.png.bak').convert('RGBA')
arr = np.array(im)
solid = arr[:, :, 3] > 140
lbl, n = ndimage.label(solid)
print('components:', n)
sizes = ndimage.sum(solid, lbl, range(1, n + 1))
keep = (sizes.argmax() + 1)
main = lbl == keep
# 轻微膨胀收拢羽化边缘
mask = ndimage.binary_dilation(main, iterations=3)
ys, xs = np.nonzero(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print('crop bbox:', x0, x1, y0, y1)

# 裁剪 RGB 与 alpha（alpha 超过阈值保留原值，边缘按距离羽化）
crop = arr[y0:y1 + 1, x0:x1 + 1].copy()
m = mask[y0:y1 + 1, x0:x1 + 1]
a = crop[:, :, 3].astype(np.float32)
a[~m] = 0
a = ndimage.binary_dilation(main, iterations=1)[y0:y1 + 1, x0:x1 + 1]  # keep core
alpha_img = Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
out = Image.fromarray(crop[:, :, :3]).convert('RGBA')
# 重建 alpha：主体内部用原 alpha，外部 0，边缘平滑
orig_a = crop[:, :, 3].astype(np.int16)
new_a = np.where(m, orig_a, 0).clip(0, 255).astype(np.uint8)
new_a = np.array(Image.fromarray(new_a).filter(ImageFilter.GaussianBlur(0.6)))
out.putalpha(new_a)
out.save('char_cut.png')
print('saved', out.size)
