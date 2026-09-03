#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""port_scan - TCP 端口开放检测（自检自有服务器端口暴露情况）"""

import socket

TOOL_NAME = 'port_scan'
_MAX_PORTS = 20


def _check(host, port, timeout):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, None
    except Exception as e:
        return False, str(e)


def handle(body, ctx):
    host = (body.get('host') or '').strip()
    ports = body.get('ports') or []
    if not host or not ports:
        ctx.send_json({'ok': False, 'error': 'host and ports required'})
        return
    try:
        ports = [int(p) for p in ports][: _MAX_PORTS]
    except Exception:
        ctx.send_json({'ok': False, 'error': 'invalid ports'})
        return
    try:
        timeout = max(0.5, min(float(body.get('timeout') or 3), 10))
    except Exception:
        timeout = 3.0

    results = []
    for p in ports:
        open_, err = _check(host, p, timeout)
        results.append({'port': p, 'open': open_, 'error': err if not open_ else None})
    ctx.send_json({'ok': True, 'host': host, 'results': results})
