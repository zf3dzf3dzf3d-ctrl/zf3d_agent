#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""read_lines - 按行读取文件"""
import os
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'read_lines'


def handle(body, ctx):
    path = body.get('path', '')
    paths = body.get('paths')

    start = max(1, int(body.get('start', 1) or 1))
    end = body.get('end')
    contains = body.get('contains', '')
    line_char_limit = int(body.get('line_char_limit', 0) or 0)
    num_only = body.get('num', False)

    if paths and isinstance(paths, list):
        results = []
        for p in paths:
            try:
                if not os.path.isfile(p):
                    results.append({'path': p, 'error': 'File not found'})
                    continue
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    all_lines = f.readlines()
                if num_only:
                    results.append({'path': p, 'total_lines': len(all_lines)})
                    continue
                s = max(1, start)
                e = min(len(all_lines), end) if end else len(all_lines)
                out_lines = []
                for idx in range(s - 1, e):
                    line = all_lines[idx].rstrip('\n\r')
                    if line_char_limit and len(line) > line_char_limit:
                        line = line[:line_char_limit] + '...'
                    out_lines.append('%d: %s' % (idx + 1, line))
                results.append({'path': p, 'lines': out_lines, 'total_lines': len(all_lines)})
            except Exception as e:
                results.append({'path': p, 'error': str(e)})
        ctx.send_json({'ok': True, 'multi': True, 'files': results})
        return

    if not path:
        ctx.send_json({'ok': False, 'error': 'No path specified'})
        return
    if not os.path.isfile(path):
        ctx.send_json({'ok': False, 'error': 'File not found: ' + path})
        return

    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            all_lines = f.readlines()
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
        return

    if num_only:
        ctx.send_json({'ok': True, 'path': path, 'total_lines': len(all_lines)})
        return

    s = max(1, start)
    e = min(len(all_lines), end) if end else len(all_lines)
    out_lines = []

    if contains:
        for idx in range(len(all_lines)):
            line = all_lines[idx].rstrip('\n\r')
            if contains in line:
                if line_char_limit and len(line) > line_char_limit:
                    line = line[:line_char_limit] + '...'
                out_lines.append('%d: %s' % (idx + 1, line))
    else:
        for idx in range(s - 1, e):
            line = all_lines[idx].rstrip('\n\r')
            if line_char_limit and len(line) > line_char_limit:
                line = line[:line_char_limit] + '...'
            out_lines.append('%d: %s' % (idx + 1, line))

    ctx.send_json({'ok': True, 'path': path, 'lines': out_lines,
                    'total_lines': len(all_lines),
                    'start': s, 'end': e})
