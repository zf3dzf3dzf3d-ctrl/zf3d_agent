# -*- coding: utf-8 -*-
"""domain_verify —— 审核师箭头配对 /api/verify-pairs 路由接线件（T2 公约 domain_*）。
20261123 B3 续：自 api_dispatch_get.py if-elif 链迁出（逻辑零改动）。"""
import os

from routes.dispatcher import route_get

_PAIRS_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'db', 'verify_pairs.json'))


@route_get('/api/verify-pairs')
def handle_verify_pairs(handler, path, parsed):
    try:
        if os.path.isfile(_PAIRS_PATH):
            with open(_PAIRS_PATH, 'r', encoding='utf-8') as f:
                handler._send_json({'ok': True, 'pairs': f.read()})
        else:
            handler._send_json({'ok': True, 'pairs': None})
    except Exception as e:
        handler._send_json({'ok': False, 'error': str(e)}, 500)
    return True
