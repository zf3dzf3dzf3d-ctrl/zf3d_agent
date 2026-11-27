# -*- coding: utf-8 -*-
"""matrix_board_api.py（6.2.0 routes 转发器，版本对齐·单一实现原则，bravo 2026-11-27）。

唯一真身：matrix/board_api.py（charlie 进化看板 API：json_payload/render_html）。
本文件只做路径注入+转发，勿在此加逻辑。存在意义：对齐 6.1.0 生产钩子
（api_dispatch_get.py /api/matrix/board，charlie 2026-11-27）——用户令
「开发以 6.2 为准、保证 6.2 最新」，生产仓有的钩子，最新仓必须同样具备。
"""
import os
import sys

_MATRIX_DIR = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "matrix"))
if _MATRIX_DIR not in sys.path:
    sys.path.insert(0, _MATRIX_DIR)

from board_api import json_payload, render_html  # noqa: F401,E402
