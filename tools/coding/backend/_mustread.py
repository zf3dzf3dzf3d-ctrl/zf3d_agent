# -*- coding: utf-8 -*-
"""改必读闸门（2026-09-21）：写入/替换成功的文件，必须被 read/read_lines 回读一次，
否则 task_complete 会被拒绝，防止「改完就不管、不看结果」。

机制：
  - write / replace_text 成功写入 → _mustread.mark(path) 登记待确认；
  - read / read_lines 成功返回文件内容（经 _readguard 放行）→ _mustread.mark_read(path) 销账；
  - task_complete 时若仍有待确认文件且 success=true → 返回 ok=false，要求先回读再收尾。
  - 进程级缓存，重启自然清空（放行，安全方向）；只读确认，不阻断读写本身。
"""
import os
import threading

# {abs_path: {'mtime': float, 'tool': str, 'chat_id': str}}
_PENDING = {}
_LOCK = threading.Lock()


def _key(path):
    return os.path.normcase(os.path.abspath(path))


def mark(path, tool='', chat_id=''):
    """写入/替换成功后登记待确认文件。"""
    try:
        mt = os.path.getmtime(path)
    except OSError:
        mt = 0.0
    with _LOCK:
        _PENDING[_key(path)] = {'mtime': mt, 'tool': tool, 'chat_id': chat_id or ''}


def mark_read(path):
    """回读到该文件内容后销账（read/read_lines 放行内容时调用）。"""
    with _LOCK:
        _PENDING.pop(_key(path), None)


def pending():
    """返回仍待确认的文件列表 [{path, tool}]（清理已不存在的）。"""
    with _LOCK:
        dead = [k for k in _PENDING if not os.path.isfile(k)]
        for k in dead:
            _PENDING.pop(k, None)
        return [{'path': k, 'tool': v.get('tool', '')} for k, v in _PENDING.items()]
