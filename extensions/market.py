# -*- coding: utf-8 -*-
"""
extensions/market.py - 本地扩展管理（市场闭环 · 半天版）

只做两件事，不做远程市场（第 3 个扩展出现再升级）：
  GET  /api/ext/market          → 列出本地扩展（复用 ui_registry 扫描结果）
  POST /api/ext/market/uninstall {id} → 卸载：整目录移入 zf-trash 回收站，不真删
  POST /api/ext/market/toggle   {id, enabled} → 启停：写 settings.json 的 ui.disabled 名单

绝对路径；卸载必经回收站（见 extensions/README.md 已知坑 1/4）。
"""

import json
import os
import shutil
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_DIR)
_SETTINGS = os.path.join(_ROOT, 'private', 'extensions', 'settings.json')
_TRASH = os.path.join(_ROOT, 'zf-trash')


def _list():
    from extensions import ui_registry
    return ui_registry.list_manifests()


def _read_settings():
    try:
        with open(_SETTINGS, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _write_settings(data):
    os.makedirs(os.path.dirname(_SETTINGS), exist_ok=True)
    with open(_SETTINGS, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def handle(handler, method, tail, body):
    action = tail[0] if isinstance(tail, list) and tail else (tail or '')

    if method == 'GET' and not action:
        handler._send_json({'ok': True, 'items': _list()}, 200)
        return True

    if method == 'POST' and action == 'toggle':
        ext_id = (body or {}).get('id')
        enabled = bool((body or {}).get('enabled', True))
        if not ext_id:
            handler._send_json({'ok': False, 'error': 'missing id'}, 400)
            return True
        st = _read_settings()
        ui = st.setdefault('ui', {})
        disabled = [d for d in (ui.get('disabled') or []) if d != ext_id]
        if not enabled:
            disabled.append(ext_id)
        ui['disabled'] = disabled
        _write_settings(st)
        handler._send_json({'ok': True, 'id': ext_id, 'enabled': enabled}, 200)
        return True

    if method == 'POST' and action == 'uninstall':
        ext_id = (body or {}).get('id')
        src = os.path.abspath(os.path.join(_DIR, ext_id or ''))
        # 安全护栏：必须位于 extensions/ 直接子级且真实存在
        if (not ext_id or os.path.dirname(src) != _DIR
                or not os.path.isdir(src) or ext_id in ('__pycache__',)):
            handler._send_json({'ok': False, 'error': 'invalid extension id'}, 400)
            return True
        os.makedirs(_TRASH, exist_ok=True)
        dst = os.path.join(_TRASH, 'ext-%s-%s' % (ext_id, time.strftime('%Y%m%d_%H%M%S')))
        shutil.move(src, dst)  # 进回收站，不真删
        # 顺手解除停用名单
        st = _read_settings()
        ui = st.setdefault('ui', {})
        ui['disabled'] = [d for d in (ui.get('disabled') or []) if d != ext_id]
        _write_settings(st)
        handler._send_json({'ok': True, 'id': ext_id, 'moved_to': dst}, 200)
        return True

    handler._send_json({'ok': False, 'error': 'method not allowed'}, 405)
    return True
