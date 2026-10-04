import io, re
s = io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js', encoding='utf-8').read()
lines = []
for kw in ['\U0001F441', '已隐藏', '\u2B50', '\u2191', '\u2193', '\u2934', '\u2935', '\U0001F5CC', '\u2398', '\u29c9', '\u2b06', '\u2b07']:
    for m in re.finditer(re.escape(kw), s):
        a = max(0, m.start() - 80)
        b = min(len(s), m.end() + 80)
        lines.append('KW ' + hex(ord(kw[0])) + ' >>> ' + repr(s[a:b]))
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\mcr_ascii.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write('\n\n'.join(lines))
print('done', len(lines))
