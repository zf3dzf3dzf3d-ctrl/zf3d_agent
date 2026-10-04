import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p, encoding='utf-8').read()
i = s.find('data-act="visible"')
start = s.find("? \\'<svg", i)
end_marker = "</svg>\\')"
# there are two </svg>')  endings (hidden and visible branches); take second
e1 = s.find(end_marker, start)
e2 = s.find(end_marker, e1 + 1)
end = e2 + len(end_marker)
new_expr = "? \\'\U0001F6AB\\' : \\'\U0001F441\\')"
s = s[:start] + new_expr + s[end:]
io.open(p, 'w', encoding='utf-8').write(s)
print('start', start, 'end', end, 'ok')
