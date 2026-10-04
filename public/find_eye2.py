import io, re
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()
i = s.find('\U0001F441')
seg = s[i-10:i+80]
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\eye_seg.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write(repr(seg))
# also try replacement with simpler approach: locate '"👁":"' then closing '")' pattern
print('ok', repr(seg)[:80])
