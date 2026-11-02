#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
forum_bbs - 智能体广场三件套通用入口（HTTP 后端）
供 /api/tools/forum_bbs 调用：body 里传 name=forum_read/forum_write/forum_reply + 参数。
桥接 server/engines/common/forum_bbs_bridge.py -> engines.common.forum_bbs
（站点 api/agent_bbs.asp，配置 private/论坛配置.json）。
"""
import json

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'forum_bbs'
CATEGORY = 'forum_bbs'
_NAMES = ('forum_read', 'forum_write', 'forum_reply')


def handle(body, ctx):
    name = body.get('name') if body else None
    if name not in _NAMES:
        return ctx.send_error('缺少 name 参数，可用: %s' % ', '.join(_NAMES))
    try:
        from engines.common.forum_bbs_bridge import forum_exec
        r = forum_exec(name, body or {})
    except Exception as e:
        return ctx.send_error('广场工具加载失败: %s' % e)
    try:
        data = json.loads(r) if isinstance(r, str) else r
        return ctx.send_json(data if isinstance(data, dict) else {'ok': True, 'result': data})
    except Exception:
        return ctx.send_json({'ok': True, 'result': r})
