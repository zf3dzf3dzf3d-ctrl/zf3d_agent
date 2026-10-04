#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""d3max - 3ds Max 连接器：状态检查 / 执行 MaxScript / 执行 Python
（移植自老版本 3dsmax-mcp，TCP 127.0.0.1:8765，协议 v2）"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dcc_common import max_send, _fmt

TOOL_NAME = 'd3max'


def handle(body, ctx):
    action = (body.get('action') or 'check').strip()
    port = body.get('port') or 8765
    host = body.get('host') or None
    timeout = float(body.get('timeout') or 60)

    if action == 'check':
        ok, res = max_send(
            'with print_all off (format "DCC_OK:%;\n" (maxversion()[1] as string))',
            port=port, host=host, timeout=min(timeout, 15))
        if ok and isinstance(res, dict):
            ctx.send_json({'ok': True, 'connected': True, 'reply': _fmt(res),
                           'message': '3ds Max 连接正常（%s:%s）' % (host or '127.0.0.1', port)})
        else:
            ctx.send_json({'ok': False, 'connected': False, 'error': str(res),
                           'message': '3ds Max 未连上。请在 3ds Max 里安装/启动 MCP 桥插件（默认端口 8765）。'})
        return

    if action == 'maxscript' or action == 'python':
        code = (body.get('code') or '').strip()
        if not code:
            ctx.send_json({'ok': False, 'error': 'code required'})
            return
        cmd_type = 'maxscript' if action == 'maxscript' else 'python'
        ok, res = max_send(code, cmd_type=cmd_type, port=port, host=host, timeout=timeout)
        ctx.send_json({'ok': ok, 'result': res if ok else None, 'error': None if ok else str(res)})
        return

    ctx.send_json({'ok': False, 'error': '未知 action: %s（可用 check / maxscript / python）' % action})
