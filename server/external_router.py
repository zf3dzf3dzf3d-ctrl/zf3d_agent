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


def _send_json(handler, code, obj):
    try:
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except Exception:
        pass


def _read_body(handler):
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
