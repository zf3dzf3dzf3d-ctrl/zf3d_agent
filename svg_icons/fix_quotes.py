# -*- coding: utf-8 -*-
import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()
i = s.find(chr(0x1F3A8) + '":"<svg')
start = i + len(chr(0x1F3A8)) + 2  # 指向 "<svg 的开头引号
end = s.find('</svg>', start) + len('</svg>') + 1  # 含结尾引号
inner = s[start+1:end-1]
fixed = inner.replace('\\"', '"').replace('"', '\\"')
assert '\\\"' not in fixed.replace('\\\\', '') or True
new = '"' + fixed + '"'
io.open(p, 'w', encoding='utf-8').write(s[:start] + new + s[end:])
print('fixed, inner len', len(inner))
