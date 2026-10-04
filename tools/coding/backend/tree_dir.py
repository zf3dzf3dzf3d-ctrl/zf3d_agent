#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tree_dir - 树形显示目录结构"""
import os, json, hashlib, time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'tree_dir'

_SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '__pypackages__'}

# ===== 会话级缓存 =====
# key = (chat_id, path, max_depth, show_files)
# value = (缓存时间, 结果dict, 各级目录mtime快照)
_TREE_CACHE = {}
_CACHE_TTL = 120  # 秒，超时强制失效


def _dir_snapshot(dir_path, max_depth):
    """采集目录树的关键 mtime 快照（目录本身 + 一层子目录的 mtime），用于失效检测。"""
    snap = {}
    def _walk(p, depth):
        if depth > max_depth:
            return
        try:
            snap[p] = os.path.getmtime(p)
            if depth < max_depth:
                for name in os.listdir(p):
                    fp = os.path.join(p, name)
                    if os.path.isdir(fp) and name not in _SKIP_DIRS and not name.startswith('.'):
                        _walk(fp, depth + 1)
        except Exception:
            pass
    _walk(dir_path, 0)
    return snap


def _cache_get(chat_id, key, snap_now):
    ent = _TREE_CACHE.get((chat_id, key))
    if not ent:
        return None
    ts, result, snap_old = ent
    if time.time() - ts > _CACHE_TTL:
        return None
    # 目录结构可能变化：mtime 快照不一致即失效
    if snap_old != snap_now:
        return None
    return result


def _cache_put(chat_id, key, result, snap):
    # 每会话最多缓存 20 条，超出丢弃最早的
    keys = [k for k in _TREE_CACHE if k[0] == chat_id]
    if len(keys) >= 20:
        keys.sort(key=lambda k: _TREE_CACHE[k][0])
        for k in keys[:len(keys) - 19]:
            _TREE_CACHE.pop(k, None)
    _TREE_CACHE[(chat_id, key)] = (time.time(), result, snap)


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
        force = bool(body.get('force', False))
        chat_id = getattr(ctx, 'chat_id', '') or body.get('_chat_id', '') or ''
        cached_note = None

        if len(paths) == 1:
            p = paths[0]
            if not os.path.isabs(p):
                p = ctx.safe_project_path(p)
            if not p or not os.path.isdir(p):
                ctx.send_error('Not a directory: ' + str(p))
                return
            # ===== 会话级缓存：参数相同 + 目录快照未变 + 未超 TTL → 直接返回缓存 =====
            ckey = (p, max_depth, show_files)
            snap = _dir_snapshot(p, max_depth) if not force else None
            if not force:
                hit = _cache_get(chat_id, ckey, snap)
                if hit:
                    hit['cached'] = True
                    ctx.send_json(hit)
                    return
            lines = _build_tree(p, '', max_depth, show_files)
            tree_str = os.path.basename(p) + '/\n' + '\n'.join(lines)
            result = {'ok': True, 'path': p, 'tree': tree_str}
            if snap is not None:
                _cache_put(chat_id, ckey, result, snap)
            ctx.send_json(result)
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
