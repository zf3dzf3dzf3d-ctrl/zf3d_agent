# -*- coding: utf-8 -*-
import sqlite3, os, glob, sys
lad = os.path.join(os.environ.get('LOCALAPPDATA',''), '\u6731\u5cf0\u667a\u80fd\u4f53\u65e0\u9650', 'private')
print('LAD:', lad, os.path.exists(lad))
for p in glob.glob(os.path.join(lad, '*.db')):
    c = sqlite3.connect(p)
    t = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
    print(p, '| has users:', 'users' in t, '| tables:', t[:8])
