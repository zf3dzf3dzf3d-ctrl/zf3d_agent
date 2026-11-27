#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""util_enforcement.py - 执法设施清单（唯一真源，只放清单与纯函数）

“执法设施” = 约束智能体的那套东西本身：执行闸门、审批钩子、审计链、认证、提交钩子、
门禁脚本及其基线。它们若能被智能体随手改写，其余一切约束都只是建议。对标产品正是把这一层
钉死的：Codex 把 .git 与 .codex 设为只读，Claude Code 把 .claude 设置与 .git 钩子列为写禁止，
ZCode 干脆不执行项目级钩子。

本模块零 I/O、零依赖，可被任意一方按路径加载。消费方：
  - tools/coding/backend/_file_protect.py   写保护清单（ensure_enforcement）
  - server/hot_reload.py                    执法模块不参与热重载
  - tests/test_enforcement_assets.py        不变量测试
  - AGENTS.md

路径一律为“项目根相对路径 + 正斜杠”。

两级保护：
  readonly  智能体工具完全不可写（shell 改写同样硬拦）。这些文件的修改从来不应是例行操作，
            要改须由人解除保护（见 _file_protect.remove 的 force 参数）。
  critical  可改，但必须过多重校验（语法 / 体量 / 锚点 / 写后回读，失败自动回滚）。
            这些文件同时是活跃开发对象，校验只拦“写坏”，不拦“写对”。

清单怎么划（可被 tests/test_enforcement_assets.py 机械复核）：
  1. 执法原语本身（闸门、审计链、密钥库…）与其判定模块 → 只读；
  2. 调用执法原语的模块 → 至少关键级（ENFORCEMENT_PRIMITIVES）。调用方若被改写——删掉一次
     check_permission、一次出域检查——原语再坚固也白搭。确有理由暂不纳入的写在
     DEFERRED_CONSUMERS 里并写明原因，不许悄悄漏掉；
  3. 需要被智能体在命令行里执行的脚本（门禁、启动脚本、自测）→ 关键级，不能只读。
"""

# ---- 只读：执法核心 ----
# 只读的判定是“命令里出现该路径（或切目录后的裸文件名）即拦”，所以只放智能体不需要在命令行里引用的东西。
ENFORCEMENT_READONLY = (
    # 提交三棒钩子链入口（2026-11-25 重建接线；2026-11-25 晚：6.2.0 发布版去 git 化，.githooks 已随主 .git 一并移除，条目下线）
    # 执行闸门与审批
    'server/engines/common/syscall.py',
    'server/engines/common/tool_base.py',
    'server/bot_gateway/approve_hook.py',
    # 紧急停止：判定它的模块只读。开关的合闸（off）必须由人来做
    'server/kill_switch.py',
    # 认证之外的授权与隔离检查
    'server/egress_gate.py',
    'server/audit_chain.py',
    'server/path_guard.py',
    'server/secure_store.py',
    'server/browser_guard.py',
    'server/util_http_safety.py',
    'server/util_key_reveal.py',
    'server/util_key_reveal_dialog.py',
    'server/util_release_verify.py',
    'server/util_enforcement.py',
    'server/security_baseline.py',
    'tools/coding/backend/_egress.py',
    'tools/coding/backend/_file_protect.py',
    'tools/coding/backend/_pathguard.py',
    'tools/coding/backend/_private_guard.py',
    # 提交钩子入口，以及门禁的基线数据（基线一改，棘轮就形同虚设；跑 ruff/pytest 走 scripts/run_checks.py）
    'tools/quality/baseline.json',
    'tools/quality/f821_baseline.json',
    'tools/quality/ruff.toml',
    'tools/quality/pytest.ini',
    # 给智能体的规约：智能体不应能改写约束自己的规则
    'agents.md',
    'claude.md',
    'security.md',
)

# ---- 只读的“开关文件”：存在与否本身就是状态，平时不存在，按路径保护 ----
# 紧急停止开关是一个文件（server/private/KILL_SWITCH）。智能体的文件工具本来就进不了私有目录，
# 这里补的是 shell：直接 del 掉它等于替用户合闸。
ENFORCEMENT_READONLY_FLAGS = (
    'server/private/KILL_SWITCH',
)

# ---- 关键：执法相邻且处于活跃开发，或需要被智能体执行 ----
ENFORCEMENT_CRITICAL = (
    # 请求入口与路由
    'server/server.py',
    'server/security.py',
    'server/config.py',
    'server/db.py',
    'server/handler_base.py',
    'server/routes/dispatcher.py',
    'server/routes/api_dispatch_get.py',
    'server/routes/api_dispatch_post.py',
    'server/routes/api_dispatch_post_extra.py',
    'server/routes/api_dispatch_delete.py',
    'server/routes/mixin_static.py',
    'server/routes/mixin_hotreload.py',
    # 能力策略引擎（M1.1）与审批票据（M1.2）：各能力闸门 M1.3 起逐类接线
    'server/util_policy.py',
    'server/util_ticket.py',
    'server/routes/domain_policy.py',
    # M1.6 自保护 ACL：给沙箱进程的执法文件 OS 级写保护（授权缺席 + RX-only）
    'server/util_acl.py',
    # M1.5 不可信内容标记：登记簿是策略升级（allow→ask）的依据
    'server/util_untrusted.py',
    'server/util_key_scrub.py',
    # M1.0 沙箱验证的 ACL 布置工具：改写执法文件的 ACL，本身就是执法相邻设施
    'tools/sandbox/apply_acl.py',
    # 密钥、显钥与密钥体检
    'server/model_config.py',
    'server/key_audit.py',
    'server/routes/domain_key_reveal.py',
    # 重新认证链路（应用锁的设/改/拆确认）：确认框模块与应用锁路由。路由文件在热重载
    # 监视内，若无保护，改盘即生效——等于可以随手拆掉“须本机确认”这道闸（2026-11-24）
    'server/routes/mixin_comics.py',
    'server/util_desktop_confirm.py',
    # 出域路径：模型代理、流式代理、内置浏览器同域代理
    'server/routes/mixin_proxy.py',
    'server/routes/mixin_proxy_stream.py',
    'server/routes/mixin_webproxy.py',
    'server/engines/common/shell_exec.py',
    # 执行审批的调用方：系统工具集与应用工厂
    'server/engines/common/sys_input.py',
    'server/engines/common/sys_control.py',
    'server/engines/common/sys_tools.py',
    'server/engines/common/sys_factory.py',
    'server/engines/common/sys_hotkey.py',
    'server/engines/common/sys_macro.py',
    'server/engines/common/sys_ui.py',
    'server/engines/common/sys_upgrade.py',
    'server/engines/common/iapp_tools.py',
    'server/engines/common/parallel_exec.py',
    'server/bot_gateway/dispatcher.py',
    'server/tools/device_hub.py',
    'tools/video_gen_engine.py',
    # 守护、自检与热重载引擎本身
    'server/applock.py',
    'server/supervisor.py',
    'server/sentinel.py',
    'server/fs_sentinel.py',
    'server/self_check.py',
    'server/selftest.py',
    'server/hot_reload.py',
    # 更新链路与发布签名
    'server/update_checker.py',
    'server/updater.py',
    'tools/release/sign_release.py',
    'tools/release/keygen.py',
    # 智能体的文件与 shell 工具
    'tools/coding/backend/run.py',
    'tools/coding/backend/read.py',
    'tools/coding/backend/write.py',
    'tools/coding/backend/replace_text.py',
    'tools/coding/backend/move_file.py',
    'tools/coding/backend/undo_changes.py',
    'tools/coding/backend/search_in_files.py',
    'tools/coding/backend/regex_search.py',
    'tools/coding/backend/list_dir.py',
    'tools/coding/backend/tree_dir.py',
    'tools/coding/backend/find_files.py',
    # 门禁脚本与启动脚本：要能被执行，所以不能只读；写入必须过校验
    'tools/hygiene_gate.py',
    'tools/hygiene_check.py',
    'tools/hooks/pre_commit_gate.py',
    'scripts/check_plugin_only.py',
    'scripts/run_checks.py',
    'tools/quality/count_antipatterns.py',
    'tools/quality/check_capabilities.py',
    'tools/quality/waivers.json',
    '.start_web_agent.bat',
    '.启动朱峰智能体.bat',
    'requirements.txt',
    'server/requirements.lock',
    'server/requirements.win.lock',
)

# ---- 暂不纳入清单的调用方（必须写原因；清单见上）----
DEFERRED_CONSUMERS = (
    ('server/brain/main_brain.py',
     '主脑编排模块，处于活跃重构期。纳入会使其写入触发体量校验；风险是其中一次 '
     'path_guard.guard_run_code 调用可被删掉。待重构稳定后评估。'),
    ('server/dispatch_swarm.py',
     '蜂群派发模块，处于活跃重构期且依赖热重载迭代。风险同上（guard_run_code）。待重构稳定后评估。'),
)

# ---- 执法原语：谁调用它们，谁就是执法设施的一部分 ----
# 模块名按 import 语句里的写法匹配（server/ 平铺在 sys.path 上，所以是裸模块名）。
ENFORCEMENT_PRIMITIVES = (
    'engines.common.syscall',
    'bot_gateway.approve_hook',
    'egress_gate',
    'path_guard',
    'secure_store',
    'audit_chain',
    'util_key_reveal',
    'util_release_verify',
    'util_enforcement',
    '_private_guard',
)
ENFORCEMENT_PRIMITIVE_FUNCS = ('is_blocked_system_path',)

# ---- 不参与热重载的模块（写在盘上不会在 2 秒后被运行中的服务自动加载，须重启）----
# 只读清单里的 server/ 模块，加上自带守卫、又会被热重载盯上的工具模块——它们的守卫逻辑改盘即生效，
# 等于智能体可以随手给自己松绑；排除之后，改动必须经过一次重启（更重、更可见的动作）。
# 关键清单里的服务端模块保持热重载：那是开发期迭代最频繁的一批文件。代价是它们的改动即时生效，
# 这是开发模式的已知取舍——正式环境默认关闭热重载（见 server/hot_reload.hot_reload_enabled）。
# 以 `_` 开头的工具模块（_file_protect 等）热重载引擎本来就不监视。
HOT_RELOAD_EXCLUDED_TOOL_MODULES = (
    'tools.coding.backend.run',
    'tools.coding.backend.read',
    'tools.coding.backend.write',
    'tools.coding.backend.replace_text',
    'tools.coding.backend.move_file',
    'tools.coding.backend.undo_changes',
    'tools.coding.backend.search_in_files',
    'tools.coding.backend.regex_search',
    'tools.coding.backend.list_dir',
    'tools.coding.backend.tree_dir',
    'tools.coding.backend.find_files',
)


def module_name_of(rel_path):
    """项目根相对路径 → Python 模块名；不是 .py 或不在已知包布局下返回 None。

    server/x.py                      -> x                 （server/ 平铺在 sys.path 上）
    server/engines/common/syscall.py -> engines.common.syscall
    server/routes/dispatcher.py      -> routes.dispatcher
    tools/coding/backend/run.py      -> None              （工具模块另行显式列出）
    """
    p = str(rel_path or '').replace('\\', '/').strip('/')
    if not p.endswith('.py') or not p.startswith('server/'):
        return None
    parts = p[:-3].split('/')
    return '.'.join(parts[1:])


def hot_reload_excluded_modules():
    """不参与热重载的模块名集合（frozenset）。"""
    names = set(HOT_RELOAD_EXCLUDED_TOOL_MODULES)
    for path in ENFORCEMENT_READONLY:
        name = module_name_of(path)
        if name:
            names.add(name)
    return frozenset(names)


def filter_enforcement(py_modules):
    """从“文件 → 模块名”监听表中剔除执法模块，返回 (保留表, 被剔除的 [(文件, 模块名)])。

    py_modules 不被修改。纯函数，供 hot_reload 调用，也便于测试。"""
    excluded = hot_reload_excluded_modules()
    kept, removed = {}, []
    for fn, mod in py_modules.items():
        if mod in excluded:
            removed.append((fn, mod))
        else:
            kept[fn] = mod
    return kept, removed
