# -*- coding: utf-8 -*-
"""路径守卫（读/写统一）。

规则：
- 项目目录（PROJECT_ROOT）内的文件：直接放行。
- 项目目录外的文件：不再弹对话框要求确认，直接放行，同时自动把所在目录写入
  白名单（private/path_whitelist.json）并在 private/path_access_log.jsonl 记录日志。
- 管理员可通过 API 查询/清除白名单。

对外接口：
    check(path) -> (ok: bool, reason: str)
        ok=True 直接放行（项目外路径会自动记录并放行，reason='auto'）。
    approve(path, permanent: bool) -> dict（保留接口兼容，供 API 调用）
    is_pending(reason) -> bool（恒为 False，保留接口兼容）
"""

import json
import os
import tempfile
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PRIVATE_DIR = os.path.join(PROJECT_ROOT, 'private')
WHITELIST_FILE = os.path.join(PRIVATE_DIR, 'path_whitelist.json')
TICKET_TTL = 600  # 临时放行票有效期（秒）

_pending_reason = 'PENDING_CONFIRM'

_tickets = {}  # path -> expiry
_whitelist = []  # 已永久放行的目录（或文件）绝对路径列表
_whitelist_loaded = False


def _load_whitelist():
    global _whitelist, _whitelist_loaded
    # 按文件修改时间增量刷新，避免进程内缓存导致新写入的白名单读不到
    try:
        mtime = os.path.getmtime(WHITELIST_FILE)
    except OSError:
        mtime = None
    if _whitelist_loaded and mtime == getattr(_load_whitelist, '_mtime', None):
        return
    _whitelist_loaded = True
    _load_whitelist._mtime = mtime
    try:
        with open(WHITELIST_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        _whitelist = [os.path.abspath(x) for x in data if isinstance(x, str)]
    except Exception:
        _whitelist = []


def _save_whitelist():
    try:
        os.makedirs(PRIVATE_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=PRIVATE_DIR, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(_whitelist, f, ensure_ascii=False, indent=1)
        os.replace(tmp, WHITELIST_FILE)
    except Exception:
        pass


def is_pending(reason):
    return False  # 已取消对话框确认机制，仅保留接口兼容


ACCESS_LOG_FILE = os.path.join(PRIVATE_DIR, 'path_access_log.jsonl')


def _log_access(path, root):
    """项目外路径自动放行时仅记录一条日志（不弹窗、不需确认）。"""
    try:
        os.makedirs(PRIVATE_DIR, exist_ok=True)
        import datetime as _dt
        with open(ACCESS_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps({
                'time': _dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'path': path, 'project_dir': root, 'action': 'auto_allow'
            }, ensure_ascii=False) + '\n')
    except Exception:
        pass


def _match_whitelist(path):
    _load_whitelist()
    for w in _whitelist:
        if path == w or path.startswith(w.rstrip('\\/') + os.sep):
            return True
    return False


def check(path, project_dir=None):
    """统一入口。返回 (ok, reason)。"""
    if not path or not str(path).strip():
        return False, 'empty path'
    p = os.path.abspath(str(path))
    root = os.path.abspath(project_dir or PROJECT_ROOT)
    if p == root or p.startswith(root.rstrip('\\/') + os.sep):
        return True, ''
    # 项目外：先看永久白名单，再看临时票
    if _match_whitelist(p):
        return True, ''
    now = time.time()
    for t in list(_tickets):
        if _tickets[t] < now:
            _tickets.pop(t, None)
        elif p == t or p.startswith(t.rstrip('\\/') + os.sep):
            return True, 'ticket'
    # 不再弹对话框要求用户确认：直接放行并自动写入白名单，仅记录提示
    _log_access(p, root)
    approve(p, permanent=True)
    return True, 'auto'


def approve(path, permanent=False):
    """用户在放行对话框点击后调用。"""
    p = os.path.abspath(str(path))
    if permanent:
        # 永久放行以「目标文件所在目录」为粒度落盘白名单，
        # 保证与 check() 使用的实际项目目录匹配（此前固定写 PROJECT_ROOT
        # 会导致放行外部项目目录时白名单条目永远匹配不上、反复弹窗）。
        d = os.path.dirname(p) if os.path.splitext(p)[1] else p
        global _whitelist
        _load_whitelist()
        if d not in _whitelist:
            _whitelist = [w for w in _whitelist if w != d]
            _whitelist.append(d)
            _save_whitelist()
        return {'ok': True, 'permanent': True, 'dir': d}
    _tickets[p] = time.time() + TICKET_TTL
    return {'ok': True, 'permanent': False, 'ttl': TICKET_TTL}


def revoke(path=None):
    """清除白名单/临时票。path 为空则全清。"""
    if path:
        global _whitelist
        p = os.path.abspath(str(path))
        _load_whitelist()
        _whitelist = [w for w in _whitelist if not (p == w or w.startswith(p.rstrip('\\/') + os.sep))]
        _save_whitelist()
        _tickets.pop(p, None)
    else:
        _whitelist = []
        _tickets.clear()
        _save_whitelist()
    return {'ok': True}


def status():
    _load_whitelist()
    now = time.time()
    return {'project_root': PROJECT_ROOT, 'whitelist': list(_whitelist),
            'tickets': [t for t, e in _tickets.items() if e > now]}
