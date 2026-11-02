# -*- coding: utf-8 -*-
import sqlite3
c = sqlite3.connect(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\private\zf3d.db')
tables = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
print('tables:', tables)
for t in tables:
    if 'user' in t.lower():
        print(t, 'rows:', c.execute('select count(*) from %s' % t).fetchone()[0])
        print(c.execute('select * from %s limit 3' % t).fetchall())
