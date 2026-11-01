import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = json.load(open(r'public\canvas\进化树\maps\_emergence.emergence.tree.json', encoding='utf-8'))
c = [0]
def w(n):
    c[0] += 1
    for x in n.get('children', []):
        w(x)
for r in d['roots']:
    w(r)
print('total_nodes =', c[0])
