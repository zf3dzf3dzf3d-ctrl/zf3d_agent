# -*- coding: utf-8 -*-
"""token_usage_stats：Token 用量长期统计（入 SQLite，可按日/月聚合查询）。

- record_token_usage(): 每次 API 调用记账一行（异常全吞，不影响主链路）
- token_usage_summary(): 聚合输出 近N天/近12月/按模型/总计
- set_price()/prices: 前端可在面板里为每个模型设置单价（元/百万token），用于核算月花销
"""
import sqlite3
import threading
import time

from config import DB_PATH, _db_lock


def record_token_usage(provider='', model='', box_id='', prompt_tokens=0,
                       completion_tokens=0, cached_tokens=0, ts=None):
    """记录一次 API 调用的 token 用量。任何异常静默吞掉。"""
    try:
        ts = int(ts or time.time())
        lt = time.localtime(ts)
        day = time.strftime('%Y-%m-%d', lt)
        month = time.strftime('%Y-%m', lt)
        pt = int(prompt_tokens or 0)
        ct = int(completion_tokens or 0)
        ck = int(cached_tokens or 0)
        total = pt + ct
        with _db_lock:
            conn = sqlite3.connect(DB_PATH)
            try:
                conn.execute(
                    'INSERT INTO token_usage(ts, day, month, provider, model, box_id,'
                    ' prompt_tokens, completion_tokens, cached_tokens, total_tokens)'
                    ' VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (ts, day, month, str(provider or ''), str(model or ''),
                     str(box_id or ''), pt, ct, ck, total))
                conn.commit()
            finally:
                conn.close()
    except Exception:
        pass


def token_usage_summary(days=31):
    """返回 近N天按日聚合 + 近12个月聚合 + 按模型聚合 + 总计。"""
    out = {'ok': True, 'days': int(days or 31),
           'daily': [], 'monthly': [], 'by_model': [], 'total': {}}
    try:
        with _db_lock:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            try:
                since_day = time.strftime(
                    '%Y-%m-%d', time.localtime(time.time() - out['days'] * 86400))
                rows = conn.execute(
                    'SELECT day, SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage WHERE day >= ? GROUP BY day ORDER BY day',
                    (since_day,)).fetchall()
                out['daily'] = [dict(r) for r in rows]
                rows = conn.execute(
                    'SELECT month, SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage GROUP BY month ORDER BY month DESC LIMIT 12').fetchall()
                out['monthly'] = [dict(r) for r in rows]
                rows = conn.execute(
                    "SELECT COALESCE(model,'') model, COALESCE(provider,'') provider,"
                    ' SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage GROUP BY provider, model ORDER BY tt DESC LIMIT 50').fetchall()
                out['by_model'] = [dict(r) for r in rows]
                row = conn.execute(
                    'SELECT SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage').fetchone()
                out['total'] = dict(row) if row else {}
            finally:
                conn.close()
    except Exception as e:
        out = {'ok': False, 'err': str(e)}
    return out


def month_detail(month=None):
    """返回某个月(YYYY-MM，默认当月)的按日聚合 + 按模型聚合，用于查询上一个月。"""
    month = month or time.strftime('%Y-%m')
    out = {'ok': True, 'month': month, 'daily': [], 'by_model': [], 'total': {}}
    try:
        with _db_lock:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            try:
                rows = conn.execute(
                    'SELECT day, SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage WHERE month = ? GROUP BY day ORDER BY day',
                    (month,)).fetchall()
                out['daily'] = [dict(r) for r in rows]
                rows = conn.execute(
                    "SELECT COALESCE(model,'') model, COALESCE(provider,'') provider,"
                    ' SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage WHERE month = ? GROUP BY provider, model ORDER BY tt DESC',
                    (month,)).fetchall()
                out['by_model'] = [dict(r) for r in rows]
                row = conn.execute(
                    'SELECT SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
                    ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls'
                    ' FROM token_usage WHERE month = ?', (month,)).fetchone()
                out['total'] = dict(row) if row else {}
            finally:
                conn.close()
    except Exception as e:
        out = {'ok': False, 'err': str(e)}
    return out
