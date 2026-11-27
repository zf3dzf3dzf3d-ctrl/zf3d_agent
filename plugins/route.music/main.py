# -*- coding: utf-8 -*-
"""route.music：i音乐域（T2.4 批量，策划案v4）。

载入 music_routes（=domain_music.py 逐字节副本，含 __file__ 重指适配），
装饰器注册即生效；禁用经注册栈 restore 回栈恢复 domain_music 原接线。
"""
import os
import sys


def setup(ctx):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import music_routes  # noqa: F401  导入即注册
    ctx.log.info("route.music: registered (T2.4 batch)")


def teardown(ctx):
    ctx.log.info("route.music teardown（注册栈恢复 domain_music 原接线）")
