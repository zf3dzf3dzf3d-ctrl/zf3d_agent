#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""houdini_dcc - Houdini 连接器：状态检查 / 桥接调用 / 节点操作
（移植自老版本 Houdini-Agent bridge，JSON-lines TCP，端口优先级：
  显式 port > 环境变量 HAGENT_BRIDGE_PORT > %LOCALAPPDATA%\HoudiniAgent\bridge.port > 45172）"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dcc_common import houdini_request, _fmt

TOOL_NAME = 'houdini_dcc'


def handle(body, ctx):
    action = (body.get('action') or 'check').strip()
    port = body.get('port') or None
    host = body.get('host') or None
    timeout = float(body.get('timeout') or 180)

    if action == 'check':
        ok, res = houdini_request('ping', port=port, host=host, timeout=5.0)
        if ok:
            ctx.send_json({'ok': True, 'connected': True, 'reply': _fmt(res, 800),
                           'message': 'Houdini 桥连接正常'})
        else:
            ctx.send_json({'ok': False, 'connected': False, 'error': str(res),
                           'message': 'Houdini 未连上。请先在 Houdini 中启动 Houdini Agent shelf/桥服务（端口见 %LOCALAPPDATA%\\HoudiniAgent\\bridge.port，默认 45172）。'})
        return

    if action == 'call':
        # 直接调桥上注册的工具/动作：execute_tool {name, args}
        name = (body.get('tool') or '').strip()
        if not name:
            ctx.send_json({'ok': False, 'error': 'tool required（execute_tool 的工具名）'})
            return
        args = body.get('args') or {}
        if isinstance(args, str):
            import json as _json
            try:
                args = _json.loads(args)
            except Exception:
                ctx.send_json({'ok': False, 'error': 'args 必须是 JSON 对象'})
                return
        ok, res = houdini_request('execute_tool', {'name': name, 'args': args},
                                  port=port, host=host, timeout=timeout)
        ctx.send_json({'ok': ok, 'result': _fmt(res, 6000) if ok else None,
                       'error': None if ok else str(res)})
        return

    if action == 'scene':
        ok, res = houdini_request('scene_context', port=port, host=host, timeout=timeout)
        ctx.send_json({'ok': ok, 'result': _fmt(res, 6000) if ok else None,
                       'error': None if ok else str(res)})
        return

    ctx.send_json({'ok': False, 'error': '未知 action: %s（可用 check / call / scene）' % action})
