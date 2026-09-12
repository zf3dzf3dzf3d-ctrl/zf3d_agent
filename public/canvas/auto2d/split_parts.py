# -*- coding: utf-8 -*-
"""按骨骼锚点把 char_cut.png 拆成六层部件：头/躯干/左臂/右臂/左腿/右腿。
输出 parts/*.png（羽化 alpha）+ parts/parts.json（层级、锚点、包围盒）。
"""
import json, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'char_cut.png')
OUT = os.path.join(HERE, 'parts')
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert('RGBA')
W, H = img.size
rig = json.load(open(os.path.join(HERE, 'rig.json'), encoding='utf-8'))
A = rig['anchors']
P = lambda k: (A[k][0] * W, A[k][1] * H)

REGIONS = {
    'head':  {'pts': [('head', -0.13, -0.10), ('head', 0.13, -0.10),
                      ('head', 0.13, 0.12),  ('head', -0.13, 0.12)], 'feather': 14, 'z': 5},
    'torso': {'pts': [('shoulderL', 0.00, -0.02), ('shoulderR', 0.00, -0.02),
                      ('hip', 0.10, 0.04), ('hip', -0.10, 0.04),
                      ('hip', -0.10, -0.06), ('shoulderL', 0.00, 0.02)], 'feather': 12, 'z': 4},
    'armL':  {'pts': [('shoulderL', -0.05, -0.03), ('shoulderL', 0.03, -0.03),
                      ('handL', 0.04, 0.03), ('handL', -0.05, 0.03)], 'feather': 12, 'z': 6},
    'armR':  {'pts': [('shoulderR', -0.03, -0.03), ('shoulderR', 0.05, -0.03),
                      ('handR', 0.05, 0.03), ('handR', -0.04, 0.03)], 'feather': 12, 'z': 3},
    'legL':  {'pts': [('hip', -0.12, -0.04), ('hip', -0.02, -0.04),
                      ('footL', 0.03, 0.03), ('footL', -0.06, 0.03)], 'feather': 12, 'z': 2},
    'legR':  {'pts': [('hip', 0.02, -0.04), ('hip', 0.12, -0.04),
                      ('footR', 0.06, 0.03), ('footR', -0.03, 0.03)], 'feather': 12, 'z': 1},
}

parts_meta = []
for name, cfg in REGIONS.items():
    pts = []
    for k, dx, dy in cfg['pts']:
        x, y = P(k)
        pts.append((x + dx * W, y + dy * H))
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(pts, fill=255)
    grow = mask.filter(ImageFilter.MaxFilter(15)).filter(
        ImageFilter.GaussianBlur(cfg['feather']))
    part = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    part.paste(img, (0, 0), grow)
    a1 = part.getchannel('A')
    a2 = img.getchannel('A')
    part.putalpha(ImageChops.multiply(a1, a2))
    bbox = part.getbbox()
    part = part.crop(bbox)
    part.save(os.path.join(OUT, f'{name}.png'))
    root = cfg['pts'][0][0]
    parts_meta.append({'name': name, 'file': f'{name}.png', 'z': cfg['z'],
                       'root': A[root], 'bbox': list(bbox),
                       'size': [part.width, part.height]})
    print(f'{name}: bbox={bbox} size={part.size}')

json.dump({'w': W, 'h': H, 'parts': parts_meta},
          open(os.path.join(OUT, 'parts.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('OK ->', OUT)
