import io, re
out = []
p1 = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p1, encoding='utf-8', errors='ignore').read()
m = re.search(r'data-act="visible".{0,200}', s, re.S)
out.append('VISIBLE >>> ' + repr(m.group(0)) if m else 'not found')
# eye svg in icons.js
p2 = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s2 = io.open(p2, encoding='utf-8').read()
m2 = re.search(r'"(?:\U0001F441)\uFE0F?":"(.*?)",', s2, re.S)
if m2:
    out.append('EYE_SVG >>> ' + repr(m2.group(1))[:1500])
io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\eye_ctx.txt', 'w', encoding='ascii', errors='backslashreplace').write('\n\n'.join(out))
print('done')
