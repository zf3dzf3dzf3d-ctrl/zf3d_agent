# -*- coding: utf-8 -*-
"""ui.sysapps：顶栏 7 项功能 Dock 化的声明型插件（方案B 单项试点）。

声明挂载：slot=dock-app（i桌面 Dock 应用注册通道），资源 = 本插件下发的 JS。
disable 本插件 → ui_mounts 不含声明 → 前端不注入 → Dock 图标消失，
且隐藏顶栏按钮的 CSS 随资产一起失效 → 顶栏原按钮自动恢复显示（功能不丢失）。
"""
import os

_ui_dir = os.path.join(os.path.dirname(__file__), "ui")


def setup(ctx):
    ctx.ui.mount("dock-app", ["ui/sysapps.js"])
    ctx.log.info("ui.sysapps mounted at dock-app (via /plugins-ui/)")


def teardown(ctx):
    ctx.log.info("ui.sysapps teardown")
