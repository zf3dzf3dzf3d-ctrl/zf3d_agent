# -*- coding: utf-8 -*-
"""matrix_bridge.py（6.2.0 routes 转发器，第12步收口·单一实现原则）。

唯一真身：matrix/matrix_bridge.py（第13步由 charlie 迁入，生产唯一入口；
6.1.0 钩子跨仓路径注入指向同一真身）。本文件只做路径注入+转发，
消除早前双实现（bea83f4 的完整桥已由 matrix/ 版取代）。勿在此加逻辑。
"""
import os
import sys

_MATRIX_DIR = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "matrix"))
if _MATRIX_DIR not in sys.path:
    sys.path.insert(0, _MATRIX_DIR)

from matrix_bridge import paired_submit, submit, stats  # noqa: F401,E402
