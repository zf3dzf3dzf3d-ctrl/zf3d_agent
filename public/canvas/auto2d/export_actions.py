# 导出多个动作 GIF（复用 actions.html 的动作曲线，用 Pillow 合成）
import json, math, os
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
pj = json.load(open(os.path.join(BASE, 'parts', 'parts.json'), encoding='utf-8'))
parts = sorted(pj['parts'], key=lambda p: p['z'])
imgs = {p['name']: Image.open(os.path.join(BASE, 'parts', p['file'])).convert('RGBA') for p in parts}
W = H = 768

def pose_idle(p, t):
    rot = {'head': math.sin(t*3.1)*0.02, 'torso': math.sin(t*2.2)*0.006,
           'armL': math.sin(t*1.6)*0.05, 'armR': -math.sin(t*1.6)*0.05}
    return rot.get(p,0), math.sin(t*1.6)*5, 0, 1+math.sin(t*2.2)*0.006, 0

def pose_walk(p, t):
    w = t*2*math.pi
    rot = {'head': math.sin(w)*0.03, 'torso': math.sin(w*2)*0.01,
           'armL': math.sin(w)*0.35, 'armR': -math.sin(w)*0.35,
           'legL': -math.sin(w)*0.30, 'legR': math.sin(w)*0.30}
    return rot.get(p,0), -abs(math.sin(w))*6, 0, 1, 0

def pose_run(p, t):
    w = t*2*math.pi/0.6
    rot = {'head': math.sin(w)*0.05+0.06, 'torso': 0.06,
           'armL': math.sin(w)*0.7, 'armR': -math.sin(w)*0.7,
           'legL': -math.sin(w)*0.55, 'legR': math.sin(w)*0.55}
    return rot.get(p,0), -abs(math.sin(w))*14, 0, 1, 0

def pose_slash(p, t):
    if t < 0.3: s = -0.9*(t/0.3)
    elif t < 0.5: s = -0.9 + 2.4*((t-0.3)/0.2)
    else: s = 1.5*(1-(t-0.5)/0.3)
    rot = {'head': s*0.15, 'torso': s*0.25, 'armR': s*0.8, 'armL': -s*0.2,
           'legL': -s*0.1, 'legR': s*0.1}
    return rot.get(p,0), abs(s)*4, 0, 1+abs(s)*0.02, 0

def pose_jump(p, t):
    if t < 0.15: c = t/0.15; dy = c*14
    elif t < 0.7: c = 0; dy = -math.sin((t-0.15)/0.55*math.pi)*130
    else: c = 1-(t-0.7)/0.3; dy = c*10
    rot = {'head': -c*0.1, 'torso': c*0.12,
           'armL': -dy*0.004-c*0.3, 'armR': -dy*0.004-c*0.3,
           'legL': c*0.35+(0.25 if dy < -10 else 0), 'legR': c*0.35+(0.25 if dy < -10 else 0)}
    return rot.get(p,0), dy, 0, 1-c*0.03, 0

def pose_die(p, t):
    k = min(t/1.2, 1); e = k*k
    rot = {'head': e*0.9, 'torso': e*1.1, 'armL': e*1.3, 'armR': e*1.2, 'legL': e*0.2, 'legR': e*0.15}
    return rot.get(p,0), e*160, 0, 1, e*1.2

ACTIONS = {'idle': (2.0, pose_idle), 'walk': (1.0, pose_walk), 'run': (1.2, pose_run),
           'slash': (0.8, pose_slash), 'jump': (1.2, pose_jump), 'die': (1.4, pose_die)}

FPS = 12
for name, (dur, fn) in ACTIONS.items():
    n = max(8, int(dur*FPS))
    frames = []
    for i in range(n):
        t = i/FPS if name not in ('idle',) else i/dur*  (dur)  # 简单线性
        t = i * dur / n
        frame = Image.new('RGBA', (W, H), (18, 20, 28, 255))
        # 阴影
        poses = {p['name']: fn(p['name'], t) for p in parts}
        dy0 = list(poses.values())[0][1]
        sh = Image.new('RGBA', (W, H), (0,0,0,0))
        from PIL import ImageDraw
        d = ImageDraw.Draw(sh)
        sc = max(0.4, 1+dy0/200)
        d.ellipse([W/2-110*sc, H*0.965-14*sc, W/2+110*sc, H*0.965+14*sc], fill=(0,0,0,110))
        frame.alpha_composite(sh)
        for p in parts:
            rot, dy, dx, scl, fall = poses[p['name']]
            im = imgs[p['name']]
            rX, rY = p['root'][0]*W+dx, p['root'][1]*H+dy
            rx = p['root'][0]*W - p['bbox'][0]
            ry = p['root'][1]*H - p['bbox'][1]
            part = im.rotate(-math.degrees(rot), center=(rx, ry), resample=Image.BICUBIC)
            if scl != 1 or fall:
                part = part.transform(part.size, Image.AFFINE,
                                      (1/scl, math.sin(fall)*0.2, 0, -math.sin(fall)*0.2, 1/scl, 0),
                                      resample=Image.BICUBIC)
            # 平移 dy：用 offset 粘贴
            frame.alpha_composite(part, (int(dx), int(dy)))
        frames.append(frame.convert('RGB').quantize(colors=128))
    out = os.path.join(BASE, f'action_{name}.gif')
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000/FPS), loop=0)
    print('saved', out, len(frames), 'frames')
print('ALL DONE')
