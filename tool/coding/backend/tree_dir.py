#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tree_dir - 树形显示目录结构"""
import os
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'tree_dir'

_SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '__pypackages__'}


def _build_tree(dir_path, prefix, max_depth, show_files, depth=0):
    lines = []
    if depth >= max_depth:
        return lines
    try:
        items = sorted(os.listdir(dir_path))
    except Exception:
        return lines
    dirs = [d for d in items if not d.startswith('.') or d in _SKIP_DIRS]
    filtered = []
    for name in items:
        if name in _SKIP_DIRS:
            continue
        if name.startswith('.'):
            continue
        fp = os.path.join(dir_path, name)
        if os.path.isdir(fp):
            filtered.append(name)
        elif show_files and os.path.isfile(fp):
            filtered.append(name)
    count = len(filtered)
    for i, name in enumerate(filtered):
        fp = os.path.join(dir_path, name)
        is_last = (i == count - 1)
        connector = '└── ' if is_last else '├── '
        lines.append(prefix + connector + name + ('/' if os.path.isdir(fp) else ''))
        if os.path.isdir(fp):
            ext = '    ' if is_last else '│   '
            lines.extend(_build_tree(fp, prefix + ext, max_depth, show_files, depth + 1))
    return lines


def handle(body, ctx):
    try:
        paths = body.get('paths')
        if not paths:
            # 空 path 降级为项目根目录，避免空参数 400 打断 Agent 循环
            p = body.get('path', '') or ctx.project_dir
            paths = [p]
        max_depth = int(body.get('max_depth', 3))
        show_files = body.get('show_files', True)

        if len(paths) == 1:
            p = paths[0]
            if not os.path.isabs(p):
                p = ctx.safe_project_path(p)
            if not p or not os.path.isdir(p):
                ctx.send_error('Not a directory: ' + str(p))
                return
            lines = _build_tree(p, '', max_depth, show_files)
            tree_str = os.path.basename(p) + '/\n' + '\n'.join(lines)
            ctx.send_json({'ok': True, 'path': p, 'tree': tree_str})
        else:
            results = []
            for p in paths:
                if not os.path.isabs(p):
                    p = ctx.safe_project_path(p)
                if not p or not os.path.isdir(p):
                    results.append({'path': p, 'error': 'Not a directory'})
                    continue
                lines = _build_tree(p, '', max_depth, show_files)
                tree_str = os.path.basename(p) + '/\n' + '\n'.join(lines)
                results.append({'path': p, 'tree': tree_str})
            ctx.send_json({'ok': True, 'multi': True, 'dirs': results})
    except Exception as e:
        ctx.send_error(str(e))
