#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deepseek_direct.engine - DeepSeek 直连引擎 v3（彻底差异化版）

与前两个引擎完全不同的行为（本引擎独有）：
1. 免压缩直连：DeepSeek 128K 上下文，消息全量透传不做滑窗/截断
   （仅对超长单条工具结果做兜底截断，正常永远不动）
2. 参数 preset：按用户任务关键词自动切换 temperature/top_p
   - code/edit: 低温 0.2（精准）
   - 写作/创意: 高温 0.9
   - 默认: 0.6
3. 中文优先提示词：高效实干家人格，最少轮次
4. 扁平 schema + 剥离 deepseek 不支持的 payload 字段
5. 极简：不注入任何额外 system（除首次人格）、不做审计、不做审批——模型自己走

接口不变：run / execute_tool_calls / get_tool_schemas
"""

import os
import json
import re

_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_PATH = os.path.join(_DIR, 'manifest.json')

_registry = None

# deepseek API 不支持/不需要的字段（直连时剥离）
_STRIP_FIELDS = {'logprobs', 'top_logprobs', 'frequency_penalty', 'presence_penalty'}

# 任务模式 preset（deepseek 独有：按内容自动调参）
_PRESETS = [
    ('precision', 0.2, 0.9, re.compile(r'(修改|修复|bug|重构|代码|edit|fix|refactor|code|错误|报错)', re.I)),
    ('creative', 0.9, 0.95, re.compile(r'(写一篇|创作|文案|故事|创意|brainstorm|文章|标题|口号)', re.I)),
]
_DEFAULT_PRESET = ('balanced', 0.6, 0.95)

SYSTEM_PROMPT = (
    "你是一个直接、高效的编程助手，用最少的轮次完成任务。\n"
    "规则：\n"
    "- 直接用 ds_ 工具（读/写/列/运行）干活，工具结果是纯文本。\n"
    "- 回答简短具体，不铺垫、不复述问题。\n"
    "- 改文件时给出最终内容或精确变更。\n"
    "- 你的上下文很大（128K），历史信息都是完整的，放心引用早期细节。"
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
            from engines.deepseek_direct import tools as _tools
            _registry = _tools.get_registry()
        except Exception as e:
            print('[deepseek_direct] tools load failed: %s' % e)
            from engines.common.tool_base import Registry
            _registry = Registry('deepseek_direct')
    return _registry


def get_tool_schemas():
    return get_tool_schemas_flat()


def get_tool_schemas_flat():
    """deepseek 独有：schema 剥离嵌套 description，最扁平、省 token。"""
    out = []
    for s in get_registry().schemas():
        fn = dict(s.get('function') or {})
        params = fn.get('parameters') or {}
        flat_props = {}
        for k, v in (params.get('properties') or {}).items():
            if isinstance(v, dict):
                flat_props[k] = {'type': v.get('type', 'string')}
        fn['parameters'] = {'type': 'object', 'properties': flat_props,
                            'required': params.get('required', [])}
        out.append({'type': 'function', 'function': fn})
    return out


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


def _pick_preset(messages):
    """按最后一条用户消息内容选参数 preset。"""
    text = ' '.join(m.get('content', '') for m in messages if m.get('role') == 'user')[-2000:]
    for name, temp, top_p, rx in _PRESETS:
        if rx.search(text):
            return name, temp, top_p
    return _DEFAULT_PRESET


def _light_guard(messages, single_limit=16000):
    """免压缩：不做滑窗。只对超长单条工具结果兜底截断（正常不会触发）。"""
    for m in messages:
        if m.get('role') == 'tool' and isinstance(m.get('content'), str) and len(m['content']) > single_limit:
            m['content'] = m['content'][:single_limit] + '\n…[单条超长兜底截断]'
    return messages


def run(messages, ctx, on_event=None):
    payload = dict(ctx.get('payload') or {})
    messages = validate_messages(messages or payload.get('messages') or [])
    messages = _light_guard(messages)          # 全量透传，仅兜底
    if not messages or messages[0].get('role') != 'system' or '最少轮次' not in str(messages[0].get('content', '')):
        messages = [{'role': 'system', 'content': SYSTEM_PROMPT}] + messages
    payload['messages'] = messages
    for k in _STRIP_FIELDS:
        payload.pop(k, None)
    # 参数 preset：用户未显式指定时按任务内容自动调参
    if payload.get('temperature') is None:
        name, temp, top_p = _pick_preset(messages)
        payload['temperature'] = temp
        payload['top_p'] = top_p
        ctx['_ds_preset'] = name
    payload['tools'] = get_tool_schemas_flat()
    ctx['payload'] = payload
    ctx['_engine_mode'] = 'local_loop'
    ctx['_engine_id'] = 'deepseek_direct'
    return ctx


def execute_tool_calls(tool_calls, ctx):
    """直连风格：全部执行、纯文本、无头无审批——快就一个字。"""
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
        ok, result = reg.execute(name, args, ctx)
        out.append({
            'tool_call_id': tc.get('tool_call_id') or tc.get('id') or '',
            'role': 'tool',
            'content': result,
            '_ok': ok,
        })
    return out
