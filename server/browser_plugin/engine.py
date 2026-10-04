# -*- coding: utf-8 -*-
"""
浏览器插件引擎 —— 门面模块（原 970 行已按行段拆分）

分段模块（按顺序 exec 合并进同一命名空间，语义零变化）：
  engine_seg1.py
  engine_seg2.py
  engine_seg3.py
"""
import os

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'engine.py')
_NS = {'__name__': __name__, '__file__': _SELF}
_SEGMENTS = ('engine_seg1', 'engine_seg2', 'engine_seg3', 'engine_seg4')
for _seg in _SEGMENTS:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_p, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _p, 'exec'), _NS)
for _k, _v in _NS.items():
    if not _k.startswith('__'):
        globals()[_k] = _v
