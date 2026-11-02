#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/syscall.py - 智能体OS系统调用表（P1：只记不拦）

统一工具网关：为所有引擎的工具调用建立「系统调用表 + 审计日志」。
- 系统调用表：运行时收集各引擎 Registry 登记的工具（名称/引擎/危险标记）
- 审计：每次调用追加一行到 server/private/logs/syscall.audit.jsonl
- 权限等级（P1 仅标注，不拦截；P4 启用拦截）：
    public    普通读写/查询
    system    配置/内核模块相关
    dangerous 网络/删除/危险操作（与 tool_base 的 dangerous 标记对齐）

设计原则（与 tool_stats.py 一致）：
- 绝不抛错、绝不阻塞工具执行；文件追加带独立锁
- 降级开关：环境变量 ZF_SYSCALL=0 时完全静默关闭（不记审计、不建表）
- 零第三方依赖，单文件自包含
"""

import os
import io
import json
import time
import threading

_ENABLED = os.environ.get('ZF_SYSCALL', '1') != '0'

_LOCK = threading.Lock()
_LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private', 'logs', 'syscall.audit.jsonl')

# 系统调用表：{tool_name: {'engine': engine_id, 'level': str, 'dangerous': bool,
#                          'calls': int, 'errors': int, 'last_ts': float}}
_TABLE = {}

# 需要标为 system 级的工具名/前缀（P1 仅标注）
_SYSTEM_RULES = (
    ('config_', 'settings_', 'kernel_', 'engines_loader', 'switch_engine',
     'registry_', 'sysctl_', 'zf_config'),
)

# 需要标为 dangerous 级的前缀（对齐 safety_wall 的危险面）
_DANGEROUS_RULES = (
    ('del_', 'rm_', 'delete_', 'drop_', 'format_', 'network_', 'http_',
     'shell_', 'cmd_', 'terminal_', 'git_push', 'git_reset', 'vault',
     'run_code', 'move_file', 'write_file', 'replace_text'),
)


def classify(tool, dangerous=False):
    """P1 静态分级：dangerous > system > public。只标注，不拦截。"""
    t = str(tool or '').lower()
    if dangerous:
        return 'dangerous'
    for k in _DANGEROUS_RULES:
        if t.startswith(k):
            return 'dangerous'
    for k in _SYSTEM_RULES:
        if t.startswith(k):
            return 'system'
    return 'public'


def register(tool, engine_id, dangerous=False, description=''):
    """Registry 注册工具时同步登记到系统调用表。异常静默。"""
    if not _ENABLED:
        return
    try:
        with _LOCK:
            ent = _TABLE.get(tool)
            if ent is None:
                _TABLE[tool] = {
                    'engine': str(engine_id or '')[:40],
                    'level': classify(tool, dangerous),
                    'dangerous': bool(dangerous),
                    'description': str(description or '')[:200],
                    'calls': 0, 'errors': 0, 'last_ts': 0.0,
                }
            else:
                # 同名工具多引擎注册：保留首引擎，追加备用引擎标记
                ent.setdefault('also_engines', []).append(str(engine_id or '')[:40])
    except Exception:
        pass


def audit(tool, engine_id, ok, ms, level=None, err=''):
    """每次调用追加一条审计。任何异常静默吞掉，绝不影响工具执行。"""
    if not _ENABLED:
        return
    try:
        rec = {
            'ts': round(time.time(), 3),
            'tool': str(tool or '')[:80],
            'engine': str(engine_id or '')[:40],
            'level': level or classify(tool),
            'ok': bool(ok),
            'ms': round(float(ms), 1),
        }
        if err:
            rec['err'] = str(err)[:120]
        line = json.dumps(rec, ensure_ascii=False)
        with _LOCK:
            ent = _TABLE.get(tool)
            if ent is not None:
                ent['calls'] += 1
                ent['last_ts'] = rec['ts']
                if not ok:
                    ent['errors'] += 1
            os.makedirs(os.path.dirname(_LOG), exist_ok=True)
            with io.open(_LOG, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
    except Exception:
        pass


def table():
    """返回系统调用表快照（供 /api/syscall/table 等接口用）。"""
    with _LOCK:
        return {k: dict(v) for k, v in _TABLE.items()}


def table_lines():
    """渲染人类可读的系统调用表。"""
    with _LOCK:
        rows = sorted(_TABLE.items())
    if not rows:
        return '(系统调用表为空)'
    out = ['%-28s %-16s %-9s %6s %6s' % ('TOOL', 'ENGINE', 'LEVEL', 'CALLS', 'ERRS')]
    for name, e in rows:
        out.append('%-28s %-16s %-9s %6d %6d' % (
            name[:28], e['engine'][:16], e['level'], e['calls'], e['errors']))
    return '\n'.join(out)


# ---------------------------------------------------------------- P4 权限拦截

# ZF_SYSCALL_ENFORCE=1 启用拦截（默认只审计不拦，渐进收紧）。
# 实时读取环境变量（带 60s 缓存），运行中改动无需重启进程。
_ENFORCE_CACHE = {'ts': 0.0, 'val': False}
_ENFORCE_LOCK = threading.Lock()


def _enforce_on():
    now = time.time()
    with _ENFORCE_LOCK:
        if now - _ENFORCE_CACHE['ts'] > 60:
            _ENFORCE_CACHE['val'] = os.environ.get('ZF_SYSCALL_ENFORCE', '0') == '1'
            _ENFORCE_CACHE['ts'] = now
        return _ENFORCE_CACHE['val']

# dangerous 级白名单：登记过的确认记录 {tool: ts}，确认后 1 小时内免重复拦截
_APPROVED = {}
_APPROVE_TTL = 3600
_APPROVE_LOCK = threading.Lock()


def check_permission(tool, level=None):
    """P4：检查该工具是否允许执行。返回 (ok, reason)。
    只拦 dangerous 级；未在确认白名单且开启拦截时拒绝并给出原因。
    ZF_SYSCALL_ENFORCE=0（默认）或 ZF_SYSCALL=0 时全放行（只审计）。
    enforce 模式下：dangerous 级未确认拒绝；未登记/未知级别工具同样拒绝（收紧）。"""
    if not _ENABLED or not _enforce_on():
        return True, ''
    # 未登记工具收紧：不在系统调用表中则拒绝（防死代码漏放，classify 对未登记名返回 public）
    with _LOCK:
        ent = _TABLE.get(str(tool))
    if ent is None:
        return False, ('SYSCALL_UNREGISTERED_BLOCKED: 工具 %s 未在系统调用表登记，'
                       'enforce 模式下拒绝执行（登记后方可调用）' % (tool,))
    # 已登记工具直接用登记时定级的 level（classify 对已登记名不会返回 unknown，
    # 原 lv=='unknown' 分支为死代码，已删除）
    lv = level or ent.get('level') or 'system'
    if lv != 'dangerous':
        return True, ''
    with _APPROVE_LOCK:
        ts = _APPROVED.get(str(tool))
        if ts and time.time() - ts < _APPROVE_TTL:
            return True, ''
    return False, ('SYSCALL_DANGEROUS_BLOCKED: 工具 %s 为 dangerous 级，'
                   '需人工确认（调用 syscall.approve(%r) 后重试，1小时内有效）'
                   % (tool, tool))


def approve(tool, by='human'):
    """人工确认某 dangerous 工具（1 小时内免拦截）。"""
    with _APPROVE_LOCK:
        _APPROVED[str(tool)] = time.time()
    audit('syscall.approve', 'kernel', True, 0.0, level='system',
          err='tool=%s by=%s' % (tool, by))
    return {'ok': True, 'tool': tool, 'ttl_sec': _APPROVE_TTL}
