import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\mcr_ctx.txt'
d = io.open(p, 'rb').read().decode('utf-8', 'replace')
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\mcr_ascii.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write(d)
print('ok', len(d))
