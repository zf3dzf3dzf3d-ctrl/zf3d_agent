# -*- coding: utf-8 -*-
"""收尾验证：1) 两个改动文件语法检查 2) 手动跑 _sync_local_chats 清积压 3) 发一次登录态心跳"""
import sys, os, time
sys.stdout.reconfigure(encoding='utf-8')
SRV = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server'
sys.path.insert(0, SRV)
os.chdir(SRV)

import py_compile
for f in ['zf3d_commands.py', 'zf3d_heartbeat.py']:
    try:
        py_compile.compile(os.path.join(SRV, f), doraise=True)
        print('[语法] %s OK' % f)
    except Exception as e:
        print('[语法] %s FAIL: %s' % (f, e))
        sys.exit(1)

from config import DB_PATH
import sqlite3

def progress():
    c = sqlite3.connect(DB_PATH, timeout=5)
    r = c.execute("select value from kv_store where key='remote_sync_last_rowid'").fetchone()
    m = c.execute("select max(rowid) from chat_history where role in ('user','assistant')").fetchone()
    c.close()
    return int(r[0]) if r and r[0] else 0, m[0] or 0

last, mx = progress()
print('[积压] last_rowid=%d max_rowid=%d 待同步=%d 条' % (last, mx, max(0, mx - last)))

import zf3d_commands as z
n = 0
for i in range(60):
    before, _ = progress()
    z._sync_local_chats()
    time.sleep(0.5)
    after, _ = progress()
    if after <= before:
        break
    n += 1
    print('[同步] 第%d轮: %d -> %d' % (n, before, after))
last2, mx2 = progress()
print('[同步完成] last=%d max=%d 剩余=%d' % (last2, mx2, max(0, mx2 - last2)))

import zf3d_heartbeat as h
print('[心跳]', h._send_heartbeat())
