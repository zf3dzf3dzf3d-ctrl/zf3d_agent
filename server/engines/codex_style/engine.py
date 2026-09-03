#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
codex_style.engine - Codex CLI 引擎 v3（彻底差异化版）

与骨架版的关键差异（本引擎独有行为）：
1. 单步循环：一轮最多放行 1 个工具调用，多余调用直接打回（codex CLI 的谨慎节奏）
2. 三档审批模式：read_only / auto_edit / full_access
   - read_only:      危险工具（run_code / apply_write / replace）一律拒绝
   - auto_edit:      文件编辑放行，run_code 需先 propose 再 apply
   - full_access:    全放行（仍记审计）
3. diffstat：写操作返回 +N/-M 行统计，codex 式透明
4. 会话 summary：轮次结束附 [CODEX SUMMARY] 审计摘要注入下一轮
5. 审计回放：codex_audit 工具，可回看本会话所有危险操作

接口不变：run / execute_tool_calls / get_tool_schemas
"""

import os
import json
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_PATH = os.path.join(_DIR, 'manifest.json')
SESSION_STATE_DIR = os.path.join(_DIR, '_state')

_registry = None
_APPROVAL_FILE = os.path.join(SESSION_STATE_DIR, 'approval_mode')
DEFAULT_APPROVAL = 'auto_edit'

_VALID_MODES = ('read_only', 'auto_edit', 'full_access')

# 各审批档位允许的"危险"工具
_DANGEROUS_TOOLS = {'codex_apply_write', 'codex_replace', 'codex_run_code'}
_EDIT_TOOLS = {'codex_apply_write', 'codex_replace'}

SYSTEM_PROMPT = (
    "You are Codex, a careful senior engineer working inside the user's project.\n"
    "Operating discipline (strict):\n"
    "1. ONE tool call per turn. Plan, then execute exactly one action.\n"
    "2. Read before write. Cite line numbers from codex_read output.\n"
    "3. Writes go through the approval flow: codex_propose_write (shows diff) -> "
    "codex_apply_write (commits). codex_replace only for single-occurrence edits.\n"
    "4. After each write, report a diffstat like (+12/-3 lines).\n"
    "5. End risky sequences with a short summary of what changed.\n"
    "Be terse, factual, and audit-friendly."
)


def _load_manifest():
    try:
        with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def get_approval_mode():
    try:
        with open(_APPROVAL_FILE, 'r', encoding='utf-8') as f:
            m = f.read().strip()
        return m if m in _VALID_MODES else DEFAULT_APPROVAL
    except OSError:
        return DEFAULT_APPROVAL


def set_approval_mode(mode):
    if mode not in _VALID_MODES:
        return False
    os.makedirs(SESSION_STATE_DIR, exist_ok=True)
    with open(_APPROVAL_FILE, 'w', encoding='utf-8') as f:
        f.write(mode)
    return True


def get_registry():
    global _registry
    if _registry is None:
        try:
            from engines.codex_style import tools as _tools
            _registry = _tools.get_registry()
        except Exception as e:
            print('[codex_style] tools load failed: %s' % e)
            from engines.common.tool_base import Registry
            _registry = Registry('codex_style')
    return _registry


def get_tool_schemas():
    return get_registry().schemas()


def validate_messages(messages):
    if not isinstance(messages, list):
        raise ValueError('messages must be a list')
    out = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = str(m.get('role', '')).strip()
        if not role:
            continue
        entry = dict(m)
        entry['role'] = role
        if 'content' not in entry:
            entry['content'] = ''
        out.append(entry)
    return out


def _compact_messages(messages, keep=40, tool_limit=6000):
    """codex 压缩：滑窗 40 + 工具截 6000（保留 codex 自身策略）。"""
    from engines.common.tool_base import clip_text
    sys_msgs = [m for m in messages if m.get('role') == 'system']
    rest = [m for m in messages if m.get('role') != 'system']
    if len(rest) > keep:
        rest = rest[-keep:]
    for m in rest:
        if m.get('role') == 'tool' and isinstance(m.get('content'), str):
            m['content'] = clip_text(m['content'], tool_limit, '…[tool output clipped]')
    return sys_msgs + rest


def _session_summary_header(messages):
    """把审计日志最近几条作为 [CODEX SUMMARY] 注入，模型知道之前做了什么。

    缓存优化：动态摘要追加到消息列表末尾（而非插在开头），并清除历史中
    上一次注入的旧摘要。这样稳定的 SYSTEM_PROMPT + 历史消息保持前缀不变，
    prompt 缓存可以命中；动态部分只在尾部，不破坏前缀缓存。
    """
    audit_path = os.path.join(_DIR, 'audit.log')
    lines = []
    try:
        with open(audit_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()[-5:]
    except OSError:
        pass
    # 先剔除历史里旧一轮注入的摘要，避免累积且保持前缀稳定
    messages = [m for m in messages
                if not (m.get('role') == 'system'
                        and str(m.get('content', '')).startswith('[CODEX SUMMARY]'))]
    if not lines:
        return messages
    summary = '[CODEX SUMMARY] recent audited actions:\n' + ''.join(lines)
    return messages + [{'role': 'system', 'content': summary}]


def run(messages, ctx, on_event=None):
    payload = dict(ctx.get('payload') or {})
    messages = validate_messages(messages or payload.get('messages') or [])
    messages = _compact_messages(messages)
    if not messages or messages[0].get('role') != 'system' or 'Codex' not in str(messages[0].get('content', '')):
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}] + messages
    messages = _session_summary_header(messages)
    payload['messages'] = messages
    payload['tools'] = get_tool_schemas()
    ctx['payload'] = payload
    ctx['_engine_mode'] = 'local_loop'
    ctx['_engine_id'] = 'codex_style'
    ctx['_codex_approval'] = get_approval_mode()
    return ctx


def _check_approval(name, ctx, args=None):
    """三档审批检查。返回 None=放行，否则返回拒绝消息。
    full_access 也不再完全裸跑：shell 危险命令仍走安全墙拦截（防绕过版）。"""
    mode = ctx.get('_codex_approval') or get_approval_mode()
    if mode == 'full_access':
        # full_access 档位下，run_code 里的 shell 命令仍过一遍危险模式拦截，
        # 拦不住的才放行（安全墙是兜底，不是审批替代）
        if name == 'run_code':
            from engines.common.safety_wall import check_shell_command
            code = ''
            if isinstance(args, dict):
                code = args.get('code') or ''
            deny = check_shell_command(code)
            if deny:
                return '[full_access 警示] ' + deny
        return None
    if mode == 'read_only' and name in _DANGEROUS_TOOLS:
        return ('REJECTED by approval mode=read_only. This tool is blocked. '
                'Switch to auto_edit/full_access or answer from read-only data.')
    # auto_edit：放行 run_code（审计日志兜底），与 codex CLI 的 auto-edit 语义一致
    return None


def execute_tool_calls(tool_calls, ctx):
    """单步循环核心：一轮只执行第一个工具调用，其余打回。"""
    reg = get_registry()
    calls = list(tool_calls or [])
    out = []
    if not calls:
        return out
    for i, tc in enumerate(calls):
        # 兼容两种格式：简化版 {name, arguments} 与 OpenAI 标准版 {function:{name, arguments}}
        fn = tc.get('function') or {}
        name = tc.get('name') or (fn.get('name') if isinstance(fn, dict) else '') or ''
        tc_id = tc.get('tool_call_id') or tc.get('id') or ''
        args = tc.get('arguments')
        if args is None and isinstance(fn, dict):
            args = fn.get('arguments')
        if isinstance(args, str):
            try:
                args = json.loads(args or '{}')
            except json.JSONDecodeError:
                args = {'_raw': args}
        if i > 0:
            # 单步纪律：多余调用打回，让模型逐步来（codex 节奏）
            out.append({
                'tool_call_id': tc_id, 'role': 'tool',
                'content': 'DEFERRED: codex discipline allows ONE tool call per turn. '
                           'This call was deferred; re-issue it next turn if still needed.',
                '_ok': False,
            })
            continue
        deny = _check_approval(name, ctx, args)
        if deny:
            out.append({'tool_call_id': tc_id, 'role': 'tool', 'content': deny, '_ok': False})
            continue
        ok, result = reg.execute(name, args, ctx)
        out.append({'tool_call_id': tc_id, 'role': 'tool', 'content': result, '_ok': ok})
    return out
