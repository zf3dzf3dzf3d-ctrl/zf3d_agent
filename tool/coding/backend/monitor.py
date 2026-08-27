#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""monitor - 监控队列管理"""
import os, json, time
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'monitor'

CATEGORY = 'monitor_queue'


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'status')
        chat_id = body.get('chat_id', '')
        message = body.get('message', '')
        session_id = body.get('session_id', '')
        session_ids = body.get('session_ids', None)
        limit = body.get('limit', 5)
        context_limit = body.get('context_limit', 10)

        if not isinstance(limit, int) or limit < 1:
            limit = 5
        if not isinstance(context_limit, int) or context_limit < 1:
            context_limit = 10

        # 构建 session_id 列表
        if session_ids and isinstance(session_ids, list):
            sid_list = [s for s in session_ids if s]
        elif session_id:
            sid_list = [session_id]
        else:
            sid_list = []

        if action == 'send':
            _do_send(ctx, chat_id, message)
        elif action == 'status':
            _do_status(ctx, sid_list, limit)
        elif action == 'list':
            _do_list(ctx)
        elif action == 'merge':
            _do_merge(ctx, chat_id, session_id, context_limit)
        else:
            ctx.send_error('不支持的操作: ' + str(action))
    except Exception as e:
        ctx.send_error(str(e))


def _do_send(ctx, chat_id, message):
    """向 chat_id 的队列发送消息"""
    if not chat_id:
        ctx.send_error('需要提供 chat_id')
        return
    if not message:
        ctx.send_error('需要提供 message')
        return

    now = int(time.time() * 1000)

    # 存储为 JSON，包含 chat_id 字段以便与现有 handler_routes 兼容
    data = json.dumps({
        'chat_id': chat_id,
        'message': message,
        'timestamp': now,
        'status': 'pending'
    }, ensure_ascii=False)

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()
            cur.execute(
                'INSERT INTO app_data (category, key, value, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?)',
                (CATEGORY, chat_id, data, now, now)
            )
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'message': '已发送消息到窗口' + chat_id,
        'chat_id': chat_id
    })


def _do_status(ctx, sid_list, limit):
    """查询指定 session 的最近消息"""
    if not sid_list:
        ctx.send_error('需要提供 session_id 或 session_ids')
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            # 批量获取标题和 model_id
            ph = ','.join('?' for _ in sid_list)
            cur.execute(
                'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                tuple(sid_list)
            )
            sid_title_map = {}
            for r in cur.fetchall():
                sid_title_map[r['id']] = r['name']

            cur.execute(
                'SELECT id, model_id FROM canvas_nodes WHERE id IN (' + ph + ')',
                tuple(sid_list)
            )
            sid_model_map = {}
            for r in cur.fetchall():
                sid_model_map[r['id']] = r['model_id']

            results = []
            for sid in sid_list:
                # 获取最近 limit 条消息
                cur.execute(
                    'SELECT id, role, content, created_at FROM chat_history '
                    'WHERE session_id = ? ORDER BY id DESC LIMIT ?',
                    (sid, limit)
                )
                rows = cur.fetchall()
                # 反转为时间正序
                messages = [
                    {
                        'id': r['id'],
                        'role': r['role'],
                        'content': r['content'] or '',
                        'created_at': r['created_at']
                    }
                    for r in reversed(rows)
                ]

                # 查询排队中的消息
                cur.execute(
                    'SELECT value FROM app_data WHERE category = ? AND key = ? '
                    'ORDER BY created_at ASC',
                    (CATEGORY, sid)
                )
                queue_rows = cur.fetchall()
                pending_messages = []
                for qr in queue_rows:
                    try:
                        qdata = json.loads(qr['value'])
                        pending_messages.append({
                            'message': qdata.get('message', ''),
                            'timestamp': qdata.get('timestamp', 0),
                            'status': qdata.get('status', 'pending')
                        })
                    except (json.JSONDecodeError, TypeError):
                        pass

                results.append({
                    'session_id': sid,
                    'title': sid_title_map.get(sid, sid),
                    'model_id': sid_model_map.get(sid),
                    'message_count': len(messages),
                    'messages': messages,
                    'queue_count': len(pending_messages),
                    'queue_messages': pending_messages
                })
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'message': '查询了' + str(len(results)) + '个窗口',
        'results': results,
        'sessions': len(results)
    })


def _do_list(ctx):
    """列出所有 canvas_nodes（对话框）及其队列状态"""
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            # 获取所有画布节点
            cur.execute(
                'SELECT id, title, model_id FROM canvas_nodes ORDER BY z_index'
            )
            nodes = cur.fetchall()

            results = []
            for node in nodes:
                node_id = node['id']
                title = node['title'] or node_id
                model_id = node['model_id']

                # 获取消息总数
                cur.execute(
                    'SELECT COUNT(*) AS cnt FROM chat_history WHERE session_id = ?',
                    (node_id,)
                )
                cnt_row = cur.fetchone()
                msg_count = cnt_row['cnt'] if cnt_row else 0

                # 获取排队消息数
                cur.execute(
                    'SELECT COUNT(*) AS cnt FROM app_data '
                    'WHERE category = ? AND key = ?',
                    (CATEGORY, node_id)
                )
                q_cnt_row = cur.fetchone()
                queue_count = q_cnt_row['cnt'] if q_cnt_row else 0

                # 获取最后一条消息
                cur.execute(
                    'SELECT content, role, created_at FROM chat_history '
                    'WHERE session_id = ? ORDER BY id DESC LIMIT 1',
                    (node_id,)
                )
                last_row = cur.fetchone()
                last_message = None
                if last_row:
                    last_content = last_row['content'] or ''
                    last_message = {
                        'role': last_row['role'],
                        'content': last_content[:100],
                        'created_at': last_row['created_at']
                    }

                results.append({
                    'chat_id': node_id,
                    'title': title,
                    'model_id': model_id,
                    'message_count': msg_count,
                    'queue_count': queue_count,
                    'last_message': last_message
                })
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'message': '共找到' + str(len(results)) + '个对话框',
        'results': results,
        'count': len(results)
    })


def _do_merge(ctx, chat_id, target_session_id, context_limit):
    """合并指定窗口的排队消息到新窗口"""
    if not chat_id:
        ctx.send_error('需要提供 chat_id（源窗口ID）')
        return
    if not target_session_id:
        ctx.send_error('需要提供 session_id（目标窗口ID）')
        return

    now = int(time.time() * 1000)

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            # 获取源窗口的排队消息
            cur.execute(
                'SELECT id, value FROM app_data '
                'WHERE category = ? AND key = ? ORDER BY created_at ASC',
                (CATEGORY, chat_id)
            )
            queue_rows = cur.fetchall()

            if not queue_rows:
                ctx.send_json({
                    'ok': True,
                    'message': '窗口' + chat_id + '没有排队消息',
                    'merged_count': 0
                })
                return

            merged_count = 0
            for qr in queue_rows:
                try:
                    qdata = json.loads(qr['value'])
                    msg_content = qdata.get('message', '')
                    if msg_content:
                        # 插入到目标 session 的 chat_history
                        cur.execute(
                            'INSERT INTO chat_history (session_id, role, content, created_at) '
                            'VALUES (?, ?, ?, ?)',
                            (target_session_id, 'user', msg_content, now + merged_count)
                        )
                        merged_count += 1
                except (json.JSONDecodeError, TypeError):
                    pass

            # 删除源窗口的排队消息
            cur.execute(
                'DELETE FROM app_data WHERE category = ? AND key = ?',
                (CATEGORY, chat_id)
            )
            conn.commit()

            # 获取目标窗口合并后的最近 context_limit 条消息作为上下文
            cur.execute(
                'SELECT id, role, content FROM chat_history '
                'WHERE session_id = ? ORDER BY id DESC LIMIT ?',
                (target_session_id, context_limit)
            )
            ctx_rows = cur.fetchall()
            context_messages = [
                {'id': r['id'], 'role': r['role'], 'content': r['content'] or ''}
                for r in reversed(ctx_rows)
            ]
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'message': '已将窗口' + chat_id + '的' + str(merged_count)
                   + '条排队消息合并到窗口' + target_session_id,
        'merged_count': merged_count,
        'source_chat_id': chat_id,
        'target_session_id': target_session_id,
        'context_messages': context_messages
    })
