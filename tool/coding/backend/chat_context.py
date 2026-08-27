#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""chat_context - 直接读写聊天记录"""
import os, json, time
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'chat_context'


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'read')
        session_id = body.get('session_id', '')
        session_ids = body.get('session_ids', None)
        limit = body.get('limit', 10)
        messages = body.get('messages', None)
        role = body.get('role', '')
        content = body.get('content', '')
        message_id = body.get('message_id', None)
        message_ids = body.get('message_ids', None)
        model_id = body.get('model_id', '')

        if not isinstance(limit, int) or limit < 1:
            limit = 10

        # 构建 session_id 列表
        if session_ids and isinstance(session_ids, list):
            sid_list = [s for s in session_ids if s]
        elif session_id:
            sid_list = [session_id]
        else:
            sid_list = []

        if action == 'read':
            _do_read(ctx, sid_list, limit)
        elif action in ('insert', 'append'):
            _do_insert(ctx, sid_list, messages, role, content, model_id)
        elif action == 'update':
            _do_update(ctx, message_id, content, role, model_id)
        elif action == 'delete':
            _do_delete(ctx, message_id, message_ids)
        else:
            ctx.send_error('不支持的操作: ' + str(action))
    except Exception as e:
        ctx.send_error(str(e))


def _do_read(ctx, sid_list, limit):
    """读取指定 session 的最近 limit 条消息"""
    if not sid_list:
        ctx.send_error('需要提供 session_id 或 session_ids')
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            # 批量获取标题
            ph = ','.join('?' for _ in sid_list)
            cur.execute(
                'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                tuple(sid_list)
            )
            sid_title_map = {}
            for r in cur.fetchall():
                sid_title_map[r['id']] = r['name']

            results = []
            for sid in sid_list:
                cur.execute(
                    'SELECT id, role, content FROM chat_history '
                    'WHERE session_id = ? ORDER BY id DESC LIMIT ?',
                    (sid, limit)
                )
                rows = cur.fetchall()
                # 反转为时间正序
                msgs = [
                    {'id': r['id'], 'role': r['role'], 'content': r['content'] or ''}
                    for r in reversed(rows)
                ]

                title = sid_title_map.get(sid, sid)
                results.append({
                    'session_id': sid,
                    'title': title,
                    'count': len(msgs),
                    'messages': msgs
                })
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'action': 'read',
        'results': results,
        'sessions': len(results)
    })


def _do_insert(ctx, sid_list, messages, role, content, model_id):
    """插入消息（insert / append 行为相同）"""
    if not sid_list:
        ctx.send_error('需要提供 session_id 或 session_ids')
        return

    now = int(time.time() * 1000)

    # 构建要插入的消息列表
    msgs_to_insert = []
    if messages and isinstance(messages, list):
        for m in messages:
            if isinstance(m, dict):
                msgs_to_insert.append({
                    'role': m.get('role', 'user'),
                    'content': m.get('content', ''),
                    'model_id': m.get('model_id', '')
                })
    elif role and content:
        msgs_to_insert.append({
            'role': role,
            'content': content,
            'model_id': model_id or ''
        })
    else:
        ctx.send_error('需要提供 messages 数组或 role + content')
        return

    if not msgs_to_insert:
        ctx.send_error('没有可插入的消息')
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            results = []
            for sid in sid_list:
                count = 0
                for m in msgs_to_insert:
                    cur.execute(
                        'INSERT INTO chat_history (session_id, role, content, model_id, created_at) '
                        'VALUES (?, ?, ?, ?, ?)',
                        (sid, m['role'], m['content'], m['model_id'] or None, now)
                    )
                    count += 1
                conn.commit()
                results.append({'session_id': sid, 'count': count})
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'results': results,
        'sessions': len(results)
    })


def _do_update(ctx, message_id, content, role, model_id):
    """更新 message_id 指定的消息内容"""
    if message_id is None:
        ctx.send_error('需要提供 message_id')
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            # 检查消息是否存在
            cur.execute('SELECT id FROM chat_history WHERE id = ?', (message_id,))
            if not cur.fetchone():
                ctx.send_error('消息 ' + str(message_id) + ' 不存在')
                return

            # 构建更新字段
            updates = []
            params = []
            if content:
                updates.append('content = ?')
                params.append(content)
            if role:
                updates.append('role = ?')
                params.append(role)
            if model_id:
                updates.append('model_id = ?')
                params.append(model_id)

            if not updates:
                ctx.send_error('没有要更新的字段（content / role / model_id）')
                return

            params.append(message_id)
            cur.execute(
                'UPDATE chat_history SET ' + ', '.join(updates) + ' WHERE id = ?',
                tuple(params)
            )
            conn.commit()
            updated = cur.rowcount
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'message_id': message_id,
        'updated': updated
    })


def _do_delete(ctx, message_id, message_ids):
    """删除 message_id 或 message_ids 指定的消息"""
    ids_to_delete = []
    if message_ids and isinstance(message_ids, list):
        for i in message_ids:
            if i is not None:
                try:
                    ids_to_delete.append(int(i))
                except (ValueError, TypeError):
                    pass
    elif message_id is not None:
        try:
            ids_to_delete.append(int(message_id))
        except (ValueError, TypeError):
            ctx.send_error('message_id 必须是整数')
            return

    if not ids_to_delete:
        ctx.send_error('需要提供 message_id 或 message_ids')
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()
            placeholders = ','.join('?' for _ in ids_to_delete)
            cur.execute(
                'DELETE FROM chat_history WHERE id IN (' + placeholders + ')',
                tuple(ids_to_delete)
            )
            conn.commit()
            deleted = cur.rowcount
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'deleted': deleted
    })
