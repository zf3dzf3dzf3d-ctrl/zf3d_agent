#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/tool_stats.py - 智能体工具使用埋点（长期利用率统计）

每次工具调用（成功/失败/未知工具）追加一行 jsonl 到
server/private/logs/agent_tool_usage.jsonl，字段：
  ts        时间戳（浮点秒）
  tool      工具名
  source    调用来源（engine:<id> / brain / swarm / web）
  category  工具分类（极简/编程/写作/浏览器/蜂群/记忆/未知）
  ok        是否成功（True/False）
  ms        耗时毫秒
  err       失败原因前 120 字符（仅失败时）

设计原则：埋点绝不抛错、绝不阻塞工具执行；文件追加带独立锁。
统计：跑 server/scripts/agent_tool_report.py 聚合。
"""

import os
import io
import json
import time
import sqlite3
import threading

_LOCK = threading.Lock()
_DB_LOCK = threading.Lock()
_LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private', 'logs', 'agent_tool_usage.jsonl')
_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private', 'data', 'tool_usage.db')

# jsonl 明细日志单文件上限（字节），超过后轮转为 .1（仅保留一代，防无限膨胀）
_LOG_MAX_BYTES = 5 * 1024 * 1024

# 工具分类表：按工具名归类（前缀匹配优先级从上到下；未命中记「未知」）
_CATEGORY_RULES = [
    (('browser_',), '浏览器'),
    (('task_list', 'long_plan', 'plan_batch', 'get_tool_result', 'ask_user',
      'task_complete', 'switch_tool_category'), '任务协作'),
    (('project_record', 'agent_memory', 'memory_'), '记忆'),
    (('chat_manage', 'swarm_', 'dispatch_', 'spawn'), '蜂群调度'),
    (('read_file', 'read_lines', 'write_file', 'replace_text', 'tree_dir',
      'find_files', 'search_in_files', 'file_info', 'move_file', 'run_code',
      'list_dir', 'search_files'), '极简'),
    (('git_', 'debug_', 'schedule_', 'mail_', 'gen_', 'video_', 'image_',
      'terminal_', 'cmd_'), '编程扩展'),
    (('rewrite', 'polish', 'expand', 'translate', 'summar', 'seo', 'analyze_'), '写作扩展'),
]


def category_of(tool):
    t = str(tool or '').lower()
    for keys, cat in _CATEGORY_RULES:
        for k in keys:
            if t.startswith(k):
                return cat
    return '未知'


def record(tool, source, ok, ms, err=''):
    """追加一条埋点。任何异常静默吞掉，绝不影响工具执行。"""
    try:
        rec = {
            'ts': round(time.time(), 3),
            'tool': str(tool or '')[:80],
            'source': str(source or '')[:40],
            'category': category_of(tool),
            'ok': bool(ok),
            'ms': int(max(0, ms)),
        }
        if err:
            rec['err'] = str(err)[:120]
        line = json.dumps(rec, ensure_ascii=False)
        with _LOCK:
            os.makedirs(os.path.dirname(_LOG), exist_ok=True)
            try:
                if os.path.getsize(_LOG) > _LOG_MAX_BYTES:
                    _log_rotate()
            except OSError:
                pass
            with io.open(_LOG, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
        _bump_db(rec['tool'], rec['category'], ok, rec['ms'])
    except Exception:
        pass


def _log_rotate():
    """轮转明细日志：agent_tool_usage.jsonl -> agent_tool_usage.jsonl.1（覆盖旧代）。"""
    rotated = _LOG + '.1'
    if os.path.exists(rotated):
        try:
            os.remove(rotated)
        except OSError:
            pass
    os.replace(_LOG, rotated)


_DB_INITED = False
_CONN = None  # 线程内复用连接，省去每次开关 sqlite 的开销（高频调用下明显）


def _db_conn():
    """返回复用的 SQLite 连接；失败返回 None。异常静默，统计绝不影响业务。"""
    global _CONN, _DB_INITED
    if _CONN is not None:
        return _CONN
    try:
        os.makedirs(os.path.dirname(_DB), exist_ok=True)
        conn = sqlite3.connect(_DB, timeout=3, check_same_thread=False)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA synchronous=NORMAL')
        conn.execute('''CREATE TABLE IF NOT EXISTS tool_usage_stats (
            day TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            calls INTEGER NOT NULL DEFAULT 0,
            errors INTEGER NOT NULL DEFAULT 0,
            total_ms INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, tool_name))''')
        conn.commit()
        _CONN = conn
        _DB_INITED = True
        return conn
    except Exception:
        _CONN = None
        return None


def _bump_db(tool, category, ok, ms):
    """SQLite 按天聚合计数：INSERT ON CONFLICT +1，复用连接，<0.3ms。
    任何异常静默吞掉；连接坏掉会置空下次自动重建。"""
    try:
        if not tool:
            return
        day = time.strftime('%Y-%m-%d')
        with _DB_LOCK:
            conn = _db_conn()
            if conn is None:
                return
            try:
                conn.execute(
                    '''INSERT INTO tool_usage_stats
                           (day, tool_name, category, calls, errors, total_ms)
                       VALUES (?, ?, ?, 1, ?, ?)
                       ON CONFLICT(day, tool_name) DO UPDATE SET
                           calls = calls + 1,
                           errors = errors + excluded.errors,
                           total_ms = total_ms + excluded.total_ms''',
                    (day, tool, category, 0 if ok else 1, ms))
                conn.commit()
            except sqlite3.Error:
                # 连接损坏/库被删等情况：关闭置空，下次调用自动重建
                try:
                    conn.close()
                except Exception:
                    pass
                globals()['_CONN'] = None
    except Exception:
        pass


def db_path():
    return _DB


def log_path():
    return _LOG


def stats(days=30, top=200):
    """聚合查询：近 N 天各工具的 calls/errors/total_ms，按调用量降序。
    返回 list[dict]，供 /api/tool/stats 接口与峰控 App 使用。只读，异常返回 []。"""
    try:
        import datetime as _dt
        since = (_dt.date.today() - _dt.timedelta(days=max(1, int(days) - 1))).isoformat()
        conn = sqlite3.connect(_DB)
        try:
            rows = conn.execute(
                '''SELECT tool_name, category,
                          SUM(calls), SUM(errors), SUM(total_ms),
                          COUNT(DISTINCT day) AS active_days, MIN(day), MAX(day)
                   FROM tool_usage_stats WHERE day >= ?
                   GROUP BY tool_name ORDER BY SUM(calls) DESC LIMIT ?''',
                (since, max(1, int(top)))).fetchall()
            return [
                {'tool': r[0], 'category': r[1], 'calls': r[2] or 0,
                 'errors': r[3] or 0, 'total_ms': r[4] or 0,
                 'active_days': r[5], 'first_day': r[6], 'last_day': r[7]}
                for r in rows]
        finally:
            conn.close()
    except Exception:
        return []
