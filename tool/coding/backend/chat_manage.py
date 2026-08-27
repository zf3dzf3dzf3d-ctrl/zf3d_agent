#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""chat_manage - 对话框管理"""
import time
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'chat_manage'


def handle(body, ctx):
    action = body.get('action', 'list')

    if action == 'list':
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            cur.execute('SELECT * FROM canvas_nodes ORDER BY created_at')
            nodes = [dict(r) for r in cur.fetchall()]
            conn.close()
        ctx.send_json({'ok': True, 'nodes': nodes, 'count': len(nodes), 'tool': 'chat_manage'})
        return

    if action == 'create':
        now = int(time.time() * 1000)
        chat_id = body.get('chat_id', 'cb' + str(now))
        title = body.get('title', '')
        model_id = body.get('model_id', '')
        x = body.get('x', 0)
        y = body.get('y', 0)
        with ctx.db_lock:
            conn = ctx.get_db()
            conn.execute('INSERT OR REPLACE INTO canvas_nodes (id, title, model_id, x, y, w, h, collapsed, z_index, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                         (chat_id, title, model_id, x, y, 320, 420, 0, 50, now, now))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'chat_id': chat_id, 'message': '已创建对话框: ' + chat_id, 'tool': 'chat_manage'})
        return

    if action == 'close':
        chat_id = body.get('chat_id', '')
        if not chat_id:
            ctx.send_json({'ok': False, 'error': '缺少 chat_id', 'tool': 'chat_manage'})
            return
        with ctx.db_lock:
            conn = ctx.get_db()
            conn.execute('DELETE FROM canvas_nodes WHERE id=?', (chat_id,))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'chat_id': chat_id, 'message': '已关闭对话框: ' + chat_id, 'tool': 'chat_manage'})
        return

    if action == 'move':
        chat_id = body.get('chat_id', '')
        x = body.get('x', 0)
        y = body.get('y', 0)
        now = int(time.time() * 1000)
        with ctx.db_lock:
            conn = ctx.get_db()
            conn.execute('UPDATE canvas_nodes SET x=?, y=?, updated_at=? WHERE id=?', (x, y, now, chat_id))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'chat_id': chat_id, 'x': x, 'y': y, 'message': '已移动对话框', 'tool': 'chat_manage'})
        return

    if action == 'send':
        chat_id = body.get('chat_id', '')
        message = body.get('message', '')
        now = int(time.time() * 1000)
        with ctx.db_lock:
            conn = ctx.get_db()
            conn.execute('INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                         (chat_id, 'user', message, now))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'chat_id': chat_id, 'message': '已发送消息', 'tool': 'chat_manage'})
        return

    if action == 'arrange':
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            cur.execute('SELECT id FROM canvas_nodes ORDER BY created_at')
            nodes = cur.fetchall()
            now = int(time.time() * 1000)
            spacing = 360
            for i, node in enumerate(nodes):
                conn.execute('UPDATE canvas_nodes SET x=?, updated_at=? WHERE id=?',
                             (i * spacing, now, node['id']))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'count': len(nodes), 'message': '已排列 %d 个对话框' % len(nodes), 'tool': 'chat_manage'})
        return

    ctx.send_json({'ok': False, 'error': '未知 action: ' + action, 'tool': 'chat_manage'})
