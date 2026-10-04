import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p, encoding='utf-8').read()
n1 = s.count('\u2191'); n2 = s.count('\u2193'); n3 = s.count('\u29c9')
s = s.replace('\u2191', '\u2B06').replace('\u2193', '\u2B07').replace('\u29c9', '\U0001F4CB')
# del button uses \xd7 (×) inside data-act="del" button; replace only that occurrence
old_del = 'data-act="del" title="\u5220\u9664\u914d\u7f6e">\xd7</button>'
nd = s.count(old_del)
s = s.replace(old_del, 'data-act="del" title="\u5220\u9664\u914d\u7f6e">\u274C</button>')
# replace inline visible-eye svgs with plain emoji (icons.js will inject pretty svg)
import re
pat = re.compile(r"model\.visible === false\n        \? \\'<svg.*?</svg>\\'\n        : \\'<svg.*?</svg>\\'\)", re.S)
nv = len(pat.findall(s))
s = pat.sub("model.visible === false ? \\'\U0001F6AB\\' : \\'\U0001F441\\')", s)
io.open(p, 'w', encoding='utf-8').write(s)
print('up', n1, 'down', n2, 'copy', n3, 'del', nd, 'visible', nv)
