#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""move_file - 移动/重命名文件"""
import os
import shutil
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'move_file'


def handle(body, ctx):
    try:
        moves = body.get('moves')
        if not moves:
            src = body.get('src', '')
            dst = body.get('dst', '')
            if not src or not dst:
                ctx.send_error('src and dst are required')
                return
            moves = [{'src': src, 'dst': dst}]

        overwrite = body.get('overwrite', False)
        results = []
        ok_count = 0

        for m in moves:
            src = m.get('src', '')
            dst = m.get('dst', '')
            try:
                try:
                    from security import is_blocked_system_path
                    if is_blocked_system_path(src) or is_blocked_system_path(dst):
                        results.append({'src': src, 'dst': dst, 'ok': False, 'error': 'Blocked: system directory'})
                        continue
                except Exception:
                    pass
                if not os.path.exists(src):
                    results.append({'src': src, 'dst': dst, 'ok': False, 'error': 'Source not found'})
                    continue
                if os.path.exists(dst) and not overwrite:
                    results.append({'src': src, 'dst': dst, 'ok': False, 'error': 'Destination exists (overwrite=False)'})
                    continue
                dst_dir = os.path.dirname(dst)
                if dst_dir and not os.path.isdir(dst_dir):
                    os.makedirs(dst_dir, exist_ok=True)
                shutil.move(src, dst)
                results.append({'src': src, 'dst': dst, 'ok': True})
                ok_count += 1
            except Exception as e:
                results.append({'src': src, 'dst': dst, 'ok': False, 'error': str(e)})

        ctx.send_json({'ok': True, 'results': results, 'ok_count': ok_count, 'total': len(results)})
    except Exception as e:
        ctx.send_error(str(e))
