# -*- coding: utf-8 -*-
"""项目级黑板占用锁（多智能体并发开发互斥）。

与 crew_board.py（任务级分片锁）互补：
- crew_board：解决"多窗分一个活"的分片认领；
- 本模块：解决"多个智能体同时改同一项目/文件"的写前互斥。

数据落盘 server/data/_blackboard/：
- <project_id>.json       占用表 {files: {norm_path: {owner, role, hint, acquired_at, heartbeat_at}}}
- <project_id>.audit.jsonl 审计日志（append-only，含 run_code 放行记录）

并发安全：threading.Lock + 临时文件 os.replace 原子落盘（同 crew_board 模式）。

拦截策略（在 parallel_exec.py 写工具统一收口处调用）：
- 文件级粒度：不同文件可并行，同文件互斥；
- 心跳制：60s 续约（写操作本身即心跳），HEARTBEAT_TIMEOUT（默认 600s）无心跳自动过期放行，防死锁；
- 同 owner 放行：同一会话连续写直接通过，不误伤；
- ZF_BLACKBOARD=0 一键降级（排障/单窗使用）；
- run_code 无法精确知道写哪个文件 → 放行但记审计日志。

owner 标识：优先 ctx 里的会话/窗口 ID（ctx.get('owner_id')），
没有则退化为进程级 owner（跨进程场景靠心跳过期兜底）。
"""

import json
import os
import re
import threading
import time

_LOCK = threading.Lock()
_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
                         'server', 'data', '_blackboard')

# 心跳超时（秒）：超时无续约的占用自动过期放行，防死窗死锁
HEARTBEAT_TIMEOUT = int(os.environ.get('ZF_BLACKBOARD_TIMEOUT', '600'))
# 降级开关：ZF_BLACKBOARD=0 时所有检查直接放行
_ENABLED = os.environ.get('ZF_BLACKBOARD', '1') != '0'


def _ensure_dir():
    os.makedirs(_DATA_DIR, exist_ok=True)


def _safe_name(project_id):
    """project_id 转安全文件名（防路径穿越）。"""
    s = re.sub(r'[^A-Za-z0-9_\-]', '_', str(project_id or 'default'))
    return s or 'default'


def _board_path(project_id):
    return os.path.join(_DATA_DIR, '%s.json' % _safe_name(project_id))


def _audit_path(project_id):
    return os.path.join(_DATA_DIR, '%s.audit.jsonl' % _safe_name(project_id))


def _load(project_id):
    p = _board_path(project_id)
    if not os.path.exists(p):
        return None
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _save(project_id, board):
    _ensure_dir()
    p = _board_path(project_id)
    tmp = p + '.tmp.%d' % threading.get_ident()
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(board, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)  # 原子替换


def _audit(project_id, obj):
    try:
        _ensure_dir()
        with open(_audit_path(project_id), 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
    except Exception:
        pass  # 审计失败不阻塞业务


def _norm_path(path):
    """路径归一化：统一分隔符/大小写盘符（Windows），转绝对路径。"""
    if not path:
        return ''
    try:
        p = os.path.abspath(str(path))
        return os.path.normcase(p)
    except Exception:
        return str(path)


def _recover_expired(board):
    """把心跳超时的占用清掉（防死窗死锁），返回是否有变化。"""
    now = time.time()
    changed = False
    for k in list((board.get('files') or {}).keys()):
        rec = board['files'][k]
        if now - float(rec.get('heartbeat_at', 0)) > HEARTBEAT_TIMEOUT:
            board['files'].pop(k)
            board.setdefault('history', []).append({
                'path': k, 'owner': rec.get('owner'), 'action': 'expired',
                'at': now,
            })
            changed = True
    if changed:
        # 历史只留最近 200 条
        board['history'] = (board.get('history') or [])[-200:]
    return changed


def _owner_of(ctx):
    """从 ctx 提取 owner 标识（会话/窗口级）。"""
    if isinstance(ctx, dict):
        for key in ('owner_id', 'session_id', 'window_id', 'conv_id'):
            v = ctx.get(key)
            if v:
                return str(v)
    return 'pid:%d' % os.getpid()


def bb_check(project_id, paths, owner=None):
    """只读看一眼：这些文件有没有被别的智能体占用。paths 可为 str 或 list。"""
    if not _ENABLED:
        return {'ok': True, 'enabled': False, 'conflicts': []}
    if isinstance(paths, str):
        paths = [paths]
    paths = [_norm_path(p) for p in (paths or []) if p]
    with _LOCK:
        board = _load(project_id)
        if board and _recover_expired(board):
            _save(project_id, board)
        conflicts = []
        if board:
            for p in paths:
                rec = board.get('files', {}).get(p)
                if rec and rec.get('owner') != owner:
                    conflicts.append({
                        'path': p, 'owner': rec.get('owner'),
                        'role': rec.get('role'), 'hint': rec.get('hint'),
                        'held_for_sec': int(time.time() - float(rec.get('acquired_at', time.time()))),
                    })
        return {'ok': True, 'enabled': True, 'conflicts': conflicts}


def bb_acquire(project_id, paths, owner, role='', hint='', ctx=None):
    """写前登记：占用成功返回 ok=True；被别人占用返回 ok=False + conflicts。
    同 owner 已占用 → 顺带续心跳放行。"""
    if not _ENABLED:
        return {'ok': True, 'enabled': False}
    if isinstance(paths, str):
        paths = [paths]
    paths = [_norm_path(p) for p in (paths or []) if p]
    now = time.time()
    with _LOCK:
        board = _load(project_id) or {'files': {}, 'history': []}
        _recover_expired(board)
        conflicts = []
        for p in paths:
            rec = board.get('files', {}).get(p)
            if rec and rec.get('owner') != owner:
                conflicts.append({
                    'path': p, 'owner': rec.get('owner'),
                    'role': rec.get('role'), 'hint': rec.get('hint'),
                    'held_for_sec': int(now - float(rec.get('acquired_at', now))),
                })
        if conflicts:
            _save(project_id, board)  # 顺带落盘过期回收结果
            return {'ok': False, 'conflicts': conflicts,
                    'message': '以下文件正被其他智能体开发：%s。建议先等待或让用户裁决（占用超过 %d 秒将自动放行）。'
                               % ('、'.join(c['path'] for c in conflicts), HEARTBEAT_TIMEOUT)}
        for p in paths:
            board['files'][p] = {
                'owner': owner, 'role': role, 'hint': hint,
                'acquired_at': now, 'heartbeat_at': now,
            }
        _save(project_id, board)
        _audit(project_id, {'at': now, 'action': 'acquire', 'owner': owner,
                            'role': role, 'paths': paths})
        return {'ok': True, 'count': len(paths)}


def bb_heartbeat(project_id, paths, owner):
    """续约：agent_loop 每轮或写操作时顺带刷。"""
    if not _ENABLED:
        return {'ok': True}
    if isinstance(paths, str):
        paths = [paths]
    paths = [_norm_path(p) for p in (paths or []) if p]
    with _LOCK:
        board = _load(project_id)
        if not board:
            return {'ok': True}
        now = time.time()
        n = 0
        for p in paths:
            rec = board.get('files', {}).get(p)
            if rec and rec.get('owner') == owner:
                rec['heartbeat_at'] = now
                n += 1
        if n:
            _save(project_id, board)
        return {'ok': True, 'renewed': n}


def bb_release(project_id, paths, owner):
    """完工释放。只释放自己占用的。"""
    if isinstance(paths, str):
        paths = [paths]
    paths = [_norm_path(p) for p in (paths or []) if p]
    with _LOCK:
        board = _load(project_id)
        if not board:
            return {'ok': True, 'released': 0}
        n = 0
        for p in paths:
            rec = board.get('files', {}).get(p)
            if rec and rec.get('owner') == owner:
                board['files'].pop(p)
                board.setdefault('history', []).append(
                    {'path': p, 'owner': owner, 'action': 'release', 'at': time.time()})
                n += 1
        board['history'] = (board.get('history') or [])[-200:]
        if n:
            _save(project_id, board)
            _audit(project_id, {'at': time.time(), 'action': 'release',
                                'owner': owner, 'released': n})
        return {'ok': True, 'released': n}


def bb_release_all(project_id, owner):
    """会话收尾时释放该 owner 的全部占用。"""
    with _LOCK:
        board = _load(project_id)
        if not board:
            return {'ok': True, 'released': 0}
        n = 0
        for p in list(board.get('files', {}).keys()):
            if board['files'][p].get('owner') == owner:
                board['files'].pop(p)
                n += 1
        if n:
            _save(project_id, board)
        return {'ok': True, 'released': n}


def bb_force_takeover(project_id, paths, new_owner, by='user'):
    """用户裁决强制接管：清掉指定文件的占用（无论谁持有），转给新 owner。"""
    if isinstance(paths, str):
        paths = [paths]
    paths = [_norm_path(p) for p in (paths or []) if p]
    with _LOCK:
        board = _load(project_id)
        if not board:
            return {'ok': True, 'taken': 0}
        n = 0
        for p in paths:
            rec = board.get('files', {}).pop(p, None)
            if rec:
                board.setdefault('history', []).append(
                    {'path': p, 'owner': rec.get('owner'), 'action': 'takeover_by_%s' % by,
                     'to': new_owner, 'at': time.time()})
                n += 1
        board['history'] = (board.get('history') or [])[-200:]
        if n:
            _save(project_id, board)
            _audit(project_id, {'at': time.time(), 'action': 'force_takeover',
                                'by': by, 'new_owner': new_owner, 'paths': paths})
        return {'ok': True, 'taken': n}


def bb_audit_run_code(project_id, owner, summary=''):
    """run_code 等无法精确知道写哪里的工具：放行 + 记审计日志。"""
    _audit(project_id, {'at': time.time(), 'action': 'run_code_passthrough',
                        'owner': owner, 'summary': str(summary)[:200]})


def bb_enabled():
    return _ENABLED


def bb_owner_of(ctx):
    return _owner_of(ctx)
