#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Declarative UI 子模块（独立文件，可整目录/单文件删除下线）

声明式 UI 配置：工具/技能以 JSON 声明返回 UI 描述，前端按描述渲染，无需写前端代码。

协议（规范 v1）：
{
  "ui": {
    "type": "form" | "cards" | "table" | "markdown" | "confirm",
    "title": "...",
    "form":   {"fields": [{"name","label","type":"text|select|radio|checkbox|textarea|number","options","placeholder","default","required"}]},
    "cards":  [{"title","subtitle","body","image","actions":[{"label","tool","arguments"}]}],
    "table":  {"columns": ["a","b"], "rows": [[..],[..]]},
    "markdown": "## 文本",
    "confirm": {"message": "...", "actions": [{"label","tool","arguments","style":"primary|danger"}]}
  }
}

API：
  GET  /api/ext/declarative_ui/schema  → 返回协议 schema（前端/工具开发者参考）
  POST /api/ext/declarative_ui/validate → 校验一份 UI 声明是否合法
  声明随工具响应返回：只要 JSON 中含 "ui" 键且 type 合法，前端扩展渲染器即可渲染。
"""

_SCHEMA = {
    'spec': 1,
    'module': 'declarative_ui',
    'types': ['form', 'cards', 'table', 'markdown', 'confirm'],
    'fieldTypes': ['text', 'textarea', 'number', 'select', 'radio', 'checkbox'],
    'rules': {
        'form': '必须含 form.fields 数组',
        'cards': '必须含 cards 数组；actions[].tool 为工具名，arguments 为参数对象',
        'table': '必须含 table.columns + table.rows',
        'markdown': '必须含 markdown 字符串',
        'confirm': '必须含 confirm.message；actions 可选',
    },
}


def validate(ui):
    """校验 UI 声明，返回 (ok, error)。"""
    if not isinstance(ui, dict):
        return False, 'ui 必须是对象'
    t = ui.get('type')
    if t not in _SCHEMA['types']:
        return False, '未知 ui.type: %r（合法: %s）' % (t, ', '.join(_SCHEMA['types']))
    if t == 'form':
        fields = (ui.get('form') or {}).get('fields')
        if not isinstance(fields, list) or not fields:
            return False, 'form.fields 必须是非空数组'
        for f in fields:
            if not isinstance(f, dict) or not f.get('name') or not f.get('label'):
                return False, 'form.fields[] 每项必须含 name/label'
            if f.get('type') not in _SCHEMA['fieldTypes']:
                return False, 'field.type 非法: %r' % f.get('type')
    elif t == 'cards':
        if not isinstance(ui.get('cards'), list) or not ui['cards']:
            return False, 'cards 必须是非空数组'
    elif t == 'table':
        tb = ui.get('table') or {}
        if not isinstance(tb.get('columns'), list) or not isinstance(tb.get('rows'), list):
            return False, 'table.columns 与 table.rows 必须是数组'
    elif t == 'markdown':
        if not isinstance(ui.get('markdown'), str) or not ui['markdown'].strip():
            return False, 'markdown 必须是非空字符串'
    elif t == 'confirm':
        if not isinstance(ui.get('confirm'), dict) or not (ui['confirm'].get('message') or '').strip():
            return False, 'confirm.message 必填'
    return True, None


def _send(handler, data, code=200):
    try:
        handler._send_json(data, code)
    except Exception:
        pass


def handle(handler, method, tail, body):
    action = tail[0] if tail else ''
    if method == 'GET' and action == 'schema':
        _send(handler, {'ok': True, 'schema': _SCHEMA})
        return True
    if method == 'POST' and action == 'validate':
        ok, err = validate(body.get('ui'))
        _send(handler, {'ok': ok, 'error': err})
        return True
    _send(handler, {'ok': False, 'error': 'Unknown declarative_ui action'}, 404)
    return True
