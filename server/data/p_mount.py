# -*- coding: utf-8 -*-
"""最终定位：#modelConfigPanel 在 index.html 的原生位置、以及谁把它搬进设置弹窗。"""
import re, os
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.6.0'
P = lambda *a: os.path.join(ROOT, *a)
rd = lambda fp: open(fp, encoding='utf-8', errors='replace').read()

idx = rd(P('public', 'index.html'))
print('=== index.html 中 modelConfigPanel 出现行 ===')
for i, line in enumerate(idx.splitlines(), 1):
    if 'modelConfigPanel' in line:
        print('  L%-5d %s' % (i, ' '.join(line.split())[:180]))

print('')
print('=== JS 里搬运/挂载 modelConfigPanel 的代码 ===')
for f in sorted(os.listdir(P('public', 'js'))):
    if not f.endswith('.js'):
        continue
    c = rd(P('public', 'js', f))
    if 'modelConfigPanel' not in c:
        continue
    for mm in re.finditer(r'[^\n]{0,150}modelConfigPanel[^\n]{0,150}', c):
        seg = ' '.join(mm.group(0).split())
        print('  %-26s | %s' % (f, seg[:240]))

print('')
print('=== #modelConfigPanel 自身样式（model-config-types.css 前 60 行相关）===')
mc = rd(P('public', 'css', 'model-config-types.css'))
for mm in re.finditer(r'([^{}]{0,120}#modelConfigPanel[^{}]{0,80})\{([^{}]{0,200})\}', mc, re.S):
    s = ' '.join(mm.group(1).split())
    b = ' '.join(mm.group(2).split())
    if 'background' in b:
        print('  %s => %s' % (s[-100:], b[:150]))
