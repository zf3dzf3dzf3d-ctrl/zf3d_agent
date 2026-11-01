# -*- coding: utf-8 -*-
"""
extensions/ui_registry.py - 扩展 UI 入口注册表

一劳永逸机制：扩展若想在主界面露出图标/入口，只需在 extensions/<id>/manifest.json
里声明一段 UI manifest（icon/title/type/url 等），前端 ext-ui-entries.js 会统一拉取
本端点并自动渲染。主程序 index.html 只挂一次 ext-ui-entries.js，永远不再为单个
扩展写专用脚本。

manifest 约定字段：
  id         必填，扩展目录名
  title      必填，提示文字
  icon       必填，按钮图标（emoji/字符）
  iconActive 可选，激活态图标
  position   可选，"corner"（右下角悬浮，默认）
  type       必填，"iframe-switch"（全屏 iframe 一键开关）| "link"（新开页）
  url        必填，目标地址
  allow      可选，iframe allow 权限
  tipIdle / tipActive  可选，按钮提示文案

启用/停用走统一开关：private/extensions/settings.json 的 ui 字段可按 id 排除。
"""

import json
import os

_DIR = os.path.dirname(os.path.abspath(__file__))
_SETTINGS = os.path.join(os.path.dirname(_DIR), 'private', 'extensions', 'settings.json')


def _settings_ui():
    """读全局设置里的 ui 排除名单，缺省空。"""
    try:
        with open(_SETTINGS, 'r', encoding='utf-8') as f:
            return (json.load(f).get('ui') or {})
    except Exception:
        return {}


_REQUIRED_FIELDS = ('title', 'icon', 'type', 'url')
_VALID_TYPES = ('iframe-switch', 'link', 'panel', 'api-only')


def _validate(m, name):
    """校验 manifest 必填字段。返回错误字符串，None 表示通过。"""
    if not isinstance(m, dict):
        return 'manifest_not_object'
    if not m.get('id'):
        return 'missing_id'
    for k in _REQUIRED_FIELDS:
        if not m.get(k):
            return 'missing_' + k
    if m.get('type') not in _VALID_TYPES:
        return 'invalid_type'
    if not isinstance(m.get('url'), str) or not m['url'].startswith(('http://', 'https://', '/')):
        return 'invalid_url'
    return None


def list_manifests():
    """扫描 extensions/*/manifest.json，返回 [{...manifest, enabled}]。

    损坏/缺字段的 manifest 不再静默跳过，返回 {"id":目录名, "error":"...", "enabled":False}
    供前端灰显提示，让配置错误可见。
    """
    blocked = _settings_ui().get('disabled') or []
    items = []
    try:
        names = sorted(os.listdir(_DIR))
    except Exception:
        return items
    for name in names:
        mpath = os.path.join(_DIR, name, 'manifest.json')
        if not os.path.isfile(mpath):
            continue
        m = None
        try:
            with open(mpath, 'r', encoding='utf-8') as f:
                m = json.load(f)
        except Exception:
            items.append({'id': name, 'error': 'manifest_unparsable', 'enabled': False})
            continue
        err = _validate(m, name)
        if err:
            items.append({'id': (m or {}).get('id') or name, 'error': err, 'enabled': False})
            continue
        m.setdefault('position', 'corner')
        m['enabled'] = m.get('id') not in blocked
        items.append(m)
    return items


def handle(handler, method, tail, body):
    """GET /api/ext/ui_registry → {ok, items}"""
    if method == 'GET':
        handler._send_json({'ok': True, 'items': list_manifests()}, 200)
        return True
    handler._send_json({'ok': False, 'error': 'method not allowed'}, 405)
    return True
