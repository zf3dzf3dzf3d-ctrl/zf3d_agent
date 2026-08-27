#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""locate_mouse - 鼠标定位（前端处理）"""
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'locate_mouse'


def handle(body, ctx):
    action = body.get('action', 'get')
    ctx.send_json({
        'ok': True, 'action': action,
        'message': '鼠标操作由前端处理',
        'tool': 'locate_mouse'
    })
