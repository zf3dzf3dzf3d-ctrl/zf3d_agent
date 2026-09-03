#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""find_files - glob模式查找文件"""
import os
import fnmatch
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'find_files'

_SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv'}


def _find(pattern, root, max_results, file_type):
    results = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith('.')]
        for fn in filenames:
            if fnmatch.fnmatch(fn, pattern) or fnmatch.fnmatch(os.path.join(os.path.relpath(dirpath, root), fn), pattern):
                if file_type:
                    if not fn.endswith(file_type):
                        continue
                results.append(os.path.join(dirpath, fn))
                if len(results) >= max_results:
                    return results
    return results


def handle(body, ctx):
    try:
        pattern = body.get('pattern', '')
        if not pattern:
            ctx.send_error('pattern is required')
            return
        paths = body.get('paths')
        if not paths:
            paths = [body.get('path', '') or ctx.project_dir]
        max_results = int(body.get('max_results', 50))
        file_type = body.get('file_type', None)

        if len(paths) == 1:
            files = _find(pattern, paths[0], max_results, file_type)
            ctx.send_json({'ok': True, 'files': files, 'count': len(files)})
        else:
            all_results = []
            for p in paths:
                files = _find(pattern, p, max_results, file_type)
                all_results.extend(files)
            all_results = all_results[:max_results]
            ctx.send_json({'ok': True, 'files': all_results, 'count': len(all_results)})
    except Exception as e:
        ctx.send_error(str(e))
