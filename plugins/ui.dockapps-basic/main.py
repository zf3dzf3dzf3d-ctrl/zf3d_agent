# -*- coding: utf-8 -*-
"""ui.dockapps-basic：Dock 第一波 4 程序（i模型生成/i网页/i设置/新建对话）声明型插件。

R1-2（策划案v4 T1）：照 ui.sysapps 模式，把 zf-app-dock.js 冻结区的 4 个自包含
register 分支搬入本插件资产；窗口逻辑不重写，仅搬运+声明化。
- i模型生成/i网页：薄壳启动器（createAppWindow + 懒加载 zf-app-igen/web.js），
  经 ZFDockBridge 扩展面（zfVerSrc/prefetchAppJs）取 dock 内部工具；
- i设置/新建对话：只依赖 window.App / window.KiteCanvas 全局，零 dock 耦合。
disable 本插件 → ui-mounts 不再注入 → 图标消失；已开窗口刷新即清。
"""
import os

_ui_dir = os.path.join(os.path.dirname(__file__), "ui")


def setup(ctx):
    ctx.ui.mount("dock-app", ["ui/dockapps-basic.js"])
    ctx.log.info("ui.dockapps-basic mounted 4 apps at dock-app (igen/web/settings/new-chat)")


def teardown(ctx):
    ctx.log.info("ui.dockapps-basic teardown")
