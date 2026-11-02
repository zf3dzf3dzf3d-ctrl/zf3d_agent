# -*- coding: utf-8 -*-
import sqlite3, sys
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\server')
import zf_identity as z
import urllib.request, json

p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\private\zf3d.db'
c = sqlite3.connect(p)
print('5.8 tables:', [r[0] for r in c.execute("select name from sqlite_master where type='table'")])
print('ai_accounts:', c.execute('select count(*) from ai_accounts').fetchone()[0])

# 看 5.7.0 运行中的网关(8574, PID 10992)对应哪个库：它的签名逻辑一样，
# 关键问题：users 表从哪来？查 zf_identity 的 DB 用途
import inspect
src = inspect.getsource(z)
import re
for m in re.finditer(r'zf3d\.db|users', src):
    s = max(0, m.start()-120)
    print('---', src[s:m.end()+120].replace('\n',' | ')[:260])
