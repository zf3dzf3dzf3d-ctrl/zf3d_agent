#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tool handler registry."""

import importlib
from pathlib import Path

_REGISTRY = {}
_SCANNED = False
_TOOL_ROOT = Path(__file__).resolve().parent
_PROJECT_ROOT = _TOOL_ROOT.parent
_CATEGORIES = ('minimal', 'coding', 'writing')
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
                    f'tool.{category}.backend.{module_name}'
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
    """Return the backend module for a tool name, or None when unavailable."""
    _scan()
    return _REGISTRY.get(tool_name)


def list_tools():
    """Return all registered tool names."""
    _scan()
    return sorted(_REGISTRY)
