import json
d = json.load(open(r'public/canvas/进化树/maps/_emergence.emergence.tree.json', encoding='utf-8'))
ns = []
def walk(o):
    if isinstance(o, dict):
        if 'id' in o and 'x' in o:
            ns.append(o)
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)
walk(d)
p = [n for n in ns if n.get('x') is not None]
print('total', len(ns), 'pinned', len(p))
# 模拟新判定
if p and len(p) < len(ns) * 0.5:
    print('NEW RULE: stale pins ignored -> nebula layout')
elif p:
    span = max(max(n['x'] for n in p)-min(n['x'] for n in p), max(n['y'] for n in p)-min(n['y'] for n in p))
    print('pins kept, span', span)
