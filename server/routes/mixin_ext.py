# -*- coding: utf-8 -*-
"""Mixin: 扩展子系统挂钩（/api/ext/* → extensions.dispatch）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinExt(MixinBase):
    def _handle_ext(self, method='GET', path='/api/ext'):
        """把 /api/ext/* 转发给 extensions 子系统（GET 读 / POST 写统一入口）。"""
        try:
            body = {}
            if method == 'POST':
                try:
                    body = self._read_body()
                except Exception:
                    body = {}
            from extensions import dispatch as _ext_dispatch
            _ext_dispatch(self, method, path, body)
        except Exception as e:
            traceback.print_exc()
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                pass
