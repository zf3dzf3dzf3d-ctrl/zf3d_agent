#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
chat_mode_rules.py - 对话模式限制规则模块
职责：
1. 读取 private/chat_mode_rules.json（按对话模式 1/2 分组的限制规则）
2. 提供 get_request_rules(loop_mode) -> 该模式在"单次请求"层面的强制限制
3. enforce_request_rules(loop_mode, payload) -> 在 _handle_proxy 发往上游前强制执行：
   - 消息条数超限 -> 截断（保留 system + 最新消息）
   - 单条消息长度超限 -> 拒绝该次请求（400）
   - 请求总字符超限 -> 拒绝该次请求（400）
   - 工具定义数量超限（含 0=完全禁用工具）-> 裁剪 tools 字段
4. 提供 load_rules_cache() 供 API 路由读取完整规则（前端用它拿 loop 段做前端限制）
设计原则：
- 规则文件缺失/损坏/字段为 null -> 自动退回内置宽容默认值（几乎无限制）
- 所有数值做安全钳制，防止配置错误拖垮服务
- 文件 mtime 缓存，改动即生效（服务端无需重启）
"""
import os
import json
import threading
import time
_RULES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'chat_mode_rules.json'
)
_RULES_LOCK = threading.Lock()
_RULES_CACHE = {'mtime': 0, 'data': None}
# ===== 内置宽容默认值（规则文件缺失/损坏/字段为空时的兜底 = 几乎无限制）=====
_BUILTIN_REQUEST_DEFAULTS = {
    'max_messages': 100000,            # 消息条数上限
    'max_single_message_chars': 5000000,  # 单条消息字符上限
    'max_request_chars': 50000000,      # 整个请求体字符上限
    'max_tools_in_request': 500,        # 请求携带的工具定义数量上限（0=不带工具）
    'request_timeout_seconds': 1800,   # 上游请求超时（秒）
}
# 硬安全钳制（即使 json 里写了超大值也不至于失控）
_HARD_LIMITS = {
    'max_messages': (1, 100000),
    'max_single_message_chars': (1000, 5000000),
    'max_request_chars': (1000, 50000000),
    'max_tools_in_request': (0, 500),
    'request_timeout_seconds': (5, 3600),
}

def _read_rules_raw():
    """读取规则文件（带 mtime 缓存）。失败返回 None。"""
    try:
        mtime = os.path.getmtime(_RULES_PATH)
    except OSError:
        return None
    with _RULES_LOCK:
        if _RULES_CACHE['data'] is not None and _RULES_CACHE['mtime'] == mtime:
            return _RULES_CACHE['data']
    try:
        with open(_RULES_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    with _RULES_LOCK:
        _RULES_CACHE['mtime'] = mtime
        _RULES_CACHE['data'] = data
    return data

def _num(value, fallback):
    """安全取数：null/非法 -> 兜底；并按硬上限钳制。"""
    if value is None:
        return fallback
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    return n

def _clamp(key, n, fallback):
    lo, hi = _HARD_LIMITS.get(key, (0, n))
    if n < lo or n > hi:
        return fallback
    return n

def _merge_request_rules(loop_mode):
    """合并 global.request + modes.<mode>.request，缺失字段用内置默认值。"""
    rules = dict(_BUILTIN_REQUEST_DEFAULTS)
    data = _read_rules_raw()
    if not data:
        return rules
    # global 段
    g = data.get('global') or {}
    if isinstance(g.get('request'), dict):
        for k in _BUILTIN_REQUEST_DEFAULTS:
            if g['request'].get(k) is not None:
                rules[k] = _num(g['request'][k], rules[k])
    # 模式段（覆盖 global）
    modes = data.get('modes') or {}
    m = modes.get(str(loop_mode)) or modes.get(loop_mode) or {}
    if isinstance(m.get('request'), dict):
        for k in _BUILTIN_REQUEST_DEFAULTS:
            if m['request'].get(k) is not None:
                rules[k] = _num(m['request'][k], rules[k])
    # 钳制到安全范围
    for k in rules:
        rules[k] = _clamp(k, rules[k], _BUILTIN_REQUEST_DEFAULTS[k])
    return rules

def get_request_rules(loop_mode, overrides=None):
    """获取指定模式的请求层规则（服务端强制执行）。
    overrides: 插件 manifest 的 limits 段，优先级最高。"""
    mode = str(loop_mode).strip() if loop_mode is not None else '1'
    rules = _merge_request_rules(mode)
    if isinstance(overrides, dict):
        for k in _BUILTIN_REQUEST_DEFAULTS:
            if overrides.get(k) is not None:
                rules[k] = _clamp(k, _num(overrides.get(k), rules[k]), _BUILTIN_REQUEST_DEFAULTS[k])
    return rules

def get_mode_rules(loop_mode):
    """获取指定模式完整规则（含 loop 段，供 API 返回给前端）。"""
    mode = str(loop_mode).strip() if loop_mode is not None else '1'
    data = _read_rules_raw()
    out = {'mode': mode, 'request': _merge_request_rules(mode), 'loop': {}}
    if not data:
        return out
    modes = data.get('modes') or {}
    m = modes.get(str(mode)) or {}
    if isinstance(m, dict) and isinstance(m.get('loop'), dict):
        out['loop'] = m['loop']
    g = data.get('global') or {}
    if isinstance(g.get('loop'), dict):
        for k, v in g['loop'].items():
            out['loop'].setdefault(k, v)
    return out

def load_rules_cache():
    """读取整个规则文件（API 路由用）。带 mtime 缓存，改动即生效。"""
    return _read_rules_raw()

def save_rules(new_rules):
    """整体写入规则文件（原子替换 + 刷新缓存）。"""
    os.makedirs(os.path.dirname(_RULES_PATH), exist_ok=True)
    tmp = _RULES_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(new_rules, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _RULES_PATH)
    try:
        with _RULES_LOCK:
            _RULES_CACHE['mtime'] = os.path.getmtime(_RULES_PATH)
            _RULES_CACHE['data'] = new_rules
    except OSError:
        pass
    return new_rules

class RulesReject(Exception):
    """规则拒绝（应返回 4xx 给前端）。"""
    def __init__(self, message, mode):
        super().__init__(message)
        self.mode = mode

def enforce_request_rules(loop_mode, payload, overrides=None):
    """
    在 _handle_proxy 中调用（发往上游 AI 之前）强制执行规则。
    overrides: 插件 manifest limits（最高优先级）。
    返回处理后的 payload（可能被截断/裁剪）。
    抛出 RulesReject 表示该次请求违反硬限制。
    """
    if not isinstance(payload, dict):
        return payload
    rules = get_request_rules(loop_mode, overrides=overrides)
    mode = str(loop_mode).strip() if loop_mode is not None else '1'
    msgs = payload.get('messages')
    if isinstance(msgs, list) and rules['max_messages'] and len(msgs) > rules['max_messages']:
        # 截断：保留 system（前缀）+ 最新消息
        keep = int(rules['max_messages'])
        head = [m for m in msgs if isinstance(m, dict) and m.get('role') == 'system'][:2]
        body = [m for m in msgs if not (isinstance(m, dict) and m.get('role') == 'system')]
        if len(head) + len(body) > keep:
            body = body[-(keep - len(head)):] if keep > len(head) else []
        payload['messages'] = head + body
        print('[ModeRules] mode=%s messages truncated %d -> %d' % (mode, len(msgs), len(payload['messages'])))
    # 单条消息字符超限 -> 拒绝
    if isinstance(msgs, list):
        limit = rules['max_single_message_chars']
        for m in msgs:
            if isinstance(m, dict) and isinstance(m.get('content'), str) and len(m['content']) > limit:
                raise RulesReject(
                    '单条消息长度 %d 超过模式%s限制 %d 字符，请缩短后重试。' % (
                        len(m['content']), mode, limit), mode)
    # 请求总字符超限 -> 拒绝
    if rules['max_request_chars']:
        try:
            total = len(json.dumps(payload, ensure_ascii=False))
        except (TypeError, ValueError):
            total = 0
        if total > rules['max_request_chars']:
            raise RulesReject(
                '请求体总长度 %d 超过模式%s限制 %d 字符，请精简后重试。' % (
                    total, mode, rules['max_request_chars']), mode)
    # 工具定义数量限制（0=禁用工具）
    tools = payload.get('tools')
    if isinstance(tools, list):
        limit = rules['max_tools_in_request']
        if limit == 0:
            payload.pop('tools', None)
            payload.pop('tool_choice', None)
            print('[ModeRules] mode=%s tools disabled by rule' % mode)
        elif len(tools) > limit:
            payload['tools'] = tools[:limit]
            print('[ModeRules] mode=%s tools truncated %d -> %d' % (mode, len(tools), limit))
    return payload

def get_request_timeout(loop_mode):
    """按模式取上游请求超时秒数（_handle_proxy 的 urlopen timeout 用）。"""
    return get_request_rules(loop_mode)['request_timeout_seconds']
