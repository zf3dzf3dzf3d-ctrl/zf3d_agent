# -*- coding: utf-8 -*-
"""ui.api-core：window.API 前端统一封装挂载（工程化整改 P1-4 · 20261123）。

声明型插件，照 ui.sysapps/ui.dockapps-basic 模式：把 public/js 层的新增前端
资源改经 ui.mount 下发（R4 收口——index.html 不再新增静态 script 标签）。
资产 ui/api.js 只做 window.API 定义（零顶层 DOM 访问），晚加载无副作用。
disable 本插件 -> API 全局消失 -> 依赖 API.* 的新代码回退裸 fetch 仍可用（渐进降级）。
"""


def setup(ctx):
    ctx.ui.mount("api-core", ["ui/api.js"])
    ctx.log.info("ui.api-core mounted window.API wrapper at api-core")


def teardown(ctx):
    ctx.log.info("ui.api-core teardown")
