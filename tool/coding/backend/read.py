#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""read - 读取文本文件"""
import os
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'read'


def handle(body, ctx):
    max_chars = int(body.get('max_chars', 8000) or 8000)
    paths = body.get('paths')
    if not paths:
        p = body.get('path', '')
        paths = [p] if p else []

    if not paths:
        ctx.send_json({'ok': False, 'error': 'No path specified'})
        return

    if len(paths) == 1:
        p = paths[0]
        try:
            if not os.path.isfile(p):
                ctx.send_json({'ok': False, 'error': 'File not found: ' + p})
                return
            with open(p, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read(max_chars + 1)
            truncated = len(content) > max_chars
            if truncated:
                content = content[:max_chars]
            size = os.path.getsize(p)
            ctx.send_json({'ok': True, 'path': p, 'content': content,
                           'truncated': truncated,
                           'meta': {'size': size, 'encoding': 'utf-8'}})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    results = []
    for p in paths:
        try:
            if not os.path.isfile(p):
                results.append({'path': p, 'error': 'File not found'})
                continue
            with open(p, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read(max_chars + 1)
            truncated = len(content) > max_chars
            if truncated:
                content = content[:max_chars]
            size = os.path.getsize(p)
            results.append({'path': p, 'content': content, 'truncated': truncated,
                            'meta': {'size': size, 'encoding': 'utf-8'}})
        except Exception as e:
            results.append({'path': p, 'error': str(e)})
    ctx.send_json({'ok': True, 'multi': True, 'files': results})
