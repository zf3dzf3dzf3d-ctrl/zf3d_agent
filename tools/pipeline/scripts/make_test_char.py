# -*- coding: utf-8 -*-
"""make_test_char.py - 生成一张测试用卡通角色图(带纯色背景)"""
from PIL import Image, ImageDraw
import os

W, H = 512, 768
img = Image.new("RGB", (W, H), (135, 206, 235))  # 天空蓝背景
d = ImageDraw.Draw(img)
cx = W // 2

# 腿
d.rounded_rectangle([cx-60, 520, cx-15, 700], 20, fill=(60, 60, 90))
d.rounded_rectangle([cx+15, 520, cx+60, 700], 20, fill=(60, 60, 90))
# 身体(躯干)
d.rounded_rectangle([cx-90, 320, cx+90, 560], 40, fill=(230, 90, 80))
# 手臂
d.rounded_rectangle([cx-150, 330, cx-95, 540], 26, fill=(230, 120, 90))
d.rounded_rectangle([cx+95, 330, cx+150, 540], 26, fill=(230, 120, 90))
# 头
d.ellipse([cx-110, 80, cx+110, 330], fill=(255, 220, 185))
# 头发
d.pieslice([cx-115, 60, cx+115, 280], 180, 360, fill=(70, 45, 30))
# 眼睛
d.ellipse([cx-55, 190, cx-25, 230], fill=(40, 40, 40))
d.ellipse([cx+25, 190, cx+55, 230], fill=(40, 40, 40))
# 嘴
d.arc([cx-30, 240, cx+30, 290], 20, 160, fill=(150, 60, 60), width=6)

os.makedirs("assets", exist_ok=True)
img.save("assets/input.png")
print("saved assets/input.png")
