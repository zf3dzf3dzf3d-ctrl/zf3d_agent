# -*- coding: utf-8 -*-
"""空 provider：模块被禁用或无可用引擎时的占位，永远 available=False 之外的兜底。"""
from . import BaseProvider, register


class NullProvider(BaseProvider):
    name = 'null'

    def available(self):
        return False

    def synthesize_stream(self, text, voice=None, rate=100):
        yield b''


register(NullProvider())
