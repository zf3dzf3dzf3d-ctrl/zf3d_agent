# AGENTS.md — 给在本仓库工作的 AI 智能体

本文件面向在本仓库里读写代码、运行命令、提交改动的 AI 智能体（Codex、Claude Code、ZCode 及项目自带的蜂群）。
只写机器已经强制或应当强制的规则。与其它文档冲突时，以“门禁脚本的实际行为”为准，其次以本文为准。

## 这是什么项目

朱峰智能体无限：Windows 本地优先的“智能体操作系统”。Python 后端（`server/`）+ 网页前端（`public/`），
内嵌解释器在 `python/`。代码绝大部分由 AI 智能体高频写入，所以**纪律必须由机器执行**，不能依赖谁记得。

| 目录 | 内容 |
|---|---|
| `server/` | 后端。顶层约 150 个模块平铺在 `sys.path` 上（`import config` 而不是 `import server.config`）；`server/routes/` 路由（注册表 + 旧 if-elif 链并存）；`server/engines/common/` 智能体内核与执行闸门 |
| `server/util_<域>.py` | 基础设施工具（约定命名，新增基础设施一律用这个前缀） |
| `tools/coding/backend/` | 智能体的工具处理器（读写文件、shell、检索…）与它们的守卫 |
| `tools/quality/`、`tools/hooks/`、`scripts/run_checks.py` | 质量门禁：反模式计数器、豁免、提交钩子第三棒、依赖锁定与审计 |
| `public/`、`public/js/` | 前端。无构建步骤，脚本按顺序经 `index.html` 静态加载，资源版本号由 `tools/quality/hash_assets.py` 维护 |
| `plugins/` | 插件（须有 `manifest.json`） |
| `tests/` | 脚本式测试：`py tests/test_xxx.py`，退出码 0 = 通过 |
| `private/`、`server/private/` | 用户的密钥、对话、记忆、日志。**不是代码，不读、不写、不入库**（shell 也不行） |

## 动手之前

- **服务通常正在运行**，且可能有其它智能体在并发改同一批文件。改之前先 `git status`，别覆盖别人的半成品。
- **很多改动要重启服务才生效。** 运行中的进程用的是启动时加载的代码；快照守护、卫生闸、热重载引擎都在这个进程里。
  改了它们依赖的规则（白名单、保护清单的代码、工具守卫），在重启前线上仍是旧行为。不要用“文件已改”当作“已生效”的证据。
- **热重载**默认关闭。本机开发环境在 `private/port.json` 里开启（`"hot_reload": true`，或环境变量 `ZF_HOT_RELOAD=1`）。
  开启时，引擎监视 `PY_MODULES` 表里的 `server/` 模块、`routes/` 下 `mixin_*` / `api_*` / `domain_*`，以及
  `tools/*/backend/` 下不以 `_` 开头的模块，落盘约 2 秒后加载。
  - **执法模块不参与热重载**：只读清单里的模块，以及智能体的文件与 shell 工具（名单见 `server/util_enforcement.py`）。改它们须重启服务。
    关键清单里的服务端模块仍可热重载——代价是它们的改动即时生效，这是开发模式的取舍。
  - **日志报“重载成功”不等于代码真的生效。** 处理器类由几十个 mixin 运行时拼装，只重载其中一个模块时，方法解析仍可能指向旧类。
    以 `GET /api/hot-reload/status` 返回的 `status.last_reload.effective` / `status.last_reload.needs_restart` 为准；
    对安全相关的改动，用真实请求核对线上行为。
- **根目录是白名单制**：快照守护每轮 `git add -A` 后，把根层白名单之外的**新文件**隔离到 `private/rollback_quarantine/`
  （看起来像“文件被神秘删除”，其实在隔离目录里，`quarantine.log` 有留痕）。新文件放 `docs/`、`tools/`、`tests/`、`tmp/`；
  确需放根目录，先登记到 `tools/coding/backend/_file_protect.py` 的 `_ROOT_OK_NAMES`，并且**重启之后**再放——
  运行中的守护用的还是旧白名单。

## 提交

- **正式提交受硬门禁**（2026-11-25 晚起 6.2.0 发布版去 git 化：主 .git 与 `.githooks/` 已移除，提交三棒门禁随仓库本体下线；质量自测入口不变：`py scripts/run_checks.py --quick`）。
  反模式指标（宽泛异常捕获、静默吞异常、`print` 当日志…）**只许降不许涨**。
  注意计数器按源码文本计数：注释里写出字面的宽泛异常捕获语句同样会被计入，注释请用中文描述。
- 处置上涨只有两条路：当场消化；或在 `tools/quality/waivers.json` 登记**带到期日**的豁免（必须写理由，到期自动失效）。
- 保护性快照由守护自动完成，不受计数器拦截，每次放行都留痕在 `private/logs/gate_exemptions.jsonl`。
- **不要绕过门禁**：`--no-verify`、`ZF_SKIP_HYGIENE_GATE=1`、`git -c zf.snapshot=1 commit`、`--soft` 都是应急通道，
  用于普通提交即为作弊。确需应急，在提交说明里写明原因。
- 提交说明写清“改了什么、为什么、怎么验收的”，一句话即可，不要写成文章。
- 提交前自测：`py scripts/run_checks.py --quick`。ruff、pytest 的配置与基线文件在只读保护清单里，
  不要在命令行里直接引用 `tools/quality/` 下的它们，统一经 `scripts/run_checks.py` 运行。

### 一切皆插件门禁（摘要）

| 规则 | 含义 |
|---|---|
| R1 | `server/` 下新增 `.py` 只允许 `util_<域>.py`、`routes/domain_*.py` 或内核白名单；业务代码走 `plugins/` |
| R2 | 代码文件不得新增对 `mixin_*` 的引用（含字符串与日志标签） |
| R3 | 不得在 `public/js/zf-app-dock.js` 里新增 `register(` |
| R4 | 不得在 `public/index.html` 净增静态 `<script src=`（约 300 个已是存量上限方向） |
| R5 / R6 | 插件不得旧轨 import；插件目录必须有合法 `manifest.json` |

## 安全红线

这些不是风格建议。每一条背后都有过真实事故或实测绕过。

1. **执法设施不随手改。** `server/util_enforcement.py` 是唯一真源：
   - 只读清单（执行闸门、审批钩子、审计链、出域检查、紧急停止、密钥库、提交钩子入口、门禁基线、本文件）智能体工具不可写。
     shell 里出现这些路径或文件名同样会被拦，包括先 `cd` 再写裸文件名的写法。
   - 关键清单（认证、请求入口、路由分发、更新链路、系统工具…）可写，但必须过校验（语法 / 体量 / 锚点 / 写后回读，失败自动回滚）。
   - **新增任何调用执法原语的模块**（`engines.common.syscall`、`egress_gate`、`path_guard`、`secure_store`、`audit_chain`、
     `bot_gateway.approve_hook` 等），必须把它登记进清单；`py tests/test_enforcement_assets.py` 会列出漏掉的。
   要改执法设施，任务里必须写明理由与验收方式。
2. **能力策略已接线（M1.3 起）**：写文件、replace、shell 工具与出域闸门会先过
   `server/util_policy.py` 的策略判定——用户规则（`private/policy/rules.json`）里 deny 的目标
   直接拒绝；ask 的目标需要人工批准票据（M1.4 审批 UI 上线前默认 allow，行为与接线前一致）。
   改 `private/policy/rules.json` 收紧规则最迟 1 秒生效；只有 egress 的接线需要重启加载。
2a. **授权与隔离类检查一律 fail-closed**（出错即拒绝）。审计、统计、埋点类可以 fail-open，但要留痕。
   不要写“检查出异常就放行”的代码。保护清单 `private/file_protection.json` 损坏时，一切写入与 shell 命令都会被拒，
   直到人工修复或删除该文件——这是设计，不要去“修”成放行。
3. **`private/` 对工具是禁区**：读工具读不了密钥库；列目录、目录树、找文件、内容检索都进不了私有目录。
   不要用 shell 绕过（`type private\…`、`findstr /s … private`）。要看模型配置走掩码接口 `GET /api/models/config`。
4. **紧急停止开关只能由人合闸。** `server/private/KILL_SWITCH` 存在即代表用户已拉闸，不要删除它，也不要替用户执行
   `kill_switch.py off`。
5. **明文密钥不进模型上下文。** 显钥接口是 `POST /api/models/reveal-key`，需要用户设置的“查看密钥密码”；
   智能体不应代替用户去调用它。
6. **新增任何“把数据带离本机”或“执行命令”的入口**，必须经过既有的闸门：出域检查（`server/egress_gate.py`）、
   执行审批（`server/engines/common/syscall.py`）、私有目录防护（`tools/coding/backend/_private_guard.py`）。
7. **新增 HTTP 端点**：写操作用 POST 并经 `routes.dispatcher` 注册表注册；不要绕过
   `_check_origin` 与 token 校验；返回给前端的内容若来自模型、网页或用户，必须经 `ZFMD`（`public/js/md-render.js`）净化，
   不要自己写正则过滤 HTML。路由注册表是后注册者覆盖先注册者，插件也能覆盖路由——改动安全相关端点时，
   同时检查 `plugins/` 下有没有它的另一份实现。
8. **依赖**：新增第三方包必须写进 `requirements.txt`（有门禁盯着未声明的 import）。
   改动后重新生成锁定：`py tools/quality/gen_lock.py`、`py tools/quality/add_lock_hashes.py`，
   并跑 `py tools/quality/dep_audit.py` 要求已知漏洞为 0。安装依赖用 `--require-hashes`。
9. **不把密钥、对话原文、个人数据写进仓库、日志、测试夹具或提交说明。**
10. **发布包要签名**：`py tools/release/sign_release.py <包目录> --key <仓库外的私钥> --version <版本>`。
    私钥永不进仓库。客户端的 `require_signature` 已开启（2026-11-24）：**没有签名的更新包装不进去**，
    发布流程漏签会直接表现为“用户更新失败”。

## 写代码

- **异常**：捕获具体异常；不写 `except Exception: pass`。吞掉异常时至少记一条日志并说明为什么可以吞。
- **日志**：用 `server/util_log.py` 的 `get_logger(__name__)`，不用 `print`（命令行工具、测试除外）。
- **类型**：新代码写类型注解；现有代码注解覆盖率极低，不要指望静态检查替你兜底。
- **前端**：新文件优先写成不依赖全局加载顺序的形式；改了 `public/js` 下被 `index.html` 引用的文件，
  运行 `py tools/quality/hash_assets.py --fix` 刷新版本号。
- **不为了满足指标而伤害代码**（例如把文件机械拆开再用 `exec` 拼回）。指标是为了让代码更好，不是反过来。

## 完成的定义

一个任务完成的证据是**验收命令的输出**，不是“我改完了”。每个任务都要能回答：
改了哪些文件、怎么验证的（贴命令与输出）、哪些没做或没验证。没验证的要明说。
需要重启才生效的，要写明“尚未重启，线上仍是旧行为”。
