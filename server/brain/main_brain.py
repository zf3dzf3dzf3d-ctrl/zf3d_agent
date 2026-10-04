# -*- coding: utf-8 -*-
"""
主脑模块 —— 门面模块（原 882 行已按行段拆分）

分段模块（按顺序 exec 合并进同一命名空间，语义零变化）：
  main_brain_seg1.py
  main_brain_seg2.py
  main_brain_seg3.py
"""
import os

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'main_brain.py')
_NS = {'__name__': __name__, '__file__': _SELF}
_SEGMENTS = ('main_brain_seg1', 'main_brain_seg2', 'main_brain_seg3')
for _seg in _SEGMENTS:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_p, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _p, 'exec'), _NS)
for _k, _v in _NS.items():
    if not _k.startswith('__'):
        globals()[_k] = _v
