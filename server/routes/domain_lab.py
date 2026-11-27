# -*- coding: utf-8 -*-
"""domain_lab —— 进化实验室 /api/lab/* 路由接线件（T2 公约 domain_*）。

20261123 B3 样板：自 api_dispatch_get.py if-elif 链迁出（逻辑零改动），
route_get 精确注册三路径，dispatcher 在链首优先分发。
"""
import glob
import json
import os
import sys
from urllib.parse import parse_qs

from routes.dispatcher import route_get

_LAB_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'evolution_lab'))


def _evolution():
    sys.path.insert(0, _LAB_DIR)
    from evolution import Evolution
    return Evolution()


@route_get(('/api/lab/status', '/api/lab/curve', '/api/lab/journal'))
def handle_lab(handler, path, parsed):
    try:
        _evo = _evolution()
        if path == '/api/lab/status':
            st = {}
            try:
                _p = os.path.join(_LAB_DIR, 'runner_state.json')
                if os.path.isfile(_p):
                    with open(_p, encoding='utf-8') as _f:
                        st = json.loads(_f.read())
            except Exception:
                pass
            handler._send_json({'ok': True, 'state': st, 'stats': _evo.stats()})
        elif path == '/api/lab/curve':
            handler._send_json({'ok': True, 'curve': _evo.curve()})
        else:
            _qs = parse_qs(parsed.query or '')
            _r = (_qs.get('round') or [''])[0]
            _f = os.path.join(_LAB_DIR, 'journal', 'round_%s.md' % _r.zfill(4)) if _r else None
            if _f and os.path.isfile(_f):
                with open(_f, encoding='utf-8') as _fh:
                    handler._send_json({'ok': True, 'content': _fh.read()})
            else:
                _files = sorted(glob.glob(os.path.join(_LAB_DIR, 'journal', 'round_*.md')))
                handler._send_json({'ok': True, 'rounds': [os.path.basename(x) for x in _files]})
    except Exception as e:
        handler._send_json({'ok': False, 'error': str(e)}, 500)
    return True
