# -*- coding: utf-8 -*-
"""Mixin 基类：提供空类供所有路由 Mixin 继承，未来公共方法放这里。"""


class MixinBase:
    pass


def db_write_log(level, box_id, action, detail):
    """向 app_logs 写一条运行日志（独立 sqlite 连接，失败静默不阻断请求）。"""
    import time
    import sqlite3
    try:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            conn.execute(
                'INSERT INTO app_logs (ts, level, box_id, action, detail) VALUES (?, ?, ?, ?, ?)',
                (int(time.time() * 1000), level, str(box_id or ''),
                 str(action or ''), str(detail or '')[:2000]))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print('[db_write_log] failed: %s' % e)
