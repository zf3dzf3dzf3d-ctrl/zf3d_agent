#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""blender_dcc - Blender 连接器：状态检查 / 执行 bpy 代码 / 常用场景操作
（移植自老版本 BlenderMCP，TCP 127.0.0.1:9876）"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dcc_common import blender_send, blender_execute, _fmt

TOOL_NAME = 'blender_dcc'


def handle(body, ctx):
    action = (body.get('action') or 'check').strip()
    port = body.get('port') or 9876
    host = body.get('host') or None
    timeout = float(body.get('timeout') or 60)

    if action == 'check':
        ok, res = blender_send('get_scene_info', port=port, host=host, timeout=min(timeout, 15))
        if ok:
            ctx.send_json({'ok': True, 'connected': True, 'scene': _fmt(res, 1500),
                           'message': 'Blender 连接正常（%s:%s）' % (host or '127.0.0.1', port)})
        else:
            ctx.send_json({'ok': False, 'connected': False, 'error': str(res),
                           'message': 'Blender 未连上。请在 Blender 中启动 BlenderMCP 面板并 Start Server（默认端口 9876）。'})
        return

    if action == 'execute':
        code = (body.get('code') or '').strip()
        if not code:
            ctx.send_json({'ok': False, 'error': 'code required'})
            return
        ok, res = blender_execute(code, port=port, host=host, timeout=timeout)
        ctx.send_json({'ok': ok, 'result': _fmt(res, 6000) if ok else None,
                       'error': None if ok else str(res)})
        return

    # 常用快捷操作（映射到 execute_code，源自老版 BlenderMCP 的场景工具思路）
    snippets = {
        'scene_info': 'import json,bpy\nprint(json.dumps({"objects":[o.name for o in bpy.data.objects]}))',
        'get_object_info': 'import json,bpy\no=bpy.data.objects.get(%r)\nprint(json.dumps({"name":o.name,"loc":list(o.location),"rot":list(o.rotation_euler),"scale":list(o.scale)}) if o else json.dumps({"error":"not found"}))' % (body.get('object') or ''),
    }
    if action in snippets:
        ok, res = blender_execute(snippets[action], port=port, host=host, timeout=timeout)
        ctx.send_json({'ok': ok, 'result': _fmt(res, 6000) if ok else None,
                       'error': None if ok else str(res)})
        return

    ctx.send_json({'ok': False, 'error': '未知 action: %s（可用 check / execute / scene_info / get_object_info）' % action})
