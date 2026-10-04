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

_AUDIT_LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'logs', 'path_audit.log')


def _normcase(p):
    """Windows 大小写不敏感 + 正反斜杠 + ../ 归一后的绝对路径。"""
    return os.path.normcase(os.path.normpath(os.path.abspath(p)))


def _realpath_safe(p):
    try:
        return os.path.realpath(p)  # 解析 junction/symlink
    except Exception:
        return p


def _audit_violation(raw, base, full, reason):
    """越界尝试写审计日志（失败静默，不阻塞工具调用）。"""
    try:
        os.makedirs(os.path.dirname(_AUDIT_LOG), exist_ok=True)
        with open(_AUDIT_LOG, 'a', encoding='utf-8') as f:
            f.write('%s\tblocked\treason=%s\tbase=%s\tpath=%r\n'
                    % (time.strftime('%Y-%m-%d %H:%M:%S'), reason, base, raw))
    except Exception:
        pass


def _inside(child, parent):
    c, p = _normcase(child), _normcase(parent)
    return c == p or c.startswith(p.rstrip('\\/') + os.sep)


def resolve_path(rel_path, project_path, allow_outside=False):
    """路径 -> 项目内绝对路径（硬化版）。
    - 相对路径基于 project_path 解析，含 ../ 也允许，只要最终落在项目内；
    - 绝对路径：归一后仍在项目内则放行；项目外仅在 allow_outside=True 时放行；
    - junction/symlink：realpath 解析后再验一次，防链接逃逸；
    - Windows 大小写不敏感、正反斜杠归一后比较；
    - 越界返回 None 并写审计日志 logs/path_audit.log。"""
    if not rel_path:
        return None
    rel = str(rel_path).strip()
    base = os.path.abspath(project_path or os.getcwd())
    is_abs = os.path.isabs(rel)
    full = os.path.abspath(rel) if is_abs else os.path.abspath(os.path.join(base, rel))
    # 第一道：归一路径白名单校验（../ 与跨项目绝对路径在此被拦）
    if not _inside(full, base):
        if is_abs and allow_outside:
            pass  # 显式放行（各引擎自行决定）
        else:
            _audit_violation(rel, base, full, 'outside_project')
            return None
    # 第二道：junction/symlink 真实落点校验（存在性不定，解析失败按原路径处理）
    rbase, rfull = _realpath_safe(base), _realpath_safe(full)
    if not _inside(rfull, rbase):
        if not (is_abs and allow_outside):
            _audit_violation(rel, base, full, 'link_escape')
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
