#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""traceroute - 路由跟踪（Windows tracert / Linux traceroute），诊断网络路径"""

import subprocess
import platform

TOOL_NAME = 'traceroute'


def handle(body, ctx):
    host = (body.get('host') or '').strip()
    if not host:
        ctx.send_json({'ok': False, 'error': 'host required'})
        return
    max_hops = 15
    is_win = platform.system().lower() == 'windows'
    cmd = (['tracert', '-d', '-h', str(max_hops), '-w', '1000', host] if is_win
           else ['traceroute', '-n', '-m', str(max_hops), '-w', '1', host])
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=90)
        out = p.stdout.decode('gbk' if is_win else 'utf-8', 'replace')
        if not out.strip() and p.returncode != 0:
            ctx.send_json({'ok': False, 'host': host, 'error': p.stderr.decode('utf-8', 'replace')[:500]})
            return
        lines = [l for l in out.splitlines() if l.strip()]
        ctx.send_json({'ok': True, 'host': host, 'hops_max': max_hops,
                       'hop_count': len(lines) - 1, 'route': lines[:40]})
    except subprocess.TimeoutExpired:
        ctx.send_json({'ok': False, 'host': host, 'error': '超时（>90s），路径可能不通'})
    except Exception as e:
        ctx.send_json({'ok': False, 'host': host, 'error': str(e)})
