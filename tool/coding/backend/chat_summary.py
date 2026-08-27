#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""chat_summary - 对话摘要管理"""
import os, json, time
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'chat_summary'

CATEGORY = 'chat_summary'


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'generate')
        session_id = body.get('session_id', '')
        session_ids = body.get('session_ids', None)
        summary = body.get('summary', '')
        summaries = body.get('summaries', None)
        title = body.get('title', '')
        limit = body.get('limit', 100)

        if not isinstance(limit, int) or limit < 1:
            limit = 100

        # 构建 session_id 列表
        if session_ids and isinstance(session_ids, list):
            sid_list = [s for s in session_ids if s]
        elif session_id:
            sid_list = [session_id]
        else:
            sid_list = []

        if action == 'generate':
            _do_generate(ctx, sid_list, limit)
        elif action == 'save':
            _do_save(ctx, sid_list, summary, summaries, title)
        elif action == 'read':
            _do_read(ctx, sid_list)
        elif action == 'list':
            _do_list(ctx)
        elif action == 'delete':
            _do_delete(ctx, sid_list)
        else:
            ctx.send_error('不支持的操作: ' + str(action))
    except Exception as e:
        ctx.send_error(str(e))


def _do_generate(ctx, sid_list, limit):
    """读取指定 session 的最近 limit 条消息，返回供 AI 生成摘要"""
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

            # 批量获取 model_id（从 canvas_nodes）
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
                    'SELECT role, content FROM chat_history '
                    'WHERE session_id = ? ORDER BY id DESC LIMIT ?',
                    (sid, limit)
                )
                rows = cur.fetchall()
                # 反转为时间正序
                messages = [
                    {'role': r['role'], 'content': r['content'] or ''}
                    for r in reversed(rows)
                ]

                total_messages = len(messages)
                user_messages = sum(1 for m in messages if m['role'] == 'user')
                assistant_messages = sum(1 for m in messages if m['role'] == 'assistant')

                session_title = sid_title_map.get(sid, sid)
                model_id = sid_model_map.get(sid)

                # 检查是否已有摘要
                cur.execute(
                    'SELECT value FROM app_data WHERE category = ? AND key = ?',
                    (CATEGORY, sid)
                )
                erow = cur.fetchone()
                existing_summary = None
                if erow:
                    try:
                        data = json.loads(erow['value'])
                        existing_summary = data.get('summary', erow['value'])
                    except (json.JSONDecodeError, TypeError):
                        existing_summary = erow['value']

                results.append({
                    'session_id': sid,
                    'title': session_title,
                    'model_id': model_id,
                    'total_messages': total_messages,
                    'user_messages': user_messages,
                    'assistant_messages': assistant_messages,
                    'existing_summary': existing_summary,
                    'messages': messages
                })
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'results': results,
        'sessions': len(results),
        'hint': '请根据以上对话内容生成摘要，然后使用 save 操作保存'
    })


def _do_save(ctx, sid_list, summary, summaries, title):
    """保存摘要到 app_data"""
    now = int(time.time() * 1000)
    saved_count = 0

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            # 批量保存
            if summaries and isinstance(summaries, list):
                for item in summaries:
                    if not isinstance(item, dict):
                        continue
                    sid = item.get('session_id', '')
                    s = item.get('summary', '')
                    if not sid or not s:
                        continue
                    data = json.dumps({
                        'summary': s,
                        'title': item.get('title', '')
                    }, ensure_ascii=False)
                    cur.execute(
                        'INSERT OR REPLACE INTO app_data '
                        '(category, key, value, created_at, updated_at) '
                        'VALUES (?, ?, ?, ?, ?)',
                        (CATEGORY, sid, data, now, now)
                    )
                    saved_count += 1
            elif sid_list and summary:
                for sid in sid_list:
                    data = json.dumps({
                        'summary': summary,
                        'title': title
                    }, ensure_ascii=False)
                    cur.execute(
                        'INSERT OR REPLACE INTO app_data '
                        '(category, key, value, created_at, updated_at) '
                        'VALUES (?, ?, ?, ?, ?)',
                        (CATEGORY, sid, data, now, now)
                    )
                    saved_count += 1
            else:
                ctx.send_error('需要提供 summaries 数组或 session_id + summary')
                return

            conn.commit()
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'saved_count': saved_count
    })


def _do_read(ctx, sid_list):
    """从 app_data 读取已保存的摘要"""
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            if sid_list:
                results = []
                # 批量获取标题
                ph = ','.join('?' for _ in sid_list)
                cur.execute(
                    'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                    tuple(sid_list)
                )
                sid_title_map = {}
                for r in cur.fetchall():
                    sid_title_map[r['id']] = r['name']

                for sid in sid_list:
                    cur.execute(
                        'SELECT value FROM app_data WHERE category = ? AND key = ?',
                        (CATEGORY, sid)
                    )
                    row = cur.fetchone()
                    if row:
                        try:
                            data = json.loads(row['value'])
                            summary_text = data.get('summary', row['value'])
                        except (json.JSONDecodeError, TypeError):
                            summary_text = row['value']

                        results.append({
                            'session_id': sid,
                            'title': sid_title_map.get(sid, sid),
                            'summary': summary_text
                        })
            else:
                # 读取全部
                cur.execute(
                    'SELECT key, value FROM app_data WHERE category = ?',
                    (CATEGORY,)
                )
                rows = cur.fetchall()

                # 批量获取标题
                all_sids = [r['key'] for r in rows if r['key']]
                sid_title_map = {}
                if all_sids:
                    ph = ','.join('?' for _ in all_sids)
                    cur.execute(
                        'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                        tuple(all_sids)
                    )
                    for r in cur.fetchall():
                        sid_title_map[r['id']] = r['name']

                results = []
                for row in rows:
                    sid = row['key']
                    try:
                        data = json.loads(row['value'])
                        summary_text = data.get('summary', row['value'])
                    except (json.JSONDecodeError, TypeError):
                        summary_text = row['value']

                    results.append({
                        'session_id': sid,
                        'title': sid_title_map.get(sid, sid),
                        'summary': summary_text
                    })
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'results': results
    })


def _do_list(ctx):
    """列出所有已保存的摘要"""
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()

            cur.execute(
                'SELECT key, value, updated_at FROM app_data '
                'WHERE category = ? ORDER BY updated_at DESC',
                (CATEGORY,)
            )
            rows = cur.fetchall()

            # 批量获取标题
            all_sids = [r['key'] for r in rows if r['key']]
            sid_title_map = {}
            if all_sids:
                ph = ','.join('?' for _ in all_sids)
                cur.execute(
                    'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                    tuple(all_sids)
                )
                for r in cur.fetchall():
                    sid_title_map[r['id']] = r['name']

            summaries = []
            for row in rows:
                sid = row['key']
                try:
                    data = json.loads(row['value'])
                    summary_text = data.get('summary', row['value'])
                    stored_title = data.get('title', '')
                except (json.JSONDecodeError, TypeError):
                    summary_text = row['value']
                    stored_title = ''

                title = stored_title or sid_title_map.get(sid, sid)

                # 预览：前 100 字
                preview = summary_text[:100]
                if len(summary_text) > 100:
                    preview += '...'

                summaries.append({
                    'session_id': sid,
                    'title': title,
                    'summary_preview': preview
                })
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'summaries': summaries,
        'count': len(summaries)
    })


def _do_delete(ctx, sid_list):
    """删除指定 session 的摘要"""
    if not sid_list:
        ctx.send_error('需要提供 session_id 或 session_ids')
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            cur = conn.cursor()
            placeholders = ','.join('?' for _ in sid_list)
            cur.execute(
                'DELETE FROM app_data WHERE category = ? AND key IN (' + placeholders + ')',
                (CATEGORY,) + tuple(sid_list)
            )
            conn.commit()
            deleted = cur.rowcount
        finally:
            conn.close()

    ctx.send_json({
        'ok': True,
        'deleted': deleted
    })
