# -*- coding: utf-8 -*-
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = json.load(open(r'public/canvas/进化树/maps/_emergence.emergence.tree.json', encoding='utf-8'))
ns = []
def w(r):
    for x in r:
        ns.append(x); w(x.get('children') or [])
w(d['roots'])
has = [n for n in ns if n.get('x') is not None]
print('total', len(ns), 'withXY', len(has))
if has:
    xs = [n['x'] for n in has]; ys = [n['y'] for n in has]
    print('x %.0f~%.0f  y %.0f~%.0f' % (min(xs), max(xs), min(ys), max(ys)))
    span = max(max(xs)-min(xs), max(ys)-min(ys))
    print('span', span)
    nnull = [n for n in ns if n.get('x') is None]
    print('nullXY', len(nnull))
    # 中间层的孩子是否有坐标
    ch = [x for n in ns for x in (n.get('children') or [])]
    print('children-with-xy', sum(1 for c in ch if c.get('x') is not None), '/', len(ch))
