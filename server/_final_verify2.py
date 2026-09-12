# -*- coding: utf-8 -*-
"""终验：语法 + 连续跑同步（带跳过机制），观察能否稳定推进 100+ 条"""
import sys, os, time, sqlite3
sys.stdout.reconfigure(encoding='utf-8')
SRV = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server'
sys.path.insert(0, SRV)
os.chdir(SRV)

import py_compile
py_compile.compile(os.path.join(SRV, 'zf3d_commands.py'), doraise=True)
print('[语法] OK')

from config import DB_PATH

def prog():
    c = sqlite3.connect(DB_PATH, timeout=5)
    r = c.execute("select value from kv_store where key='remote_sync_last_rowid'").fetchone()
    c.close()
    return int(r[0]) if r and r[0] else 0

import zf3d_commands as z
p0 = prog()
t0 = time.time()
for i in range(40):
    z._sync_local_chats()
    p = prog()
    if p >= 39200:
        break
    time.sleep(0.2)
p1 = prog()
dt = time.time() - t0
print('[推进] last_rowid %d -> %d（+%.0f 条，%.1f 秒，%.1f 条/分钟）' % (p0, p1, p1 - p0, dt, (p1 - p0) * 60.0 / dt))
print('[剩余待同步]', max(0, 42960 - p1))
