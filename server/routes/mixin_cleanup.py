#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mixin: 一键清理（提速）API —— 360 风格多层清理

路由：
  GET  /api/cleanup/speed          预览：统计各清理项大小（不删除）
  POST /api/cleanup/speed          执行一键清理（全部层）
  GET  /api/cleanup/step?key=xxx   单层扫描（不删除）
  POST /api/cleanup/step  {key}    单层清理
"""
import os
import json
import time
import shutil

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # server/

BAK_CUTOFF_DAYS = 30


def _targets():
    root_parent = os.path.dirname(_ROOT)  # 项目根
    return [
        ('trash_expired', '垃圾箱过期项', '>30 天自动清除', 'expired',
         os.path.join(root_parent, 'system', 'trash')),
        ('pycache', 'Python 编译缓存', '__pycache__ 目录', 'pycache', _ROOT),
        ('tmp_eval', '临时评估目录', 'temp_eval* 临时产物', 'prefix:temp_eval', _ROOT),
        ('old_logs', '历史日志', '7 天前的旧日志', 'oldlogs', os.path.join(_ROOT, 'logs')),
        ('browser_cache', '浏览器跟踪缓存', 'server/data/browser_profile', 'browser',
         os.path.join(_ROOT, 'data', 'browser_profile')),
        ('old_bak', '旧备份文件', '.bak / .bak.*（>30 天）', 'oldbak', root_parent),
    ]


def _dir_size(path):
    total = 0
    for dirpath, _dn, filenames in os.walk(path):
        for f in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total


def _walk_pruned(root):
    """遍历，跳过 node_modules/.git/python 解释器/venv"""
    for dirpath, dirnames, fns in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ('node_modules', '.git', 'python',
                                    '.venv', 'venv', 'site-packages')]
        yield dirpath, dirnames, fns


def _iter_pycache(root):
    for dirpath, dirnames, _fns in _walk_pruned(root):
        for d in list(dirnames):
            if d == '__pycache__':
                yield os.path.join(dirpath, d)


def _scan_one(key, name, desc, mode, path, now):
    """返回 {key,name,desc,files,bytes,paths(仅前80个用于删除)}"""
    files, total, paths = 0, 0, []
    if mode == 'expired':
        try:
            import trash as trash_mod
            items = trash_mod.list_items(include_restored=False)
            cutoff = now - trash_mod.TRASH_RETENTION_DAYS * 86400
            for it in items:
                ts = it.get('trashed_at') or 0
                if ts and ts / 1000 < cutoff:
                    tp = it.get('trash_path') or ''
                    if os.path.exists(tp):
                        s = _dir_size(tp) if os.path.isdir(tp) else os.path.getsize(tp)
                        total += s
                        files += 1
                        if len(paths) < 80:
                            paths.append(tp)
        except Exception:
            pass
    elif mode == 'pycache':
        for p in _iter_pycache(path):
            s = _dir_size(p)
            total += s
            files += 1
            if len(paths) < 80:
                paths.append(p)
    elif mode.startswith('prefix:'):
        pre = mode.split(':', 1)[1]
        if os.path.isdir(path):
            for d in os.listdir(path):
                if d.startswith(pre):
                    full = os.path.join(path, d)
                    if os.path.isdir(full):
                        s = _dir_size(full)
                        total += s
                        files += 1
                        if len(paths) < 80:
                            paths.append(full)
    elif mode == 'oldlogs':
        if os.path.isdir(path):
            for dirpath, _dn, fns in os.walk(path):
                for f in fns:
                    fp = os.path.join(dirpath, f)
                    try:
                        if os.path.getmtime(fp) < now - 7 * 86400:
                            total += os.path.getsize(fp)
                            files += 1
                            if len(paths) < 80:
                                paths.append(fp)
                    except OSError:
                        pass
    elif mode == 'browser':
        if os.path.isdir(path):
            s = _dir_size(path)
            total = s
            files = 1
            paths = [path]
    elif mode == 'oldbak':
        cutoff = now - BAK_CUTOFF_DAYS * 86400
        for dirpath, _dn, fns in _walk_pruned(path):
            for f in fns:
                if f == '.bak' or f.startswith('.bak.') or f.endswith('.bak'):
                    fp = os.path.join(dirpath, f)
                    try:
                        if os.path.getmtime(fp) < cutoff:
                            total += os.path.getsize(fp)
                            files += 1
                            if len(paths) < 80:
                                paths.append(fp)
                    except OSError:
                        pass
    return {'key': key, 'name': name, 'desc': desc,
            'files': files, 'bytes': total, 'paths': paths}


def _collect_scan():
    now = time.time()
    return [_scan_one(*t, now=now) for t in _targets()]


def _public_items(scan):
    return [{'key': i['key'], 'name': i['name'], 'desc': i['desc'],
             'files': i['files'], 'mb': round(i['bytes'] / 1048576, 2)}
            for i in scan]


def handle_cleanup_speed(handler, do_run=False):
    """GET/POST /api/cleanup/speed —— 全量预览 / 一键全部清理"""
    try:
        scan = _collect_scan()
        errors = []
        freed = 0
        if do_run:
            before = sum(i['bytes'] for i in scan)
            for item in scan:
                for p in item['paths']:
                    try:
                        if os.path.isdir(p):
                            shutil.rmtree(p, ignore_errors=True)
                        else:
                            os.remove(p)
                    except Exception as e:
                        errors.append(f"{p}: {e}")
            after = sum(i['bytes'] for i in _collect_scan())
            freed = max(0, before - after)
            scan = _collect_scan()
        handler._send_json({
            'ok': True, 'ran': do_run, 'items': _public_items(scan),
            'freed_bytes': freed, 'freed_mb': round(freed / 1048576, 2),
            'errors': errors[:10],
        }, 200)
    except Exception as e:
        handler._send_json({'ok': False, 'error': str(e)}, 500)


def handle_cleanup_step(handler, do_run=False, key=None):
    """GET/POST /api/cleanup/step?key=xxx —— 单层扫描 / 单层清理"""
    try:
        if not key:
            try:
                body = handler._read_json_body() if hasattr(handler, '_read_json_body') else {}
            except Exception:
                body = {}
            key = body.get('key') or ''
        target = None
        for t in _targets():
            if t[0] == key:
                target = t
                break
        if not target:
            handler._send_json({'ok': False, 'error': 'unknown key: %s' % key}, 404)
            return
        now = time.time()
        item = _scan_one(*target, now=now)
        freed = 0
        errors = []
        if do_run:
            before = item['bytes']
            for p in item['paths']:
                try:
                    if os.path.isdir(p):
                        shutil.rmtree(p, ignore_errors=True)
                    else:
                        os.remove(p)
                except Exception as e:
                    errors.append(f"{p}: {e}")
            item = _scan_one(*target, now=now)
            freed = max(0, before - item['bytes'])
        handler._send_json({
            'ok': True, 'ran': do_run,
            'item': {'key': item['key'], 'name': item['name'], 'desc': item['desc'],
                     'files': item['files'], 'mb': round(item['bytes'] / 1048576, 2)},
            'freed_mb': round(freed / 1048576, 2),
            'errors': errors[:5],
        }, 200)
    except Exception as e:
        handler._send_json({'ok': False, 'error': str(e)}, 500)
