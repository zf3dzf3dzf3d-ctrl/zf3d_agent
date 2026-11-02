import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = json.load(open('public/canvas/进化树/maps/_emergence.emergence.tree.json', encoding='utf-8'))
def cnt(l): return sum(1 + cnt(n.get('children')) for n in (l or []))
print('ROOTS_NODE_COUNT =', cnt(d['roots']))
