# -*- coding: utf-8 -*-
"""token_usage_stats：Token 用量长期统计（入 SQLite，可按时/日/月聚合查询）。

- record_token_usage(): 每次 API 调用记账一行（异常全吞，不影响主链路）
- token_usage_summary(): 聚合输出 近N天按日 / 近24+小时按小时 / 近12月 / 按模型 / 总计
  并按通道（zhufeng=朱峰模型 / local=本地模型 / cloud=其他云端）分组，供前端堆叠图用
- set_price()/prices: 前端可在面板里为每个模型设置单价（元/百万token），用于核算月花销

通道判定规则（按记账时的 provider 主机名）：
  local   : 127.0.0.1 / localhost / 192.168.* / 10.* / 172.16-31.*（本地局域网推理）
  zhufeng : 主机名含 zhufeng / zf3d / zhuifeng，或 provider 含 bigmodel
            （朱峰大模型走智谱网关 open.bigmodel.cn，glm 系列归本通道）
  cloud   : 其余（OpenAI 兼容云端）
"""
import sqlite3
import threading
import time

from config import DB_PATH, _db_lock

# 通道分类 SQL 片段（按 provider 主机名归类）
_CHANNEL_SQL = (
    "CASE "
    "WHEN LOWER(COALESCE(provider,'')) LIKE '%zhufeng%' "
    "  OR LOWER(COALESCE(provider,'')) LIKE '%zf3d%' "
    "  OR LOWER(COALESCE(provider,'')) LIKE '%zhuifeng%' "
    "  OR LOWER(COALESCE(provider,'')) LIKE '%bigmodel%' THEN 'zhufeng' "
    "WHEN COALESCE(provider,'') IN ('127.0.0.1','localhost','::1','[::1]') "
    "  AND LOWER(COALESCE(model,'')) LIKE 'glm%' THEN 'zhufeng' "
    "WHEN COALESCE(provider,'') IN ('127.0.0.1','localhost','::1','[::1]') "
    "  OR COALESCE(provider,'') LIKE '192.168.%' OR COALESCE(provider,'') LIKE '10.%' "
    "  OR COALESCE(provider,'') LIKE '172.16.%' OR COALESCE(provider,'') LIKE '172.17.%' "
    "  OR COALESCE(provider,'') LIKE '172.18.%' OR COALESCE(provider,'') LIKE '172.19.%' "
    "  OR COALESCE(provider,'') LIKE '172.2_.%' OR COALESCE(provider,'') LIKE '172.30.%' "
    "  OR COALESCE(provider,'') LIKE '172.31.%' THEN 'local' "
    "ELSE 'cloud' END"
)


def record_token_usage(provider='', model='', box_id='', prompt_tokens=0,
                       completion_tokens=0, cached_tokens=0, ts=None,
                       session_title='', duration_ms=0, status='ok'):
    """记录一次 API 调用的 token 用量。任何异常静默吞掉。"""
    try:
        ts = int(ts or time.time())
        lt = time.localtime(ts)
        day = time.strftime('%Y-%m-%d', lt)
        month = time.strftime('%Y-%m', lt)
        hour = time.strftime('%Y-%m-%d %H:00', lt)
        pt = int(prompt_tokens or 0)
        ct = int(completion_tokens or 0)
        ck = int(cached_tokens or 0)
        total = pt + ct
        with _db_lock:
            conn = sqlite3.connect(DB_PATH, timeout=30)
            conn.execute('PRAGMA busy_timeout=30000')
            try:
                conn.execute(
                    'INSERT INTO token_usage(ts, day, month, provider, model, box_id,'
                    ' prompt_tokens, completion_tokens, cached_tokens, total_tokens,'
                    ' session_title, duration_ms, status)'
                    ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (ts, day, month, str(provider or ''), str(model or ''),
                     str(box_id or ''), pt, ct, ck, total,
                     str(session_title or ''), int(duration_ms or 0), str(status or 'ok')))
                conn.commit()
            finally:
                conn.close()
    except Exception:
        pass


def _sum_cols():
    return (' SUM(prompt_tokens) pt, SUM(completion_tokens) ct,'
            ' SUM(cached_tokens) ck, SUM(total_tokens) tt, COUNT(*) calls')


def token_usage_summary(days=31):
    """返回 近N天按日 + 小时粒度(近72h) + 近12月 + 按模型 + 总计。

    daily / hourly / monthly 均附带按通道的分组行（key=channel），
    前端据此画堆叠柱状图区分 朱峰模型/本地模型/其他云端。
    """
    out = {'ok': True, 'days': int(days or 31),
           'daily': [], 'hourly': [], 'monthly': [], 'by_model': [], 'total': {}}
    try:
        with _db_lock:
            conn = sqlite3.connect(DB_PATH, timeout=30)
            conn.execute('PRAGMA busy_timeout=30000')
            conn.row_factory = sqlite3.Row
            try:
                since_day = time.strftime(
                    '%Y-%m-%d', time.localtime(time.time() - out['days'] * 86400))
                since_hour = time.strftime(
                    '%Y-%m-%d %H:00', time.localtime(time.time() - 72 * 3600))

                # 近N天 按日 + 通道
                rows = conn.execute(
                    'SELECT day, ' + _CHANNEL_SQL + ' channel,' + _sum_cols() +
                    ' FROM token_usage WHERE day >= ? GROUP BY day, channel ORDER BY day',
                    (since_day,)).fetchall()
                out['daily'] = [dict(r) for r in rows]

                # 近72小时 按小时 + 通道
                rows = conn.execute(
                    "SELECT strftime('%Y-%m-%d %H:00', ts, 'unixepoch', 'localtime') hour,"
                    ' ' + _CHANNEL_SQL + ' channel,' + _sum_cols() +
                    " FROM token_usage WHERE ts >= ? GROUP BY hour, channel ORDER BY hour",
                    (int(time.time() - 72 * 3600),)).fetchall()
                out['hourly'] = [dict(r) for r in rows]

                # 近12月 按月 + 通道
                rows = conn.execute(
                    'SELECT month, ' + _CHANNEL_SQL + ' channel,' + _sum_cols() +
                    ' FROM token_usage GROUP BY month, channel ORDER BY month DESC LIMIT 36').fetchall()
                out['monthly'] = [dict(r) for r in rows]

                # 按模型（含通道）
                rows = conn.execute(
                    "SELECT COALESCE(model,'') model, COALESCE(provider,'') provider,"
                    ' ' + _CHANNEL_SQL + ' channel,' + _sum_cols() +
                    ' FROM token_usage GROUP BY provider, model ORDER BY tt DESC LIMIT 50').fetchall()
                out['by_model'] = [dict(r) for r in rows]

                row = conn.execute(
                    'SELECT' + _sum_cols() + ' FROM token_usage').fetchone()
                out['total'] = dict(row) if row else {}

                # 今日按模型（用于总览卡"今日花销"估算）
                today = time.strftime('%Y-%m-%d', time.localtime())
                rows = conn.execute(
                    "SELECT COALESCE(model,'') model, COALESCE(provider,'') provider,"
                    ' ' + _sum_cols() +
                    ' FROM token_usage WHERE day = ? GROUP BY provider, model', (today,)).fetchall()
                out['today_by_model'] = [dict(r) for r in rows]
            finally:
                conn.close()
    except Exception as e:
        out = {'ok': False, 'err': str(e)}
    return out


def month_detail(month=None):
    """返回某个月(YYYY-MM，默认当月)的按日聚合(+通道) + 按模型聚合。"""
    month = month or time.strftime('%Y-%m')
    out = {'ok': True, 'month': month, 'daily': [], 'by_model': [], 'total': {}}
    try:
        with _db_lock:
            conn = sqlite3.connect(DB_PATH, timeout=30)
            conn.execute('PRAGMA busy_timeout=30000')
            conn.row_factory = sqlite3.Row
            try:
                rows = conn.execute(
                    'SELECT day, ' + _CHANNEL_SQL + ' channel,' + _sum_cols() +
                    ' FROM token_usage WHERE month = ? GROUP BY day, channel ORDER BY day',
                    (month,)).fetchall()
                out['daily'] = [dict(r) for r in rows]
                rows = conn.execute(
                    "SELECT COALESCE(model,'') model, COALESCE(provider,'') provider,"
                    ' ' + _CHANNEL_SQL + ' channel,' + _sum_cols() +
                    ' FROM token_usage WHERE month = ? GROUP BY provider, model ORDER BY tt DESC',
                    (month,)).fetchall()
                out['by_model'] = [dict(r) for r in rows]
                row = conn.execute(
                    'SELECT' + _sum_cols() + ' FROM token_usage WHERE month = ?',
                    (month,)).fetchone()
                out['total'] = dict(row) if row else {}
            finally:
                conn.close()
    except Exception as e:
        out = {'ok': False, 'err': str(e)}
    return out


# ===== 明细查询（翻页/筛选）+ 聚合缓存 =====
_AGG_CACHE = {}   # key -> (expire_ts, data)
_AGG_TTL = 15     # 短缓存抗连点；写入记账时按 key 前缀失效


def _cache_get(key):
    import time as _t
    v = _AGG_CACHE.get(key)
    if v and v[0] > _t.time():
        return v[1]
    return None


def _cache_set(key, data):
    import time as _t
    _AGG_CACHE[key] = (_t.time() + _AGG_TTL, data)


def _db_conn():
    import db as _db
    for name in ('get_conn', 'get_db', 'connect'):
        fn = getattr(_db, name, None)
        if callable(fn):
            return fn()
    raise RuntimeError('db conn not available')


def _fmt_time(ts):
    import time as _t
    try:
        return _t.strftime('%m-%d %H:%M:%S', _t.localtime(int(ts)))
    except Exception:
        return ''


def usage_detail(page=1, page_size=30, month='', model='', q='', range_=''):
    """明细分页查询。month=YYYY-MM（7位）或 YYYY-MM-DD（10位）；model 精确筛选；q 模糊匹配模型/会话/box。"""
    page = max(1, int(page or 1))
    page_size = min(200, max(10, int(page_size or 30)))
    where, args = [], []
    if range_:
        # 时间范围：today/7d/30d/90d/all
        import time as _tm
        if range_ == 'today':
            _d = _tm.strftime('%Y-%m-%d', _tm.localtime())
            where.append('day = ?'); args.append(_d)
        elif range_ in ('7d', '30d', '90d'):
            _days = int(range_[:-1])
            _since = _tm.time() - _days * 86400
            where.append('ts >= ?'); args.append(_since)
    elif month:
        if len(month) == 7:
            where.append('month = ?'); args.append(month)
        else:
            where.append('day = ?'); args.append(month)
    if model:
        where.append('model = ?'); args.append(model)
    if q:
        where.append("(model LIKE ? OR IFNULL(session_title,'') LIKE ? OR IFNULL(box_id,'') LIKE ?)")
        args += ['%' + q + '%', '%' + q + '%', '%' + q + '%']
    w = ('WHERE ' + ' AND '.join(where)) if where else ''
    # 缓存键：today 按日期区分，避免跨天后命中昨天的缓存
    _range_key = range_
    if range_ == 'today':
        import time as _tk
        _range_key = 'today@' + _tk.strftime('%Y-%m-%d', _tk.localtime())
    key = 'detail|%s|%s|%s|%s|%s|%s' % (page, page_size, month, model, q, _range_key)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    conn = _db_conn()
    cur = conn.cursor()
    try:
        cur.execute('SELECT COUNT(*) FROM token_usage ' + w, args)
        total = cur.fetchone()[0]
        cur.execute(
            "SELECT ts, day, provider, model, box_id, prompt_tokens, completion_tokens, "
            "cached_tokens, total_tokens, IFNULL(session_title,''), IFNULL(duration_ms,0), IFNULL(status,'ok') "
            "FROM token_usage " + w + " ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?",
            args + [page_size, (page - 1) * page_size])
        rows = [{
            'ts': r[0], 'time': _fmt_time(r[0]), 'day': r[1], 'provider': r[2],
            'model': r[3], 'box_id': r[4], 'pt': r[5], 'ct': r[6], 'ck': r[7], 'tt': r[8],
            'session_title': r[9], 'duration_ms': r[10], 'status': r[11]}
            for r in cur.fetchall()]
        cur.execute('SELECT COUNT(*), IFNULL(SUM(total_tokens),0), IFNULL(SUM(cached_tokens),0) FROM token_usage ' + w, args)
        s = cur.fetchone()
        out = {'ok': True, 'page': page, 'page_size': page_size, 'total': total,
               'pages': max(1, (total + page_size - 1) // page_size),
               'sum_calls': s[0], 'sum_tokens': s[1], 'sum_cached': s[2], 'rows': rows}
    finally:
        try:
            conn.close()
        except Exception:
            pass
    _cache_set(key, out)
    return out

