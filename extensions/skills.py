#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Skills 子模块（独立文件，可单文件删除下线）

技能包 = 提示词片段 + 可选工具白名单 + 可选声明式 UI 面板，文件夹级别插拔：

skills/
├── _template/            ← 模板（不参与注册）
│   └── skill.json
└── <skill_id>/
    └── skill.json        ← 唯一必需文件
        可选: prompt.md（技能提示词正文，skill.json 里引用）

skill.json 规范：
{
  "id": "<=文件夹名", "name": "...", "description": "...",
  "enabled": true,
  "prompt": "prompt.md",              ← 可选，注入系统提示词
  "tools": ["read", "run"],           ← 可选，白名单（空=不限制）
  "triggers": ["关键词1", "关键词2"],  ← 可选，命中关键词时自动激活
  "autoInject": false                 ← true 则始终注入
}

热更新：skill.json mtime 变化自动重扫。

API：
  GET  /api/ext/skills/list
  POST /api/ext/skills/set_enabled  {id, enabled}
  POST /api/ext/skills/match        {text} → 返回命中的技能（供对话循环注入）
  GET  /api/ext/skills/prompt?ids=a,b → 拼接技能提示词

技能市场（market.py，见下）：
  GET  /api/ext/skills/market_list     → 本地索引（不联网，标注 installed）
  POST /api/ext/skills/market_refresh  → 联网重新拉取索引（只存元数据）
  POST /api/ext/skills/market_install  {id} → 按需下载安装到 skills/<id>/
  POST /api/ext/skills/market_delete   {id} → 卸载（删除技能目录）
"""

import os
import json
import threading

_DIR = os.path.dirname(os.path.abspath(__file__))
_SKILLS_DIR = os.path.join(_DIR, 'skills')
_LOCK = threading.Lock()
_CACHE = {'fingerprint': None, 'skills': {}}


def _read_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _scan():
    try:
        entries = sorted(os.listdir(_SKILLS_DIR))
    except OSError:
        return {}
    skills = {}
    for name in entries:
        if name.startswith(('_', '.')):
            continue
        sp = os.path.join(_SKILLS_DIR, name, 'skill.json')
        if not os.path.isfile(sp):
            continue
        data = _read_json(sp)
        if not isinstance(data, dict):
            print('[Skills] invalid skill.json skipped: %s' % name)
            continue
        if data.get('id') != name or 'enabled' not in data or not data.get('name'):
            print('[Skills] skill.json id/name/enabled invalid, skipped: %s' % name)
            continue
        if data.get('enabled'):
            skills[name] = data
    return skills


def _ensure():
    fps = []
    try:
        for name in os.listdir(_SKILLS_DIR):
            sp = os.path.join(_SKILLS_DIR, name, 'skill.json')
            if os.path.isfile(sp):
                fps.append((name, os.path.getmtime(sp)))
    except OSError:
        pass
    fp = tuple(fps)
    with _LOCK:
        if _CACHE['fingerprint'] != fp:
            _CACHE['skills'] = _scan()
            _CACHE['fingerprint'] = fp
    return _CACHE['skills']


def list_skills():
    return _ensure()


def get_prompt_text(sk):
    """读取技能提示词（skill.json 同目录的 prompt.md）。"""
    pfile = sk.get('prompt')
    if not pfile:
        return ''
    path = os.path.join(_SKILLS_DIR, sk['id'], pfile)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def match(text, limit=3):
    """按 triggers 关键词匹配技能。"""
    text = (text or '')
    hits = []
    for sid, sk in list_skills().items():
        if sk.get('autoInject'):
            hits.append(sid)
            continue
        for kw in (sk.get('triggers') or []):
            if kw and kw in text:
                hits.append(sid)
                break
        if len(hits) >= limit:
            break
    return hits


def compose_prompt(text=None, extra_ids=None):
    """拼接技能提示词，供对话循环注入 system 消息。"""
    skills = list_skills()
    ids = list(dict.fromkeys((extra_ids or []) + (match(text) if text else [])))
    parts = []
    for sid in ids:
        sk = skills.get(sid)
        if not sk:
            continue
        body = get_prompt_text(sk)
        if body.strip():
            parts.append('### 技能：%s\n%s' % (sk.get('name', sid), body.strip()))
    return '\n\n'.join(parts)


def _send(handler, data, code=200):
    try:
        handler._send_json(data, code)
    except Exception:
        pass


def handle(handler, method, tail, body):
    action = tail[0] if tail else ''

    # 全局开关：技能总开关关闭时 match/prompt/ui 返回空（管理接口仍可用）
    from extensions import settings as _ext_settings
    _skills_off = not _ext_settings.is_enabled('skills')

    if method == 'GET' and action == 'list':
        _send(handler, {'ok': True, 'skills': [
            {'id': sid, 'name': sk.get('name'), 'description': sk.get('description', ''),
             'tools': sk.get('tools', []), 'triggers': sk.get('triggers', []),
             'autoInject': bool(sk.get('autoInject'))}
            for sid, sk in list_skills().items()]})
        return True

    if method == 'POST' and action == 'set_enabled':
        sid = str(body.get('id') or '')
        sp = os.path.join(_SKILLS_DIR, sid, 'skill.json')
        data = _read_json(sp)
        if not isinstance(data, dict):
            _send(handler, {'ok': False, 'error': '技能不存在: ' + sid})
            return True
        data['enabled'] = bool(body.get('enabled'))
        with open(sp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        _ensure()
        _send(handler, {'ok': True, 'id': sid, 'enabled': data['enabled']})
        return True

    if method == 'POST' and action == 'match':
        if _skills_off:
            _send(handler, {'ok': True, 'hits': []})
            return True
        _send(handler, {'ok': True, 'hits': match(body.get('text'))})
        return True

    if method == 'GET' and action == 'ui':
        # ?text=... 或 ?ids=a,b → 返回命中技能的声明式 UI 面板
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(handler.path).query)
        text = q.get('text', [''])[0]
        ids = [i for i in (q.get('ids', [''])[0] or '').split(',') if i]
        if text:
            ids = list(dict.fromkeys(ids + match(text)))
        if _skills_off:
            _send(handler, {'ok': True, 'panels': []})
            return True
        skills = list_skills()
        panels = []
        for sid in ids[:3]:
            sk = skills.get(sid)
            ui = sk.get('ui') if sk else None
            if isinstance(ui, dict):
                panels.append({'id': sid, 'name': sk.get('name', sid), 'ui': ui})
        _send(handler, {'ok': True, 'panels': panels})
        return True

    if method == 'GET' and action == 'prompt':
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(handler.path).query)
        ids = (q.get('ids', [''])[0] or '').split(',')
        text = q.get('text', [''])[0]
        if _skills_off:
            _send(handler, {'ok': True, 'prompt': '', 'disabled': True})
            return True
        _send(handler, {'ok': True, 'prompt': compose_prompt(text, ids)})
        return True

    # ---- 技能市场（本地索引 + 按需下载，见 market.py）----
    if action.startswith('market_'):
        from extensions import market as _market
        return _market.handle(handler, method, tail, body)

    _send(handler, {'ok': False, 'error': 'Unknown skills action'}, 404)
    return True
