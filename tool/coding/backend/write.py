#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""write - Write text files with bounded automatic backups."""

import os

from tool.coding.backend._backup import create_backup
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'write'


def _write_file(path, content):
    if not path:
        return {'path': path, 'error': 'No path specified'}
    try:
        backup_path = create_backup(path) if os.path.isfile(path) else None
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as file:
            file.write(content)
        return {
            'path': path,
            'size': len(content.encode('utf-8')),
            'backup': bool(backup_path),
            'backup_path': backup_path,
        }
    except Exception as exc:
        return {'path': path, 'error': str(exc)}


def handle(body, ctx):
    files = body.get('files')
    if not files:
        files = [{'path': body.get('path', ''), 'content': body.get('content', '')}]

    results = [_write_file(item.get('path', ''), item.get('content', '')) for item in files]
    if len(results) == 1:
        ctx.send_json({'ok': 'error' not in results[0], **results[0]})
    else:
        ctx.send_json({'ok': True, 'multi': True, 'files': results})
