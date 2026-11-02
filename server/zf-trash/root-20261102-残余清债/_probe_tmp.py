import sqlite3, sys
con = sqlite3.connect(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\data\memory.db')
cur = con.cursor()
cur.execute('select name from _tables')
print(cur.fetchall())
