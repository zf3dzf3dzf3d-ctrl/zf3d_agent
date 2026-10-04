# -*- coding: utf-8 -*-
"""一次性脚本：把 chat_gate.py 改写为「门面」——顺序执行 5 个分段模块，
全部符号合并进同一命名空间，对外 import chat_gate 行为完全不变。"""
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server')
SRC = os.path.join(ROOT, 'chat_gate.py')

FACADE = '''# -*- coding: utf-8 -*-
"""
对话闸门 chat_gate v4 —— 门面模块（原 1420 行已按职责拆分）

分段模块（由本文件按顺序加载，全部符号合并进同一命名空间）：
  _gate_state    状态/常量/网络退避（全局锁、车道注册表、优先级、监控记录）
  _gate_cfg_io   配置读写（_load_cfg / save_cfg）+ 车道管理（选道/扩缩容）
  _gate_acquire  对外主接口（acquire / force_recover / release / GateRejected）
  _gate_worker   车道 worker 循环 + AIMD 自适应 + 监控记录 + 快照视图
  _gate_admin    管理 API（set_enabled/set_gap/set_lanes/set_auto/set_box_* /probe）

加载方式：在临时命名空间中按依赖顺序 exec 各分段源码，等价于把原文件
按行段无改动切分后再拼回同一模块 —— global 语句、函数互调语义零变化。
"""

import os
import sys

_SELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chat_gate.py')

_NS = {'__name__': 'chat_gate', '__file__': _SELF}
_SEGMENTS = ('_gate_state', '_gate_cfg_io', '_gate_acquire',
             '_gate_worker', '_gate_admin')
for _seg in _SEGMENTS:
    _path = os.path.join(os.path.dirname(os.path.abspath(__file__)), _seg + '.py')
    with open(_path, 'r', encoding='utf-8') as _f:
        exec(compile(_f.read(), _path, 'exec'), _NS)

# 把分段内定义的全部符号提升为本模块属性（含被 from chat_gate import X 引用的名字）
for _k, _v in _NS.items():
    if _k.startswith('__'):
        continue
    globals()[_k] = _v
'''

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(FACADE)
print('facade written, lines:', FACADE.count('\n'))
