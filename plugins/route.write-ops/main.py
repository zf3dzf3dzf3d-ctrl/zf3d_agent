# -*- coding: utf-8 -*-
"""route.write-ops：写操作POST域（T2 尾巴，策划案v4）。

载入 write_ops_routes（=domain_write-ops.py 逐字节副本），
装饰器注册即生效；禁用经注册栈 restore 回栈恢复原接线。
"""
import os
import sys


def setup(ctx):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import write_ops_routes  # noqa: F401  导入即注册
    ctx.log.info("route.write-ops: registered (T2 tail)")


def teardown(ctx):
    ctx.log.info("route.write-ops teardown（注册栈恢复原接线）")
