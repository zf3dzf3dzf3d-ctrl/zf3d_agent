# -*- coding: utf-8 -*-
# Step3: 简单骨骼/网格变形信息生成（供前端动画使用）
import os, json
from PIL import Image
import numpy as np

HERE = os.path.dirname(__file__)
im = Image.open(os.path.join(HERE, 'char_cut.png')).convert('RGBA')
arr = np.asarray(im)
a = arr[..., 3]
ys, xs = np.where(a > 20)
info = {
    'w': im.width, 'h': im.height,
    'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
    # 关键锚点比例（默认 humanoid 布局，可后续用 SAM/Skeleton 精修）
    'anchors': {
        'head':  [0.5, 0.12],
        'chest': [0.5, 0.35],
        'hip':   [0.5, 0.58],
        'shoulderL': [0.36, 0.32], 'shoulderR': [0.64, 0.32],
        'handL': [0.30, 0.55], 'handR': [0.70, 0.55],
        'footL': [0.40, 0.96], 'footR': [0.60, 0.96],
    }
}
with open(os.path.join(HERE, 'rig.json'), 'w') as f:
    json.dump(info, f, indent=2)
print('rig.json saved', info['w'], info['h'])
