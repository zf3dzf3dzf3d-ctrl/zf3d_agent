# -*- coding: utf-8 -*-
"""
蜂群调度 —— 门面模块（原 748 行已按行段拆分）

分段模块（按顺序 exec 合并进同一命名空间，语义零变化）：
  dispatch_swarm_infra.py
  dispatch_swarm_tasks.py
"""
import os

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dispatch_swarm.py')
_NS = {'__name__': __name__, '__file__': _SELF}
_SEGMENTS = ('dispatch_swarm_infra', 'dispatch_swarm_tasks')
for _seg in _SEGMENTS:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_p, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _p, 'exec'), _NS)
for _k, _v in _NS.items():
    if not _k.startswith('__'):
        globals()[_k] = _v
