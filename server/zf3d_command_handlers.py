# -*- coding: utf-8 -*-
"""
zf3d 命令处理器 + 注册表（重构 S3，自 zf3d_commands.py 拆出，2026-11-10）
====================================================================
含 chat / new_chat / canvas / restart 四个远程命令处理器及 COMMAND_HANDLERS 注册表。
依赖通过 build() 注入（_db_write / _log / _call_llm），与主模块无循环 import。
对外：build(...) -> COMMAND_HANDLERS dict；逻辑与拆分前逐字一致（仅依赖名注入）。
"""
import os
import sys
import json
import time
import threading
import subprocess


def build(_db_write, _log, _call_llm):
    """返回 COMMAND_HANDLERS 注册表（依赖注入版本）。"""

    def _handle_new_chat(cmd):
        """new_chat 命令：本地创建新会话，回传 session_id。
        手机端"新建对话"按钮下发此命令，本地电脑真正建一个新对话，
        之后手机与电脑在同一 session_id 下聊天，实现双向一致。"""
        try:
            try:
                data = json.loads(cmd.get('data') or '{}')
            except Exception:
                data = {}
            import uuid, time as _t
            if True:
                # 云端会话映射：手机端先在云端建会话（数字id），本地建 remote_<id> 对应会话
                cloud_sid = str(data.get('session_id') or '').strip()
                if cloud_sid and cloud_sid != '0':
                    sid = 'remote_' + cloud_sid
                else:
                    sid = str(int(_t.time() * 1000)) + uuid.uuid4().hex[:6]
                name = '远程对话 ' + _t.strftime('%m-%d %H:%M')
                def _w(conn, sid=sid, name=name):
                    cur = conn.execute('SELECT 1 FROM sessions WHERE id=?', (sid,))
                    if not cur.fetchone():
                        conn.execute('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                                     (sid, name, int(_t.time() * 1000), int(_t.time() * 1000)))
                        conn.commit()
            # 【提速 2026-10-27】不再排全局 _db_lock：单行 INSERT 开独立短连接
            # + 3s busy_timeout 直接写（WAL 下安全），避免被长事务堵 8s；失败回退 _db_write。
            try:
                import sqlite3 as _sq
                from config import DB_PATH as _dbp
                _conn = _sq.connect(_dbp, timeout=3)
                try:
                    _conn.execute('PRAGMA busy_timeout=3000')
                    _w(_conn)
                finally:
                    _conn.close()
                _log('远程新建会话: %s（直连快写）' % sid)
                return json.dumps({'session_id': sid, 'name': name}), 1
            except Exception:
                _db_write(_w)
                _log('远程新建会话: %s' % sid)
                return json.dumps({'session_id': sid, 'name': name}), 1
        except Exception as e:
            _log('new_chat error: %s' % e)
            return '[新建对话失败] %s' % e, 0


    def _handle_chat(cmd):
        """chat 命令：取本地会话历史 → 调模型 → 写回本地 chat_history（自动镜像上云）→ 回传。"""
        try:
            data = json.loads(cmd.get('data') or '{}')
        except Exception:
            data = {}
        message = str(data.get('message') or '').strip()
        session_id = str(data.get('session_id') or 0).strip()
        model_name = str(data.get('model_name') or data.get('model') or '').strip()
        if not message:
            return '（空消息）', 0

        import time as _t

        # session_id 为 0/空 时自动本地新建会话（兜底）
        if not session_id or session_id == '0':
            try:
                import uuid
                session_id = str(int(_t.time() * 1000)) + uuid.uuid4().hex[:6]
                def _w(conn, sid=session_id):
                    conn.execute('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?,?,?,?)',
                                 (sid, '远程对话 ' + _t.strftime('%m-%d %H:%M'),
                                  int(_t.time() * 1000), int(_t.time() * 1000)))
                    conn.commit()
                _db_write(_w)
            except Exception as e:
                _log('auto new session error: %s' % e)
                return '[新建会话失败] %s' % e, 0

        # 云端数字会话 id → 本地 remote_ 前缀命名空间（与 _handle_new_chat 映射一致）
        if session_id.isdigit():
            session_id = 'remote_' + session_id

        now_ms = int(_t.time() * 1000)
        # 写入用户消息到本地 chat_history（写必拿 _db_lock）
        def _w(conn):
            conn.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                         (session_id, 'user', message, now_ms))
            conn.commit()
        _db_write(_w)
        try:
            from db import get_db
            c = get_db()
            if True:
                # 取本地历史作为上下文（最近 12 条）
                rows = c.execute(
                    "SELECT role, content FROM chat_history WHERE session_id=? AND role IN ('user','assistant') "
                    "ORDER BY id DESC LIMIT 12", (session_id,)).fetchall()
        except Exception as e:
            _log('local history(%s) error: %s' % (session_id, e))
            rows = []
        history = [{'role': r, 'content': ct} for r, ct in reversed(rows)]
        if history and history[-1].get('role') == 'user':
            history = history[:-1]  # 最后一条是刚写入的用户消息，去重

        reply, err = _call_llm(message, history, model_name=model_name)
        if err:
            return '[远程对话错误] %s' % err, 0
        # AI 回复写回本地 chat_history（session 更新时间一并刷新，写必拿 _db_lock）
        def _w2(conn):
            conn.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                         (session_id, 'assistant', reply, int(_t.time() * 1000)))
            conn.execute('UPDATE sessions SET updated_at=? WHERE id=?',
                         (int(_t.time() * 1000), session_id))
            conn.commit()
        _db_write(_w2)
        # 回传结果带 session_id，手机端可同步会话归属
        return json.dumps({'session_id': session_id, 'reply': reply}), 1


    def _handle_canvas(cmd):
        """canvas 命令：手机端画布同步。
        action=get → 返回本地画布快照（canvas_view 视图 + canvas_nodes 节点列表）
        action=set → 手机端把视图/节点位置写回本地
        """
        try:
            data = json.loads(cmd.get('data') or '{}')
        except Exception:
            data = {}
        action = str(data.get('action') or 'get')
        import json as _j, time as _t
        try:
            from db import get_db
            c = get_db()
            if True:
                if action == 'set':
                    view = data.get('view') or {}
                    nodes = data.get('nodes') or []
                    def _w(conn):
                        if view:
                            conn.execute("INSERT OR REPLACE INTO canvas_view (id, x, y, scale, updated_at) VALUES (1,?,?,?,?)",
                                         (float(view.get('x') or 0), float(view.get('y') or 0),
                                          float(view.get('scale') or 1), int(_t.time() * 1000)))
                        n = 0
                        for nd in nodes:
                            nid = str(nd.get('id') or '')
                            if not nid:
                                continue
                            try:
                                conn.execute('UPDATE canvas_nodes SET x=?, y=?, w=?, h=?, updated_at=? WHERE id=?',
                                             (float(nd.get('x') or 0), float(nd.get('y') or 0),
                                              float(nd.get('w') or 0) or None, float(nd.get('h') or 0) or None,
                                              int(_t.time() * 1000), nid))
                                n += 1
                            except Exception:
                                pass
                        conn.commit()
                        return n
                    n = _db_write(_w, default=0) or 0
                    _log('canvas set: view=%s nodes=%d' % (view, n))
                    return _j.dumps({'ok': 1, 'updated': n}), 1
                else:
                    view = {}
                    try:
                        row = c.execute('SELECT x, y, scale FROM canvas_view WHERE id=1').fetchone()
                        if row:
                            view = {'x': row[0], 'y': row[1], 'scale': row[2]}
                    except Exception:
                        pass
                    nodes = []
                    try:
                        for r in c.execute('SELECT id, title, x, y, w, h, model_id FROM canvas_nodes ORDER BY updated_at DESC LIMIT 100'):
                            nodes.append({'id': r[0], 'title': r[1] or '', 'x': r[2] or 0, 'y': r[3] or 0,
                                          'w': r[4] or 0, 'h': r[5] or 0, 'model_id': r[6] or ''})
                    except Exception:
                        pass
                    return _j.dumps({'view': view, 'nodes': nodes}), 1
        except Exception as e:
            _log('canvas error: %s' % e)
            return '[画布同步失败] %s' % e, 0


    def _handle_restart(cmd):
        """restart 命令：延迟调用 restart_server.py 重启后台服务。"""
        _log('收到远程重启命令，2 秒后执行 restart_server.py')

        def _do_restart():
            time.sleep(2)
            try:
                python_exe = sys.executable or 'python'
                subprocess.Popen(
                    [python_exe, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'restart_server.py')],
                    cwd=os.path.dirname(os.path.abspath(__file__)),
                    creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as e:
                _log('restart error: %s' % e)

        threading.Thread(target=_do_restart, daemon=True).start()
        return '✅ 重启指令已接收，后台服务将在几秒后重启（预计 10~20 秒内恢复）', 1


    COMMAND_HANDLERS = {
        'chat': _handle_chat,
        'new_chat': _handle_new_chat,
        'canvas': _handle_canvas,
        'restart': _handle_restart,
    }
    return COMMAND_HANDLERS
