# -*- coding: utf-8 -*-
import sqlite3, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
db = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\private\db\zf3d_canvas.db'
print('exists', os.path.exists(db))
c = sqlite3.connect(db); cur = c.cursor()
rows = cur.execute("select name from sqlite_master where type='table'").fetchall()
print('tables:', rows)
for t in [r[0] for r in rows]:
    try: print(t, cur.execute('select count(*) from '+t).fetchone()[0])
    except Exception as e: print(t, 'ERR', e)
cols = [r[1] for r in cur.execute('pragma table_info(capability)')]
print('cap cols:', cols)
sel = ','.join([x for x in ['id','subject_type','subject_id','text','kind','status','clarity','parent_id'] if x in cols])
for row in cur.execute(f'select {sel} from capability order by id'):
    print(row)
