# -*- coding: utf-8 -*-
# 用朱峰社区 Z 图标(app.ico/_logo_preview.png)生成峰控 App 的全部启动图标
import os, sys
from PIL import Image, ImageDraw, ImageOps
sys.stdout.reconfigure(encoding='utf-8')

root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.5'
src = Image.open(os.path.join(root, 'installer', 'assets', '_logo_preview.png')).convert('RGBA')
print('src size:', src.size)

base = os.path.join(root, 'mobile-app', 'app', 'src', 'main', 'res')

def make_icon(size, safe=0.80):
    """背景沿用原渐变，中间放 Z 图标"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top, bot = (41, 98, 255), (123, 47, 247)
    for y in range(size):
        t = y / size
        c = tuple(int(top[i] + (bot[i]-top[i])*t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))
    inner = int(size * safe)
    logo = src.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    img.alpha_composite(logo, (off, off))
    return img

def make_fore(size):
    """前景：透明底 + 居中 Z 图标（安全区 0.55）"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = int(size * 0.55)
    logo = src.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    img.alpha_composite(logo, (off, off))
    return img

# 背景层沿用原渐变
bg = Image.new('RGB', (432, 432))
d = ImageDraw.Draw(bg)
for y in range(432):
    t = y / 432
    c = (int(41+(123-41)*t), int(98+(47-98)*t), int(255+(247-255)*t))
    d.line([(0, y), (432, y)], fill=c)

sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for name, sz in sizes.items():
    p = os.path.join(base, 'mipmap-' + name)
    os.makedirs(p, exist_ok=True)
    make_icon(sz).save(os.path.join(p, 'ic_launcher.png'))
    make_icon(sz).save(os.path.join(p, 'ic_launcher_round.png'))

fg = os.path.join(base, 'mipmap-xxxhdpi')
make_fore(432).save(os.path.join(fg, 'ic_launcher_foreground.png'))
bg.save(os.path.join(fg, 'ic_launcher_background.png'))
nfg = os.path.join(base, 'mipmap-nodpi')
os.makedirs(nfg, exist_ok=True)
make_fore(432).save(os.path.join(nfg, 'ic_launcher_foreground.png'))
bg.save(os.path.join(nfg, 'ic_launcher_background.png'))
print('ICONS DONE')
