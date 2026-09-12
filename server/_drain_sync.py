# -*- coding: utf-8 -*-
"""48KB 分包下手动清同步积压，验证能不能过"""
import sys, os, time
sys.stdout.reconfigure(encoding='utf-8')
SRV = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server'
sys.path.insert(0, SRV)
os.chdir(SRV)

from config import DB_PATH
import sqlite3

def progress():
    c = sqlite3.connect(DB_PATH, timeout=5)
    r = c.execute("select value from kv_store where key='remote_sync_last_rowid'").fetchone()
    m = c.execute("select max(rowid) from chat_history where role in ('user','assistant')").fetchone()
    c.close()
    return int(r[0]) if r and r[0] else 0, m[0] or 0

import zf3d_commands as z
for i in range(300):
    before, mx = progress()
    if before >= mx:
        break
    z._sync_local_chats()
    time.sleep(0.3)
    after, _ = progress()
    if after == before:
        print('[卡住] 第%d轮: %d 不再前进' % (i + 1, before))
        break
last, mx = progress()
print('[结果] last=%d max=%d 剩余=%d' % (last, mx, max(0, mx - last)))
