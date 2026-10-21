# -*- coding: utf-8 -*-
"""通用拆分器：按行段无改动切分大文件 + 生成 exec 合并门面。
用法：python split_generic.py <相对server路径> <段1起,段1止> <段2起,段2止> ... <门面标题>
行号 1 基，含头不含尾；最后一段止可写 end。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')

rel = sys.argv[1]
facade_title = sys.argv[-1]
seg_args = sys.argv[2:-1]

SRC = os.path.join(SERVER, rel)
base, name = os.path.split(SRC)
stem = os.path.splitext(name)[0]

lines = open(SRC, encoding='utf-8').read().splitlines(keepends=True)
n = len(lines)
print('total', n)

segs = []
for i, a in enumerate(seg_args):
    a, b = a.split(',')
    b = n + 1 if b == 'end' else int(b)
    segs.append(('%s_seg%d' % (stem, i + 1), int(a), b))

HDR = ('# -*- coding: utf-8 -*-\n'
       '# 拆分分段模块：由原 %s 按行段【无改动】切分，由同名门面加载合并。\n' % name)
for nm, a, b in segs:
    body = ''.join(lines[a - 1:b - 1]).replace('\ufeff', '')
    with open(os.path.join(base, nm + '.py'), 'w', encoding='utf-8') as f:
        f.write(HDR + body)
    print(nm, b - a)

facade = '''# -*- coding: utf-8 -*-
"""
%s —— 门面模块（原 %d 行已按行段拆分）

分段模块（按顺序 exec 合并进同一命名空间，语义零变化）：
%s
"""
import os

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), %r)
_NS = {'__name__': __name__, '__file__': _SELF}
_SEGMENTS = (%s)
for _seg in _SEGMENTS:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_p, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _p, 'exec'), _NS)
for _k, _v in _NS.items():
    if not _k.startswith('__'):
        globals()[_k] = _v
''' % (facade_title, n,
       '\n'.join('  %s.py' % nm for nm, _, _ in segs),
       name,
       ', '.join(repr(nm) for nm, _, _ in segs))

# 备份原文件
if not os.path.exists(SRC + '.bak'):
    import shutil
    shutil.copy2(SRC, SRC + '.bak')
with open(SRC, 'w', encoding='utf-8') as f:
    f.write(facade)
print('facade written')
