# -*- coding: utf-8 -*-
"""route.chess：i棋域（T2.4 批量，策划案v4）。

载入 chess_routes（=domain_chess.py 逐字节副本，仅引擎路径适配），
装饰器注册即生效；禁用经注册栈 restore 回栈恢复 domain_chess 原接线。
"""
import os
import sys


def setup(ctx):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import chess_routes  # noqa: F401  导入即注册（@route_post 装饰器）
    ctx.log.info("route.chess: /api/chess/move + /api/chess/score registered")


def teardown(ctx):
    ctx.log.info("route.chess teardown（注册栈恢复 domain_chess 原接线）")
