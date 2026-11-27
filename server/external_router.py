# -*- coding: utf-8 -*-
"""
external_router.py - 外部线路请求转发（/api/external/*，三区隔离路由）
====================================================================
- 独立路由、独立错误码（4093=未启用 / 4092=网关不活 / 4091=上游失败）
- 失败直报、禁止跨区降级：外部线挂了绝不偷偷走朱峰线/自定义 API
- 流式：请求体带 stream=true 时透传 SSE；非流式直接转发 JSON
"""

import json
import urllib.request

import external_gateway
from util_http import send_json_http


def _send_json(handler, code, obj):
    # 【P1-5 收口】委托公共实现 util_http.send_json_http（原手写副本已删；
    # 与 handler_base 权威版的刻意差异见 util_http 模块注释）
    send_json_http(handler, obj, code)


def _read_body(handler):
    # 【排干黑洞修复 2026-11-23】POST 入口 _drain_body 已把流读走并缓存；
    # 此处再裸读 rfile 会永久阻塞（/api/external/config 实锤挂死）。
    # 优先取 handler 缓存，仅在无缓存可用时（非 drain 入口）回落裸读。
    try:
        cached = getattr(handler, '_read_body', None)
        if callable(cached):
            b = cached()
            if isinstance(b, (dict, list)):
                return b
    except Exception:
        pass
    try:
        n = int(handler.headers.get('Content-Length') or 0)
        return json.loads(handler.rfile.read(n).decode('utf-8')) if n else {}
    except Exception:
        return {}


def handle_external_chat(handler):
    """POST /api/external/chat —— 前端对话统一入口（模型 name 带 🔗 前缀即走这里）。"""
    cfg = external_gateway.load_config()
    if not cfg.get('enabled'):
        return _send_json(handler, 409, {'ok': False, 'code': 4093, 'error': '外部线路未启用'})

    body = _read_body(handler)
    model = str(body.get('model') or '')
    if model.startswith('🔗 '):
        model = model[2:]
    messages = body.get('messages') or []
    stream = bool(body.get('stream'))
    if not model or not messages:
        return _send_json(handler, 400, {'ok': False, 'code': 4091, 'error': '缺少 model 或 messages'})

    gw = cfg.get('gateway') or {}
    url = (gw.get('url') or '').rstrip('/')
    key = gw.get('apiKey') or ''
    upstream_body = json.dumps({
        'model': model, 'messages': messages, 'stream': stream,
        **({'max_tokens': body['max_tokens']} if body.get('max_tokens') else {}),
        **({'temperature': body['temperature']} if body.get('temperature') is not None else {}),
    }).encode('utf-8')

    req = urllib.request.Request(url + '/v1/chat/completions', data=upstream_body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', 'Bearer ' + key)

    try:
        if stream:
            # ---- 流式透传：SSE 原样转发，不解析不缓冲 ----
            upstream = urllib.request.urlopen(req, timeout=120)
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-cache')
            handler.end_headers()
            try:
                while True:
                    chunk = upstream.read(1024)
                    if not chunk:
                        break
                    handler.wfile.write(chunk)
                    handler.wfile.flush()
            except Exception:
                pass
            finally:
                upstream.close()
        else:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/json; charset=utf-8')
            handler.send_header('Content-Length', str(len(data)))
            handler.end_headers()
            handler.wfile.write(data)
    except Exception as e:
        # 禁止跨区降级：失败直报，绝不转发给朱峰线
        if not handler.wfile.closed:
            _send_json(handler, 502, {'ok': False, 'code': 4091, 'error': '外部线路上游失败: %s' % e})


def handle_external_admin(handler, action):
    """GET /api/external/<action> —— 管理面：config / health / models / test / start / stop"""
    # 【安全收口】管理 action 双重校验：①来源必须是本机回环；②必须显式 confirm=yes。
    # 防局域网内其他机器（或被注入的网页经 CSRF/表单发 GET）启停网关/改配置/触发探测。
    if action in ('config', 'test', 'start', 'stop'):
        try:
            client_ip = (handler.client_address[0] or '')
        except Exception:
            client_ip = ''
        if client_ip not in ('127.0.0.1', '::1', '::ffff:127.0.0.1'):
            return _send_json(handler, 403, {'ok': False,
                                             'error': '外部线路管理操作仅允许本机回环访问 (来源: %s)' % client_ip})
        try:
            from urllib.parse import urlparse as _up, parse_qs as _pq
            _qs = _pq(_up(getattr(handler, 'path', '') or '').query)
            _confirm = (_qs.get('confirm') or [''])[0].lower()
        except Exception:
            _confirm = ''
        if _confirm != 'yes':
            return _send_json(handler, 403, {'ok': False,
                                             'error': '管理操作需显式确认：请附加 confirm=yes 参数'})

    if action == 'config':
        cfg = external_gateway.load_config()
        gw = dict(cfg.get('gateway') or {})
        if gw.get('apiKey'):
            gw['apiKey'] = '****' + str(gw['apiKey'])[-4:]
        return _send_json(handler, 200, {'ok': True, 'config': {**cfg, 'gateway': gw}})

    if action == 'health':
        return _send_json(handler, 200, {'ok': True, **external_gateway.health()})

    if action == 'models':
        ids = external_gateway.fetch_external_models()
        return _send_json(handler, 200, {'ok': True, 'models': ids})

    if action == 'test':
        # 第二层探测：真实对话（与 health 分开）
        return _send_json(handler, 200, {'ok': True, **external_gateway.test_channel()})

    if action == 'start':
        ok, msg = external_gateway.start_gateway()
        return _send_json(handler, 200, {'ok': ok, 'message': msg})

    if action == 'stop':
        ok, msg = external_gateway.stop_gateway()
        return _send_json(handler, 200, {'ok': ok, 'message': msg})

    return _send_json(handler, 404, {'ok': False, 'error': 'Unknown external action'})
