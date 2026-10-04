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

    def _resolve(pp):
        """【2026-09-13 易用性修复】相对路径自动补根目录：原样失败后依次按
        project_dir（当前项目）、base_dir（软件根目录）重试，返回命中路径或 None。"""
        if not pp:
            return None
        if os.path.isfile(pp):
            return pp
        if os.path.isabs(pp):
            return None
        for base in (ctx.project_dir, ctx.base_dir):
            c = os.path.join(base, pp)
            if os.path.isfile(c):
                return c
        return None

    if paths and isinstance(paths, list):
        results = []
        for p in paths:
            try:
                rp = _resolve(p)
                if not rp:
                    results.append({'path': p, 'error': 'File not found（相对路径已自动按项目根/软件根补全重试仍未命中，请检查文件名与扩展名）'})
                    continue
                # 重复读拦截：未变更且已读过 → 不回正文
                try:
                    from tools.coding.backend import _readguard
                    _serve, _note = _readguard.should_serve_content(rp, read_count.get(rp, 0), force)
                    if not _serve:
                        results.append({'path': p, 'cached': True, 'lines': [], 'note': _note})
                        continue
                except Exception:
                    pass
                with open(rp, 'r', encoding='utf-8', errors='replace') as f:
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
                # 【改必读】回读到内容 → 销账
                try:
                    from tools.coding.backend import _mustread as _mr
                    _mr.mark_read(p)
                except Exception:
                    pass
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

    # 【改必读】回读到内容 → 销账
    try:
        from tools.coding.backend import _mustread as _mr
        _mr.mark_read(path)
    except Exception:
        pass
    ctx.send_json({'ok': True, 'path': path, 'lines': out_lines,
                    'total_lines': len(all_lines),
                    'start': s, 'end': e})
