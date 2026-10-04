#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""zf_toolkit - 朱峰抠图工具（视觉工具操作端）转发桥。

把本地 zf_vision_toolkit 的 tool_server（http://127.0.0.1:8765/call）
以统一工具接口暴露给大模型：
  action=open    打开图片
  action=inspect 查看当前画布状态（含缩略图路径）
  action=call    任意调用工具端动作（tool_name + params）
  action=run     跑一轮 agent_loop 全流程（耗时较长）
返回结果中的 image/thumbnail 路径由前端渲染成 <img>（/api/fs/file 通道）。
"""
import json
import urllib.request

TOOL_NAME = 'zf_toolkit'

TOOL_SERVER = 'http://127.0.0.1:8765/call'
TIMEOUT = 600  # agent_loop 全流程可能跑几分钟


def _post_call(payload):
    req = urllib.request.Request(
        TOOL_SERVER,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode('utf-8'))


def handle(body, ctx):
    try:
        action = body.get('action', 'status')
        payload = {'action': action}
        if action == 'call':
            payload['tool_name'] = body.get('tool_name', '')
            payload['params'] = body.get('params', {})
        elif action == 'open':
            payload['path'] = body.get('path', '')
        elif action == 'run':
            payload['path'] = body.get('path', '')
            payload['instruction'] = body.get('instruction', '')

        r = _post_call(payload)
        r.setdefault('tool', 'zf_toolkit')
        ctx.send_json(r)
    except Exception as e:
        ctx.send_json({
            'ok': False,
            'error': 'zf_toolkit 调用失败: %s（请确认 tool_server.py 已启动，端口 8765）' % e,
            'tool': 'zf_toolkit',
        })
