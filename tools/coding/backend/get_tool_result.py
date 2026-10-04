#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""get_tool_result - 查回已丢弃的工具结果"""
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'get_tool_result'

_archive_store = {}
_counter = 0


def handle(body, ctx):
    global _counter
    chat_id = body.get('_chat_id', '_default')
    action = body.get('action', 'list')
    archive = _archive_store.get(chat_id, [])

    if action == 'get' and body.get('id') is not None:
        ga_id = int(body['id'])
        found = None
        for item in archive:
            if item['id'] == ga_id:
                found = item
                break
        if found:
            ctx.send_json({
                'ok': True,
                'message': '存档 #%d [%s]\n\n%s' % (found['id'], found['toolName'], found['content']),
                'id': found['id'], 'toolName': found['toolName'], 'content': found['content'],
                'tool': 'get_tool_result'
            })
        else:
            ctx.send_json({'ok': False, 'message': '未找到存档 #%d' % ga_id, 'tool': 'get_tool_result'})
    else:
        if not archive:
            ctx.send_json({'ok': True, 'message': '当前没有已存档的工具结果。', 'archive': [], 'tool': 'get_tool_result'})
        else:
            lines = ['已存档 %d 条工具结果：' % len(archive)]
            for item in archive:
                preview = item['content'][:80]
                if len(item['content']) > 80:
                    preview += '...'
                lines.append('#%d [%s] %s' % (item['id'], item['toolName'], preview))
            lines.append('\n使用 action=get + id 查回完整内容。')
            ctx.send_json({'ok': True, 'message': '\n'.join(lines), 'archive': [
                {'id': a['id'], 'toolName': a['toolName'], 'contentLength': len(a['content'])} for a in archive
            ], 'tool': 'get_tool_result'})
