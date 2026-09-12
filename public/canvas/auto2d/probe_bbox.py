from PIL import Image
import numpy as np
im = Image.open('char_cut.png').convert('RGBA')
a = np.array(im)
# 检查四角像素颜色（可能是没抠干净的白底/渐晕）
h, w = a.shape[:2]
for name, (y, x) in {'TL':(0,0),'TR':(0,w-1),'BL':(h-1,0),'BR':(h-1,w-1),'top-mid':(2,w//2),'bot-mid':(h-3,w//2)}.items():
    print(name, a[y, x])
# 统计边缘带 alpha
print('edge alpha row0:', a[0, :, 3].max(), 'col0:', a[:, 0, 3].max())
