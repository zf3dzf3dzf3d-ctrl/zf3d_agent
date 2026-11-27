# -*- coding: utf-8 -*-
"""插件脚手架 main.py —— 复制 _template 后改这里。

PFD 八步（策划案 v4 §3.1）：立卡 → 判型命名 → 脚手架(本步) → 只用 ctx API 实现
→ 自验四件套 → 门禁 → 提交 → 文档。

铁律（策划案 v4 §3.2）：
- 只准 import kernel / config / 标准库；禁 import db / engines / routes.mixin_*
- 插件间协作只走 ctx.event 总线与 provides 解析，禁插件间 import
- enable 时 setup(ctx) 一次性执行；disable/reload 时 teardown(ctx) 必须把
  线程/订阅/临时文件清干净（拔测四件套会验）
"""


def setup(ctx):
    """启用钩子：manifest.capabilities 决定 ctx 上哪些面板可用，越界抛 PermissionError。"""

    # -- 工具注册（capability: tool.register）——注册后进入 kernel.tools，AI 引擎可消费
    # ctx.tool.register({
    #     "name": "template_hello",
    #     "description": "脚手架示例工具",
    #     "parameters": {"type": "object", "properties": {}},
    #     "exec": lambda params: {"ok": True, "hello": ctx.config.get("greeting")},
    # })

    # -- 路由注册（capability: http.route）——路径建议带插件前缀防冲突
    # @ctx.route.post("/api/template/hello")
    # def _hello(handler, path, query):
    #     ctx.log.info("hello called")

    # -- 前端挂载（capability: ui.mount）——assets 相对本插件目录，经 /plugins-ui/<目录>/ 下发
    # ctx.ui.mount("dock-app", ["ui/myapp.js"])

    # -- 定时任务（capability: schedule）——disable 时随插件注销
    # ctx.schedule_every(60, lambda: ctx.log.info("tick"), name="template-tick")

    # -- 事件协作（禁插件间 import 的正道）
    # ctx.event.on("some.event", lambda data: None)
    # ctx.event.emit("template.ready", {"plugin": ctx.id})

    # -- 沙箱存储（自动限定本插件命名空间 server/data/plugin_store/<id>.json）
    # ctx.store.set("boot_count", (ctx.store.get("boot_count", 0) or 0) + 1)

    ctx.log.info("scaffold setup ok（本行来自 _template，正式插件请删）")


def teardown(ctx):
    """停用钩子：把 setup 里启动的一切收干净，保证拔测 disable→enable 往返无损。"""
    ctx.log.info("scaffold teardown")
