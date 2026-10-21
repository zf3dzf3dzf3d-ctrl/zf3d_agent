# -*- coding: utf-8 -*-
# 用 F:\zf\app标\圆角标_512.png 朱峰图标重新生成峰控 App 全部启动图标
import os, sys
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')
src = Image.open(r'F:\zf\app标\圆角标_512.png').convert('RGBA')
print('src size:', src.size)
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'src', 'main', 'res')

# 圆角标本身已是完整图标（含底色圆角），直接铺满
for name, sz in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    p = os.path.join(base, 'mipmap-' + name)
    os.makedirs(p, exist_ok=True)
    icon = src.resize((sz, sz), Image.LANCZOS)
    icon.save(os.path.join(p, 'ic_launcher.png'))
    icon.save(os.path.join(p, 'ic_launcher_round.png'))

# 自适应图标：前景铺满 432（圆角标自带圆角，安全区放大避免被裁太多）
fore = src.resize((400, 400), Image.LANCZOS)
canvas = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
canvas.alpha_composite(fore, (16, 16))
bg = Image.new('RGBA', (432, 432), (255, 255, 255, 255)).convert('RGB')
for d in ('mipmap-xxxhdpi', 'mipmap-nodpi'):
    p = os.path.join(base, d)
    os.makedirs(p, exist_ok=True)
    canvas.save(os.path.join(p, 'ic_launcher_foreground.png'))
    bg.save(os.path.join(p, 'ic_launcher_background.png'))
print('ICONS DONE')
