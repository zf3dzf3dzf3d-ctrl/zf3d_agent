#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Settings 子模块（独立文件，可单文件删除下线）
扩展子系统全局开关，持久化到 private/extensions/settings.json：

{
  "mcp": true,      # MCP 网关总开关（关掉后 /api/ext/mcp/tools 返回空、call 拒绝）
  "skills": true    # 技能包总开关（关掉后 match/prompt/ui 全部返回空）
}

API：
  GET  /api/ext/settings        → 读取
  POST /api/ext/settings        {mcp:bool, skills:bool} → 保存
"""

import os
import json
import threading

_DIR = os.path.dirname(os.path.abspath(__file__))
_CONF_PATH = os.path.join(_DIR, '..', 'private', 'extensions', 'settings.json')
_LOCK = threading.Lock()

_DEFAULTS = {'mcp': True, 'skills': True}


def _load():
    try:
        with open(_CONF_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict):
            out = dict(_DEFAULTS)
            for k in _DEFAULTS:
                if k in d:
                    out[k] = bool(d[k])
            return out
    except (OSError, json.JSONDecodeError):
        pass
    return dict(_DEFAULTS)


def _save(d):
    os.makedirs(os.path.dirname(_CONF_PATH), exist_ok=True)
    with open(_CONF_PATH, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def get_settings():
    return _load()


def is_enabled(module):
    """模块级总开关。module: 'mcp' | 'skills'。"""
    return _load().get(module, True)


def _send(handler, data, code=200):
    try:
        handler._send_json(data, code)
    except Exception:
        pass


def handle(handler, method, tail, body):
    if method == 'GET':
        _send(handler, {'ok': True, 'settings': _load()})
        return True

    if method == 'POST':
        cur = _load()
        for k in _DEFAULTS:
            if k in (body or {}):
                cur[k] = bool(body[k])
        with _LOCK:
            _save(cur)
        _send(handler, {'ok': True, 'settings': cur})
        return True

    _send(handler, {'ok': False, 'error': 'Unknown settings action'}, 404)
    return True
