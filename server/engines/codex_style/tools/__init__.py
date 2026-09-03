#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
codex_style/tools - Codex 引擎专属工具集（物理隔离，自研实现）

设计哲学（源自 codex CLI 精髓，非照搬）：
1. 审批意识：所有写操作先 produce diff/预览，`propose_write` 只提案不落盘，
   需模型或用户再次确认后调用 `apply_patch`
2. 破坏性隔离：run_code 记录到审计日志，输出带超时
3. 事实优先：read 工具返回带行号，方便模型精准 replace
"""

import os
import json
import time
import threading
import subprocess

from engines.common.tool_base import (
    Registry, resolve_path, clip_text, tool_event,
)
from engines.common.safety_wall import (
    backup_before_write, check_shell_command, check_code, core_file_warning,
)

registry = Registry('codex_style')

READ_LIMIT = 12000
RUN_TIMEOUT = 30
_AUDIT_LOCK = threading.Lock()


def _audit(ctx, tool, detail):
    with _AUDIT_LOCK:
        try:
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audit.log')
            with open(path, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'ts': time.time(), 'tool': tool, 'detail': detail}, ensure_ascii=False) + '\n')
        except Exception:
            pass
    tool_event(ctx, 'audit', {'tool': tool, 'detail': detail})


# ---------------------------------------------------------------- read（带行号，codex 特色）

@registry.register(
    'codex_read',
    'Read a text file. Returns content prefixed with line numbers (use them for precise edits).',
    {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']},
)
def codex_read(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full or not os.path.isfile(full):
        return False, 'file not found or path not allowed: %s' % args.get('path')
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read(READ_LIMIT * 4)
    lines = text.splitlines()
    numbered = '\n'.join('%5d| %s' % (i + 1, ln) for i, ln in enumerate(lines))
    out = clip_text(numbered, READ_LIMIT, '…[lines clipped, use read_lines for ranges]')
    _audit(ctx, 'codex_read', {'path': full})
    return True, out


@registry.register(
    'codex_read_lines',
    'Read a line range of a file (1-based, inclusive). Cheaper than full read.',
    {'type': 'object', 'properties': {
        'path': {'type': 'string'},
        'start': {'type': 'integer'},
        'end': {'type': 'integer'}}, 'required': ['path']},
)
def codex_read_lines(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full or not os.path.isfile(full):
        return False, 'file not found: %s' % args.get('path')
    start = max(1, int(args.get('start') or 1))
    end = int(args.get('end') or start + 400)
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()
    seg = lines[start - 1:end]
    return True, '\n'.join('%5d| %s' % (start + i, ln.rstrip('\n')) for i, ln in enumerate(seg))


@registry.register(
    'codex_list_dir',
    'List directory tree (depth-limited).',
    {'type': 'object', 'properties': {
        'path': {'type': 'string'},
        'depth': {'type': 'integer'}}, 'required': []},
)
def codex_list_dir(args, ctx):
    base = resolve_path(args.get('path') or '.', ctx.get('project_path'))
    if not base or not os.path.isdir(base):
        return False, 'dir not found: %s' % args.get('path')
    depth = min(4, max(1, int(args.get('depth') or 2)))
    out = []
    for root, dirs, files in os.walk(base):
        rel = os.path.relpath(root, base)
        if rel.count(os.sep) >= depth:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__')]
        indent = '  ' * rel.count(os.sep)
        if rel != '.':
            out.append(indent + os.path.basename(root) + '/')
        for fn in sorted(files)[:50]:
            out.append(indent + '  ' + fn)
    return True, clip_text('\n'.join(out), 8000)


# ---------------------------------------------------------------- 提案-审批-落盘（codex 核心）

def _unified_diff(old, new, path):
    import difflib
    return '\n'.join(difflib.unified_diff(
        str(old).splitlines(), str(new).splitlines(),
        fromfile='a/' + path, tofile='b/' + path, lineterm=''))


@registry.register(
    'codex_propose_write',
    'Propose a file write. Shows a diff, does NOT write. Then call codex_apply_write to commit.',
    {'type': 'object', 'properties': {
        'path': {'type': 'string'},
        'content': {'type': 'string'}}, 'required': ['path', 'content'], },
)
def codex_propose_write(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full:
        return False, 'path not allowed: %s' % args.get('path')
    old = ''
    if os.path.isfile(full):
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            old = f.read()
    diff = _unified_diff(old, args.get('content', ''), args.get('path'))
    pending = ctx.setdefault('_codex_pending_writes', {})
    pending[args.get('path')] = {'full': full, 'content': args.get('content', '')}
    _audit(ctx, 'codex_propose_write', {'path': full, 'diff_lines': diff.count('\n') + 1})
    # 推送 proposal 事件（含 diff 预览），供前端展示确认信息/审计
    tool_event(ctx, 'proposal', {
        'path': full,
        'is_new_file': not os.path.isfile(full),
        'diff_lines': diff.count('\n') + 1,
        'diff': clip_text(diff, 6000),
    })

    if os.path.isfile(full):
        return True, 'PROPOSED (existing file, diff below):\n' + clip_text(diff, 6000)
    return True, 'PROPOSED (new file, %d chars). Call codex_apply_write to commit.' % len(args.get('content', ''))


@registry.register(
    'codex_apply_write',
    'Commit a previously proposed write (must call codex_propose_write first). Backs up to .bak.',
    {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']},
)
def codex_apply_write(args, ctx):
    pending = ctx.get('_codex_pending_writes') or {}
    p = pending.pop(args.get('path'), None)
    if not p:
        return False, 'no pending proposal for %s; call codex_propose_write first (approval flow)' % args.get('path')
    full = p['full']
    # 安全墙：统一备份目录（backups/tool_writes/，替代散落的 .bak）+ 核心文件提示
    backup_before_write(full, tag='codex_apply_write')
    warn = core_file_warning(full)
    os.makedirs(os.path.dirname(full) or '.', exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(p['content'])
    _audit(ctx, 'codex_apply_write', {'path': full, 'size': len(p['content'])})
    return True, 'written: %s (%d bytes, backup .bak if replaced)%s' % (args.get('path'), len(p['content']), warn)


@registry.register(
    'codex_replace',
    'Exact text replace in a file (single occurrence). Shows no diff; audit-logged. Backup .bak automatic.',
    {'type': 'object', 'properties': {
        'path': {'type': 'string'},
        'old_text': {'type': 'string'},
        'new_text': {'type': 'string'}}, 'required': ['path', 'old_text', 'new_text']},
)
def codex_replace(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full or not os.path.isfile(full):
        return False, 'file not found: %s' % args.get('path')
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        data = f.read()
    old = args.get('old_text', '')
    if data.count(old) != 1:
        return False, 'old_text matches %d times (need exactly 1)' % data.count(old)
    # 安全墙：统一备份目录 + 核心文件提示
    backup_before_write(full, tag='codex_replace')
    warn = core_file_warning(full)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(data.replace(old, args.get('new_text', ''), 1))
    _audit(ctx, 'codex_replace', {'path': full})
    return True, 'replaced 1 occurrence in %s%s' % (args.get('path'), warn)


# ---------------------------------------------------------------- 执行（超时 + 审计）

@registry.register(
    'codex_run_code',
    'Run a shell command in the project directory. Hard timeout, output truncated, audit-logged.',
    {'type': 'object', 'properties': {
        'code': {'type': 'string'},
        'timeout': {'type': 'integer'}}, 'required': ['code']},
    dangerous=True,
)
def codex_run_code(args, ctx):
    code = args.get('code', '')
    # 安全墙第二层：危险命令 / 编码事故拦截
    deny = check_shell_command(code) or check_code(code)
    if deny:
        _audit(ctx, 'codex_run_code_blocked', {'cmd': code[:200]})
        return False, deny
    timeout = min(120, max(1, int(args.get('timeout') or RUN_TIMEOUT)))
    _audit(ctx, 'codex_run_code', {'cmd': code[:200], 'timeout': timeout})
    try:
        r = subprocess.run(code, shell=True, capture_output=True,
                           timeout=timeout, cwd=ctx.get('project_path') or '.')
        out = (r.stdout or b'').decode('utf-8', 'replace')[-6000:]
        err = (r.stderr or b'').decode('utf-8', 'replace')[-3000:]
        return True, 'exit=%d\n--- stdout ---\n%s\n--- stderr ---\n%s' % (r.returncode, out or '(empty)', err or '(empty)')
    except subprocess.TimeoutExpired:
        return False, 'command timed out after %ss (killed)' % timeout


# ---------------------------------------------------------------- diffstat + 审批档位（v3 独有）

_VALID_MODES = ('read_only', 'auto_edit', 'full_access')
_APPROVAL_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              '_state', 'approval_mode')


def _get_mode_file():
    try:
        with open(_APPROVAL_FILE, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return 'auto_edit'


def _set_mode_file(mode):
    os.makedirs(os.path.dirname(_APPROVAL_FILE), exist_ok=True)
    with open(_APPROVAL_FILE, 'w', encoding='utf-8') as f:
        f.write(mode)

@registry.register(
    'codex_diffstat',
    'Show diff statistics (lines added/removed) between current file and a pending proposal, or stat a file size.',
    {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']},
)
def codex_diffstat(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full:
        return False, 'path not allowed'
    pending = (ctx.get('_codex_pending_writes') or {}).get(args.get('path'))
    if not pending:
        if not os.path.isfile(full):
            return False, 'file not found and no pending proposal'
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            n = len(f.read().splitlines())
        return True, '%s: %d lines (on disk, no pending proposal)' % (args.get('path'), n)
    if os.path.isfile(full):
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            old_lines = f.read().splitlines()
    else:
        old_lines = []
    new_lines = pending['content'].splitlines()
    added = len([l for l in new_lines if l not in old_lines])
    removed = len([l for l in old_lines if l not in new_lines])
    return True, '%s: +%d/-%d lines pending (use codex_apply_write to commit)' % (args.get('path'), added, removed)


@registry.register(
    'codex_set_approval',
    'Get or set the approval mode: read_only / auto_edit / full_access. Omit mode to query current.',
    {'type': 'object', 'properties': {'mode': {'type': 'string', 'enum': list(_VALID_MODES)}}, 'required': []},
)
def codex_set_approval(args, ctx):
    mode = args.get('mode')
    if not mode:
        return True, 'current approval mode: %s' % (ctx.get('_codex_approval') or _get_mode_file())
    if mode not in _VALID_MODES:
        return False, 'invalid mode (use: %s)' % '/'.join(_VALID_MODES)
    _set_mode_file(mode)
    return True, 'approval mode switched to %s' % mode


@registry.register(
    'codex_audit',
    'Replay the audit log: last N audited actions (reads, writes, commands) of this engine.',
    {'type': 'object', 'properties': {'last': {'type': 'integer'}}, 'required': []},
)
def codex_audit(args, ctx):
    try:
        n = min(50, max(1, int(args.get('last') or 10)))
    except (TypeError, ValueError):
        n = 10
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audit.log'),
                  'r', encoding='utf-8') as f:
            lines = f.readlines()
    except OSError:
        return True, '(audit log empty)'
    return True, ''.join(lines[-n:]) or '(empty)'


def get_registry():
    return registry
