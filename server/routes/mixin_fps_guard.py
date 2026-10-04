#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FPS 坠落真凶追查模块 (FPS<10 自动记录)
主脑要求: 当 fps 帧数下降到 10 以下时必须记录一次, 并找出真凶。
系统内所有工具(一个不许漏)都会被前端 AOP 包装监控, 低帧瞬间全量上报。
数据落点:
  - SQLite app_data 表 category='fps_crime' (供 /api/fps-guard/list 查询)
  - private/logs/fps-guard-YYYYMMDD.jsonl (供人工/主脑翻查原始现场)
"""
import os
import json
import time
import threading

try:
    from db import get_db, _db_lock  # 与 server.py 同目录
except ImportError:  # 兜底
    from .db import get_db, _db_lock  # type: ignore

_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'private', 'logs')
_LOCK = threading.Lock()

_FPS_CREATE_SQL = (
    "CREATE TABLE IF NOT EXISTS app_data ("
    " id INTEGER PRIMARY KEY AUTOINCREMENT,"
    " category TEXT NOT NULL,"
    " key TEXT,"
    " value TEXT,"
    " created_at TEXT DEFAULT (datetime('now','localtime')))"
)


def _ensure_table(conn):
    try:
        conn.execute(_FPS_CREATE_SQL)
    except Exception:
        pass


def record_fps_crime(payload):
    """记录一次 fps<10 的现场。payload 由前端 fps-guard.js 上报。"""
    fps = payload.get('fps')
    try:
        fps = float(fps)
    except (TypeError, ValueError):
        fps = -1
    rec = {
        'time': time.strftime('%Y-%m-%d %H:%M:%S'),
        'fps': fps,
        'url': payload.get('url') or '',
        'agent': payload.get('userAgent') or '',
        'active_tool': payload.get('activeTool') or None,       # 触发瞬间的活动工具
        'active_tool_ms': payload.get('activeToolMs'),          # 该工具已运行毫秒
        'slowest_tools': payload.get('slowestTools') or [],     # 本页耗时排行 Top
        'timeline': payload.get('timeline') or [],              # 低帧前 60s 工具调用时间线
        'long_tasks': payload.get('longTasks') or [],           # 主线程长任务(阻塞元凶)
        'extra': payload.get('extra') or {},
    }
    line = json.dumps(rec, ensure_ascii=False)

    # 1) JSONL 现场日志
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
        path = os.path.join(_LOG_DIR, 'fps-guard-%s.jsonl' % time.strftime('%Y%m%d'))
        with _LOCK:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
    except Exception:
        pass

    # 2) SQLite 存档 (供主脑查询)
    try:
        with _db_lock:
            conn = get_db()
            _ensure_table(conn)
            conn.execute(
                "INSERT INTO app_data(category, key, value) VALUES (?,?,?)",
                ('fps_crive' if False else 'fps_crime', 'fps_%d' % int(fps), line),
            )
            conn.commit()
    except Exception:
        pass
    return rec


def list_fps_crimes(limit=50):
    """主脑查询: 最近的低帧现场, 按 fps 升序(最惨的在前)。"""
    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 50
    out = []
    try:
        with _db_lock:
            conn = get_db()
            _ensure_table(conn)
            cur = conn.cursor()
            cur.execute(
                "SELECT id, created_at, value FROM app_data WHERE category='fps_crime' "
                "ORDER BY id DESC LIMIT ?", (limit,))
            for rid, ts, val in cur.fetchall():
                try:
                    data = json.loads(val)
                except Exception:
                    data = {'raw': val}
                data['_id'] = rid
                data['_db_time'] = ts
                out.append(data)
    except Exception:
        pass
    out.sort(key=lambda r: r.get('fps', 999))
    return out


class MixinFpsGuard:
    """HTTP mixin: 低帧上报 + 主脑查询"""

    def _handle_fps_guard_report(self):
        data = self._read_json() or {}
        rec = record_fps_crime(data)
        self._send_json({'ok': True, 'recorded': True, 'fps': rec.get('fps')})

    def _handle_fps_guard_list(self, query=None):
        limit = 50
        try:
            if query and query.get('limit'):
                limit = int(query['limit'][0])
        except Exception:
            pass
        self._send_json({'ok': True, 'items': list_fps_crimes(limit)})
