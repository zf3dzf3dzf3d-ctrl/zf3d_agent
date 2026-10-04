# -*- coding: utf-8 -*-
"""
Agent循环 —— 门面模块（原 640 行已按行段拆分）

分段模块（按顺序 exec 合并进同一命名空间，语义零变化）：
  agent_loop_seg1.py
  agent_loop_seg2.py
"""
import os

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent_loop.py')
_NS = {'__name__': __name__, '__file__': _SELF}
_SEGMENTS = ('agent_loop_seg1', 'agent_loop_seg2')
for _seg in _SEGMENTS:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_p, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _p, 'exec'), _NS)
for _k, _v in _NS.items():
    if not _k.startswith('__'):
        globals()[_k] = _v
