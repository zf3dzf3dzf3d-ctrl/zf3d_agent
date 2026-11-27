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


from extensions import config_store

_CONF_PATH = config_store.CONF_PATH
_LOCK = config_store.LOCK  # 与 market.py/ui_registry.py 共用同一把 RLock，消除并发互相覆盖

_DEFAULTS = {'mcp': True, 'skills': True}


def _load():
    """返回带默认值视图，但保存时必须基于 load_raw() 全量，避免抹掉未知键（如 ui.disabled）。"""
    raw = config_store.load_raw()
    out = dict(_DEFAULTS)
    for k in _DEFAULTS:
        if k in raw:
            out[k] = bool(raw[k])
    return out


def _save(d):
    config_store.save_raw(d)


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
        # 根治按钮复发：基于全量原始配置改，禁止只用 _DEFAULTS 构造后覆盖写回
        with _LOCK:
            cur = config_store.load_raw()
            cur.setdefault('mcp', _DEFAULTS['mcp'])
            cur.setdefault('skills', _DEFAULTS['skills'])
            for k in _DEFAULTS:
                if k in (body or {}):
                    cur[k] = bool(body[k])
            config_store.save_raw(cur)
        _send(handler, {'ok': True, 'settings': _load()})
        return True

    _send(handler, {'ok': False, 'error': 'Unknown settings action'}, 404)
    return True
