import io
a = io.open(r'C:\Program Files\朱峰智能体无限\public\js\model-config-rewrite.js', encoding='utf-8').read()
b = io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js', encoding='utf-8').read()
info = 'lenA=%d lenB=%d a_up=%d a_b06=%d b_has_visible_btn=%s' % (len(a), len(b), a.count('\u2191'), a.count('\u2B06'), 'data-act="visible"' in a)
io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\cmp.txt', 'w', encoding='ascii', errors='backslashreplace').write(info)
print('written')
