#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tool handler registry."""

import importlib
from pathlib import Path

_REGISTRY = {}
_REGISTRY_FP = {}      # tool_name -> 后端文件 Path（v6.2 工具热同步用）
_REGISTRY_MTIME = {}   # tool_name -> 后端文件 mtime
_SCANNED = False
_TOOL_ROOT = Path(__file__).resolve().parent
_PROJECT_ROOT = _TOOL_ROOT.parent
_CATEGORIES = ('minimal', 'coding', 'writing', 'vision', 'dcc')
# A tool must have one authoritative backend implementation.
_CANONICAL_CATEGORY = {'work_order': 'minimal'}


def _scan():
    """Load tool backends using package-relative module names.
    【v6.2 工具热同步前置】扫描时登记每个工具后端文件的路径+mtime，
    真正的变更检测在 get_handler 按 tool O(1) 做（_SCANNED 短路不会走到这里）。
    """
    global _SCANNED
    if _SCANNED:
        return

    registry = {}
    fps = {}
    mtimes = {}
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
                fps[tool_name] = module_path
                mtimes[tool_name] = module_path.stat().st_mtime
    except Exception:
        # Do not publish a partially scanned registry; a later request can retry.
        raise
    else:
        _REGISTRY.clear()
        _REGISTRY.update(registry)
        _REGISTRY_FP.clear()
        _REGISTRY_FP.update(fps)
        _REGISTRY_MTIME.clear()
        _REGISTRY_MTIME.update(mtimes)
        _SCANNED = True


def get_handler(tool_name):
    """Return the backend module for a tool name, or None when unavailable.

    若注册表中没有该工具（典型情况：服务启动后新增的工具文件），
    重置扫描标记强制重扫一次，让新工具无需重启服务即可生效。
    【v6.2 工具热同步（用户令「更加灵活的交互」）】已注册工具的后端文件 mtime
    变化时 importlib.reload 并更新注册表——此前缓存模块对象后改动永不生效
    （协作v6.2 wakeup peers 参数传不进服务进程，实锤踩坑后补此机制）。
    reload 失败（如语法错）保旧模块继续服务，可用性优先。
    """
    _scan()
    # 已注册工具：单文件 mtime 热检查，变了就 reload（O(1)，无全量重扫）
    fp = _REGISTRY_FP.get(tool_name)
    if fp is not None:
        try:
            cur = fp.stat().st_mtime
        except OSError:
            cur = None
        if cur is not None and cur != _REGISTRY_MTIME.get(tool_name):
            mod = _REGISTRY.get(tool_name)
            try:
                importlib.reload(mod)
                _REGISTRY_MTIME[tool_name] = cur
            except Exception:
                # 语法错/坏提交：保旧模块，回写 mtime 防每次请求都撞 reload
                _REGISTRY_MTIME[tool_name] = cur
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
