import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p, encoding='utf-8').read()
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\tail.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write(repr(s[-400:]))
print('len', len(s))
