# -*- coding: utf-8 -*-
"""Mixin: 电脑管家（Housekeeper）路由处理器（替代原做梦系统）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsDream(MixinBase):
    # ==================== 电脑管家（Housekeeper） ====================
    def _handle_hk_status(self):
        """GET /api/hk/status — 管家状态+上次扫描+消息流"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.housekeeper_engine import hk_status
            self._send_json(hk_status(BASE_DIR))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_hk_scan(self):
        """POST /api/hk/scan — 立即扫描"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.housekeeper_engine import hk_scan_now
            self._send_json(hk_scan_now(BASE_DIR))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_hk_clean(self):
        """POST /api/hk/clean {ids:[...]} — 清理白名单项"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.housekeeper_engine import hk_clean
            body = self._read_body()
            self._send_json(hk_clean(BASE_DIR, body.get('ids')))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_hk_auto(self):
        """POST /api/hk/auto {enabled} — 开/关自动巡检"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.housekeeper_engine import hk_set_auto
            body = self._read_body()
            self._send_json(hk_set_auto(BASE_DIR, body.get('enabled')))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
