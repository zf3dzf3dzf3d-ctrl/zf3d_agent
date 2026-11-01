# -*- coding: utf-8 -*-
# 全量重导出涌现树（today_only=False），与 DB 一致，防止 render 管线再覆盖回小树
import sys, os, sqlite3, json, time
sys.stdout.reconfigure(encoding='utf-8')
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # server/system -> 项目根
os.chdir(BASE)
DB = 'private/db/zf3d_canvas.db'
c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row
rows = c.execute("select * from capability where subject_id='_emergence'").fetchall()
by_parent = {}
for r in rows:
    n = dict(r)
    n.pop('children', None)
    by_parent.setdefault(n['parent_id'], []).append(n)
def build(pid, depth=0):
    out = []
    for n in sorted(by_parent.get(pid, []), key=lambda x: x['created_at']):
        out.append({**n, 'depth': depth, 'children': build(n['id'], depth + 1)})
    return out
def cnt(nodes):
    return sum(1 + cnt(n['children']) for n in nodes)
tree = {'meta': {'title': '涌现能力树', 'subject_type': 'project', 'subject_id': '_emergence',
                 'created': time.strftime('%Y-%m-%d'), 'today_only': False},
        'roots': build(None), 'links': []}
fp = 'public/canvas/进化树/maps/_emergence.emergence.tree.json'
json.dump(tree, open(fp, 'w', encoding='utf-8'), ensure_ascii=False)
print('WROTE nodes =', cnt(tree['roots']))
# 读回验证
d = json.load(open(fp, encoding='utf-8'))
print('VERIFY nodes =', sum(cnt([r]) for r in d['roots']), 'today_only =', d['meta'].get('today_only'))
