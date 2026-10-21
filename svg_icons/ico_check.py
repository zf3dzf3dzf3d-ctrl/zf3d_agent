# -*- coding: utf-8 -*-
from PIL import Image, IcoImagePlugin
import os
SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'favicon.ico')
ico = IcoImagePlugin.IcoFile(open(SRC, 'rb'))
im = ico.getimage((64, 64)).convert('RGBA')
px = im.load()
out = 'sizes=%s corners=%s center=%s' % (
    sorted(ico.sizes()),
    [px[c][3] for c in [(0, 0), (63, 0), (0, 63), (63, 63)]],
    px[32, 32][3])
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '_ico_check.txt'), 'w').write(out)
