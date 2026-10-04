#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
config_agent/backend/web_request.py
插件工具：通用联网请求（HTTP GET/POST），用于模型配置管家
查询各模型服务商的官方文档、可用模型列表、接口状态等。

约定接口（被通用工具执行器调用）：
    run(args: dict) -> dict
args:
    url:     必填，请求地址（仅支持 http/https）
    method:  可选，GET（默认）/ POST
    headers: 可选，dict，自定义请求头（如 Authorization）
    params:  可选，dict，URL 查询参数
    body:    可选，dict/str，POST 请求体（dict 自动 JSON 编码）
    timeout: 可选，秒，默认 30，上限 60
返回:
    {ok, status, body, text}  body 为尝试 JSON 解析后的结果，text 为原始文本
"""

import os
import json
import urllib.request
import urllib.error
import urllib.parse

_MAX_TIMEOUT = 60
_MAX_BODY_CHARS = 60000  # 返回给模型的内容上限，避免撑爆上下文


def _clip(text):
    if isinstance(text, str) and len(text) > _MAX_BODY_CHARS:
        return text[:_MAX_BODY_CHARS] + '\n...[内容过长已截断]'
    return text


def run(args):
    args = args or {}
    url = str(args.get('url') or '').strip()
    if not url:
        return {'ok': False, 'error': '缺少 url 参数'}
    if not (url.startswith('http://') or url.startswith('https://')):
        return {'ok': False, 'error': '仅支持 http/https 地址'}

    method = str(args.get('method') or 'GET').upper()
    if method not in ('GET', 'POST'):
        return {'ok': False, 'error': 'method 仅支持 GET/POST'}

    try:
        timeout = min(float(args.get('timeout') or 30), _MAX_TIMEOUT)
    except (TypeError, ValueError):
        timeout = 30

    headers = {'User-Agent': 'ZF-Agent-ConfigAgent/1.0',
               'Accept': 'application/json, text/plain, */*'}
    custom = args.get('headers')
    if isinstance(custom, dict):
        for k, v in custom.items():
            headers[str(k)] = str(v)

    # 查询参数
    params = args.get('params')
    if isinstance(params, dict) and params:
        sep = '&' if '?' in url else '?'
        url = url + sep + urllib.parse.urlencode(params)

    # 请求体
    data = None
    if method == 'POST':
        body = args.get('body')
        if isinstance(body, dict) or isinstance(body, list):
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers.setdefault('Content-Type', 'application/json')
        elif isinstance(body, str) and body:
            data = body.encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            raw = resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', errors='replace') if e.fp else ''
        return {'ok': False, 'error': 'HTTP %s' % e.code, 'status': e.code,
                'text': _clip(raw[:2000])}
    except (urllib.error.URLError, OSError) as e:
        return {'ok': False, 'error': '网络请求失败: %s' % e}

    # 尝试 JSON 解析
    parsed = None
    try:
        parsed = json.loads(raw)
        # JSON 响应也做截断保护
        if len(raw) > _MAX_BODY_CHARS:
            return {'ok': True, 'status': status, 'body': None,
                    'text': _clip(raw), 'note': '响应过大，仅返回原始文本截断版'}
    except (json.JSONDecodeError, ValueError):
        pass

    return {'ok': True, 'status': status,
            'body': parsed, 'text': _clip(raw) if parsed is None else None}


if __name__ == '__main__':
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else 'https://www.baidu.com'
    print(json.dumps(run({'url': url}), ensure_ascii=False, indent=2)[:3000])
