#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/dual_protocol.py - 双协议适配层（Chat Completions / Responses API）

解决的问题：
    agent_loop 每轮调上游都用 OpenAI Chat Completions，不保留 Reasoning（推理过程），
    相当于每轮都「打晕重来」，多步 agent 任务会明显变弱。
    OpenAI 新的 Responses API（POST /v1/responses）会在服务端保留 previous_response_id
    对应的推理状态，配合 store=true 可以带上思考继续。

功能：
    1. endpoint 探测：自动判断上游支持哪种协议（缓存，60s 有效）
       GET  {base}/responses          -> 200/400 = 支持 Responses API
       POST {base}/chat/completions   -> 兜底
    2. 协议路由：按探测结果 + 用户配置选择协议
    3. 上下文保留挡位（ctx_mode）：
         truncate  - 截断（现状）：messages 全量重发，不带思考，最省 token
         minimal   - 极简保留：只保留 system + 最近 2 轮对话 + 思考过程摘要
         full      - 全保留：Responses API 时用 previous_response_id 串联（思考全保留），
                     Chat Completions 时全量重发
       仅 full 挡位在 Responses API 下会带 Reasoning（思考过程），其余挡位不带。
    4. 请求转换：Chat Completions payload <-> Responses API payload
       （messages->input、tools 格式、响应 choices 格式归一化，agent_loop 无感知）

对外接口（供 agent_loop 调用）：
    call_upstream(ctx, payload) -> dict（OpenAI Chat Completions 格式响应）
    probe_endpoint(base_url, api_key) -> 'responses' | 'chat' | 'unknown'
    get_protocol_policy() -> {'protocol': 'auto'|'responses'|'chat', 'ctx_mode': 'truncate'|'minimal'|'full'}

挡位配置（private/agent_protocol.json，无文件用默认）：
    {"protocol": "auto", "ctx_mode": "truncate"}
    protocol: auto=探测自适应 / responses=强制 Responses / chat=强制 Chat Completions
    ctx_mode: truncate=截断 / minimal=极简保留 / full=全保留
"""

import os
import json
import time
import urllib.request
import urllib.error

UPSTREAM_TIMEOUT = 300
PROBE_TIMEOUT = 8
_CACHE_TTL = 60          # endpoint 探测缓存秒数

_DIR = os.path.dirname(os.path.abspath(__file__))
_LOG_PATH = os.path.join(_DIR, '_dual_protocol.log')
_CFG_PATH = os.path.join(_DIR, '..', '..', '..', 'private', 'agent_protocol.json')

# 探测缓存：{base_url: {'protocol': str, 'ts': float}}
_PROBE_CACHE = {}
_cfg_cache = {'ts': 0.0, 'value': None}


def _log(msg):
    try:
        with open(_LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%m-%d %H:%M:%S ') + str(msg) + '\n')
    except OSError:
        pass


# ============================ 配置 ============================

def get_protocol_policy():
    """读挡位配置，带 5s 缓存。返回 {'protocol':..., 'ctx_mode':...}"""
    now = time.time()
    if _cfg_cache['value'] is not None and now - _cfg_cache['ts'] < 5:
        return dict(_cfg_cache['value'])
    value = {'protocol': 'auto', 'ctx_mode': 'truncate'}   # 默认：自适应协议+截断（现状行为）
    try:
        with open(_CFG_PATH, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        if isinstance(data, dict):
            p = str(data.get('protocol') or '').strip().lower()
            if p in ('auto', 'responses', 'chat'):
                value['protocol'] = p
            m = str(data.get('ctx_mode') or '').strip().lower()
            if m in ('truncate', 'minimal', 'full'):
                value['ctx_mode'] = m
    except (OSError, ValueError):
        pass
    _cfg_cache['ts'] = now
    _cfg_cache['value'] = value
    return dict(value)


# ============================ endpoint 探测 ============================

def _base_of(target_url):
    """从 target_url 提取 base（去掉 /chat/completions 或 /responses 尾巴）"""
    u = str(target_url or '').strip()
    for tail in ('/chat/completions', '/responses'):
        if u.endswith(tail):
            u = u[: -len(tail)]
            break
    return u.rstrip('/')


def probe_endpoint(base_url, api_key=''):
    """
    探测上游 base 是否支持 Responses API。
    判定：GET {base}/responses 返回非 404/405（200/400/401 都算支持）。
    结果缓存 60s。返回 'responses' | 'chat'。
    """
    base = _base_of(base_url)
    now = time.time()
    hit = _PROBE_CACHE.get(base)
    if hit and now - hit.get('ts', 0) < _CACHE_TTL:
        return hit['protocol']

    proto = 'chat'   # 兜底
    try:
        url = base + '/responses'
        req = urllib.request.Request(url, method='GET')
        if api_key:
            req.add_header('Authorization', 'Bearer ' + str(api_key))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=PROBE_TIMEOUT) as resp:
                resp.read(64)
            proto = 'responses'
        except urllib.error.HTTPError as e:
            # 404/405 = 路由不存在 -> 只支持 chat；其他（401/400等）= 路由存在 -> 支持 responses
            proto = 'chat' if e.code in (404, 405) else 'responses'
        except (urllib.error.URLError, OSError):
            proto = 'chat'
    except Exception as e:   # noqa: BLE001 探测绝不能影响主流程
        _log('probe error %s: %s' % (base, e))
        proto = 'chat'

    _PROBE_CACHE[base] = {'protocol': proto, 'ts': now}
    _log('probe %s -> %s' % (base, proto))
    return proto


def _resolve_protocol(ctx):
    """按配置 + 探测结果决定本轮用哪种协议。返回 'responses' | 'chat'"""
    policy = get_protocol_policy()
    forced = policy.get('protocol')
    if forced in ('responses', 'chat'):
        return forced
    # auto：从 target_url / model_cfg 推断 base，再探测
    target_url = str(ctx.get('target_url') or '')
    base = _base_of(target_url)
    api_key = ''
    mc = ctx.get('model_cfg') or {}
    if isinstance(mc, dict):
        api_key = str(mc.get('apiKey') or mc.get('api_key') or '')
    if not api_key:
        # 从 headers 还原（掩码头时 _sanitize 已处理过，这里尽力而为）
        auth = str((ctx.get('headers') or {}).get('Authorization') or '')
        if auth.startswith('Bearer '):
            api_key = auth[7:]
    return probe_endpoint(base or target_url, api_key)


# ============================ Responses API 转换 ============================

def _cc_tools_to_responses(tools):
    """OpenAI tools[{type:function,function:{name,description,parameters}}]
    -> Responses tools[{type:function,name,description,parameters}]"""
    out = []
    for t in tools or []:
        if not isinstance(t, dict):
            continue
        if t.get('type') == 'function':
            fn = t.get('function') or {}
            out.append({
                'type': 'function',
                'name': fn.get('name') or '',
                'description': fn.get('description') or '',
                'parameters': fn.get('parameters') or {'type': 'object', 'properties': {}},
            })
    return out


def _resp_to_cc_response(resp):
    """Responses API 响应 -> OpenAI Chat Completions 格式（agent_loop 消费）。
    同时抽取 reasoning 摘要放 _reasoning_hint，供极简挡位回填。"""
    out_msg = {'role': 'assistant', 'content': ''}
    rid = resp.get('id') or ''
    rc = resp.get('reasoning') or {}
    if isinstance(rc, dict) and rc.get('summary'):
        try:
            out_msg['_reasoning_hint'] = ' '.join(
                str(s.get('text') or s.get('summary') or '') for s in rc['summary'] if isinstance(s, dict)
            ).strip()[:2000]
        except Exception:
            pass
    tool_calls = []
    for item in resp.get('output') or []:
        if not isinstance(item, dict):
            continue
        it = item.get('type')
        if it == 'message':
            content = item.get('content') or []
            texts = []
            for c in content:
                if isinstance(c, dict) and c.get('type') in ('output_text', 'text'):
                    texts.append(str(c.get('text') or ''))
            out_msg['content'] += ''.join(texts)
        elif it == 'function_call':
            tool_calls.append({
                'id': item.get('call_id') or item.get('id') or '',
                'type': 'function',
                'function': {
                    'name': item.get('name') or '',
                    'arguments': item.get('arguments') or '{}',
                },
            })
    if tool_calls:
        out_msg['tool_calls'] = tool_calls
    out = {
        'id': rid,
        'object': 'chat.completion',
        'model': resp.get('model') or '',
        'choices': [{'index': 0, 'message': out_msg, 'finish_reason': 'tool_calls' if tool_calls else 'stop'}],
        '_response_id': rid,   # full 挡位下一轮 previous_response_id 用
    }
    return out


def _cc_payload_to_responses(payload, ctx, prev_id):
    """Chat Completions payload -> Responses API payload"""
    messages = payload.get('messages') or []
    inp = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = m.get('role') or 'user'
        content = m.get('content')
        if role == 'tool':
            inp.append({
                'type': 'function_call_output',
                'call_id': str(m.get('tool_call_id') or ''),
                'output': str(content if content is not None else ''),
            })
        elif role == 'assistant' and isinstance(m.get('tool_calls'), list) and m['tool_calls']:
            for tc in m['tool_calls']:
                fn = tc.get('function') or {}
                inp.append({
                    'type': 'function_call',
                    'call_id': str(tc.get('id') or ''),
                    'name': str(fn.get('name') or ''),
                    'arguments': str(fn.get('arguments') or '{}'),
                })
            if content:
                inp.append({'role': 'assistant', 'content': str(content)})
        else:
            inp.append({'role': role, 'content': str(content if content is not None else '')})

    out = {
        'model': payload.get('model') or '',
        'input': inp,
        'stream': False,
        'store': True,          # full 挡位思考保留的前提
    }
    if prev_id:
        out['previous_response_id'] = prev_id
    tools = _cc_tools_to_responses(payload.get('tools'))
    if tools:
        out['tools'] = tools
    for k in ('temperature', 'top_p'):
        if payload.get(k) is not None:
            out[k] = payload[k]
    return out


# ============================ 挡位（ctx_mode）处理 ============================

def _apply_ctx_mode(messages, ctx_mode):
    """按挡位裁剪 messages。minimal：保留 system + 最近2轮 user/assistant + reasoning_hint 摘要"""
    messages = messages or []
    if ctx_mode != 'minimal' or len(messages) <= 6:
        return messages
    sys_msgs = [m for m in messages if m.get('role') == 'system']
    rest = [m for m in messages if m.get('role') != 'system']
    # 最近 2 个 assistant 轮次的 reasoning hint
    hints = [m.get('_reasoning_hint') for m in rest if m.get('_reasoning_hint')]
    tail = rest[-4:]   # 最近2轮（user+assistant 各2条）
    out = list(sys_msgs)
    if hints:
        out.append({'role': 'user', 'content': '[system context] 前几轮思考要点：' + '；'.join(h for h in hints if h)})
    out.extend(tail)
    return out


# ============================ 统一入口 ============================

def call_upstream(ctx, payload):
    """双协议统一调用入口（agent_loop 的替换点）。"""
    return _call_upstream_impl(ctx, payload)


# ===== v5.1.3 协议状态徽章：最近 N 轮实际协议环形记录（内存，重启即清） =====
_LAST_PROTOCOLS = []          # [{'ts': epoch, 'protocol': 'chat|responses|anthropic', 'mode': ctx_mode, 'note': str}]
_LAST_PROTOCOLS_MAX = 20


def _record_protocol(protocol, ctx_mode, note=''):
    """每次上游调用成功后记一条，供 /api/agent/protocol/last 展示（协议状态徽章数据源）"""
    try:
        _LAST_PROTOCOLS.append({
            'ts': round(time.time(), 3),
            'protocol': str(protocol or ''),
            'mode': str(ctx_mode or ''),
            'note': str(note or ''),
        })
        if len(_LAST_PROTOCOLS) > _LAST_PROTOCOLS_MAX:
            del _LAST_PROTOCOLS[:-_LAST_PROTOCOLS_MAX]
    except Exception:
        pass


def get_last_protocols(limit=20):
    """返回最近 limit 条实际协议记录（新→旧），供前端徽章浮层展示"""
    try:
        n = max(1, min(int(limit or 20), _LAST_PROTOCOLS_MAX))
    except Exception:
        n = _LAST_PROTOCOLS_MAX
    items = list(_LAST_PROTOCOLS[-n:])
    items.reverse()
    return items


def _call_upstream_impl(ctx, payload):
    policy = get_protocol_policy()
    ctx_mode = policy.get('ctx_mode') or 'truncate'
    payload = dict(payload or {})
    payload['stream'] = False
    # 挡位先裁剪（对 chat 协议也生效：minimal 挡省 token）
    payload['messages'] = _apply_ctx_mode(payload.get('messages') or [], ctx_mode)

    headers = dict(ctx.get('headers') or {})
    data = json.dumps(payload, ensure_ascii=True).encode('utf-8')

    def _post(url, body):
        req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=True).encode('utf-8'), method='POST')
        for k, v in headers.items():
            try:
                req.add_header(k, str(v))
            except Exception:
                pass
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=UPSTREAM_TIMEOUT) as resp:
            return json.loads(resp.read().decode('utf-8', errors='replace'))

    # 【v5.1.3】Anthropic 协议线路（apiFormat 指定或 URL 自动识别）：整条走适配器
    try:
        from common.anthropic_adapter import is_anthropic_endpoint as _cc_is_anth
    except Exception:
        _cc_is_anth = None
    _mk0 = ctx.get('model_cfg') or {}
    _fmt = str(payload.get('api_format') or _mk0.get('apiFormat') or '') if isinstance(payload, dict) else str(_mk0.get('apiFormat') or '')
    if _fmt == 'anthropic' or (_fmt != 'openai' and _cc_is_anth and _cc_is_anth(ctx.get('target_url'))):
        try:
            from common.anthropic_adapter import (
                to_anthropic_request as _to_anth, from_anthropic_response as _from_anth,
                anthropic_headers as _anth_hdrs)
            _base = _base_of(ctx.get('target_url') or '').rstrip('/')
            _u = _base if _base.endswith('/v1/messages') or _base.endswith('/messages') else (_base + '/v1/messages')
            _k = _mk0.get('apiKey') or _mk0.get('key') or ctx.get('api_key') or ''
            _ap = dict(payload or {})
            _ap.pop('api_format', None)
            _ap = _to_anth(_ap)
            _hd = _anth_hdrs(_k)
            if str(_k).startswith('eyJ'):
                _hd['Authorization'] = 'Bearer ' + str(_k)
            _data = json.dumps(_ap, ensure_ascii=True).encode('utf-8')
            _req = urllib.request.Request(_u, data=_data, method='POST')
            for _hk, _hv in _hd.items():
                try:
                    _req.add_header(_hk, str(_hv))
                except Exception:
                    pass
            _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with _opener.open(_req, timeout=120) as _resp:
                _r = json.loads(_resp.read().decode('utf-8', errors='replace'))
            _log('anthropic ok | url=%s | msgs=%d' % (_u, len(_ap.get('messages') or [])))
            _record_protocol('anthropic', ctx_mode, 'Anthropic Messages 原生')
            return _from_anth(_r, _ap.get('model') or '')
        except urllib.error.HTTPError as _ae:
            _ab = ''
            try:
                _ab = _ae.read().decode('utf-8', errors='replace')[:300]
            except Exception:
                pass
            raise RuntimeError('anthropic upstream HTTP %s: %s' % (_ae.code, _ab)) from _ae
        except Exception as _ae:
            raise RuntimeError('anthropic upstream call failed: %s' % _ae) from _ae

    use_resp = (_resolve_protocol(ctx) == 'responses')
    if use_resp:
        url = _base_of(ctx.get('target_url') or '') + '/responses'
        # full 挡位：优先用上一轮 response_id 串联（上游保留思考），没有则全量 input
        prev_id = ''
        if ctx_mode == 'full':
            prev_id = str(ctx.get('_prev_response_id') or '')
            payload_r = _cc_payload_to_responses(payload, ctx, prev_id)
            # previous_response_id 已含全部历史时可精简 input，但保守起见仍全量传
        else:
            payload_r = _cc_payload_to_responses(payload, ctx, '')
        try:
            resp = _post(url, payload_r)
            cc = _resp_to_cc_response(resp)
            # 记录 response_id 供下一轮 full 挡位串联
            if cc.get('_response_id'):
                ctx['_prev_response_id'] = cc['_response_id']
            _log('responses ok | mode=%s | prev=%s | rid=%s' % (ctx_mode, prev_id[:20], cc.get('_response_id', '')[:20]))
            _record_protocol('responses', ctx_mode, 'Responses 协议')
            return cc
        except urllib.error.HTTPError as e:
            # Responses 调用失败（部分中转不支持 POST）-> 回退 chat/completions
            body_txt = ''
            try:
                body_txt = e.read().decode('utf-8', errors='replace')[:300]
            except Exception:
                pass
            _log('responses failed HTTP %s -> fallback chat | %s' % (e.code, body_txt))
            if e.code in (404, 405, 400, 501):
                _PROBE_CACHE[_base_of(ctx.get('target_url') or '')] = {'protocol': 'chat', 'ts': time.time()}
                use_resp = False
            else:
                raise RuntimeError('responses upstream HTTP %s: %s' % (e.code, body_txt or e.reason)) from e

    if not use_resp:
        url = ctx.get('target_url')
        _log('chat ok | mode=%s' % ctx_mode)
        _record_protocol('chat', ctx_mode, 'Chat Completions')
        return _post(url, payload)


def probe_summary():
    """诊断用：返回探测缓存快照"""
    return [{'base': k, 'protocol': v.get('protocol'), 'age_s': int(time.time() - v.get('ts', 0))}
            for k, v in _PROBE_CACHE.items()]


if __name__ == '__main__':
    print(json.dumps(get_protocol_policy(), ensure_ascii=False))
    print(json.dumps(probe_summary(), ensure_ascii=False))
