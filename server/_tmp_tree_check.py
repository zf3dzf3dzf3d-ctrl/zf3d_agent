import json, sys
sys.stdout.reconfigure(encoding='utf-8')
M = 'public/canvas/进化树/maps/'
def cnt(x):
    if isinstance(x, dict):
        return 1 + sum(cnt(c) for c in x.get('children', []))
    return 0
for n in ['_emergence.emergence.tree.json',
          '_emergence.emergence.tree.json.bak.20261031_小树备份',
          '_emergence_emergence_tree_json.emergence.tree.json',
          'archive_project.tree.1025.json',
          'demo.emergence.tree.json']:
    try:
        d = json.load(open(M + n, encoding='utf-8'))
    except Exception as e:
        print(n, 'ERR', e); continue
    roots = d.get('roots', [])
    total = sum(cnt(r) for r in roots)
    print(n, '| roots=', len(roots), '| total_nodes=', total, '| links=', len(d.get('links', [])), '| meta=', str(d.get('meta'))[:120])
    def walk(x, depth=0):
        if depth > 1: return
        print('   ' * (depth + 1), str(x.get('text'))[:30], x.get('status'))
        for c in x.get('children', []):
            walk(c, depth + 1)
    for r in roots[:2]:
        walk(r)
