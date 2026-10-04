import glob, subprocess, sys, os
from PIL import Image

ico = r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.5.0/public/logo.ico'
im = Image.open(ico)
print('ico sizes:', im.info.get('sizes'))
im.size = (256, 256)
im.load()
im = im.convert('RGBA')

W, H = 55, 58  # Inno 向导右上角小图推荐尺寸
bg = Image.new('RGB', (W, H), (255, 255, 255))
s = min((W-8)/im.width, (H-8)/im.height)
r = im.resize((max(1,int(im.width*s)), max(1,int(im.height*s))), Image.LANCZOS)
bg.paste(r, ((W-r.width)//2, (H-r.height)//2), r)

targets = glob.glob(r'F:/朱峰社区智能体无限_新版本/**/assets/wizard_small.bmp', recursive=True)
for out in targets:
    with open(out, 'wb') as f:
        bg.save(f, 'BMP')
    print('saved', out, Image.open(out).size)

iss = r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_打包工具/朱峰智能体.iss'
p = subprocess.run([r'F:/zf/tools/InnoSetup/ISCC.exe', iss], capture_output=True, text=True)
out = (p.stdout or '') + (p.stderr or '')
tail = [l for l in out.splitlines() if 'error' in l.lower() or '成功' in l or 'Output' in l or '输出' in l]
print('ISCC exit', p.returncode)
print('\n'.join(tail[-8:]))
