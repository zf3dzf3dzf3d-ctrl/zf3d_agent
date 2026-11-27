# -*- coding: utf-8 -*-
"""crew_order.py — 派出团队排序真源（server 落盘，2026-11-13）

用户拖拽排序后前端把 zf_crew_order_v1 内容 POST 上来落盘；
AI 对话侧直接 GET /api/crew/order 读到 {groups, cards} 按用户排序派出。
文件：server/data/crew_order.json  结构：{groups:[组名], cards:{组:[roleKey]}}
"""
import json
import os
import threading

_LOCK = threading.Lock()
_ORDER_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           'data', 'crew_order.json')


def crew_order_get(_body=None):
    """GET /api/crew/order → {ok, order:{groups, cards}}"""
    try:
        with _LOCK:
            with open(_ORDER_FILE, 'r', encoding='utf-8') as f:
                order = json.load(f)
    except Exception:
        order = {}
    return {'ok': True, 'order': {'groups': order.get('groups') or [],
                                  'cards': order.get('cards') or {}}}


def crew_order_save(body):
    """POST /api/crew/order  body={groups:[...], cards:{组:[key]}}"""
    if not isinstance(body, dict):
        return {'ok': False, 'error': 'body 必须为 JSON 对象'}
    order = {'groups': body.get('groups') or [],
             'cards': body.get('cards') or {},
             'updated_at': __import__('time').time()}
    os.makedirs(os.path.dirname(_ORDER_FILE), exist_ok=True)
    tmp = _ORDER_FILE + '.tmp'
    try:
        with _LOCK:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(order, f, ensure_ascii=False)
            os.replace(tmp, _ORDER_FILE)  # 原子改名防半截
    except Exception as e:
        return {'ok': False, 'error': '排序落盘失败: %r' % e}
    return {'ok': True, 'order': {k: order[k] for k in ('groups', 'cards')}}
