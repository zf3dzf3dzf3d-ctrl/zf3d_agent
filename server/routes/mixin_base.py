# -*- coding: utf-8 -*-
"""Mixin 基类：提供空类供所有路由 Mixin 继承，未来公共方法放这里。"""


class MixinBase:
    pass


_last_cleanup = {'n': 0}


def db_write_log(level, box_id, action, detail):
    """向 app_logs 写一条运行日志（独立 sqlite 连接，失败静默不阻断请求）。

    内置自动清理：每写入 5000 条触发一次，保留最近 MAX_APP_LOGS(50000) 条，
    防止 app_logs 无限膨胀拖慢数据库（2026-09 慢化排查结论：app_logs 曾达 10 万条）。
    """
    import time
    import sqlite3
    try:
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.execute('PRAGMA busy_timeout=30000')
        try:
            conn.execute(
                'INSERT INTO app_logs (ts, level, box_id, action, detail) VALUES (?, ?, ?, ?, ?)',
                (int(time.time() * 1000), level, str(box_id or ''),
                 str(action or ''), str(detail or '')[:2000]))
            _last_cleanup['n'] += 1
            if _last_cleanup['n'] >= 5000:
                _last_cleanup['n'] = 0
                conn.execute(
                    'DELETE FROM app_logs WHERE id NOT IN '
                    '(SELECT id FROM app_logs ORDER BY id DESC LIMIT ?)',
                    (50000,))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print('[db_write_log] failed: %s' % e)
