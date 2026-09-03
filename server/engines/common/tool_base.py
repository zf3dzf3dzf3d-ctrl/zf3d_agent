#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/tool_base.py - 各引擎独立工具集的最小公共底座

原则（刻意保持极简）：
- 只提供「注册表 + schema 生成 + 安全路径解析 + 调用分发」四个原语
- 工具的具体实现、参数风格、返回格式、截断策略，由各引擎 tools/ 自己写
- 本文件不得 import 任何上层朱峰 tool 包，也不得 import 任何引擎包（物理隔离）
"""

import os
import json
import time
import threading

# ---------------------------------------------------------------- 注册表


class Tool(object):
    __slots__ = ('name', 'description', 'parameters', 'func', 'dangerous')

    def __init__(self, name, description, parameters, func, dangerous=False):
        self.name = name
        self.description = description
        self.parameters = parameters or {'type': 'object', 'properties': {}}
        self.func = func
        self.dangerous = bool(dangerous)

    def openai_schema(self):
        return {
            'type': 'function',
            'function': {
                'name': self.name,
                'description': self.description,
                'parameters': self.parameters,
            },
        }


class Registry(object):
    """每引擎一个实例，互不共享（物理隔离的核心）。"""

    def __init__(self, engine_id):
        self.engine_id = engine_id
        self._tools = {}
        self._lock = threading.Lock()

    def register(self, name, description, parameters=None, dangerous=False):
        def deco(fn):
            with self._lock:
                self._tools[name] = Tool(name, description, parameters, fn, dangerous)
            return fn
        return deco

    def get(self, name):
        return self._tools.get(name)

    def names(self):
        return sorted(self._tools.keys())

    def schemas(self, only=None):
        """返回 OpenAI tools 数组。only 为 None 时全部导出。"""
        out = []
        for name in self.names():
            if only is not None and name not in only:
                continue
            out.append(self._tools[name].openai_schema())
        return out

    def execute(self, name, args, ctx):
        """执行工具，返回 (ok, result_str)。任何异常都收敛为字符串，不外抛。"""
        t = self._tools.get(name)
        if not t:
            return False, 'unknown tool: %s (engine=%s)' % (name, self.engine_id)
        args = args if isinstance(args, dict) else {}
        try:
            result = t.func(args, ctx or {})
            if isinstance(result, tuple):
                return result
            return True, result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        except Exception as e:
            return False, 'tool %s error: %s' % (name, e)


# ---------------------------------------------------------------- 安全路径

def resolve_path(rel_path, project_path, allow_outside=False):
    """相对路径 -> 项目内绝对路径。越权且未放行时返回 None。
    rel 为绝对路径且 allow_outside=True 时原样放行（各引擎自行决定是否放行）。"""
    if not rel_path:
        return None
    rel = str(rel_path).strip()
    if os.path.isabs(rel):
        return rel if allow_outside else None
    base = os.path.abspath(project_path or os.getcwd())
    full = os.path.abspath(os.path.join(base, rel))
    if not allow_outside and os.path.commonpath([base, full]) != base:
        return None
    return full


def clip_text(text, limit, marker='…[clipped]'):
    """通用截断（各引擎用自己的 limit 和 marker 调用）。"""
    text = str(text)
    if len(text) <= limit:
        return text
    head = int(limit * 0.8)
    tail = limit - head
    return text[:head] + '\n' + marker + '\n' + (text[-tail:] if tail > 0 else '')


def tool_event(ctx, kind, data):
    """向 ctx 里累积事件（供上层/前端审计），不抛错。"""
    try:
        ev = ctx.setdefault('_tool_events', [])
        ev.append({'ts': time.time(), 'kind': kind, 'data': data})
    except Exception:
        pass
