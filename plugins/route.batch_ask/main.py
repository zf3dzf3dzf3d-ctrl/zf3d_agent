# -*- coding: utf-8 -*-
"""route.batch_ask：批量提问域（T2.4 批量，策划案v4）。

载入 batch_ask_routes（=domain_batch_ask.py 逐字节副本），
装饰器注册即生效；禁用经注册栈 restore 回栈恢复 domain_batch_ask 原接线。
"""
import os
import sys


def setup(ctx):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import batch_ask_routes  # noqa: F401  导入即注册
    ctx.log.info("route.batch_ask: registered (T2.4 batch)")


def teardown(ctx):
    ctx.log.info("route.batch_ask teardown（注册栈恢复 domain_batch_ask 原接线）")
