# -*- coding: utf-8 -*-
"""ui.matrix-board：i进化看板 Dock 程序（charlie·看板实时化 2026-11-27）。

「一切皆插件」纪律：不碰 zf-app-dock.js 硬编码冻结区，走 ui.mount 声明式通道。
窗口内嵌 /api/matrix/board?view=html（matrix/board_api.py 渲染的实时仪表盘，
10s 自动刷新，全链只读）。disable 后图标消失、端点仍可用（端点在 server 侧）。
"""


def setup(ctx):
    ctx.ui.mount("dock-app", ["ui/matrix-board.js"])
    ctx.log.info("ui.matrix-board mounted i进化看板 at dock-app")


def teardown(ctx):
    ctx.log.info("ui.matrix-board teardown")
