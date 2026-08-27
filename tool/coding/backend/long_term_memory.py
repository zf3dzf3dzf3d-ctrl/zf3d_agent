#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""long_term_memory - 长期记忆管理"""

import os
import json
import time
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'long_term_memory'

CATEGORY = 'long_term_memory'


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'list')

        if action == 'save':
            _do_save(body, ctx)
        elif action == 'get':
            _do_get(body, ctx)
        elif action == 'search':
            _do_search(body, ctx)
        elif action == 'list':
            _do_list(body, ctx)
        elif action == 'delete':
            _do_delete(body, ctx)
        else:
            ctx.send_json({'ok': False, 'error': f'未知操作: {action}'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})


def _do_save(body, ctx):
    """创建记忆"""
    title = body.get('title', '')
    content = body.get('content', '')
    keywords = body.get('keywords', [])
    tags = body.get('tags', [])

    if not title and not content:
        ctx.send_json({'ok': False, 'error': '需要提供 title 或 content'})
        return

    mem_id = 'mem_' + str(int(time.time() * 1000))
    now = int(time.time() * 1000)
    memory = {
        'id': mem_id,
        'title': title,
        'content': content,
        'keywords': keywords if isinstance(keywords, list) else [],
        'tags': tags if isinstance(tags, list) else [],
        'created_at': now,
        'updated_at': now
    }

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            conn.execute(
                'INSERT INTO app_data (category, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                (CATEGORY, mem_id, json.dumps(memory, ensure_ascii=False), now, now)
            )
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'memory': memory})


def _do_get(body, ctx):
    """按ID获取记忆"""
    memory_id = body.get('memory_id')
    memory_ids = body.get('memory_ids')

    ids = []
    if memory_id:
        ids = [memory_id]
    elif memory_ids and isinstance(memory_ids, list):
        ids = memory_ids

    if not ids:
        ctx.send_json({'ok': False, 'error': '需要提供 memory_id 或 memory_ids'})
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            placeholders = ','.join('?' * len(ids))
            rows = conn.execute(
                f'SELECT value FROM app_data WHERE category=? AND key IN ({placeholders})',
                [CATEGORY] + ids
            ).fetchall()
        finally:
            conn.close()

    memories = []
    for row in rows:
        try:
            memories.append(json.loads(row['value']))
        except Exception:
            pass

    ctx.send_json({'ok': True, 'memories': memories, 'count': len(memories)})


def _do_search(body, ctx):
    """搜索记忆"""
    keyword = body.get('keyword', '')
    keywords = body.get('keywords', [])
    match_mode = body.get('match_mode', 'any')  # any=OR, all=AND
    limit = body.get('limit', 20)

    search_terms = []
    if keyword:
        search_terms.append(keyword)
    if keywords and isinstance(keywords, list):
        search_terms.extend(keywords)

    if not search_terms:
        ctx.send_json({'ok': False, 'error': '需要提供 keyword 或 keywords'})
        return

    search_terms_lower = [t.lower() for t in search_terms]

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            rows = conn.execute(
                'SELECT value FROM app_data WHERE category=? ORDER BY created_at DESC',
                [CATEGORY]
            ).fetchall()
        finally:
            conn.close()

    matched = []
    for row in rows:
        try:
            mem = json.loads(row['value'])
        except Exception:
            continue

        searchable = ' '.join([
            mem.get('title', ''),
            mem.get('content', ''),
            ' '.join(mem.get('keywords', [])),
            ' '.join(mem.get('tags', []))
        ]).lower()

        if match_mode == 'all':
            # 所有关键词都必须匹配
            if all(term in searchable for term in search_terms_lower):
                matched.append(mem)
        else:
            # 任一关键词匹配即可
            if any(term in searchable for term in search_terms_lower):
                matched.append(mem)

        if len(matched) >= limit:
            break

    ctx.send_json({'ok': True, 'memories': matched, 'count': len(matched)})


def _do_list(body, ctx):
    """列出所有记忆"""
    limit = body.get('limit', 20)

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            rows = conn.execute(
                'SELECT value FROM app_data WHERE category=? ORDER BY created_at DESC LIMIT ?',
                [CATEGORY, limit]
            ).fetchall()
        finally:
            conn.close()

    memories = []
    for row in rows:
        try:
            memories.append(json.loads(row['value']))
        except Exception:
            pass

    ctx.send_json({'ok': True, 'memories': memories, 'count': len(memories)})


def _do_delete(body, ctx):
    """按ID删除记忆"""
    memory_id = body.get('memory_id')
    memory_ids = body.get('memory_ids')

    ids = []
    if memory_id:
        ids = [memory_id]
    elif memory_ids and isinstance(memory_ids, list):
        ids = memory_ids

    if not ids:
        ctx.send_json({'ok': False, 'error': '需要提供 memory_id 或 memory_ids'})
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            placeholders = ','.join('?' * len(ids))
            cur = conn.execute(
                f'DELETE FROM app_data WHERE category=? AND key IN ({placeholders})',
                [CATEGORY] + ids
            )
            deleted = cur.rowcount
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'deleted': deleted})
