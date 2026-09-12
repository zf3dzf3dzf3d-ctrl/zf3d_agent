# 对话模式插件开发手册

> 朱峰社区智能体无限 5.x · 对话模式插件化规范 v1.0
> 适用版本：5.0.2 及以后

---

## 1. 设计目标

每个"对话模式"是一个**完全独立的文件夹**（插件），主系统通过统一加载器发现并注册它们。做到：

- **可插拔**：`enabled: false` 或删除文件夹 = 模式整体下线，主系统零改动
- **可扩展**：新增对话模式 = 复制 `_template` 改 manifest，不动任何主系统代码
- **强隔离**：提示词、工具、数据、文件访问权限互相隔离

---

## 2. 目录结构

```
modes/
├── README.md            ← 本手册
├── _template/           ← 插件模板（新开发从这里复制）
│   ├── manifest.json    ← 插件声明（唯一必改的注册文件）
│   ├── prompt.md        ← 系统提示词
│   ├── backend/         ← Python 工具实现（可选）
│   ├── frontend/        ← 前端工具描述/面板脚本（可选）
│   └── db/              ← 该模式独立 SQLite（运行时自动创建，不入库）
│
├── chat_direct/         ← 内置模式1（直接聊天，逐步迁移）
├── chat_tools/          ← 内置模式2（工具循环）
└── config_agent/        ← 插件模式：模型配置管家（首个独立插件示例）
```

**命名规则**：文件夹名 = 插件 id（小写字母/数字/下划线），以 `_` 开头的目录（如 `_template`）不参与注册。

---

## 3. manifest.json 规范（核心）

```json
{
  "id": "config_agent",
  "name": "模型配置管家",
  "icon": "⚙️",
  "description": "一句话描述该模式做什么",
  "version": "1.0.0",
  "enabled": true,

  "prompt": "prompt.md",

  "tools": {
    "backend": ["read_models.py", "write_models.py"],
    "frontend": ["read_models.js"]
  },

  "fileAccess": ["public/config/models.json"],

  "db": "db/config_agent.db",

  "limits": {
    "max_tools_in_request": 500,
    "request_timeout_seconds": 1800
  },

  "entry": {
    "panel": "frontend/panel.js"
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 插件唯一标识，等于文件夹名，前后端引用都用它 |
| `name` | ✅ | 模式显示名（UI 上展示） |
| `icon` | — | emoji 图标 |
| `enabled` | ✅ | `true` 注册 / `false` 下线（不加载、不显示、不注册路由） |
| `prompt` | — | 系统提示词文件（相对插件目录）；缺省则不注入系统提示词 |
| `tools.backend` | — | 后端工具脚本白名单；这些脚本会作为"工具结果出口"的可用处理器 |
| `tools.frontend` | — | 前端工具定义文件白名单 |
| `fileAccess` | — | 该模式工具允许读写的文件白名单（相对项目根），越界即拒绝 |
| `db` | — | 该模式独立 SQLite 路径（相对插件目录），声明即自动初始化 |
| `limits` | — | 覆盖 `chat_mode_rules` 的请求限制，缺省用全局规则 |
| `entry.panel` | — | 前端对话面板脚本（相对插件目录） |

**强制规则**：`fileAccess` 是安全边界，工具代码不得绕过它访问白名单外的文件。

---

## 4. 加载机制（主系统侧，一次写好）

### 4.1 后端 `server/mode_loader.py`

- 启动时扫描 `modes/*/manifest.json`（跳过 `_` 开头目录）
- 校验：`id` 与文件夹名一致；JSON 可解析；缺 `id/name/enabled` 视为无效插件并打日志跳过
- 提供接口：
  - `load_modes()` → `{mode_id: manifest}`（仅 enabled）
  - `get_manifest(mode_id)`
  - `get_prompt(mode_id)` → 读取并拼接 prompt 文件（带 mtime 缓存，改文件即生效）
  - `check_file_access(mode_id, path)` → 白名单校验
- **热更新**：manifest 的 mtime 变化时自动重新扫描，无需重启

### 4.2 路由接入 `handler_routes.py`

- `_load_loop_mode_system()` 改为优先查 `mode_loader.get_prompt(mode_id)`，查不到再回落旧的 `prompts/模式X` 目录（保证旧模式兼容）
- `_handle_proxy` 中：`loop_mode` 对应插件存在时，用插件的 `limits` 覆盖限制规则
- 新增 `GET /api/modes` → 返回所有 enabled 插件的 `{id, name, icon, description}`，前端动态渲染模式选择

### 4.3 前端 `public/js/mode_panel_loader.js`

- 启动时 fetch `/api/modes`，把插件模式追加进模式切换 UI（放在内置模式后面）
- 切到插件模式时：按 manifest 加载 `entry.panel`（动态 `<script>`，重复加载去重），面板自管自己的 UI
- 会话消息依旧走现有 `db.js` 链路，只是 `_loop_mode` 带插件 id

---

## 5. 隔离规则（强制）

| 维度 | 规则 |
|---|---|
| 提示词 | 只注入插件自己的 `prompt` 文件；不继承其他模式提示词 |
| 工具 | 只注册 manifest 里列的工具；加载器不加载其他插件的工具文件 |
| 文件 | 工具对文件的读写必须过 `mode_loader.check_file_access()`，白名单外一律 403 |
| 数据 | 每个插件独立 db 文件；禁止跨插件 join / 直接读别人的 db |
| 配置 | 插件自己的配置放插件目录内（如 `config.json`），不放 `private/` 全局区 |

---

## 6. 新增一个对话模式的步骤（开发者视角）

1. 复制 `modes/_template/` → `modes/你的模式id/`
2. 改 `manifest.json`：`id`（=文件夹名）、`name`、`icon`、`fileAccess`
3. 写 `prompt.md`：定义该模式的角色、行为、工具使用规则
4. 需要后端工具 → 在 `backend/` 写 Python 脚本，文件名登记进 `tools.backend`
5. 需要前端面板 → 写 `frontend/panel.js`，登记进 `entry.panel`
6. `enabled: true`，保存 → mode_loader 自动发现，刷新页面即可用
7. 下线：`enabled: false` 或直接删文件夹

**零主系统改动**，这就是可插拔的意义。

---

## 7. 版本与兼容

- 本规范为 v1.0；manifest 顶层加 `"spec": 1` 可选，未来规范不兼容时用 spec 区分
- 旧模式（模式1/模式2）保留 `prompts/` 目录走回落逻辑，迁移期两者并存
- 迁移完成的内置模式建议也转为插件目录（`chat_direct/`、`chat_tools/`）

---

## 8. 变更记录

| 日期 | 内容 |
|---|---|
| 2026-08-28 | v1.0 初版：目录规范、manifest、加载机制、隔离规则、开发步骤 |
