# -*- coding: utf-8 -*-
"""Mixin: OPTIONS/CORS（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinCore(MixinBase):
    def do_OPTIONS(self):
        self._send_json({'ok': True})

    # ===== API 浠ｇ悊锛氳浆鍙戣姹傚埌绗笁鏂?AI 鏈嶅姟锛堣В鍐?CORS锛?=====

