# -*- coding: utf-8 -*-
"""Mixin: 监督师（Supervisor）全局开关 API —— GET/POST /api/supervisor"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSupervisor(MixinBase):
    def _handle_supervisor_get(self):
        """GET /api/supervisor — 读取监督师全局开关状态"""
        try:
            import supervisor as sv
            self._send_json({'ok': True, 'enabled': sv.is_enabled()})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_supervisor_post(self):
        """POST /api/supervisor — body {enabled: bool}，写全局开关"""
        try:
            import json as _json
            import supervisor as sv
            body = self._read_body() or {}
            enabled = bool(body.get('enabled'))
            sv.set_enabled(enabled)
            self._send_json({'ok': True, 'enabled': enabled})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
