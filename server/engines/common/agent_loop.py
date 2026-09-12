#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/agent_loop.py - 通用服务端 agent 循环内核（引擎无关，可插拔）

设计（从 codex-cli turn.rs 取精髓重写，不照搬）：
- 循环内核只负责「调模型 -> 有工具调用就交给引擎执行 -> 结果回填 -> 再调模型」
- 每轮工具调用全部交给引擎自己的 execute_tool_calls 处理：
  * codex_style 有单步纪律（一轮只放行1个）+ 三档审批 -> 内核不感知
  * pi_style / deepseek_direct 可有自己的节奏
- MAX_TURNS 防失控；每轮消息由引擎钩子（compact_messages）压缩（可选）
- 上游 HTTP 调用复用 ctx['target_url'] / ctx['headers']（proxy 已还原密钥）

接口：
    run_agent_loop(engine_id, engine_mod, messages, ctx, on_event=None)
        -> OpenAI 兼容响应 dict（choices[0].message.content 为最终文本）

引擎钩子（全部可选，通过 hasattr 探测）：
    validate_messages(messages) -> messages
    compact_messages(messages)  -> messages
    get_tool_schemas()          -> list[dict]
    execute_tool_calls(tool_calls, ctx) -> list[{tool_call_id, role:'tool', content, _ok}]
"""

import os
import json
import time
import urllib.request
import urllib.error

MAX_TURNS = 50               # 循环上限，防失控
UPSTREAM_TIMEOUT = 300      # 单次上游调用超时（秒）

_DIR = os.path.dirname(os.path.abspath(__file__))
loop_LOG = os.path.join(_DIR, '_loop.log')

# ===== 工具结果打回（reject）参数：超长/失败结果不进上下文，原文落盘存档，回填短通知让模型换方法 =====
REJECT_DEFAULTS = {
    'enabled': True,
    'max_chars': 20000,          # 结果超过该长度 → 打回
    'reject_failed': True,       # _ok=False 的失败结果 → 打回（仅当长度超过 min_fail_len）
    'min_fail_len': 2000,        # 失败结果打回的最小长度：短失败通知原文放行（保留引擎语义，如 codex DEFERRED）
    'archive_dir': os.path.normpath(os.path.join(_DIR, '..', '..', '..', 'private', 'tool_result_archive')),
    'notice': ('[工具结果已被打回存档（原因: {reason}，原始长度 {n} 字符），该结果未进入上下文。'
               '如确需原文，用 run_code 对存档文件 {path} 分片读取（每次 4000 字符）；'
               '否则请换方法或缩小范围重新执行。]'),
}


def _log(msg):
    try:
        with open(loop_LOG, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%m-%d %H:%M:%S ') + str(msg) + '\n')
    except OSError:
        pass


def _sanitize_headers(headers):
    """修复 latin-1 编码失败的请求头（典型：掩码密钥 'Bearer ••••xxxx' 未被还原）。
    对不能 latin-1 编码的值：若是 Authorization，按尾4位从 api_keys.json 还原真实密钥；
    还原不了则该头丢弃并记日志，保证循环内上游调用不会 3 连败。"""
    import re as _re
    out = {}
    for k, v in (headers or {}).items():
        sv = str(v)
        try:
            sv.encode('latin-1')
            out[k] = sv
            continue
        except UnicodeEncodeError:
            pass
        if k.lower() == 'authorization':
            try:
                from model_config import find_key_by_tail
                m = _re.search(r'([0-9A-Za-z]{2,8})$', sv)
                tail = m.group(1) if m else sv[-4:]
                real = find_key_by_tail(tail)
                if real:
                    _log('sanitized masked Authorization header (tail=%s)' % tail)
                    sv = 'Bearer ' + real
            except Exception as _e:
                _log('auth header restore failed: %s' % _e)
        try:
            sv.encode('latin-1')
            out[k] = sv
        except UnicodeEncodeError:
            _log('dropped non-latin1 header: %s (len=%d)' % (k, len(sv)))
    return out


def _call_upstream(ctx, payload):
    """调用上游模型 API（非流式），返回响应 dict。异常时抛 RuntimeError。

    v2：接入双协议适配层（dual_protocol）。
    - 自动探测上游支持 Responses API 还是 Chat Completions（缓存 60s）
    - 支持上下文保留挡位：truncate 截断 / minimal 极简保留（带思考摘要）/ full 全保留
    - 双协议层异常时回退到内置 chat/completions 直连逻辑，保证可用性
    """
    try:
        from common.dual_protocol import call_upstream as _dual_call
        return _dual_call(ctx, payload)
    except Exception as e:   # noqa: BLE001 适配层任何异常都回退直连，不影响主流程
        _log('dual_protocol fallback -> builtin chat: %r' % e)

    url = ctx.get('target_url')

    # 【v5.1.3】Anthropic 协议直连兜底（dual_protocol 异常时仍可走）
    try:
        from common.anthropic_adapter import is_anthropic_endpoint as _al_is_anth
        if _al_is_anth(url):
            from common.anthropic_adapter import (
                to_anthropic_request as _al_to_anth, from_anthropic_response as _al_from_anth,
                anthropic_headers as _al_hdrs)
            _mk = ctx.get('model_cfg') or {}
            _k = _mk.get('apiKey') or _mk.get('key') or ctx.get('api_key') or ''
            _base = str(url or '').rstrip('/')
            _u = _base if _base.endswith('/v1/messages') or _base.endswith('/messages') else (_base + '/v1/messages')
            _p2 = dict(payload)
            _p2['stream'] = False
            _p2.pop('api_format', None)
            _ap2 = _al_to_anth(_p2)
            _hd2 = _al_hdrs(_k)
            if str(_k).startswith('eyJ'):
                _hd2['Authorization'] = 'Bearer ' + str(_k)
            _d2 = json.dumps(_ap2, ensure_ascii=True).encode('utf-8')
            _rq2 = urllib.request.Request(_u, data=_d2, method='POST')
            for _hk2, _hv2 in _hd2.items():
                try:
                    _rq2.add_header(_hk2, str(_hv2))
                except Exception:
                    pass
            _op2 = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with _op2.open(_rq2, timeout=UPSTREAM_TIMEOUT) as _rp2:
                _b2 = _rp2.read().decode('utf-8', errors='replace')
            _log('anthropic fallback ok')
            return _al_from_anth(json.loads(_b2), _ap2.get('model') or '')
    except urllib.error.HTTPError as _ah:
        _ab2 = ''
        try:
            _ab2 = _ah.read().decode('utf-8', errors='replace')[:300]
        except Exception:
            pass
        raise RuntimeError('anthropic upstream HTTP %s: %s' % (_ah.code, _ab2)) from _ah
    except Exception as _ae2:
        _log('anthropic fallback skip: %r' % _ae2)

    headers = _sanitize_headers(ctx.get('headers') or {})
    # 循环内必须非流式，避免 SSE 处理复杂化
    payload = dict(payload)
    payload['stream'] = False
    data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
    last_err = None
    for attempt in range(3):
        req = urllib.request.Request(url, data=data, method='POST')
        for k, v in headers.items():
            try:
                req.add_header(k, str(v))
            except Exception:
                pass
        try:
            # 直连，不使用环境代理（loopback/内网及 API 直连都更可靠）
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=UPSTREAM_TIMEOUT) as resp:
                body = resp.read().decode('utf-8', errors='replace')
            return json.loads(body)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as e:
            # HTTPError 是上游明确返回错误（如 4xx/5xx），不重试，直接抛
            if isinstance(e, urllib.error.HTTPError):
                raise RuntimeError('agent_loop upstream HTTP %s: %s' % (e.code, e.reason)) from e
            last_err = e
            if attempt < 2:
                _log('upstream transient error (attempt %d): %s, retrying' % (attempt + 1, e))
                time.sleep(0.4 * (attempt + 1))
    raise RuntimeError('agent_loop upstream call failed after retries: %s' % last_err)


def _extract_message(resp):
    """从 OpenAI 兼容响应中取 message dict；取不到返回 None。"""
    if not isinstance(resp, dict):
        return None
    choices = resp.get('choices') or []
    if not choices:
        return None
    return (choices[0] or {}).get('message') or None


def _extract_tool_calls(message):
    """提取工具调用，返回【OpenAI 标准完整格式】（type:'function' + function:{name,arguments}）。

    【修复】之前返回简化格式 {id,name,arguments}，直接塞进下一轮 messages 后被
    上游 API 400 拒绝（tool_calls 必须是 function 类型对象）。
    下游 execute_tool_calls 同时兼容两种格式。
    """
    tcs = message.get('tool_calls') if isinstance(message, dict) else None
    if not isinstance(tcs, list):
        return []
    out = []
    for tc in tcs:
        if not isinstance(tc, dict):
            continue
        fn = tc.get('function') or {}
        out.append({
            'id': tc.get('id') or '',
            'type': 'function',
            'function': {'name': fn.get('name') or '', 'arguments': fn.get('arguments') or '{}'},
        })
    return out


def _engine_preferred_model(engine_id):
    """读取引擎 manifest 的 preferred_model（模型偏好配置，可为空）。"""
    try:
        mpath = os.path.join(os.path.dirname(_DIR), engine_id, 'manifest.json')
        with open(mpath, 'r', encoding='utf-8-sig') as f:
            m = json.load(f)
        pm = str(m.get('preferred_model') or '').strip()
        return pm or None
    except Exception:
        return None


_reject_seq = 0


def _reject_tool_results(results, cfg=None):
    """【工具结果打回】超大/失败的结果不进上下文，原文落盘存档，替换为短通知。
    好处：上下文立刻干净，不带错误的工具结果继续跑浪费 token；模型按通知换方法或分片查回原文。"""
    _cfg = dict(REJECT_DEFAULTS, **(cfg or {}))
    if not _cfg.get('enabled'):
        return results
    try:
        os.makedirs(_cfg['archive_dir'], exist_ok=True)
    except Exception:
        pass
    out = []
    for i, r in enumerate(results or []):
        if not isinstance(r, dict) or r.get('role') != 'tool':
            out.append(r)
            continue
        content = str(r.get('content') or '')
        failed = (r.get('_ok') is False)
        _max = int(_cfg.get('max_chars') or 20000)
        too_long = len(content) > _max
        # 失败打回仅针对长失败内容；短失败通知（如 codex DEFERRED/REJECTED）原文放行，保留指令语义
        _fail_big = failed and _cfg.get('reject_failed') and len(content) > int(_cfg.get('min_fail_len') or 0)
        if not (too_long or _fail_big):
            out.append(r)
            continue
        reason = ('执行失败+超长(%d字符>上限%d)' % (len(content), _max) if (too_long and _fail_big)
                  else '超长(%d字符>上限%d)' % (len(content), _max) if too_long else '执行失败')
        # 原文落盘存档（JSON，含摘要），供模型按需分片查回
        arc_path = ''
        try:
            stamp = time.strftime('%Y%m%d_%H%M%S')
            global _reject_seq
            _reject_seq += 1
            safe_name = ''.join(ch if ch.isalnum() else '_' for ch in str(r.get('tool_name') or ''))[:40]
            arc_path = os.path.join(_cfg['archive_dir'], 'reject_%s_%d_%s_%d.json' % (stamp, i, safe_name or 'tool', _reject_seq))
            with open(arc_path, 'w', encoding='utf-8') as f:
                json.dump({'tool_name': r.get('tool_name') or '',
                           'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                           'ok': not failed, 'reason': reason, 'len': len(content),
                           'archived_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'content': content},
                          f, ensure_ascii=False, indent=1)
        except Exception as e:
            _log('reject archive failed: %s' % e)
            arc_path = ''
        notice = str(_cfg.get('notice') or '').format(
            reason=reason, n=len(content), path=arc_path or '(存档写入失败，原文已丢弃)')
        _log('tool result rejected (%s), archived -> %s' % (reason, arc_path or 'N/A'))
        out.append({'role': 'tool', 'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                    'content': notice, '_ok': not failed})
    return out


def run_agent_loop(engine_id, engine_mod, messages, ctx, on_event=None):
    """通用 agent 循环。返回 OpenAI 兼容响应 dict。"""
    # 每轮工具调用写入 app_logs（便于在日志面板排查引擎工具链问题）
    _log_box_id = ''
    try:
        from routes.mixin_base import db_write_log as _dbw
        _log_box_id = str((ctx.get('payload') or {}).get('_box_id') or '')

        def _loop_db_log(level, action, detail):
            try:
                _dbw(level, _log_box_id, action, '[%s] %s' % (engine_id, detail))
            except Exception:
                pass
    except Exception:
        def _loop_db_log(level, action, detail):
            pass
    _loop_db_log('info', 'engine-loop-start', 'agent循环启动 | messages=%d' % len(messages or []))

    # ===== 全量落库（方案A）：agent 循环每条消息实时写入 agent_turns 表 =====
    _turn_session = str(ctx.get('_session_id')
                        or ctx.get('_box_id')
                        or (ctx.get('payload') or {}).get('session_id') or '')
    _turn_turnno = int(time.time())  # 用启动时间戳作为本轮循环的批次号
    _turn_idx = 0

    def _persist(role, content):
        """把循环内产生的每条消息（assistant 工具调用 / tool 结果）实时落库。"""
        nonlocal _turn_idx
        _turn_idx += 1
        if not _turn_session:
            return
        try:
            from db import write_agent_turn as _wat
            _wat(_turn_session, _turn_turnno, role, str(content or ''), _log_box_id)
        except Exception:
            pass

    # 循环开始前，把用户最后的问题也落库（role=user）
    try:
        _last_user = next((m for m in reversed(messages or [])
                           if isinstance(m, dict) and m.get('role') == 'user'), None)
        if _last_user is not None:
            _persist('user', _last_user.get('content') or '')
    except Exception:
        pass

    if hasattr(engine_mod, 'validate_messages'):
        messages = engine_mod.validate_messages(messages or [])
    messages = list(messages or [])

    hooks = {
        'compact': getattr(engine_mod, 'compact_messages', None),
        'schemas': getattr(engine_mod, 'get_tool_schemas', None),
        'exec': getattr(engine_mod, 'execute_tool_calls', None),
    }
    tool_schemas = hooks['schemas']() if hooks['schemas'] else None

    final_response = None
    for turn in range(1, MAX_TURNS + 1):
        if hooks['compact']:
            send_messages = hooks['compact']([dict(m) for m in messages])
        else:
            send_messages = messages

        payload = dict(ctx.get('payload') or {})
        payload['messages'] = send_messages
        if tool_schemas:
            payload['tools'] = tool_schemas
        # 引擎模型偏好：manifest.preferred_model 优先于上层 payload 里的 model
        _m = _engine_preferred_model(engine_id)
        if _m:
            payload['model'] = _m

        if on_event:
            try:
                on_event({'type': 'loop_turn', 'turn': turn})
            except Exception:
                pass
        _log('[%s] turn %d: %d messages -> upstream' % (engine_id, turn, len(send_messages)))

        resp = _call_upstream(ctx, payload)
        message = _extract_message(resp)
        if message is None:
            # 上游没有合法 choices：原样返回，让上层报错
            _log('[%s] turn %d: invalid upstream response' % (engine_id, turn))
            return resp

        tool_calls = _extract_tool_calls(message)
        if not tool_calls:
            # 最终回答，循环结束
            _log('[%s] turn %d: final answer (%d chars)' % (
                engine_id, turn, len(str(message.get('content') or ''))))
            _persist('assistant', message.get('content') or '')
            return resp

        # 有工具调用：先把 assistant 消息（含 tool_calls）入历史
        # 【修复 400】必须用 OpenAI 标准格式（type:'function' + function:{name,arguments}），
        # 之前直接放简化后的 tool_calls 列表，第二轮请求被上游 400 拒绝，
        # 导致 mixin_proxy 回退透传、前端执行 codex_* 工具报"未知工具"。
        messages.append({
            'role': 'assistant',
            'content': message.get('content') or '',
            'tool_calls': [
                {
                    'id': tc.get('id') or '',
                    'type': 'function',
                    'function': {'name': tc.get('name') or '', 'arguments': tc.get('arguments') or '{}'},
                }
                for tc in tool_calls if isinstance(tc, dict)
            ],
        })
        _persist('assistant', json.dumps(messages[-1], ensure_ascii=False))

        # 交给引擎自己的执行器（审批/单步纪律由引擎决定）
        if not hooks['exec']:
            # 引擎没有执行器却返回了工具调用：直接终止，避免死循环
            _log('[%s] engine has no execute_tool_calls, abort at turn %d' % (engine_id, turn))
            return resp
        results = hooks['exec'](tool_calls, ctx) or []
        # 每轮工具调用写入 app_logs：工具名+参数摘要+结果摘要，便于排查
        for _tc, _r in zip(tool_calls, results):
            try:
                _ok = bool(_r.get('_ok', True)) if isinstance(_r, dict) else True
                _loop_db_log('info' if _ok else 'error', 'engine-tool-call',
                             'turn %d 工具 %s(%s) -> %s | 结果: %s' % (
                                 turn, _tc.get('name', '?'), str(_tc.get('arguments', ''))[:150],
                                 'OK' if _ok else 'ERR',
                                 str((_r or {}).get('content', ''))[:200] if isinstance(_r, dict) else '?'))
            except Exception:
                pass
        # 工具执行期间引擎累积的事件（audit/proposal 等）实时转发给前端
        _pending_events = ctx.pop('_tool_events', None) or []
        for ev in _pending_events:
            if on_event:
                try:
                    on_event({'type': 'tool_event', 'turn': turn, 'kind': ev.get('kind'), 'data': ev.get('data')})
                except Exception:
                    pass
        # 工具名透传给打回器（存档文件名可读）；超大/失败结果打回：落盘存档+回填短通知
        for _tc, _r in zip(tool_calls, results):
            if isinstance(_r, dict) and isinstance(_tc, dict):
                _r.setdefault('tool_name', (_tc.get('function') or {}).get('name') or _tc.get('name') or '')
        results = _reject_tool_results(results)
        for r in results:
            if isinstance(r, dict) and r.get('role') == 'tool':
                entry = {'role': 'tool', 'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                         'content': str(r.get('content') or '')}
                messages.append(entry)
                _persist('tool', json.dumps(entry, ensure_ascii=False))
                if on_event:
                    try:
                        on_event({'type': 'tool_result', 'turn': turn,
                                  'tool_call_id': entry['tool_call_id'],
                                  'ok': bool(r.get('_ok', True)),
                                  'preview': entry['content'][:200]})
                    except Exception:
                        pass

        if turn == MAX_TURNS:
            # 到达上限：注入提示让模型总结，不再执行工具
            messages.append({'role': 'user', 'content':
                '[agent_loop] MAX_TURNS (%d) reached. Tool calls are now disabled. '
                'Summarize what was done and answer directly.' % MAX_TURNS})
            payload = dict(ctx.get('payload') or {})
            payload['messages'] = messages
            payload.pop('tools', None)
            final_response = _call_upstream(ctx, payload)
            _log('[%s] max turns reached, forced summary' % engine_id)
            return final_response

    # 理论上不会到这里
    return final_response or {'choices': [{'message': {'role': 'assistant', 'content': ''}}]}
