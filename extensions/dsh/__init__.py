#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extensions/dsh/ - 朱峰无限 ⇄ dsh (DeepSeek Harness) 桥接
入口 handle(handler, method, tail, body)，由 extensions/__init__.py 分发。
路由（tail 为 /api/ext/dsh 之后的段）：
  status   GET  - 检测本机 dsh 与凭据
  models   GET  - DeepSeek 可用模型
  chat     POST - 借 dsh 凭据调 DeepSeek 对话（OpenAI 兼容）
  sessions GET  - dsh 本地会话元数据（互联）
  ui       GET  - dsh UI 地址（供前端内嵌）
"""
import os
import re
import json
import urllib.request

_DSH_DIR = os.path.expanduser('~/.dsh')
_DSH_CRED = os.path.join(_DSH_DIR, '.credentials.yaml')
_DSH_SESSIONS = os.path.join(_DSH_DIR, 'sessions')
_API_BASE = 'https://api.deepseek.com'
_TIMEOUT = 60


def _read_key():
    """从 dsh 凭据读 DEEPSEEK_API_KEY（只读不落盘不响应）。"""
    try:
        txt = open(_DSH_CRED, encoding='utf-8').read()
    except Exception:
        return None
    m = re.search(r'DEEPSEEK_API_KEY["\']?\s*[:=]\s*["\']?([A-Za-z0-9_-]{20,})', txt)
    return m.group(1) if m else None


def _session_dirs():
    out = []
    try:
        for ws in os.listdir(_DSH_SESSIONS):
            wsp = os.path.join(_DSH_SESSIONS, ws)
            if not os.path.isdir(wsp):
                continue
            for s in os.listdir(wsp):
                sp = os.path.join(wsp, s)
                if os.path.isdir(sp):
                    out.append(sp)
    except Exception:
        pass
    return out


def _has_zstd():
    try:
        import zstandard  # noqa
        return True
    except ImportError:
        return False


# ------------------------------------------------ handlers

def _h_status(handler, method, body):
    handler._send_json({'ok': True, 'data': {
        'installed': os.path.isdir(_DSH_DIR),
        'has_key': bool(_read_key()),
        'session_count': len(_session_dirs()),
        'ui_url': 'https://harness.chat.deepseek.com',
        'body_decodable': _has_zstd(),
    }})


def _h_models(handler, method, body):
    handler._send_json({'ok': True, 'data': {'models': [
        {'id': 'deepseek-chat', 'name': 'DeepSeek Chat (V3.x)', 'source': 'dsh'},
        {'id': 'deepseek-reasoner', 'name': 'DeepSeek Reasoner (R1)', 'source': 'dsh'},
    ]}})


def _h_chat(handler, method, body):
    key = _read_key()
    if not key:
        handler._send_json({'ok': False,
                            'error': '未找到 dsh 凭据(DEEPSEEK_API_KEY)，请先登录 dsh 桌面版'}, 400)
        return
    messages = body.get('messages') or []
    if not messages:
        handler._send_json({'ok': False, 'error': 'messages 不能为空'}, 400)
        return
    model = str(body.get('model') or 'deepseek-chat')
    payload = json.dumps({'model': model, 'messages': messages,
                          'stream': False}).encode('utf-8')
    req = urllib.request.Request(
        _API_BASE + '/chat/completions', data=payload, method='POST',
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            result = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        handler._send_json({'ok': False, 'error': 'DeepSeek 调用失败: %s' % e}, 502)
        return
    choice = (result.get('choices') or [{}])[0]
    handler._send_json({'ok': True, 'data': {
        'model': model,
        'content': (choice.get('message') or {}).get('content', ''),
        'usage': result.get('usage', {}),
    }})


def _h_sessions(handler, method, body):
    items = []
    for sp in _session_dirs():
        try:
            st = os.stat(sp)
            files = os.listdir(sp)
        except Exception:
            continue
        items.append({
            'id': os.path.basename(sp),
            'workspace': os.path.basename(os.path.dirname(sp)),
            'mtime': int(st.st_mtime),
            'size': sum(os.path.getsize(os.path.join(sp, f))
                        for f in files if os.path.isfile(os.path.join(sp, f))),
            'has_body': any('session.v4' in f for f in files),
        })
    items.sort(key=lambda x: -x['mtime'])
    handler._send_json({'ok': True, 'data': {
        'sessions': items, 'body_decodable': _has_zstd()}})


def _h_ui(handler, method, body):
    handler._send_json({'ok': True, 'data': {
        'ui_url': 'https://harness.chat.deepseek.com'}})


_ROUTES = {
    ('GET', 'status'): _h_status,
    ('GET', 'models'): _h_models,
    ('POST', 'chat'): _h_chat,
    ('GET', 'sessions'): _h_sessions,
    ('GET', 'ui'): _h_ui,
}


def handle(handler, method, tail, body):
    if isinstance(tail, list):
        # 兼容 list 形式：多段拼回路径，避免静默截断错路由
        tail = '/'.join(tail)
    fn = _ROUTES.get((method, tail))
    if fn is None:
        handler._send_json({'ok': False,
                            'error': 'unknown dsh route: %s %s' % (method, tail)}, 404)
        return True
    try:
        fn(handler, method, body or {})
    except Exception as e:
        try:
            handler._send_json({'ok': False, 'error': 'dsh bridge error: %s' % e}, 500)
        except Exception:
            pass
    return True
