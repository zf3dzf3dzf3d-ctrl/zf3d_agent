# -*- coding: utf-8 -*-
"""gateway.zf3d-relay — zf3d 中继网关插件（S5）。

提供 build_relay_request(model, payload, zf_key, zf_user) 纯函数：
构造 zf_models_relay 请求（URL+鉴权头+序列化 body），与 routes/zf3d_relay.py
原逻辑逐字段一致；mixin 侧经内核 resolve 优先走本插件，失败回退内联实现。
"""
import urllib.parse as _up
import json as _js

RELAY_BASE = 'https://www.zf3d.com/api/zf_models_relay.asp'


def build_relay_request(model, payload, zf_key='', zf_user=0):
    """返回 dict(url, headers, data, timeout)。纯函数无副作用，可独立单测。"""
    model = str(model or '')
    relay_url = RELAY_BASE + '?model=' + _up.quote(model)
    headers = {'Content-Type': 'application/json'}
    if zf_key:
        headers['X-ZF-Key'] = zf_key
    if zf_user and zf_user > 0:
        headers['X-ZF-User'] = str(zf_user)
    data = _js.dumps(payload, ensure_ascii=True).encode('utf-8')
    return {'url': relay_url, 'headers': headers, 'data': data, 'timeout': 120}


def setup(ctx):
    def _tool(params):
        r = build_relay_request(params.get('model'), params.get('payload') or {},
                                params.get('zf_key', ''), params.get('zf_user', 0))
        return {'ok': True, 'request': {
            'url': r['url'], 'headers': r['headers'],
            'data': r['data'].decode('utf-8'), 'timeout': r['timeout']}}

    ctx.tool.register({
        'name': 'zf3d_relay_request',
        'description': '构造 zf_models_relay 上游请求（url/headers/data/timeout）',
        'params': {'model': 'str', 'payload': 'object', 'zf_key': 'str', 'zf_user': 'int'},
        'exec': _tool,
    })
