#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI群聊房间工具：send/read/clear，存储于 private/群聊/groupchat.jsonl"""
import sys
import os

TOOL_NAME = 'groupchat'
CATEGORY = 'collaboration'

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))

from tools.coding.backend.base import ToolContext

_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))), 'private', '群聊',
    'groupchat.jsonl')


def handle(body, ctx):
    try:
        action = body.get('action', 'read')
        if action == 'send':
            _do_send(ctx, body)
        elif action == 'read':
            _do_read(ctx, body)
        elif action == 'clear':
            _do_clear(ctx)
        else:
            ctx.send_error('不支持的操作: ' + str(action))
    except Exception as e:
        ctx.send_error(str(e))


def _resolve_role(ctx):
    """根据当前会话推断角色身份（名字+id）。"""
    name = ''
    rid = ''
    try:
        import roles_db
        box_id = getattr(ctx, 'box_id', '') or getattr(ctx, 'session_id', '') or ''
        sel = roles_db.get_selected_role(box_id)
        if sel:
            name = sel.get('name') or ''
            rid = str(sel.get('id') or '')
    except Exception:
        pass
    if not name:
        name = str(getattr(ctx, 'role_name', '') or '未命名角色')
    return name, rid


def _load_msgs():
    msgs = []
    if os.path.exists(_DB_PATH):
        with open(_DB_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        import json
                        msgs.append(json.loads(line))
                    except Exception:
                        pass
    return msgs


def _append_msg(rec):
    import json
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    with open(_DB_PATH, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def _do_send(ctx, body):
    import time
    content = str(body.get('content') or body.get('message') or '').strip()
    if not content:
        ctx.send_error('需要提供 content')
        return
    sender = str(body.get('sender') or '').strip()
    sender_id = str(body.get('sender_id') or '').strip()
    if not sender:
        sender, sender_id = _resolve_role(ctx)
    msgs = _load_msgs()
    seq = (msgs[-1].get('seq', 0) + 1) if msgs else 1
    msg = {
        'seq': seq,
        'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
        'sender': sender,
        'sender_id': sender_id,
        'content': content,
    }
    try:
        _append_msg(msg)
    except Exception as e:
        ctx.send_error('写入失败: ' + str(e))
        return
    ctx.send_json({
        'ok': True,
        'seq': msg['seq'],
        'sender': sender,
    })


def _do_read(ctx, body):
    try:
        limit = int(body.get('limit', 20))
    except Exception:
        limit = 20
    try:
        after_seq = int(body.get('after_seq', 0))
    except Exception:
        after_seq = 0
    try:
        msgs = [m for m in _load_msgs() if m.get('seq', 0) > after_seq]
        msgs = msgs[-limit:] if limit > 0 else msgs
    except Exception as e:
        ctx.send_error('读取失败: ' + str(e))
        return
    lines = []
    for m in msgs:
        lines.append('[%s] %s: %s' % (m.get('ts'), m.get('sender'),
                                      m.get('content')))
    ctx.send_json({
        'ok': True,
        'count': len(msgs),
        'messages': msgs,
        'text': '\n'.join(lines),
    })


def _do_clear(ctx):
    try:
        if os.path.exists(_DB_PATH):
            os.remove(_DB_PATH)
    except Exception as e:
        ctx.send_error('清空失败: ' + str(e))
        return
    ctx.send_json({'ok': True, 'cleared': True})
