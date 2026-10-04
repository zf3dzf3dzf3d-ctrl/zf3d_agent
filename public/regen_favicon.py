# -*- coding: utf-8 -*-
"""重新生成浏览器/托盘图标：圆角蓝色渐变底 + 白色山峰 + 金色太阳"""
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根
S = 256

def make():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角渐变底
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    c1, c2 = (41, 98, 255), (0, 210, 255)
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(c1, c2)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([4, 4, S - 4, S - 4], radius=56, fill=255)
    img.paste(grad, (0, 0), mask)
    # 金色太阳
    d.ellipse([158, 46, 216, 104], fill=(255, 200, 60, 255))
    # 白色双峰山
    d.polygon([(28, 208), (104, 100), (150, 160), (186, 112), (232, 208)], fill=(255, 255, 255, 255))
    return img

img = make()
assets = os.path.join(BASE, "public", "assets")
os.makedirs(assets, exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(assets, "favicon.png"))
img.resize((16, 16), Image.LANCZOS).save(os.path.join(assets, "favicon-16.png"))
img.resize((32, 32), Image.LANCZOS).save(os.path.join(assets, "favicon-32.png"))
img.save(os.path.join(BASE, "public", "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.save(os.path.join(BASE, "public", "favicon_preview.png"))
print("done")
