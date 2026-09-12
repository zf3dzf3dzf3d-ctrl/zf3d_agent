#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/anthropic_adapter.py - Anthropic Messages 协议适配器
（v5.1.3 新增：让用户可为大模型线路选择 Anthropic 协议格式）

背景：
    部分模型服务（Claude 官方、Claude Code 专用中转、部分 GLM 网关等）
    只提供 Anthropic Messages 协议（POST {base}/v1/messages）。
    本适配器把系统内部的 OpenAI Chat Completions 格式
    <-> Anthropic Messages 格式互转，两条链路均接入：
      1) 后端 agent_loop（dual_protocol.call_upstream，非流式）
      2) 前端对话代理（/api/proxy 非流式 + /api/proxy_stream 流式）

设计原则：
    - 纯函数式转换，无状态、无 IO（网络由调用方执行）
    - 输出严格归一化为 OpenAI Chat Completions 格式，下游零改动
    - 任何转换异常都不致命：调用方捕获后回退原有直连逻辑

对外接口：
    is_anthropic_endpoint(url)          -> bool（按 URL 路径判断）
    to_anthropic_request(cc_payload)    -> (url_suffix, anth_payload)
    from_anthropic_response(anth_resp)  -> OpenAI 非流式响应 dict
    anthropic_sse_to_openai_events(raw_line) -> OpenAI 流式 chunk dict | None
    stream_adapter_reset()              -> 流式状态机复位（每次请求前调用）
"""

import json
import re

# ============================================================
# 识别：URL 是否指向 Anthropic Messages 端点
# ============================================================

_ANT_PATH_MARKS = ('/v1/messages', '/messages')

def is_anthropic_endpoint(url):
    """按 URL 判断是否 Anthropic 协议端点。
    三种用户填法都支持：
      1) 官方/中转完整端点：https://host/v1/messages
      2) Anthropic 网关根：https://open.bigmodel.cn/api/anthropic（客户端自动拼 /v1/messages）
      3) 任何路径带 /messages 的地址"""
    try:
        u = str(url or '').lower()
    except Exception:
        return False
    if not u:
        return False
    if 'anthropic' in u:          # 网关根地址（GLM 等）
        return True
    from urllib.parse import urlparse
    try:
        path = urlparse(u).path
    except Exception:
        return False
    return any(m in path for m in _ANT_PATH_MARKS)


# ============================================================
# 请求转换：OpenAI Chat Completions -> Anthropic Messages
# ============================================================

def _cc_content_to_anth(content):
    """OpenAI content（str 或 parts 数组）-> Anthropic content 数组。
    Anthropic 的 system 不能放进 messages，单独由调用方提取。"""
    if content is None:
        return []
    if isinstance(content, str):
        return [{'type': 'text', 'text': content}] if content else []
    parts = []
    if isinstance(content, list):
        for p in content:
            if not isinstance(p, dict):
                continue
            pt = p.get('type')
            if pt == 'text':
                parts.append({'type': 'text', 'text': str(p.get('text') or '')})
            elif pt == 'image_url':
                # data:image/png;base64,xxx -> Anthropic image block
                url = str((p.get('image_url') or {}).get('url') or '')
                if url.startswith('data:'):
                    try:
                        meta, b64 = url.split(',', 1)
                        mime = meta.split(':', 1)[1].split(';', 1)[0] or 'image/png'
                        parts.append({'type': 'image',
                                      'source': {'type': 'base64',
                                                 'media_type': mime,
                                                 'data': b64}})
                    except Exception:
                        pass
                # http 图片 Anthropic 也支持 url source
                elif url.startswith('http'):
                    parts.append({'type': 'image',
                                  'source': {'type': 'url', 'url': url}})
    return parts


def _cc_tools_to_anth(tools):
    """OpenAI tools -> Anthropic tools（顶层 name/description/input_schema）"""
    out = []
    for t in tools or []:
        if not isinstance(t, dict) or t.get('type') != 'function':
            continue
        fn = t.get('function') or {}
        out.append({
            'name': fn.get('name') or '',
            'description': fn.get('description') or '',
            'input_schema': fn.get('parameters') or {'type': 'object', 'properties': {}},
        })
    return out


def to_anthropic_request(cc_payload):
    """OpenAI Chat Completions payload -> Anthropic Messages payload。
    返回 (anth_payload)。system 消息合并到顶层 system 字段。"""
    msgs_in = cc_payload.get('messages') or []
    system_parts = []
    out_msgs = []

    for m in msgs_in:
        if not isinstance(m, dict):
            continue
        role = m.get('role')
        if role == 'system':
            # system -> 顶层 system（数组则展开拼接）
            c = m.get('content')
            if isinstance(c, list):
                for p in c:
                    if isinstance(p, dict) and p.get('type') == 'text':
                        system_parts.append(str(p.get('text') or ''))
            elif c:
                system_parts.append(str(c))
        elif role == 'user':
            out_msgs.append({'role': 'user', 'content': _cc_content_to_anth(m.get('content'))})
        elif role == 'assistant':
            blocks = _cc_content_to_anth(m.get('content'))
            tcs = m.get('tool_calls') or []
            for tc in tcs:
                fn = tc.get('function') or {}
                try:
                    args = json.loads(fn.get('arguments') or '{}')
                except Exception:
                    args = {}
                blocks.append({'type': 'tool_use', 'id': tc.get('id') or ('call_' + str(len(blocks))),
                               'name': fn.get('name') or '', 'input': args})
            if blocks:
                out_msgs.append({'role': 'assistant', 'content': blocks})
        elif role == 'tool':
            # OpenAI tool 结果 -> Anthropic user 消息里的 tool_result block
            out_msgs.append({'role': 'user', 'content': [{
                'type': 'tool_result',
                'tool_use_id': m.get('tool_call_id') or '',
                'content': [{'type': 'text', 'text': str(m.get('content') or '')}],
            }]})

    anth = {
        'model': cc_payload.get('model') or '',
        'messages': out_msgs,
        'max_tokens': int(cc_payload.get('max_tokens') or 8192),
    }
    if system_parts:
        anth['system'] = '\n\n'.join(system_parts)
    if cc_payload.get('temperature') is not None:
        anth['temperature'] = cc_payload['temperature']
    if cc_payload.get('top_p') is not None:
        anth['top_p'] = cc_payload['top_p']
    if cc_payload.get('stop'):
        stop = cc_payload['stop']
        anth['stop_sequences'] = stop if isinstance(stop, list) else [stop]
    tools = _cc_tools_to_anth(cc_payload.get('tools'))
    if tools:
        anth['tools'] = tools
    tc = cc_payload.get('tool_choice')
    if isinstance(tc, dict) and tc.get('type') == 'function':
        anth['tool_choice'] = {'type': 'tool', 'name': (tc.get('function') or {}).get('name') or ''}
    elif tc == 'required':
        anth['tool_choice'] = {'type': 'any'}
    elif tc == 'none':
        anth['tool_choice'] = {'type': 'auto'}
    # 其余字段（frequency_penalty 等）Anthropic 不支持，忽略
    return anth


def anthropic_headers(api_key):
    """Anthropic 协议必需头（覆盖 OpenAI 的 Authorization 用法）"""
    return {
        'x-api-key': str(api_key or ''),
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
    }


# ============================================================
# 响应转换：Anthropic 非流式 -> OpenAI Chat Completions
# ============================================================

def from_anthropic_response(anth_resp, model=''):
    """Anthropic Messages 响应 -> OpenAI Chat Completions 格式。
    content 数组拼接 text；tool_use 转为 tool_calls。"""
    if not isinstance(anth_resp, dict):
        return {'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': ''},
                             'finish_reason': 'stop'}]}
    text_parts = []
    reasoning_parts = []
    tool_calls = []
    for b in anth_resp.get('content') or []:
        if not isinstance(b, dict):
            continue
        bt = b.get('type')
        if bt == 'text':
            text_parts.append(str(b.get('text') or ''))
        elif bt == 'thinking':
            reasoning_parts.append(str(b.get('thinking') or b.get('text') or ''))
        elif bt == 'tool_use':
            tool_calls.append({
                'id': b.get('id') or '',
                'type': 'function',
                'function': {'name': b.get('name') or '',
                             'arguments': json.dumps(b.get('input') or {}, ensure_ascii=False)},
            })

    stop_map = {'end_turn': 'stop', 'tool_use': 'tool_calls', 'max_tokens': 'length',
                'stop_sequence': 'stop'}
    msg = {'role': 'assistant', 'content': ''.join(text_parts)}
    if reasoning_parts:
        msg['reasoning_content'] = ''.join(reasoning_parts)   # 兼容 GLM 风格思考字段
    if tool_calls:
        msg['tool_calls'] = tool_calls
    finish = stop_map.get(anth_resp.get('stop_reason') or '', 'stop')

    return {
        'id': anth_resp.get('id') or 'anthropic-adapted',
        'object': 'chat.completion',
        'created': 0,
        'model': anth_resp.get('model') or model,
        'choices': [{'index': 0, 'message': msg, 'finish_reason': finish}],
        'usage': {
            'prompt_tokens': ((anth_resp.get('usage') or {}).get('input_tokens') or 0),
            'completion_tokens': ((anth_resp.get('usage') or {}).get('output_tokens') or 0),
        },
    }


# ============================================================
# 流式转换：Anthropic SSE -> OpenAI Chat Completions chunk
# ============================================================

# 每请求一次的状态（服务端单线程串行模型，安全）
_STREAM_STATE = {'block_type': None, 'tool_idx': -1, 'tool_id': '', 'tool_name': ''}


def stream_adapter_reset():
    _STREAM_STATE['block_type'] = None
    _STREAM_STATE['tool_idx'] = -1
    _STREAM_STATE['tool_id'] = ''
    _STREAM_STATE['tool_name'] = ''


def _mk_chunk(delta, finish=None, model=''):
    return {'id': 'chatcmpl-anth-adapted', 'object': 'chat.completion.chunk',
            'created': 0, 'model': model,
            'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}


def anthropic_event_to_openai_chunk(event):
    """Anthropic 流式事件 dict -> OpenAI chunk dict；无关事件返回 None。
    事件类型：message_start / content_block_start / content_block_delta /
              content_block_stop / message_delta / message_stop / ping / error"""
    if not isinstance(event, dict):
        return None
    et = event.get('type')
    model = (event.get('message') or {}).get('model') or ''

    if et == 'message_start':
        return _mk_chunk({'role': 'assistant', 'content': ''}, model=model)

    if et == 'content_block_start':
        b = event.get('content_block') or {}
        bt = b.get('type')
        _STREAM_STATE['block_type'] = bt
        if bt == 'tool_use':
            _STREAM_STATE['tool_idx'] += 1
            _STREAM_STATE['tool_id'] = b.get('id') or ''
            _STREAM_STATE['tool_name'] = b.get('name') or ''
            return _mk_chunk({'tool_calls': [{'index': _STREAM_STATE['tool_idx'],
                                              'id': _STREAM_STATE['tool_id'], 'type': 'function',
                                              'function': {'name': _STREAM_STATE['tool_name'],
                                                           'arguments': ''}}]}, model=model)
        return None

    if et == 'content_block_delta':
        d = event.get('delta') or {}
        dt = d.get('type')
        if _STREAM_STATE['block_type'] == 'thinking' and dt in ('thinking_delta', 'text_delta'):
            return _mk_chunk({'reasoning_content': d.get('thinking') or d.get('text') or ''},
                             model=model)
        if dt == 'text_delta':
            return _mk_chunk({'content': d.get('text') or ''}, model=model)
        if dt == 'input_json_delta':
            return _mk_chunk({'tool_calls': [{'index': max(_STREAM_STATE['tool_idx'], 0),
                                              'function': {'arguments': d.get('partial_json') or ''}}]},
                             model=model)
        return None

    if et == 'content_block_stop':
        _STREAM_STATE['block_type'] = None
        return None

    if et == 'message_delta':
        d = event.get('delta') or {}
        sr = d.get('stop_reason')
        stop_map = {'end_turn': 'stop', 'tool_use': 'tool_calls', 'max_tokens': 'length',
                    'stop_sequence': 'stop'}
        if sr:
            return _mk_chunk({}, finish=stop_map.get(sr, 'stop'), model=model)
        return None

    if et == 'message_stop':
        return 'DONE'          # 特殊标记：调用方发 data: [DONE]

    return None


def anthropic_sse_line_to_openai_chunk(raw_line):
    """SSE 原始行（'data: {...}'）-> OpenAI chunk dict | 'DONE' | None"""
    line = (raw_line or '').strip()
    if not line.startswith('data:'):
        return None
    payload = line[5:].strip()
    if not payload or payload == '[DONE]':
        return None
    try:
        ev = json.loads(payload)
    except Exception:
        return None
    if ev.get('type') == 'error':
        return None
    return anthropic_event_to_openai_chunk(ev)


# ============================================================
# 代理链路一键接入：识别 + 转换请求（mixin_proxy / mixin_proxy_stream 用）
# ============================================================

def adapt_proxy_request(target_url, payload, headers):
    """(url, payload, headers) -> (url2, payload2, headers2, is_anthropic)
    识别规则：URL 带 anthropic 或 /messages 即转换；
    payload 里 api_format='openai' 可强制关闭，'anthropic' 可强制开启。"""
    fmt = ''
    if isinstance(payload, dict):
        fmt = str(payload.get('api_format') or '')
    is_anth = is_anthropic_endpoint(target_url)
    if fmt == 'openai':
        is_anth = False
    elif fmt == 'anthropic':
        is_anth = True
    if not is_anth:
        return target_url, payload, headers, False

    base = str(target_url or '').rstrip('/')
    if base.endswith('/v1/messages') or base.endswith('/messages'):
        url2 = base
    else:
        url2 = base + '/v1/messages'

    payload2 = dict(payload or {})
    payload2.pop('api_format', None)
    payload2.pop('stream', None)
    payload2 = to_anthropic_request(payload2)

    headers2 = dict(headers or {})
    # 从 Authorization: Bearer xxx 提取真实密钥（代理链路密钥在头里）
    key = ''
    for k, v in list(headers2.items()):
        if str(k).lower() == 'authorization':
            m = re.search(r'(?i)bearer\s+([^\s";]+)', str(v))
            if m:
                key = m.group(1)
            headers2.pop(k, None)
    if not key:
        key = str(headers2.pop('X-Real-Key', '') or '')
    out = anthropic_headers(key)
    if str(key).startswith('eyJ'):
        out['Authorization'] = 'Bearer ' + str(key)
    skip = {'content-type', 'accept', 'x-api-key', 'anthropic-version', 'authorization',
            'x-real-key', 'host', 'content-length', 'connection'}
    for k, v in headers2.items():
        if str(k).lower() not in skip:
            out[k] = v
    return url2, payload2, out, True
