#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pi_style.engine - pi agent 引擎 v3（彻底差异化版）

与 codex_style 完全相反的行为（本引擎独有）：
1. 流水线批量：一轮内所有工具调用全部按顺序执行（pi 的吞吐哲学），不做审批
2. OK/ERR meta 头：每个工具结果强制带 [OK]/[ERR] 头 + 耗时，管道可预测
3. 一步一摘要：把上一轮工具结果压缩成一行注入，模型永远带着"管道状态"前进
4. 调用计数器：把已用调用数暴露给模型（pi_stat 工具 + 注入提示）
5. 头尾保留裁剪：压上下文时保留最早+最新，丢中间（pi 的可预测策略）

接口不变：run / execute_tool_calls / get_tool_schemas
"""

import os
import json
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_PATH = os.path.join(_DIR, 'manifest.json')

_registry = None
_COUNTER = {'total': 0, 'session_start': time.time()}   # 进程级流水线计数器

SYSTEM_PROMPT = (
    "You are pi, a high-throughput pipeline agent.\n"
    "Operating discipline:\n"
    "1. Batch freely: issue ALL independent tool calls in one turn. The pipeline runs them in order.\n"
    "2. Tool results arrive with [OK]/[ERR] headers. Skim headers first, act on failures immediately.\n"
    "3. Keep a running one-line status: `step N: <what you just learned>`.\n"
    "4. No filler. No apologies. Results in, results out.\n"
    "You are trusted: no approval gates. Precision comes from the pipeline, not from caution."
)


def _load_manifest():
    try:
        with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def get_registry():
    global _registry
    if _registry is None:
        try:
            from engines.pi_style import tools as _tools
            _registry = _tools.get_registry()
        except Exception as e:
            print('[pi_style] tools load failed: %s' % e)
            from engines.common.tool_base import Registry
            _registry = Registry('pi_style')
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


def _clip_tool_messages(messages, limit=2500):
    """pi 管道瘦身：头 80% + 尾 20%，中间丢弃（与其他引擎的纯尾部截断不同）。"""
    for m in messages:
        if m.get('role') == 'tool' and isinstance(m.get('content'), str):
            c = m['content']
            if len(c) > limit:
                m['content'] = c[:int(limit * 0.8)] + '\n…[pipeline clip]' + c[-int(limit * 0.2):]
    return messages


def _compact_messages(messages, keep=60):
    """pi 头尾保留：最早 6 条 + 最新 keep-6 条，丢中间。"""
    sys_msgs = [m for m in messages if m.get('role') == 'system']
    rest = [m for m in messages if m.get('role') != 'system']
    head = 6
    if len(rest) > keep:
        rest = rest[:head] + ['\n…[%d pipeline steps collapsed]…\n' % (len(rest) - keep)] + rest[-(keep - head):]
    return sys_msgs + rest


def _pipeline_status_header(messages):
    """注入管道状态：调用计数 + 上一轮工具结果的一行摘要。

    缓存优化：动态状态追加到末尾并清除历史旧注入，保持稳定前缀可命中
    prompt 缓存（原实现插在开头，每轮都使整个前缀缓存失效）。
    """
    last_tool = next((m for m in reversed(messages) if m.get('role') == 'tool'), None)
    line = ''
    if last_tool and isinstance(last_tool.get('content'), str):
        first = last_tool['content'].strip().splitlines()[0][:120] if last_tool['content'].strip() else ''
        line = ' | last result: %s' % first
    status = '[PIPELINE] calls so far: %d | uptime: %.0fs%s' % (
        _COUNTER['total'], time.time() - _COUNTER['session_start'], line)
    # 剔除历史里旧一轮注入的状态行，避免累积且保持前缀稳定
    messages = [m for m in messages
                if not (m.get('role') == 'system'
                        and str(m.get('content', '')).startswith('[PIPELINE]'))]
    return messages + [{'role': 'system', 'content': status}]


def run(messages, ctx, on_event=None):
    payload = dict(ctx.get('payload') or {})
    messages = validate_messages(messages or payload.get('messages') or [])
    messages = _clip_tool_messages(messages)
    messages = _compact_messages(messages)
    if not messages or messages[0].get('role') != 'system' or 'pipeline agent' not in str(messages[0].get('content', '')):
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}] + messages
    messages = _pipeline_status_header(messages)
    payload['messages'] = messages
    payload['tools'] = get_tool_schemas()
    ctx['payload'] = payload
    ctx['_engine_mode'] = 'local_loop'
    ctx['_engine_id'] = 'pi_style'
    return ctx


def execute_tool_calls(tool_calls, ctx):
    """流水线核心：一轮内全部执行（与 codex 单步相反），结果带 [OK]/[ERR] 头 + 耗时。"""
    reg = get_registry()
    out = []
    for tc in (tool_calls or []):
        name = tc.get('name') or ''
        args = tc.get('arguments')
        if isinstance(args, str):
            try:
                args = json.loads(args or '{}')
            except json.JSONDecodeError:
                args = {'_raw': args}
        t0 = time.time()
        ok, result = reg.execute(name, args, ctx)
        dt = time.time() - t0
        _COUNTER['total'] += 1
        header = '[OK %s %.2fs]' % (name, dt) if ok else '[ERR %s %.2fs]' % (name, dt)
        out.append({
            'tool_call_id': tc.get('tool_call_id') or tc.get('id') or '',
            'role': 'tool',
            'content': '%s %s' % (header, result),
            '_ok': ok,
        })
    return out
