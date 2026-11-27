# -*- coding: utf-8 -*-
"""answer_bridge.py（6.2.0 routes 转发器，版本对齐·单一实现原则，bravo 2026-11-27）。

唯一真身：matrix/answer_bridge.py（第17步 alpha 主刀，影子查纸）。本文件只做
路径注入+转发，勿在此加逻辑。存在意义：对齐 6.1.0 生产钩子（api_dispatch_post.py
L984-988，commit 49ecb01）——用户令「开发以 6.2 为准、保证 6.2 最新」，生产仓
有的钩子，最新仓必须同样具备。
"""
import os
import sys

_MATRIX_DIR = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "matrix"))
if _MATRIX_DIR not in sys.path:
    sys.path.insert(0, _MATRIX_DIR)

from answer_bridge import shadow_route, shadow_stats, shadow_flush  # noqa: F401,E402
