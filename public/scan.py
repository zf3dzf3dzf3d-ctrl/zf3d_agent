import os, io, sys, glob
os.chdir(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public')
hits = {}
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ('node_modules', 'vendor', 'lib', 'monaco', 'ace', 'codemirror', 'xterm', 'pdfjs')]
    for fn in files:
        if not fn.endswith(('.js', '.html', '.htm', '.css')):
            continue
        p = os.path.join(root, fn)
        try:
            s = io.open(p, encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        for kw in ['已隐藏', '\U0001F441', '\u2B50', '\u2B06', '\u2B07']:
            if kw in s:
                hits.setdefault(p, []).append((hex(ord(kw[0])), s.count(kw)))
lines = [str(len(hits))] + [repr(p) + ' ' + str(kws) for p, kws in hits.items()]
io.open('hits_ascii.txt', 'w', encoding='ascii', errors='backslashreplace').write('\n'.join(lines))
print('done', len(hits))
