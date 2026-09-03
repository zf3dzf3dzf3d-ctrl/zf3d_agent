#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""http_headers - HTTP 响应头安全审计（检查自有站点安全响应头配置）"""

import urllib.request
import urllib.error

TOOL_NAME = 'http_headers'

# 建议配置的安全响应头
_SECURITY_HEADERS = [
    'strict-transport-security',
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'x-xss-protection',
]


def handle(body, ctx):
    url = (body.get('url') or '').strip()
    if not url:
        ctx.send_json({'ok': False, 'error': 'url required'})
        return
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'http_headers/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            headers = dict(resp.headers.items())
    except urllib.error.HTTPError as e:
        status = e.code
        headers = dict(e.headers.items()) if e.headers else {}
    except Exception as e:
        ctx.send_json({'ok': False, 'url': url, 'error': str(e)})
        return
    lower = {k.lower(): v for k, v in headers.items()}
    missing = [h for h in _SECURITY_HEADERS if h not in lower]
    present = {h: lower[h] for h in _SECURITY_HEADERS if h in lower}
    # 避免泄露的服务器信息头
    leak = {}
    for h in ('server', 'x-powered-by', 'x-aspnet-version', 'x-generator'):
        if h in lower:
            leak[h] = lower[h]
    score = max(0, 100 - len(missing) * 14 - len(leak) * 5)
    ctx.send_json({'ok': True, 'url': url, 'status': status,
                   'security_headers_present': present,
                   'security_headers_missing': missing,
                   'info_leak_headers': leak,
                   'audit_score': score,
                   'all_headers': dict(list(headers.items())[:25])})
