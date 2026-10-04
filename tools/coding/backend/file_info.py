#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""file_info - 获取文件/目录信息"""
import os
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'file_info'


def _info(path):
    if not os.path.exists(path):
        return None, 'Not found: ' + path
    st = os.stat(path)
    info = {
        'path': path,
        'type': 'dir' if os.path.isdir(path) else 'file',
        'size': st.st_size,
        'modified': st.st_mtime,
        'created': st.st_ctime
    }
    if os.path.isdir(path):
        total_size = 0
        file_count = 0
        dir_count = 0
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames[:] = [d for d in dirnames if d not in ('.git', 'node_modules', '__pycache__')]
            dir_count += len(dirnames)
            for fn in filenames:
                fp = os.path.join(dirpath, fn)
                try:
                    total_size += os.path.getsize(fp)
                    file_count += 1
                except Exception:
                    pass
        info['total_size'] = total_size
        info['file_count'] = file_count
        info['dir_count'] = dir_count
    elif os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                info['lines'] = sum(1 for _ in f)
        except Exception:
            info['lines'] = None
    return info, None


def handle(body, ctx):
    try:
        paths = body.get('paths')
        if not paths:
            p = body.get('path', '')
            paths = [p] if p else []
        if not paths:
            ctx.send_error('No path specified')
            return

        if len(paths) == 1:
            info, err = _info(paths[0])
            if err:
                ctx.send_json({'ok': False, 'error': err})
            else:
                ctx.send_json({'ok': True, 'info': info})
        else:
            results = []
            for p in paths:
                info, err = _info(p)
                results.append({'path': p, 'info': info, 'error': err})
            ctx.send_json({'ok': True, 'multi': True, 'items': results})
    except Exception as e:
        ctx.send_error(str(e))
