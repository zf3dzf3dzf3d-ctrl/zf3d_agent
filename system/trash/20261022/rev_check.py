import re, io, os
p = os.path.join(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0', '手机版/app/src/main/assets/web/index.html')
h = io.open(p, encoding='utf-8').read()
out = []
ok = True
for m in re.finditer(r'<script[^>]*>(.*?)</script>', h, re.S):
    s = m.group(1)
    b = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
    if any(b):
        ok = False
        out.append(str(b))
out.append('balance-ok' if ok else 'BAD')
out.append('fg=%d' % h.count('if(_fg())'))
out.append('hist=%s' % ('var hist=_h;' in h))
out.append('arch=%s' % ('archRegister(fn,fargs,result,ctx' in h))
io.open(r'C:\Users\Public\rev_out.txt', 'w', encoding='utf-8').write('\n'.join(out))
