#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""read_lines - 按行读取文件"""
import os
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'read_lines'


def handle(body, ctx):
    path = body.get('path', '')
    paths = body.get('paths')
    # 【2026-09-09 重复读拦截】前端透传的对话级已读计数（{path: count}）+ force 破格重读
    read_count = body.get('_read_count') or {}
    force = bool(body.get('force'))

    start = max(1, int(body.get('start', 1) or 1))
    end = body.get('end')
    contains = body.get('contains', '')
    line_char_limit = int(body.get('line_char_limit', 0) or 0)
    num_only = body.get('num', False)
    # 【防碎片化】若指定了 end 且范围小于 50 行，自动扩展到至少 50 行
    if end is not None and not num_only and not contains:
        try:
            if int(end) - start + 1 < 50:
                end = start + 49
        except (TypeError, ValueError):
            pass

    if paths and isinstance(paths, list):
        results = []
        for p in paths:
            try:
                if not os.path.isfile(p):
                    results.append({'path': p, 'error': 'File not found'})
                    continue
                # 重复读拦截：未变更且已读过 → 不回正文
                try:
                    from tools.coding.backend import _readguard
                    _serve, _note = _readguard.should_serve_content(p, read_count.get(p, 0), force)
                    if not _serve:
                        results.append({'path': p, 'cached': True, 'lines': [], 'note': _note})
                        continue
                except Exception:
                    pass
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

    # 重复读拦截：未变更且已读过 → 不回正文
    try:
        from tools.coding.backend import _readguard
        _serve, _note = _readguard.should_serve_content(path, read_count.get(path, 0), force)
        if not _serve:
            ctx.send_json({'ok': True, 'path': path, 'cached': True, 'lines': [],
                           'note': _note})
            return
    except Exception:
        pass

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
