#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""set_camera - 画布视口定位"""
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'set_camera'


def handle(body, ctx):
    target = body.get('target', '')
    x = body.get('x', 0)
    y = body.get('y', 0)

    if target == 'center':
        x, y = 0, 0
    elif target.startswith('chat:'):
        chat_id = target[5:]
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            cur.execute('SELECT x, y FROM canvas_nodes WHERE id=?', (chat_id,))
            row = cur.fetchone()
            conn.close()
            if row:
                x, y = row['x'], row['y']
            else:
                ctx.send_json({'ok': False, 'error': '对话框不存在: ' + chat_id, 'tool': 'set_camera'})
                return

    with ctx.db_lock:
        conn = ctx.get_db()
        conn.execute('UPDATE canvas_view SET x=?, y=?, updated_at=? WHERE id=1',
                     (x, y, int(__import__('time').time() * 1000)))
        conn.commit()
        conn.close()

    ctx.send_json({'ok': True, 'x': x, 'y': y, 'message': '视口已定位', 'tool': 'set_camera'})
