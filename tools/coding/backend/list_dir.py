#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""list_dir - 列出目录内容"""
import os
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'list_dir'


def handle(body, ctx):
    try:
        paths = body.get('paths')
        if not paths:
            p = body.get('path', '')
            paths = [p] if p else []
        if not paths:
            ctx.send_error('No path specified')
            return

        show_hidden = body.get('show_hidden', False)
        sort_by = body.get('sort_by', 'name')

        skip_dirs = {'.git', 'node_modules', '__pycache__'}

        def _list_one(dir_path):
            entries = []
            try:
                items = os.listdir(dir_path)
            except Exception as e:
                return [], str(e)
            for name in items:
                if not show_hidden and name.startswith('.'):
                    continue
                if not show_hidden and name in skip_dirs:
                    continue
                fp = os.path.join(dir_path, name)
                try:
                    st = os.stat(fp)
                    entry = {
                        'name': name,
                        'type': 'dir' if os.path.isdir(fp) else 'file',
                        'size': st.st_size if os.path.isfile(fp) else 0,
                        'modified': st.st_mtime
                    }
                    entries.append(entry)
                except Exception:
                    pass
            if sort_by == 'size':
                entries.sort(key=lambda x: x.get('size', 0), reverse=True)
            elif sort_by == 'modified':
                entries.sort(key=lambda x: x.get('modified', 0), reverse=True)
            else:
                entries.sort(key=lambda x: x['name'])
            return entries, None

        if len(paths) == 1:
            entries, err = _list_one(paths[0])
            if err:
                ctx.send_json({'ok': False, 'error': err})
            else:
                ctx.send_json({'ok': True, 'path': paths[0], 'entries': entries})
        else:
            results = []
            for p in paths:
                entries, err = _list_one(p)
                results.append({'path': p, 'entries': entries, 'error': err})
            ctx.send_json({'ok': True, 'multi': True, 'dirs': results})
    except Exception as e:
        ctx.send_error(str(e))
