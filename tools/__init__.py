#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tool handler registry."""

import importlib
from pathlib import Path

_REGISTRY = {}
_SCANNED = False
_TOOL_ROOT = Path(__file__).resolve().parent
_PROJECT_ROOT = _TOOL_ROOT.parent
_CATEGORIES = ('minimal', 'coding', 'writing', 'vision', 'dcc')
# A tool must have one authoritative backend implementation.
_CANONICAL_CATEGORY = {'work_order': 'minimal'}


def _scan():
    """Load tool backends using package-relative module names."""
    global _SCANNED
    if _SCANNED:
        return

    registry = {}
    try:
        for category in _CATEGORIES:
            backend_dir = _TOOL_ROOT / category / 'backend'
            if not backend_dir.is_dir():
                continue
            for module_path in sorted(backend_dir.glob('*.py')):
                if module_path.name.startswith('_'):
                    continue
                module_name = module_path.stem
                module = importlib.import_module(
                    f'tools.{category}.backend.{module_name}'
                )
                tool_name = getattr(module, 'TOOL_NAME', module_name)
                canonical_category = _CANONICAL_CATEGORY.get(tool_name)
                if canonical_category and canonical_category != category:
                    continue
                if not hasattr(module, 'handle'):
                    continue
                if tool_name in registry:
                    raise RuntimeError(
                        f'Duplicate tool backend: {tool_name} '
                        f'({registry[tool_name].__name__}, {module.__name__})'
                    )
                registry[tool_name] = module
    except Exception:
        # Do not publish a partially scanned registry; a later request can retry.
        raise
    else:
        _REGISTRY.clear()
        _REGISTRY.update(registry)
        _SCANNED = True


def get_handler(tool_name):
    """Return the backend module for a tool name, or None when unavailable.

    若注册表中没有该工具（典型情况：服务启动后新增的工具文件），
    重置扫描标记强制重扫一次，让新工具无需重启服务即可生效。
    """
    _scan()
    mod = _REGISTRY.get(tool_name)
    if mod is None:
        global _SCANNED
        _SCANNED = False
        _scan()
        mod = _REGISTRY.get(tool_name)
    # 别名：外部调用名 -> 注册表真名
    #   find        : 前端 kg-extract.js / kg-code.js 统一调用 /api/tools/find，对应 find_files 后端
    #   model_3d_gen: 前端 defs-media.js / tools-04-execute.js / 历史文档均用下划线名，后端注册名 model3d_gen
    _TOOL_ALIASES = {'find': 'find_files', 'model_3d_gen': 'model3d_gen'}
    if mod is None and tool_name in _TOOL_ALIASES:
        mod = _REGISTRY.get(_TOOL_ALIASES[tool_name])
    return mod


def list_tools():
    """Return all registered tool names (含别名，供一致性自检核对前端名)."""
    _scan()
    names = set(_REGISTRY)
    names.update({'find', 'model_3d_gen'})
    return sorted(names)
