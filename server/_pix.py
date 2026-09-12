# -*- coding: utf-8 -*-
import struct, zlib, sys
p = r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.0/server/browser_plugin/data/shots/default/latest.png'
d = open(p, 'rb').read()
pos = 8; w = h = None; idat = b''; ct = 6
while pos < len(d):
    ln = struct.unpack('>I', d[pos:pos+4])[0]; typ = d[pos+4:pos+8]
    if typ == b'IHDR':
        w, h, bd, ct = struct.unpack('>IIBB', d[pos+8:pos+18])
    if typ == b'IDAT':
        idat += d[pos+8:pos+8+ln]
    pos += 12 + ln
raw = zlib.decompress(idat)
bpp = 4 if ct == 6 else 3
stride = w * bpp
out = bytearray(); prev = bytearray(stride)
for y in range(h):
    f = raw[y*(stride+1)]
    line = bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
    if f == 1:
        for x in range(bpp, stride): line[x] = (line[x] + line[x-bpp]) & 255
    elif f == 2:
        for x in range(stride): line[x] = (line[x] + prev[x]) & 255
    elif f == 3:
        for x in range(stride): line[x] = (line[x] + ((line[x-bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
    elif f == 4:
        for x in range(stride):
            a = line[x-bpp] if x >= bpp else 0; b = prev[x]; c = prev[x-bpp] if x >= bpp else 0
            pa = abs(b-c); pb = abs(a-c); pc = abs(a+b-2*c)
            pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            line[x] = (line[x] + pr) & 255
    out += line; prev = line
def px(x, y):
    o = y*stride + x*bpp
    return tuple(out[o:o+3])
res = []
res.append('%dx%d ct=%d' % (w, h, ct))
res.append('top: %s %s %s' % (px(w//2, 2), px(w//2, 20), px(10, 10)))
res.append('bottom: %s %s %s' % (px(w//2, h-3), px(w//2, h-30), px(10, h-10)))
open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.2.0\server\_pix.txt', 'w').write('\n'.join(res))
print('OK', len(out))
