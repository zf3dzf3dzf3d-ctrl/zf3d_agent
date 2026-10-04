import io, re
def ctx(path, kws):
    s = io.open(path, encoding='utf-8', errors='ignore').read()
    lines = []
    for kw in kws:
        for m in re.finditer(re.escape(kw), s):
            a = max(0, m.start() - 60)
            b = min(len(s), m.end() + 60)
            lines.append(path.split('\\')[-1] + ' KW ' + hex(ord(kw[0])) + ' >>> ' + repr(s[a:b]))
    return lines

out = []
p1 = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
out += ctx(p1, ['data-act="visible"', 'data-act="del"'])
p2 = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\panel-models.js'
out += ctx(p2, ['\u2B50', '\U0001F441', 'move-up', 'move-down', '置顶'])
io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\btn_ctx.txt', 'w', encoding='ascii', errors='backslashreplace').write('\n\n'.join(out))
print('done', len(out))
