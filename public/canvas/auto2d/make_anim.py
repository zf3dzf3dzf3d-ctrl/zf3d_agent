# -*- coding: utf-8 -*-
"""Step4-5: 离线渲染待机动画 GIF + 横向精灵表(sprite sheet)。"""
import os, json, math
from PIL import Image

base = os.path.dirname(os.path.abspath(__file__))
parts = json.load(open(os.path.join(base, 'parts', 'parts.json'), encoding='utf-8'))['parts']
rig = json.load(open(os.path.join(base, 'rig.json'), encoding='utf-8'))
W = H = rig['w']

imgs = {p['name']: Image.open(os.path.join(base, 'parts', p['file'])).convert('RGBA') for p in parts}
parts_sorted = sorted(parts, key=lambda p: p['z'])
hipX, hipY = 0.5 * W, rig['anchors']['hip'][1] * H

def render(t):
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bob = math.sin(t * 1.6) * 5
    breathe = 1 + math.sin(t * 2.2) * 0.006
    sway = {
        'head': math.sin(t * 1.6 + 0.4) * 0.02,
        'torso': math.sin(t * 2.2) * 0.006,
        'armL': math.sin(t * 1.6) * 0.05,
        'armR': -math.sin(t * 1.6) * 0.05,
        'legL': math.sin(t * 1.2) * 0.015,
        'legR': -math.sin(t * 1.2) * 0.015,
    }
    for p in parts_sorted:
        im = imgs[p['name']]
        rot = sway.get(p['name'], 0.0)
        rx = p['root'][0] * W - p['bbox'][0]
        ry = p['root'][1] * H - p['bbox'][1]
        # 以 hip 为轴整体变换
        f = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        f.paste(im, (p['bbox'][0], p['bbox'][1]), im)
        f = f.rotate(math.degrees(rot), center=(rx, ry), resample=Image.BICUBIC)
        # breathe 缩放(以hip为轴)
        f = f.transform((W, H), Image.AFFINE,
                        (1 / breathe, 0, hipX - hipX / breathe,
                         0, 1 / (2 - breathe), hipY - hipY / (2 - breathe)),
                        resample=Image.BICUBIC)
        # bob 位移
        f = f.transform((W, H), Image.AFFINE, (1, 0, 0, 0, 1, -bob), resample=Image.BICUBIC)
        frame.alpha_composite(f)
    return frame

N = 24
frames = [render(i / N * math.pi * 2 / 1.6) for i in range(N)]
gif = os.path.join(base, 'idle.gif')
frames[0].save(gif, save_all=True, append_images=frames[1:], duration=1000 // 30, loop=0)
print('saved', gif)

# 精灵表
sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * W, 0))
sp = os.path.join(base, 'sprite_sheet.png')
sheet.save(sp)
print('saved', sp, sheet.size)
