import numpy as np
from PIL import Image
im = Image.open('char_raw.png').convert('RGB')
arr = np.array(im)
h, w, _ = arr.shape
print('size', im.size)
for name, (y, x) in {'TL':(2,2),'TR':(2,w-3),'BL':(h-3,2),'BR':(h-3,w-3),'T':(2,w//2),'B':(h-3,w//2)}.items():
    print(name, arr[y, x])
# 背景是否均匀：统计与四角均值的差
bg = arr[::40, ::40].reshape(-1, 3)
print('sample std:', bg.std(axis=0), 'mean:', bg.mean(axis=0))
