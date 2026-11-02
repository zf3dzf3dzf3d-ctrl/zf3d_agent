# -*- coding: utf-8 -*-
"""
screen_recorder —— 门面模块（已拆分为分段 + 拼接式加载）

分段模块（按顺序拼接为一个整体源码后一次性 exec，语义与原文件零差异）：
  screen_recorder_seg1
  screen_recorder_seg2
  screen_recorder_seg3
注意：分段间可能存在跨段的缩进代码块（类体续段），
因此必须拼接后整体编译，不能逐段单独 exec。
"""
import os as _os

_HERE = _os.path.dirname(_os.path.abspath(__file__))
_SEGMENTS = ('screen_recorder_seg1', 'screen_recorder_seg2', 'screen_recorder_seg3')
_src = ''
for _seg in _SEGMENTS:
    with open(_os.path.join(_HERE, _seg + '.py'), 'r', encoding='utf-8') as _f:
        _src += _f.read()
exec(compile(_src, __file__, 'exec'), globals())
