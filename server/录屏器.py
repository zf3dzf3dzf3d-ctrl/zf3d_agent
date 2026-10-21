# -*- coding: utf-8 -*-
"""录屏器 —— screen_recorder 的中文别名门面。

路由层（routes/mixin_media.py 等）使用 `from 录屏器 import 录屏器`，
实际实现位于 screen_recorder.py（分段拼接加载），此处直接转发。
"""
import sys as _sys

from screen_recorder import *  # noqa: F401,F403
import screen_recorder as _impl

# 将实现模块的全部名字合并进本模块命名空间，供 `from 录屏器 import X` 使用
_g = globals()
for _k, _v in list(vars(_impl).items()):
    if not _k.startswith('__'):
        _g.setdefault(_k, _v)

录屏器 = _g.get('录屏器')
_sys.modules[__name__] = _sys.modules[__name__]
