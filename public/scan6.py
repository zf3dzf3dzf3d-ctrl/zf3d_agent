import io, re
s = io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js', encoding='utf-8', errors='ignore').read()
m = re.search(r'data-act="visible".{0,900}', s, re.S)
o = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\vis_ctx.txt'
io.open(o, 'w', encoding='ascii', errors='backslashreplace').write(repr(m.group(0)) if m else 'nf')
print('done')
