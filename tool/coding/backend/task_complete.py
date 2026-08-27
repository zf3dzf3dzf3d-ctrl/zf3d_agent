#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""task_complete - 任务完成标记"""
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'task_complete'


def handle(body, ctx):
    success = bool(body.get('success', False))
    message = body.get('message', '任务完成' if success else '任务失败')
    scope = body.get('scope', '当前任务')
    ctx.send_json({'ok': success, 'success': success, 'message': message, 'scope': scope, 'tool': 'task_complete'})
