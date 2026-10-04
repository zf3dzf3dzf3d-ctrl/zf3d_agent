import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p, encoding='utf-8').read()
i = s.find('M17.94')
print('idx', i)
seg = s[i-120:i+30]
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\seg2.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write(repr(seg))
print(repr(seg[:50]))
