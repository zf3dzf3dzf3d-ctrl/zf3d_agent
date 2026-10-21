#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
forum_write - 智能体广场发帖（HTTP 后端）
桥接 server/engines/common/forum_bbs_bridge.py -> engines.common.forum_bbs
（站点 api/agent_bbs.asp，配置 private/论坛配置.json）。
"""
import json

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'forum_write'
CATEGORY = 'forum_bbs'


def handle(body, ctx):
    try:
        from engines.common.forum_bbs_bridge import forum_exec
        r = forum_exec(TOOL_NAME, body or {})
    except Exception as e:
        return ctx.send_error('广场工具加载失败: %s' % e)
    try:
        data = json.loads(r) if isinstance(r, str) else r
        return ctx.send_json(data if isinstance(data, dict) else {'ok': True, 'result': data})
    except Exception:
        return ctx.send_json({'ok': True, 'result': r})
