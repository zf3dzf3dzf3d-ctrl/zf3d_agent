# -*- coding: utf-8 -*-
import sqlite3, os
for p in [r'E:\work\web\private\zf3d.db']:
    print(p, os.path.isfile(p))
    if os.path.isfile(p):
        c = sqlite3.connect(p)
        t = [r[0] for r in c.execute("select name from sqlite_master where name='users'")]
        print('has users table:', t)
        if t:
            print('user 69503:', c.execute('select user_id,username,token_balance from users where user_id=69503').fetchall())
