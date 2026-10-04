import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p, encoding='utf-8').read()
i = s.find('data-act="visible"')
seg = s[i:i+900]
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\seg.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write(repr(seg))
print('ok', i)
