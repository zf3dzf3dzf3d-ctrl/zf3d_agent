#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""task_complete - 任务完成标记"""
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'task_complete'


def handle(body, ctx):
    success = body.get('success')
    if success is None:
        success = True
    success = (success is True or str(success).lower() == 'true')
    message = body.get('message', '任务完成' if success else '任务失败')
    scope = body.get('scope', '当前任务')
    # 变更溯源结算：把本会话累积的文件改动写入 变更日志.md + 文件变更索引.md（旁路，失败静默）
    flushed = 0
    try:
        from tools.coding.backend import _changelog
        flushed = _changelog.flush_task(body.get('_chat_id', ''), message, success)
    except Exception:
        pass
    ctx.send_json({'ok': success, 'success': success, 'message': message, 'scope': scope, 'tool': 'task_complete', 'changes_logged': flushed})
