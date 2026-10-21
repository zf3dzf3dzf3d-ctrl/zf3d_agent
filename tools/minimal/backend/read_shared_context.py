#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
read_shared_context - 共享上下文池读取工具
读取 analyze_project 等工具写入的共享数据（app_data 表，全局共享，
不按对话隔离），供流程图每个节点/任意对话共同使用。
"""
import json
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'read_shared_context'
CATEGORY = 'analyze_project'  # 与 analyze_project 共用同一类别，读同一份数据

VALID_KEYS = ('project_analysis',)


def _get_conn(ctx):
    """在 db_lock 保护下获取数据库连接（调用方负责 close）"""
    with ctx.db_lock:
        conn = ctx.get_db()
    return conn


def handle(body, ctx):
    try:
        key = body.get('key') or 'project_analysis'
        if key not in VALID_KEYS:
            return ctx.send_json({
                'ok': False,
                'error': f'不支持的 key: {key}，可用: {list(VALID_KEYS)}',
            })
        part = body.get('part') or 'summary'   # summary/files/routes/mermaid/all
        limit = min(int(body.get('limit') or 200), 1000)

        conn = _get_conn(ctx)
        try:
            row = conn.execute(
                'SELECT value FROM app_data WHERE category=? AND key=?',
                [CATEGORY, key]).fetchone()
        finally:
            conn.close()
        if not row:
            return ctx.send_json({
                'ok': False,
                'error': '尚无分析数据，请先调用 analyze_project（action=analyze）。',
            })
        data = json.loads(row['value'])

        if part == 'summary':
            out = {'root': data['root'], 'analyzed_at': data['analyzed_at'],
                   'summary': data['summary']}
        elif part == 'mermaid':
            out = {'root': data['root'], 'mermaid': data['mermaid']}
        elif part == 'files':
            out = {'root': data['root'],
                   'total': len(data['files']),
                   'files': data['files'][:limit]}
        elif part == 'routes':
            out = {'root': data['root'],
                   'total': len(data['routes']),
                   'routes': data['routes'][:limit]}
        else:  # all
            out = data

        return ctx.send_json({'ok': True, 'part': part, 'data': out})
    except Exception as e:
        return ctx.send_json({'ok': False, 'error': str(e)})
