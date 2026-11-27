# -*- coding: utf-8 -*-
"""ui.dockapps-main：Dock 主包 16 程序（R1-2 第二波，策划案v4 T1）。

搬运自 zf-app-dock.js 冻结区（等价性经 git HEAD 备份逐行 diff 实证）。
装载时经 window.ZFDockBridge 自注册图标，并回挂 window.ZFDock 的
open*/close*/mangaCmd 契约（pollCmds AI 指令队列运行时读取，插件未启用
时对应指令安静跳过——dock 端 typeof 检查已有）。
disable 本插件 → 图标消失、ZFDock 契约项不再回挂；已开窗口刷新即清。
"""


def setup(ctx):
    ctx.ui.mount("dock-app", ["ui/dockapps-main.js"])
    ctx.log.info("ui.dockapps-main mounted 16 apps at dock-app")


def teardown(ctx):
    ctx.log.info("ui.dockapps-main teardown")
