# -*- coding: utf-8 -*-
"""Mixin: DB 读写（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinDb(MixinBase):
    # ===== 模型配置管家：独立长期记忆（config_agent_memory 表，不与主会话混用） =====
    def _agent_memory_table(self, cur):
        cur.execute('''
            CREATE TABLE IF NOT EXISTS config_agent_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT,
                created_at INTEGER
            )
        ''')

    def _handle_config_agent_memory_get(self):
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                self._agent_memory_table(cur)
                # 安全策略：管家记忆只保留一天，读取时自动清理超过 24 小时的旧记录
                # （防止历史对话里出现过的 apikey 等敏感信息长期留存在数据库中）
                expire_ms = int(time.time() * 1000) - 24 * 3600 * 1000
                cur.execute('DELETE FROM config_agent_memory WHERE created_at < ?', (expire_ms,))
                cur.execute('SELECT role, content, created_at FROM config_agent_memory ORDER BY id')
                rows = [dict(r) for r in cur.fetchall()]
                conn.commit()
                conn.close()
            self._send_json({'ok': True, 'data': rows})
        except Exception as e:
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)

    def _handle_config_agent_memory_post(self):
        body = self._read_body()
        action = body.get('action', 'append')
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                self._agent_memory_table(cur)
                if action == 'clear':
                    cur.execute('DELETE FROM config_agent_memory')
                elif action == 'replace_last':
                    cur.execute("SELECT id FROM config_agent_memory WHERE role='assistant' ORDER BY id DESC LIMIT 1")
                    row = cur.fetchone()
                    if row:
                        cur.execute('UPDATE config_agent_memory SET content=? WHERE id=?',
                                    (str(body.get('content', '')), row['id']))
                else:
                    role = body.get('role', 'user')
                    if role not in ('user', 'assistant'):
                        raise ValueError('role 只允许 user/assistant')
                    cur.execute('INSERT INTO config_agent_memory (role, content, created_at) VALUES (?, ?, ?)',
                                (role, str(body.get('content', '')), int(time.time() * 1000)))
                conn.commit()
                conn.close()
            self._send_json({'ok': True})
        except Exception as e:
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)

    def _chat_history_content_prefix(self, cur, session_id, created_at, max_len=200):
        """取某条 user 历史记录的内容前缀（避免读取超大文本整段内容）"""
        try:
            cur.execute('''SELECT substr(content, 1, ?) AS prefix FROM chat_history
                           WHERE session_id=? AND created_at=? AND role='user' ''', (max_len, session_id, created_at))
            row = cur.fetchone()
            if row and row['prefix'] is not None:
                return row['prefix']
            cur.execute('''SELECT substr(content, 1, ?) AS prefix FROM chat_history_archive
                           WHERE session_id=? AND created_at=? AND role='user' ''', (max_len, session_id, created_at))
            row = cur.fetchone()
            if row and row['prefix'] is not None:
                return row['prefix']
        except Exception:
            pass
        return ''


    def _handle_db_get(self, path):
        """澶勭悊 /api/db/* 鐨?GET 璇锋眰"""
        parsed = urlparse(self.path)
        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        # 鍏堟煡璇㈡暟鎹紝鍏抽棴杩炴帴锛屽啀鍙戦€佸搷搴旓紙閬垮厤杩炴帴娉勬紡锛?
        result = None
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes':
                    cur.execute('SELECT * FROM canvas_nodes ORDER BY z_index')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'canvas' and len(parts) > 1 and parts[1] == 'view':
                    cur.execute('SELECT * FROM canvas_view WHERE id=1')
                    row = cur.fetchone()
                    result = {'ok': True, 'data': dict(row) if row else {}}

                elif resource == 'kv' and len(parts) > 1:
                    key = parts[1]
                    cur.execute('SELECT value FROM kv_store WHERE key=?', (key,))
                    row = cur.fetchone()
                    result = {'ok': True, 'data': row['value'] if row else None}

                elif resource == 'model-stats' and len(parts) > 1 and parts[1] == 'today':
                    # 大模型面板专用轻量聚合接口：一条 SQL 直接按模型 ID 统计今天全部 user 消息，
                    # 替代旧版前端逐页串行拉取（一天几百上千条要发几十个请求再自己分组）。
                    now_t = time.localtime()
                    day_start = int(time.mktime((now_t.tm_year, now_t.tm_mon, now_t.tm_mday, 0, 0, 0, 0, 0, -1))) * 1000
                    day_end = day_start + 24 * 60 * 60 * 1000
                    stats_sql = '''
                        SELECT COALESCE(all_history.model_id, '') AS model_id, COUNT(*) AS cnt
                        FROM (
                            SELECT ch.model_id, ch.created_at
                            FROM chat_history ch
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT model_id, created_at
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                        WHERE created_at >= ? AND created_at < ?
                        GROUP BY all_history.model_id
                        ORDER BY cnt DESC, model_id ASC
                    '''
                    cur.execute('CREATE TABLE IF NOT EXISTS chat_history_archive (\n                            id INTEGER PRIMARY KEY AUTOINCREMENT,\n                            session_id TEXT NOT NULL,\n                            session_name TEXT,\n                            role TEXT,\n                            content TEXT,\n                            model_id TEXT,\n                            created_at INTEGER\n                        )')
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    _cols = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in _cols:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    cur.execute(stats_sql, (day_start, day_end))
                    rows = [dict(r) for r in cur.fetchall()]
                    total = sum(int(r['cnt'] or 0) for r in rows)
                    result = {'ok': True, 'data': rows, 'total': total}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'all':
                    # 性能优化版：默认仅返回每一天的前 N 条对话（含对话数统计），
                    # 完整内容按需通过 ?day=YYYY-MM-DD&offset=&limit= 分页加载。
                    # 旧的全量接口数据量可达数 MB（单条 30 万字符），导致面板打开极慢。
                    cur.execute('''
                        CREATE TABLE IF NOT EXISTS chat_history_archive (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            session_name TEXT,
                            role TEXT,
                            content TEXT,
                            model_id TEXT,
                            created_at INTEGER
                        )
                    ''')
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    archive_columns = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    qs = parse_qs(parsed.query)
                    req_day = qs.get('day', [''])[0]
                    offset = int(qs.get('offset', ['0'])[0] or 0)
                    limit = int(qs.get('limit', ['5'])[0] or 5)
                    limit = max(1, min(limit, 50))

                    # ===== 对话完成率 MVP：按会话聚合 task_stats（成功数/总数）=====
                    # 前端据此在历史面板每条对话上显示 ✅/⚠️/❌ 完成率徽标
                    try:
                        # 只统计 task_complete 写入的有效任务；旧版每次模型请求留下的空 task_title 记录不参与完成率。
                        cur.execute("SELECT session_id, COUNT(*) AS total, SUM(success) AS done FROM task_stats WHERE COALESCE(task_title, '') <> '' GROUP BY session_id")
                        _task_stats_map = {}
                        for _r in cur.fetchall():
                            _task_stats_map[_r['session_id']] = {'task_done': int(_r['done'] or 0), 'task_total': int(_r['total'] or 0)}
                    except Exception:
                        _task_stats_map = {}

                    # 仅读取元信息列（不 SELECT content，避免读取超大文本）
                    meta_sql = '''
                        SELECT session_id, session_name, model_id, created_at, LENGTH(content) AS content_len
                        FROM (
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                   ch.model_id, ch.created_at, ch.content
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                   model_id, created_at, content
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                    '''

                    if req_day:
                        # ---- 按天分页：返回某一天[offset, offset+limit)的对话 + 内容摘要 ----
                        # day 形如 2024-05-01（本地时区）
                        try:
                            day_start = int(time.mktime(time.strptime(req_day, '%Y-%m-%d'))) * 1000
                        except ValueError:
                            day_start = None
                        if day_start is None:
                            result = {'ok': False, 'error': 'day 参数格式应为 YYYY-MM-DD'}
                        else:
                            day_end = day_start + 24 * 60 * 60 * 1000
                            full_sql = '''
                                SELECT session_id, session_name, model_id, created_at,
                                       SUBSTR(content, 1, 200) AS content
                                FROM (
                                    SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                           ch.model_id, ch.created_at, ch.content
                                    FROM chat_history ch
                                    LEFT JOIN sessions s ON s.id = ch.session_id
                                    WHERE ch.role = 'user'
                                    UNION ALL
                                    SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                           model_id, created_at, content
                                    FROM chat_history_archive
                                    WHERE role = 'user'
                                ) all_history
                            '''
                            # 逐条消息返回（保留 model_id + 内容前缀），供“历史加载更多”和大模型面板统计使用。
                            # total = 当天 user 消息总条数，offset/limit 按 message 分页。
                            cur.execute('SELECT COUNT(*) AS c FROM (' + full_sql + ' WHERE created_at >= ? AND created_at < ?)', (day_start, day_end))
                            total = int(cur.fetchone()['c'] or 0)
                            cur.execute(full_sql + ' WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC LIMIT ? OFFSET ?', (day_start, day_end, limit, offset))
                            rows = cur.fetchall()
                            data = []
                            for r in rows:
                                d = dict(r)
                                d['content'] = (d.get('content') or '')[:200]
                                # 对话完成率徽标数据
                                _ts = _task_stats_map.get(d['session_id'])
                                if _ts:
                                    d['task_total'] = _ts['task_total']
                                    d['task_done'] = _ts['task_done']
                                    d['task_rate'] = int(round(_ts['task_done'] / _ts['task_total'] * 100)) if _ts['task_total'] else 0
                                data.append(d)
                            result = {'ok': True, 'data': data, 'total': total, 'offset': offset, 'limit': limit}
                    else:
                        # ---- 默认：按天统计 + 每天前 N 个会话（一个会话=一个对话）----
                        # 先把全部 user 记录按会话归组，再按会话最后活跃时间落到对应“天”
                        cur.execute(meta_sql + ' ORDER BY created_at ASC')
                        rows = cur.fetchall()
                        # 按会话归组
                        sess_map = {}
                        for r in rows:
                            sid = r['session_id']
                            if sid not in sess_map:
                                sess_map[sid] = {'session_id': sid, 'session_name': r['session_name'] or sid,
                                                 'content': '', 'firstTs': r['created_at'] or 0, 'lastTs': r['created_at'] or 0}
                            else:
                                if (r['created_at'] or 0) > sess_map[sid]['lastTs']:
                                    sess_map[sid]['lastTs'] = r['created_at'] or 0
                        session_list = list(sess_map.values())
                        # 本地时区按“最后活跃时间”分组
                        day_groups = {}
                        for s in session_list:
                            day_str = time.strftime('%Y-%m-%d', time.localtime((s['lastTs'] or 0) / 1000))
                            if day_str not in day_groups:
                                day_groups[day_str] = []
                            day_groups[day_str].append(s)
                        days = []
                        initial_per_day = int(qs.get('initial', ['5'])[0] or 5)
                        initial_per_day = max(1, min(initial_per_day, 50))
                        for day_str in sorted(day_groups.keys(), reverse=True):
                            group = sorted(day_groups[day_str], key=lambda s: s['lastTs'], reverse=True)
                            day_start_ms = int(time.mktime(time.strptime(day_str, '%Y-%m-%d'))) * 1000
                            # 给每天前 N 个会话补上内容前缀（供前端直接显示）
                            head_records = []
                            for s in group[:initial_per_day]:
                                d = dict(s)
                                d['created_at'] = s['lastTs']
                                d['content'] = self._chat_history_content_prefix(cur, d['session_id'], s['firstTs']) or s['content']
                                # 对话完成率徽标数据
                                _ts = _task_stats_map.get(d['session_id'])
                                if _ts:
                                    d['task_total'] = _ts['task_total']
                                    d['task_done'] = _ts['task_done']
                                    d['task_rate'] = int(round(_ts['task_done'] / _ts['task_total'] * 100)) if _ts['task_total'] else 0
                                head_records.append(d)
                            days.append({
                                'day': day_str,
                                'total': len(group),            # 当天会话总数
                                'records': head_records,        # 当天前 N 个会话（含内容前缀）
                                'dayStart': day_start_ms,
                            })
                        result = {'ok': True, 'data': {'days': days, 'initialPerDay': initial_per_day}, 'total': sum(d['total'] for d in days)}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'prefix':
                    # 单条历史内容前缀（供旧版兼容 / 调试）
                    sid = parse_qs(parsed.query).get('session_id', [''])[0]
                    ts = parse_qs(parsed.query).get('created_at', ['0'])[0]
                    prefix = self._chat_history_content_prefix(cur, sid, int(ts or 0))
                    result = {'ok': True, 'data': prefix}

                elif resource == 'sessions':
                    cur.execute('SELECT * FROM sessions ORDER BY created_at DESC')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'projects':
                    cur.execute('SELECT * FROM projects ORDER BY created_at DESC')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    # 历史面板点击标题展开时拉取某会话的完整消息。
                    # 【修复】归档表消息的 session_id 现已带 '_arc_' 后缀（归档时改名），
                    # 不会再与复用中的会话 id (cbN) 撞号，因此这里只查当前表。
                    # 仅当前端显式传 ?archive=1 时才补查归档表，避免旧裸 ID 归档数据混入当前会话。
                    rows = []
                    cur.execute('SELECT * FROM chat_history WHERE session_id=? ORDER BY created_at', (sid,))
                    rows += [dict(r) for r in cur.fetchall()]
                    if not rows and parse_qs(parsed.query).get('archive', [''])[0] == '1':
                        try:
                            cur.execute('SELECT * FROM chat_history_archive WHERE session_id=? ORDER BY created_at', (sid,))
                            rows += [dict(r) for r in cur.fetchall()]
                        except Exception:
                            pass
                    # 按 created_at 稳定归并排序
                    rows.sort(key=lambda r: r.get('created_at') or 0)
                    result = {'ok': True, 'data': rows}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    if len(parts) > 2:
                        key = parts[2]
                        cur.execute('SELECT value FROM app_data WHERE category=? AND key=?', (category, key))
                        row = cur.fetchone()
                        result = {'ok': True, 'data': row['value'] if row else None}
                    else:
                        cur.execute('SELECT * FROM app_data WHERE category=?', (category,))
                        result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'logs':
                    limit = 200
                    qs = parse_qs(parsed.query)
                    if 'limit' in qs:
                        limit = min(int(qs['limit'][0]), 2000)
                    cur.execute('SELECT * FROM app_logs ORDER BY ts DESC LIMIT ?', (limit,))
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'stats':
                    qs = parse_qs(parsed.query)
                    date_range = qs.get('range', ['all'])[0]
                    if date_range == 'today':
                        today_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-%d', time.localtime()), '%Y-%m-%d')) * 1000)
                        cur.execute('SELECT * FROM task_stats WHERE created_at >= ? ORDER BY created_at DESC', (today_start,))
                    elif date_range == 'month':
                        month_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-01', time.localtime()), '%Y-%m-%d')) * 1000)
                        cur.execute('SELECT * FROM task_stats WHERE created_at >= ? ORDER BY created_at DESC', (month_start,))
                    else:
                        cur.execute('SELECT * FROM task_stats ORDER BY created_at DESC LIMIT 500')
                    rows = [dict(r) for r in cur.fetchall()]
                    total_tasks = len(rows)
                    success_tasks = sum(1 for r in rows if r.get('success'))
                    total_tokens = sum(r.get('tokens_used', 0) or 0 for r in rows)
                    avg_tokens = int(total_tokens / total_tasks) if total_tasks > 0 else 0
                    daily_map = {}
                    for r in rows:
                        day_str = time.strftime('%Y-%m-%d', time.localtime(r.get('created_at', 0) / 1000))
                        if day_str not in daily_map:
                            daily_map[day_str] = {'date': day_str, 'tasks': 0, 'tokens': 0, 'success': 0}
                        daily_map[day_str]['tasks'] += 1
                        daily_map[day_str]['tokens'] += r.get('tokens_used', 0) or 0
                        if r.get('success'):
                            daily_map[day_str]['success'] += 1
                    daily = sorted(daily_map.values(), key=lambda x: x['date'])
                    result = {'ok': True, 'data': {
                        'tasks': rows,
                        'summary': {
                            'total_tasks': total_tasks,
                            'success_tasks': success_tasks,
                            'fail_tasks': total_tasks - success_tasks,
                            'total_tokens': total_tokens,
                            'avg_tokens': avg_tokens
                        },
                        'daily': daily
                    }}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[GET /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)
            return

        # 连接已关闭，安全发送响应
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown GET route: ' + path, 404)


