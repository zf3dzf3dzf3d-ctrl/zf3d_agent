import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
t = json.load(open('public/canvas/进化树/maps/_emergence.emergence.tree.json', encoding='utf-8'))
flat = []
def walk(n):
    flat.append(n)
    for c in n.get('children', []):
        walk(c)
for r in t['roots']:
    walk(r)
print('nodes=%d today(>10-31_0点)= %d roots=%d' % (len(flat), sum(1 for x in flat if x.get('created_at', 0) > 1793356800), len(t['roots'])))
