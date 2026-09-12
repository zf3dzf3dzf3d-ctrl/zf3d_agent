# -*- coding: utf-8 -*-
"""Mixin: 沙箱保护（/api/sandbox）—— 每次 AI 更改都可撤销。
GET  /api/sandbox?limit=50  → 操作时间线
POST /api/sandbox {action: 'undo'|'redo'|'timeline'|'stats', id?}
"""
import json
from urllib.parse import parse_qs
from engines.common import sandbox as _sb


class MixinSandbox:
    def _handle_sandbox_get(self, query):
        try:
            qs = parse_qs(query or '')
            limit = int((qs.get('limit') or ['50'])[0])
        except Exception:
            limit = 50
        self._send_json(_sb.timeline(limit))

    def _handle_sandbox_post(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        action = body.get('action', 'timeline')
        op_id = body.get('id')
        if action == 'undo':
            self._send_json(*_pack(_sb.undo(op_id)))
        elif action == 'redo':
            self._send_json(*_pack(_sb.redo(op_id)))
        elif action == 'stats':
            self._send_json(_sb.stats())
        elif action == 'git_history':
            self._send_json({'ok': True, 'commits': _sb.git_history(body.get('limit', 30))})
        else:
            self._send_json(_sb.timeline())


def _pack(pair):
    ok, msg = pair
    return ({'ok': bool(ok), 'message': msg},) if ok else ({'ok': False, 'error': msg}, 400)
