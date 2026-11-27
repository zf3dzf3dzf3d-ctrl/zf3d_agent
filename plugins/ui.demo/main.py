# -*- coding: utf-8 -*-
"""ui.demo：S7 前端挂载点示例。

声明挂载：slot=banner，资源 = 本插件下发的 JS（带 CSP 头，仅自执行不改 DOM 外部）。
前端经 GET /api/plugin-manager/ui-mounts 拉声明后按 slot 注入。
"""

_JS = ("(function(){var b=document.createElement('div');"
       "b.textContent='plugin-ui-demo';"
       "b.style.cssText='font-size:11px;opacity:.6;margin-left:8px';"
       "(document.querySelector('[data-slot=banner]')||document.body).appendChild(b);})();")


def setup(ctx):
    # 【2026-11-17 通道收敛】声明走 /plugins-ui/ 静态通道（相对路径含 ui/ 前缀），
    # 旧 /api/plugin-ui/demo.js 动态路由已删除，统一单通道避免双通道漂移。
    ctx.ui.mount("banner", ["ui/demo.js"])
    ctx.log.info("ui.demo mounted at banner (via /plugins-ui/)")


def teardown(ctx):
    ctx.log.info("ui.demo teardown")
