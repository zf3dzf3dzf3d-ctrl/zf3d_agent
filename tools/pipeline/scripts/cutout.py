# -*- coding: utf-8 -*-
"""步骤1：自动抠背景。rembg 可用时用 AI 模型，否则降级为边缘色差启发式抠图。"""
import sys, os
from PIL import Image
import numpy as np

def rembg_cutout(src, dst):
    from rembg import remove
    img = Image.open(src).convert("RGBA")
    out = remove(img)
    out.save(dst)
    return True

def fallback_cutout(src, dst):
    """降级：假设背景是四角的主色，按颜色距离+连通中心保留主体。"""
    img = Image.open(src).convert("RGB")
    a = np.asarray(img).astype(np.int32)
    h, w, _ = a.shape
    corners = np.concatenate([a[:20,:20].reshape(-1,3), a[:20,-20:].reshape(-1,3),
                              a[-20:,:20].reshape(-1,3), a[-20:,-20:].reshape(-1,3)])
    bg = corners.mean(axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    mask = dist > 60  # 与背景色差异大的算前景
    # 保留最大连通域（简易洪水填充，用 scipy 若无则逐行标记）
    try:
        from scipy import ndimage
        lbl, n = ndimage.label(mask)
        if n > 1:
            sizes = ndimage.sum(mask, lbl, range(1, n + 1))
            mask = lbl == (np.argmax(sizes) + 1)
    except ImportError:
        pass
    alpha = (mask * 255).astype(np.uint8)
    rgba = np.dstack([np.asarray(img), alpha])
    Image.fromarray(rgba, "RGBA").save(dst)
    return True

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "assets/input.png"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dst = os.path.join(root, "output", "cutout.png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        rembg_cutout(src, dst)
        print("rembg OK ->", dst)
    except Exception as e:
        print("rembg failed (%s), using fallback" % e)
        fallback_cutout(src, dst)
        print("fallback OK ->", dst)
