# -*- coding: utf-8 -*-
import urllib.request, os
base = os.path.dirname(os.path.abspath(__file__))
url = 'https://image.pollinations.ai/prompt/2D%20game%20character%20sprite%2C%20full%20body%2C%20standing%20idle%20pose%2C%20T-pose-like%20relaxed%20stance%2C%20cute%20fantasy%20knight%20with%20silver%20armor%20and%20blue%20cape%2C%20flat%20cel-shaded%20style%2C%20clean%20solid%20white%20background%2C%20front%20view%2C%20high%20detail%2C%20centered?width=1024&height=1024&nologo=true'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
data = urllib.request.urlopen(req, timeout=120).read()
p = os.path.join(base, 'char_raw.png')
with open(p, 'wb') as f:
    f.write(data)
print('saved', p, len(data))
from PIL import Image
im = Image.open(p)
print(im.size, im.mode)
