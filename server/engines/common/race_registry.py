#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""施工队窗口注册表（P1-2）：
前端建施工队窗时调用 race_register_window 登记 chat_id ↔ worktree 绑定；
窗口关闭时 race_unregister_window 注销。
git_branch_api.race_worktree_remove 清现场前用它校验活跃窗口（防悬空 cwd 孤儿窗）。
纯内存 + JSON 落盘（server/data/_race_windows.json），重启后仍可校验。
"""
import json
import os
import threading

_LOCK = threading.Lock()
_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', '_race_windows.json')


def _load():
    try:
        with open(_DB, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(d):
    try:
        os.makedirs(os.path.dirname(_DB), exist_ok=True)
        with open(_DB, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print('[race_registry] save failed: %s' % e)


def race_register_window(chat_id, worktree, team=''):
    """登记窗口 → worktree 绑定。"""
    with _LOCK:
        d = _load()
        d[str(chat_id)] = {'worktree': worktree, 'team': team,
                           'registered_at': __import__('time').strftime('%Y-%m-%d %H:%M:%S')}
        _save(d)
    return {'ok': True}


def race_unregister_window(chat_id):
    """窗口关闭时注销。"""
    with _LOCK:
        d = _load()
        d.pop(str(chat_id), None)
        _save(d)
    return {'ok': True}


def active_windows_on_worktree(worktree):
    """返回仍绑定在该 worktree 上的活跃窗口 chat_id 列表（目录已消失的窗口视为悬空，一并算活跃）。"""
    norm = os.path.normpath(str(worktree)).lower()
    out = []
    with _LOCK:
        for cid, info in _load().items():
            try:
                if os.path.normpath(str(info.get('worktree', ''))).lower() == norm:
                    out.append(cid)
            except Exception:
                continue
    return out


def list_windows():
    with _LOCK:
        return _load()
