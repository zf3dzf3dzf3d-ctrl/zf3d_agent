import os, io, sys
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\hits_public.txt'
data = io.open(p, encoding='utf-8').read()
out = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\hits_ascii.txt'
io.open(out, 'w', encoding='ascii', errors='backslashreplace').write(data)
print('ok', len(data))
