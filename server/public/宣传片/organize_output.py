# -*- coding: utf-8 -*-
"""整理 output 根目录散落的宣传片图片，按前缀归类到 宣传片_整理/ 子目录"""
import re, os, shutil, sys

root = r'D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output'
dst_root = os.path.join(root, '宣传片_整理')
files = [f for f in os.listdir(root) if f.lower().endswith(('.png', '.webp'))]
print('散图总数:', len(files))

groups = {}
for f in files:
    m = re.match(r'^([A-D]\d+_[^\u4e00-\u9fff]*[\u4e00-\u9fff]+)', f)  # A1_猛拍键盘
    if m:
        key = m.group(1)
    elif f.startswith('s57v2'):
        key = 's57v2_初版分镜'
    elif f.startswith('z-image-turbo'):
        key = 'z-image-turbo_早期测试'
    elif f.startswith('zmei_turnaround'):
        key = 'zmei_转面图'
    elif f.startswith('shot01_blackrose'):
        key = 'shot01_blackrose_首帧'
    elif f.startswith('千问修图'):
        key = '千问修图'
    else:
        key = '未分类'
    groups.setdefault(key, []).append(f)

for key, fs in groups.items():
    dst = os.path.join(dst_root, key)
    os.makedirs(dst, exist_ok=True)
    for f in fs:
        shutil.move(os.path.join(root, f), os.path.join(dst, f))
    print(key, '->', len(fs), '张')

remain = [f for f in os.listdir(root) if f.lower().endswith(('.png', '.webp'))]
print('整理后根目录剩余散图:', len(remain))
