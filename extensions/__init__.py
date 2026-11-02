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
import os
import re
import sys

_DIR = os.path.dirname(os.path.abspath(__file__))


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
    if sub == 'dsh':
        from extensions import dsh
        return dsh.handle(handler, method, tail, body or {})
    if sub == 'ui_registry':
        from extensions import ui_registry
        return ui_registry.handle(handler, method, tail, body or {})
    if sub == 'market':
        from extensions import market
        return market.handle(handler, method, tail, body or {})

    # 动态兜底：extensions/<sub>/api.py 存在即自动挂载（文件夹即插件）
    if _try_dynamic_api(handler, method, sub, tail, body):
        return True

    _send(handler, {'ok': False, 'error': 'Unknown extension module: ' + sub}, 404)
    return True


def _try_dynamic_api(handler, method, sub, tail, body):
    """阶段B 动态 API 兜底：扩展目录若有 api.py，自动挂 /api/ext/<id>/<...>。

    文件夹即插件——扩展写一个 extensions/<id>/api.py 暴露 handle(handler,
    method, tail, body)，无需改本文件即可拥有自己的 API。api-only 类型扩展
    的后端全靠这条通路。安全：sub 必须是 extensions/ 直接子目录且 api.py
    存在；模块名做合法标识符校验，防路径注入。
    """
    # 扩展 id 允许连字符（如 ext-demo），但 importlib 需合法模块名 → 按文件路径加载
    if not sub or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', sub):
        return False
    api_path = os.path.join(_DIR, sub, 'api.py')
    if not os.path.isfile(api_path):
        return False
    try:
        import importlib.util
        mod_name = 'zf_ext_' + sub.replace('-', '_')
        spec = importlib.util.spec_from_file_location(mod_name, api_path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        return bool(mod.handle(handler, method, tail, body or {}))
    except Exception as e:
        _send(handler, {'ok': False, 'error': 'extension api error: %s' % e}, 500)
        return True
