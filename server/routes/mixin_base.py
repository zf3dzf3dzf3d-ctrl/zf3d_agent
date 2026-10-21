# -*- coding: utf-8 -*-
"""Mixin 基类：提供空类供所有路由 Mixin 继承，未来公共方法放这里。"""


class MixinBase:
    pass


_last_cleanup = {'n': 0}
_boot_cleaned = False  # 进程内首次写入时做一次全量清理（启动兜底）

# 清理策略（2026-10-08 优化：按天 + 条数双保险；error 级单独保留更久便于排查）
APP_LOGS_KEEP_DAYS = 7        # 普通(info/warn)日志保留天数
APP_LOGS_ERR_KEEP_DAYS = 30   # error 级日志保留天数
# 条数兜底上限。注意：当前写入速率约 1 万条/天，5 万上限只相当于 ~5 天窗口，
# 会让"保留 7 天"沦为纸面承诺（审核第 2 轮共同指出）。故下调至 2 万（约 2 天
# 常态窗口），仅作爆发性写入时的空间兜底；如需真正的 7 天回看，需做降量开关
# （减少写入量）而非调大本值。TODO(后续): 降量开关，第 4 项方案。
APP_LOGS_KEEP_MAX = 20000
_CLEANUP_EVERY_N = 3000       # 每写入 N 条触发一次清理检查


def cleanup_app_logs(cur):
    """执行一次 app_logs 清理：过期(按天) + 超量(按条数)。

    调用方负责 commit/rollback。ts 为毫秒时间戳。
    """
    import time
    now_ms = int(time.time() * 1000)
    # 普通：超 APP_LOGS_KEEP_DAYS 天删除（error 除外）
    cur.execute(
        'DELETE FROM app_logs WHERE ts < ? AND level != ?',
        (now_ms - APP_LOGS_KEEP_DAYS * 86400000, 'error'))
    # error：超 APP_LOGS_ERR_KEEP_DAYS 天删除
    cur.execute(
        'DELETE FROM app_logs WHERE ts < ?',
        (now_ms - APP_LOGS_ERR_KEEP_DAYS * 86400000,))
    # 条数兜底：只保留最近 N 条
    cur.execute(
        'DELETE FROM app_logs WHERE id NOT IN '
        '(SELECT id FROM app_logs ORDER BY id DESC LIMIT ?)',
        (APP_LOGS_KEEP_MAX,))


def maybe_cleanup_app_logs(cur, n_writes=1):
    """写入后调用：累计 n_writes 条，达到阈值时触发清理（顺带进程首次写入兜底）。

    供所有 app_logs 写入口共用（mixin_base.db_write_log / api_dispatch_post 等），
    避免"部分写入口不触发清理导致日志无限膨胀"的旧问题。
    清理失败静默（不影响主流程）；commit 由调用方随写入一起提交。
    """
    global _boot_cleaned
    try:
        if not _boot_cleaned:
            _boot_cleaned = True
            cleanup_app_logs(cur)
            _last_cleanup['n'] = 0
            return
        _last_cleanup['n'] += n_writes
        if _last_cleanup['n'] >= _CLEANUP_EVERY_N:
            _last_cleanup['n'] = 0
            cleanup_app_logs(cur)
    except Exception as e:
        print('[app_logs cleanup] failed: %s' % e)


def db_write_log(level, box_id, action, detail):
    """向 app_logs 写一条运行日志（独立 sqlite 连接，失败静默不阻断请求）。

    内置自动清理（统一入口 maybe_cleanup_app_logs）：
    - 进程启动后首次写入：全量清理一次（启动兜底）；
    - 此后每写 3000 条触发检查：普通日志保留 7 天、error 保留 30 天、
      条数兜底上限 2 万条，防止 app_logs 无限膨胀拖慢数据库。
    空间回收（VACUUM）复用 db.py 已有的定期维护机制（50MB 阈值）。
    """
    import time
    try:
        from db import get_db
        from config import _db_lock
        # 【修复 2026-10-17】原 with _db_lock 无超时：锁被长事务占住时（如 AI 请求
        # 期间 30s+ 持锁），所有走日志写入的 API（含池提交 /api/chat-pool/chat）
        # 全部静默挂死——表现为"发不出去也不报错"。改为限时抢锁，抢不到就丢日志保业务。
        if not _db_lock.acquire(timeout=1.5):
            print('[db_write_log] lock busy(>1.5s), log dropped: %s' % str(action or ''))
            return
        try:
            conn = get_db()
            conn.execute(
                'INSERT INTO app_logs (ts, level, box_id, action, detail) VALUES (?, ?, ?, ?, ?)',
                (int(time.time() * 1000), level, str(box_id or ''),
                 str(action or ''), str(detail or '')[:2000]))
            maybe_cleanup_app_logs(conn.cursor())
            conn.commit()
        finally:
            _db_lock.release()
    except Exception as e:
        print('[db_write_log] failed: %s' % e)
