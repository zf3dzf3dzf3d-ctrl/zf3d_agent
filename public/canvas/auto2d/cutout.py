# -*- coding: utf-8 -*-
"""Step2: 自动抠背景去底。白底阈值法(适配白底立绘) + 可选 rembg。"""
import os, sys
from PIL import Image, ImageFilter
import numpy as np

SRC = os.path.join(os.path.dirname(__file__), 'char_raw.png')
DST = os.path.join(os.path.dirname(__file__), 'char_cut.png')

im = Image.open(SRC).convert('RGB')
arr = np.asarray(im).astype(np.int16)

# rembg 仅在显式开启时使用（AUTO2D_REMBG=1），默认跳过以免首次下载模型卡住
if os.environ.get('AUTO2D_REMBG'):
    rgba = None
    try:
        from rembg import remove
        rgba = remove(im)
        print('used rembg')
    except Exception as e:
        print('rembg unavailable (%s), use white-threshold' % e)
        rgba = None
    if rgba is not None:
        bbox = rgba.getbbox()
        rgba.crop(bbox).save(DST)
        print('saved', DST, rgba.size)
        sys.exit(0)
else:
    rgba = None
if rgba is None:
    # 白色距离：与(255,255,255)的最大通道差
    diff = 255 - arr.min(axis=2)  # 越白越接近0
    mask = diff > 40  # 非白像素保留
    # 连通域只保留最大前景，去噪点
    try:
        from scipy import ndimage
        lbl, n = ndimage.label(mask)
        if n > 1:
            sizes = ndimage.sum(mask, lbl, range(1, n + 1))
            mask = lbl == (sizes.argmax() + 1)
    except ImportError:
        pass
    # 轻微腐蚀+羽化边缘
    try:
        from scipy import ndimage
        mask = ndimage.binary_erosion(mask, iterations=2)
        mask = ndimage.binary_dilation(mask, iterations=2)
    except ImportError:
        pass
    alpha = (mask * 255).astype(np.uint8)
    a = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0))
    rgba = im.convert('RGBA')
    rgba.putalpha(a)

# 裁剪到内容包围盒
bbox = rgba.getbbox()
rgba = rgba.crop(bbox)
rgba.save(DST)
print('saved', DST, rgba.size)
