#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""http_probe - HTTP 探活：状态码/响应头/耗时（检查自有网站可用性）"""

import time
import urllib.request
import urllib.error

TOOL_NAME = 'http_probe'


def handle(body, ctx):
    url = (body.get('url') or '').strip()
    if not url:
        ctx.send_json({'ok': False, 'error': 'url required'})
        return
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    method = (body.get('method') or 'GET').upper()
    try:
        timeout = max(1, min(float(body.get('timeout') or 10), 30))
    except Exception:
        timeout = 10.0
    start = time.time()
    try:
        req = urllib.request.Request(url, method=method, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; http_probe/1.0)'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = round((time.time() - start) * 1000)
            headers = dict(list(resp.headers.items())[:20])
            body_bytes = resp.read(2048)
        ctx.send_json({'ok': True, 'url': url, 'status': resp.status if hasattr(resp, 'status') else 200,
                       'elapsed_ms': elapsed, 'headers': headers,
                       'body_preview': body_bytes.decode('utf-8', 'replace')[:500]})
    except urllib.error.HTTPError as e:
        elapsed = round((time.time() - start) * 1000)
        ctx.send_json({'ok': True, 'url': url, 'status': e.code, 'elapsed_ms': elapsed,
                       'headers': dict(list(e.headers.items())[:20]) if e.headers else {},
                       'error': 'HTTP ' + str(e.code)})
    except Exception as e:
        ctx.send_json({'ok': False, 'url': url, 'error': str(e)})
