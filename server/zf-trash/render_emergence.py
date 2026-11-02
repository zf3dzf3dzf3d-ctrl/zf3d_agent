import json, sqlite3, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
DB = 'private/db/zf3d_canvas.db'
SUB = '_emergence'
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT * FROM capability WHERE subject_id=?", (SUB,)).fetchall()
byid = {}
for r in rows:
    byid[r['id']] = dict(id=r['id'], text=r['text'], kind=r['kind'], status=r['status'],
                         icon=r['icon'], clarity=r['clarity'], binds=r['binds'],
                         parent_id=r['parent_id'], children=[])
roots = []
for r in rows:
    n = byid[r['id']]
    if r['parent_id'] and r['parent_id'] in byid:
        byid[r['parent_id']]['children'].append(n)
    else:
        roots.append(n)
try:
    links = [dict(l) for l in conn.execute("SELECT * FROM capability_link WHERE subject_id=?", (SUB,)).fetchall()]
except Exception:
    links = []
root = roots[0] if len(roots) == 1 else {'id': None, 'text': 'ROOT', 'children': roots}
tree = {
    'meta': {'title': '涌现科技总树', 'subject_type': 'project', 'subject_id': SUB, 'total': len(rows), 'created': '2026-10-27'},
    'roots': [root],
    'links': links,
}
out = 'public/canvas/进化树/maps/_emergence.emergence.tree.json'
json.dump(tree, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
def cnt(l): return sum(1 + cnt(n['children']) for n in l)
print('written', out, 'nodes=', cnt([root]))
