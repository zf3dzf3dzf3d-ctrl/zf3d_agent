# extensions/ 扩展生态规范 v1

> 原则：**文件夹即插件**。扩展丢进 `extensions/<id>/` 刷新即得 UI 入口/路由，
> 主程序（index.html、server 核心）永远不为单个扩展写专用代码。

## 1. 目录结构

```
extensions/<id>/
  manifest.json    必需，扩展声明（UI/能力清单）
  __init__.py      可选，提供 handle(handler, method, tail, body) 路由入口
  其他资源文件
```

## 2. manifest.json 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| id | ✅ | 扩展标识，建议与目录名一致 |
| title | ✅ | 入口提示文字 |
| icon | ✅ | 图标（emoji/字符） |
| type | ✅ | `iframe-switch`（全屏 iframe 一键开关）· `link`（新开页） |
| url | ✅ | 目标地址（http(s):// 或 / 开头站内路径） |
| iconActive | | 激活态图标（iframe-switch 用） |
| position | | 入口位置，默认 `corner`（右下角悬浮） |
| allow | | iframe allow 权限串 |
| tipIdle / tipActive | | 按钮提示文案 |
| version | | 扩展版本号（只增不改，向后兼容） |
| skills | | 技能包引用列表（复用 extensions/skills 体系） |

字段缺失或损坏时，注册表返回 `{"id":..., "error":"...", "enabled":false}` 条目，
前端灰显 + tooltip，**不静默失败**。校验错误码：
`manifest_unparsable / missing_id / missing_title / missing_icon / missing_type /
invalid_type / missing_url / invalid_url`

## 3. 后端路由

- `extensions/__init__.py::dispatch` 按 `sub == '<id>'` 分发到子模块 `handle()`；
  **新增子模块必须同步注册 `server/hot_reload.py` 的 PY_MODULES**（含级联重载），
  否则改动需重启才生效。
- `handle()` 收到的 `tail` 是 **list**（URL 路径段），自取所需段。

## 4. API 端点（/api/ext/*）

| 端点 | 说明 |
|---|---|
| GET ui_registry | 扫描全部 manifest 返回条目（含 error 条目） |
| GET/POST market | 本地扩展注册/列表/卸载（卸载移入 zf-trash，不真删） |
| settings | 启停开关（private/extensions/settings.json 的 ui.disabled 名单） |

## 5. 前端

`public/index.html` 只挂一次 `public/js/zf-ext-entries.js`（通用挂载器）。
error 条目灰显不进 corner 队列。扩展 UI 类型新增需在挂载器加渲染分支，
manifest 字段只增不改。

## 6. 已知坑（必读）

1. **路径一律绝对路径**：相对路径默认落 `server/`，历史已踩 3 次。
2. **写 private/ 记录用 project_record**，write_file 对 private/ 会被拦。
3. **外部站点 iframe 前先 `curl -I` 查 X-Frame-Options**，被拒则用 `type:"link"` 兜底。
4. 卸载/删除扩展目录一律移入 zf-trash 回收站，不真删。

## 7. 版本

规范 v1（2026-10-24）。后续只增字段不改语义，破坏性变更须升 v2 并写迁移说明。


### manifest.type 扩展位（阶段B）
| type | 行为 |
|---|---|
| iframe-switch | corner 按钮，整页 iframe 切换（dsh 模式） |
| link | corner 按钮，新标签页打开 url |
| panel | corner 按钮，右侧 420px 抽屉 iframe，x 关闭 |
| api-only | 无 UI，纯后端，走动态 API 兜底 |

### 动态 API 兜底（文件夹即插件）
扩展目录放 api.py 暴露 handle(handler, method, tail, body) 即自动挂载
/api/ext/<id>/<...>，无需注册任何代码。示例：extensions/ext-demo/。
注意：扩展 id 可含连字符（ext-demo），内部按文件路径加载（importlib.util），
不依赖包名合法。
