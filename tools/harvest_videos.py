# -*- coding: utf-8 -*-
"""收割 ComfyUI 产出的视频文件：从 output/video 拷到 promo2/videos 并重命名"""
import os, shutil, glob, re

SRC = r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output\video"
DST = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\promo2\videos"
os.makedirs(DST, exist_ok=True)
n = 0
for f in sorted(glob.glob(os.path.join(SRC, "wan*.*")), key=os.path.getmtime):
    base = os.path.basename(f)
    dst = os.path.join(DST, base)
    if not os.path.exists(dst):
        shutil.copy2(f, dst)
        n += 1
        print("copy", base)
print("total files in dst:", len(glob.glob(os.path.join(DST, "*"))))
