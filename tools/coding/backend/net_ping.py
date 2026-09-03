#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""net_ping - Ping 主机测连通性与延迟（自有/授权资产诊断用）"""

import subprocess
import re

TOOL_NAME = 'net_ping'


def _ping(host, count):
    is_win = __import__('os').name == 'nt'
    cmd = ['ping', '-n' if is_win else '-c', str(count), host]
    try:
        import os as _os
        _enc = 'gbk' if _os.name == 'nt' else 'utf-8'
        r = subprocess.run(cmd, capture_output=True, text=True, encoding=_enc,
                           errors='replace', timeout=count * 3 + 10)
        out = (r.stdout or '') + (r.stderr or '')
    except Exception as e:
        return {'ok': False, 'error': str(e)}
    # 提取平均延迟
    avg = None
    m = re.search(r'Average[:=]\s*(\d+)', out) or re.search(r'= [\d.]+/([\d.]+)/', out)
    if m:
        avg = float(m.group(1))
    lost = None
    m2 = re.search(r'(\d+)%', out)
    if m2:
        lost = int(m2.group(1))
    return {'ok': True, 'host': host, 'alive': r.returncode == 0, 'avg_ms': avg, 'loss_pct': lost, 'output': out[-1500:]}


def handle(body, ctx):
    host = (body.get('host') or '').strip()
    if not host:
        ctx.send_json({'ok': False, 'error': 'host required'})
        return
    try:
        count = max(1, min(int(body.get('count') or 4), 10))
    except Exception:
        count = 4
    ctx.send_json(_ping(host, count))
