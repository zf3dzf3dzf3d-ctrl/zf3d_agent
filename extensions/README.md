# extensions/ 扩展子系统

一级独立模块，与主工具（tool/）、对话模式（modes/）平级，互不污染。
每个子模块一个文件，删除即下线，主系统零改动。

## 子模块

| 模块 | 文件 | 功能 | API 前缀 |
|---|---|---|---|
| MCP | `mcp.py` | Model Context Protocol 客户端网关（HTTP/stdio，JSON-RPC 2.0），外部工具转 function calling schema | `/api/ext/mcp/*` |
| Declarative UI | `declarative_ui.py` | 声明式 UI 协议：工具响应携带 `ui` JSON，前端按声明渲染表单/卡片/表格/确认框 | `/api/ext/declarative_ui/*` |
| Skills | `skills.py` | 技能包：`skills/<id>/skill.json`（+ prompt.md），关键词触发/autoInject，提示词拼接注入 | `/api/ext/skills/*` |
| Settings | `settings.py` | 扩展子系统总开关（mcp/skills），持久化 `private/extensions/settings.json` | `/api/ext/settings` |

## 设置面板「扩展」页（阶段5）

- `public/js/ext-settings-panel.js`（独立文件）：设置面板新增 🧩 扩展 tab —— MCP / 技能包**总开关**（关掉立即对模型生效，前后端双重拦截），MCP server 列表（启停/测试）、技能列表（启停）
- 开关 API：`GET/POST /api/ext/settings {mcp:bool, skills:bool}`
- `ext-bridge.js` 启动时拉取开关：MCP 关 → 清空 mcp_ 工具注册并拒绝执行；Skills 关 → 不注入技能提示词
- `ext-manager.js` 修复：addServer/delServer/testServer 之前传 `name` 与后端期望的 `id` 不匹配（实际是坏的），已改为 `id`，并给 server 增加 启用/停用 开关

## Agent 主循环桥接（阶段4）

| 文件 | 位置 | 功能 |
|---|---|---|
| `public/js/ext-bridge.js` | 独立文件 | ① 启动时拉 `/api/ext/mcp/tools` 注册 `mcp_<server>__<name>` 工具进 ToolDefinitions；② 包装 `Tools.execute` 拦截 `mcp_` 前缀工具走 `/api/ext/mcp/call`；③ 包装 `App.sendToModel` 按用户最后输入匹配技能，把技能提示词挂 `chat._extSkillPrompt`；④ 技能面板提交按钮 → 组装表单值发起对话 |
| `public/js/ext-ui-render.js` | 独立文件 | 声明式 UI 渲染 + 技能 UI 面板（输入框实时匹配技能展示面板，`data-ext-panel="skill"`） |
| `public/js/ext-manager.js` | 独立文件 | 管理面板（右下角 🧩）：MCP server 增删测、工具列表、技能开关 |

主流程改动点（均为可摘除的注入行）：
- `public/index.html`：引入 `ext-bridge.js`（一行）
- `public/js/agent-01-project-memory.js`：`sendToModel` 组装 messages 后，若 `chat._extSkillPrompt` 存在则 splice 一条 `【技能激活】` system 消息

## 主系统挂钩点（后端）

1. `server/routes/mixin_dispatch.py` do_GET / do_POST 中：
   `path.startswith('/api/ext/')` → `extensions.dispatch(...)`

## MCP server 配置

`private/extensions/mcp_servers.json`：
```json
{"servers": {"fetch": {"type": "http", "url": "http://127.0.0.1:8931/mcp", "enabled": true}}}
```

## 联调测试

`extensions/test/run_joint_test.py`：stdio + http 双 transport 连通 / tools/list / tools/call 全部实测通过。

## Declarative UI 协议

工具响应 JSON 顶层加 `"ui": {"type": "form|cards|table|markdown|confirm", ...}`，
完整协议见 `GET /api/ext/declarative_ui/schema`。

## Skills 目录

```
extensions/skills/
├── _template/skill.json   ← 模板（复制改名即新增技能）
└── <skill_id>/skill.json  ← id 必须等于文件夹名
    （可选 prompt.md：技能提示词正文，skill.json 里 "prompt": "prompt.md" 引用）
```
