# -*- coding: utf-8 -*-
"""db 拆库路由回归（工程基建总纲 P2.1 核心资产安全网 20261123）。

钉死 db.py 的分离化契约（2026-11-12 收口）：
  1) 裸表名路由：经 _new_split_conn 写 kv_store（非 chat 域）必须物理落在
     apps 分库，chat 主库不得出现该表（temp->main->attached 解析顺序）；
  2) chat 域裸表名（sessions）照常走 main；
  3) _sweep_misplaced_tables：chat 库中的错位表整表搬回目标分库并 DROP，
     目标已有时合并增量；sweep 后裸表名直达分库。

测试全程用临时目录的 5 个新鲜库文件，db/config 全局打补丁并在 finally 还原，
绝不触碰生产数据库。
"""
import os
import shutil
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import config  # noqa: E402
import db      # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


def tables_of(path):
    c = sqlite3.connect(path)
    ts = [r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    c.close()
    return ts


tmp = tempfile.mkdtemp(prefix='zf_dbtest_')
paths = {a: os.path.join(tmp, a + '.db') for a in ('chat', 'apps', 'roles', 'projects', 'system')}
for pth in paths.values():
    sqlite3.connect(pth).close()
c = sqlite3.connect(paths['chat'])
c.execute('CREATE TABLE sessions(id TEXT)')
c.commit()
c.close()
c = sqlite3.connect(paths['apps'])
c.execute('CREATE TABLE kv_store(k TEXT, v TEXT)')
c.commit()
c.close()

# 静态一致性：TABLE_DB_MAP 与 TABLE_ALIAS_MAP 互恰（生产映射健康度）
try:
    bad = [t for t in config.TABLE_DB_MAP
           if config.TABLE_DB_MAP[t] != config.DB_ATTACH_MAP.get(config.TABLE_ALIAS_MAP.get(t))]
    check('生产映射互恰', not bad, 'bad=%s' % bad[:3])
except Exception as e:
    check('生产映射互恰', False, repr(e))

# 双侧补丁（db 全局 + config 全局）并在 finally 还原
# 注意：_new_split_conn 在函数体内 `from config import DB_CHAT_PATH`（延迟导入读
# config 属性），所以 config.DB_CHAT_PATH 也必须补丁——否则主连接会连到生产对话库
# （20261123 首跑即因此误写生产库一行，已清除；本补丁顺序为永久防线）。
orig = (dict(db.DB_ATTACH_MAP), db.DB_PATH, dict(config.DB_ATTACH_MAP),
        dict(config.TABLE_ALIAS_MAP), config.DB_PATH, config.DB_CHAT_PATH)
db.DB_ATTACH_MAP = dict(paths)
config.DB_ATTACH_MAP = dict(paths)
db.DB_PATH = paths['chat']
config.DB_PATH = paths['chat']
config.DB_CHAT_PATH = paths['chat']
config.TABLE_ALIAS_MAP = {}
for _alias, _tbls in {
    'chat': ('sessions', 'chat_history', 'chat_history_archive', 'agent_turns'),
    'apps': ('app_data', 'kv_store', 'settings', 'app_logs', 'jobs', 'task_stats', 'trash_items'),
    'roles': ('canvas_nodes', 'canvas_view', 'canvas_node_ext', 'canvas_edge'),
    'projects': ('projects',),
    'system': ('token_usage', 'capability', 'capability_link', 'emergence_event',
               'health_state', 'health_events', 'health_daily'),
}.items():
    for _t in _tbls:
        config.TABLE_ALIAS_MAP[_t] = _alias
try:
    # 1) 裸表名路由
    conn = db._new_split_conn()
    conn.execute("INSERT INTO kv_store(k, v) VALUES ('route-test', 'ok')")
    conn.execute("INSERT INTO sessions(id) VALUES ('s1')")
    conn.commit()
    a = sqlite3.connect(paths['apps'])
    row = a.execute("SELECT v FROM kv_store WHERE k='route-test'").fetchone()
    a.close()
    check('非 chat 域落分库', bool(row) and row[0] == 'ok')
    check('chat 主库无污染表', 'kv_store' not in tables_of(paths['chat']),
          str(tables_of(paths['chat'])))
    c = sqlite3.connect(paths['chat'])
    got = c.execute("SELECT id FROM sessions").fetchone()
    c.close()
    check('chat 域走 main', bool(got) and got[0] == 's1')
    conn.close()

    # 2) sweep 搬错位表
    c = sqlite3.connect(paths['chat'])
    c.execute('CREATE TABLE app_data(x TEXT)')
    c.execute("INSERT INTO app_data VALUES ('mis1')")
    c.execute("INSERT INTO app_data VALUES ('mis2')")
    c.commit()
    c.close()
    db._sweep_misplaced_tables()
    a = sqlite3.connect(paths['apps'])
    n = a.execute("SELECT count(*) FROM app_data").fetchone()[0]
    a.close()
    check('错位表搬回分库(2行)', n == 2, 'rows=%s' % n)
    check('chat 库已 DROP', 'app_data' not in tables_of(paths['chat']))

    # 3) sweep 后裸表名直达分库
    conn = db._new_split_conn()
    conn.execute("INSERT INTO app_data(x) VALUES ('post-sweep')")
    conn.commit()
    conn.close()
    a = sqlite3.connect(paths['apps'])
    n = a.execute("SELECT count(*) FROM app_data").fetchone()[0]
    a.close()
    check('sweep 后写直达分库(3行)', n == 3, 'rows=%s' % n)
finally:
    db.DB_ATTACH_MAP = orig[0]
    db.DB_PATH = orig[1]
    config.DB_ATTACH_MAP = orig[2]
    config.TABLE_ALIAS_MAP = orig[3]
    config.DB_PATH = orig[4]
    config.DB_CHAT_PATH = orig[5]
    shutil.rmtree(tmp, ignore_errors=True)

print('== db 拆库路由回归: %d fail ==' % len(_fail))


def test_db_routing():
    """pytest 入口（快速优化冲刺 A4 20261123）：模块导入时已完整执行拆库路由回归。"""
    assert not _fail, 'db 拆库路由回归失败: ' + ', '.join(_fail)


if __name__ == '__main__':
    sys.exit(1 if _fail else 0)
