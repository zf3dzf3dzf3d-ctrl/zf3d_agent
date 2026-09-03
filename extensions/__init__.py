#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extensions/ - 智能体扩展子系统（一级独立模块）

包含三个互不依赖的子模块，每个子模块文件级别独立、可单独下线：

  mcp/              Model Context Protocol 客户端网关（连接外部 MCP server）
  declarative_ui/   声明式 UI 配置（工具返回 ui 描述 → 前端渲染表单/卡片）
  skills/           技能包（可插拔的提示词+工具组合，自动注入对话）

对外唯一入口：dispatch(handler, method, path, body)
  由 server/routes/mixin_dispatch.py 挂钩 /api/ext/* 调用。
  本包不 import 主系统任何业务代码（仅可选借用 tool 注册表），主工具零污染。
"""

import json


def _send(handler, data, code=200):
    try:
        handler._send_json(data, code)
    except Exception:
        pass


def dispatch(handler, method, path, body):
    """统一入口。返回 True 表示已处理。path 形如 /api/ext/<sub>/<...>"""
    rest = path[len('/api/ext/'):].strip('/')
    parts = [p for p in rest.split('/') if p]
    if not parts:
        _send(handler, {'ok': False, 'error': '缺少子模块名：mcp | declarative_ui | skills'})
        return True
    sub, tail = parts[0], parts[1:]

    if sub == 'mcp':
        from extensions import mcp
        return mcp.handle(handler, method, tail, body or {})
    if sub == 'declarative_ui':
        from extensions import declarative_ui
        return declarative_ui.handle(handler, method, tail, body or {})
    if sub == 'skills':
        from extensions import skills
        return skills.handle(handler, method, tail, body or {})
    if sub == 'settings':
        from extensions import settings as ext_settings
        return ext_settings.handle(handler, method, tail, body or {})

    _send(handler, {'ok': False, 'error': 'Unknown extension module: ' + sub}, 404)
    return True
