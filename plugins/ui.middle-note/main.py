# -*- coding: utf-8 -*-
"""ui.middle-note：随手标题·中键双击创建（i缩小整理 + 无限画布通用）。

【2026-11-24 功能收敛 no-op】双实现撞车收敛声明：
功能已由 public/js/app-quick-note.js v7.6 统一实现（commit ad79b8a4），
其为本插件 note.js 的功能超集（额外拦中键自动滚动 preventDefault、
创建即空文本进编辑态、toast 提示）。本插件若继续挂载 note.js 会与
quick-note.js 形成 document 级双监听，一次双击创建两个标题（实测：
/api/plugin-manager/ui-mounts 返回本插件声明 + note.js 500ms 延迟创建
叠加 quick-note.js 400ms 即时创建）。

保留目录与 note.js 供参考，setup 不再挂载任何资源（no-op），
ui-mounts 声明随之消失，双监听解除。
"""
def setup(ctx):
    # 【收敛】不再挂载 note.js：功能由 app-quick-note.js v7.6 统一承载，
    # 避免 document 双监听导致一次双击创建两个随手标题。
    # 历史实现保留在 ui/note.js，仅供查阅。
    ctx.log.info("ui.middle-note: no-op（功能已收敛至 app-quick-note.js v7.6）")


def teardown(ctx):
    ctx.log.info("ui.middle-note teardown")
