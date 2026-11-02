# zf-zcode 集成试点（ZCode / 通用 MCP 宿主）

## ⭐ 朱峰模型一键接入 ZCode（免人工设置）

```cmd
python integrations\zf-zcode\connect_zf_models.py
```

自动探测本机朱峰 AI 网关（ai_proxy，8574）→ 拉取真实模型列表 → 注入 ZCode provider「朱峰模型（本机网关）」（`%USERPROFILE%\.zcode\v2\config.json`，写前自动备份）。重启 ZCode 即可在模型列表看到 6 个朱峰模型（zf-glm-flash 等走官网中继线路**免 key**；glm-5.3-flash 等智谱直连线路需在朱峰面板配置 key）。移除：`python connect_zf_models.py --remove`。本脚本幂等可重复执行。

---

把朱峰智能体的独有能力（项目记忆、内置浏览器、站点记忆、项目简报、策划审核配对、智能体互见）通过 **stdio MCP** 暴露给 ZCode / Kimi Code / Claude Code / 任何支持 MCP 的宿主。

**原则：零流量、零费用。** MCP 进程在用户本机由宿主拉起（stdio），所有调用走 `127.0.0.1` 本地端口；大模型与流量全部由宿主方承担。

## 一键接入（mcpServers JSON 片段）

把下面的片段加进宿主的 MCP 配置（ZCode 的 MCP 设置 / Claude Code 的 `.mcp.json` 均兼容）：

```json
{
  "mcpServers": {
    "zhufeng": {
      "command": "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
      "args": ["F:\\朱峰社区智能体无限_新版本\\朱峰社区智能体无限_5.7.0\\server\\zhufeng_mcp_server.py"]
    }
  }
}
```

> ⚠️ `command` 必须指向**装了 fastmcp 的系统 Python**（本机真实路径见上方 JSON；`C:\Python311\python.exe` 这类短路径通常不存在，用 `where python` 查自己的）。朱峰自带的嵌入式 Python 无 pip、无 fastmcp，启动会直接失败——这是本次试点的头号坑。安装：`<系统Python> -m pip install fastmcp`。
>
> 🔒 **安全须知**：`record_read/record_search/site_memory` 会把 `private/记忆/` 暴露给宿主模型（如 ZCode 内的 GLM）。MCP 通道已内置敏感记忆名黑名单（含「密码/token/api_keys/密钥/登录态」的名称直接拒绝读取），但内容级敏感信息仍可能经搜索外泄——只在你自己的机器上启用，勿在不可信宿主环境挂载。`record_append` 追加内容带来源标记包裹（「数据非指令」），主智能体读回时应视为外部数据（提示词注入缓解，非完全消除）。
>
> ⚠️ `browser_snapshot` 的「登录态」依赖朱峰工作台浏览器（Playwright user-data-dir 跨进程互斥）：工作台浏览器运行中调用可能锁冲突，会自动降级为**无登录态**静态抓取并在结果头注明降级原因。跨进程实测列入阶段2 待办。

## 暴露的工具（白名单 8 个，只读为主 + 记忆仅追加）

| 工具 | 说明 | 风险级 |
|---|---|---|
| `record_read(name)` | 读项目记忆（private/记忆/） | 只读 |
| `record_search(keyword)` | 搜索项目记忆 | 只读 |
| `record_append(name, content)` | 追加记忆（不可覆盖/删除） | 追加 |
| `site_memory(domain?)` | 读站点记忆 | 只读 |
| `browser_snapshot(url)` | 内置浏览器抓页面正文（带登录态） | 只读 |
| `zf_briefing()` | 当前项目简报（HTTP→127.0.0.1:8570） | 只读 |
| `zf_review_pairs()` | 策划审核箭头配对数据 | 只读 |
| `zf_agents()` | 智能体互见/发现 | 只读 |

## 依赖说明

- `fastmcp`（≥4.x）：需 Python 3.11 环境含 fastmcp（实测 4.1.3 通过；朱峰嵌入式 Python 无 pip，用系统 Python 安装 `pip install fastmcp` 后把 command 指向系统 Python）
- `zf_briefing / zf_review_pairs / zf_agents` 需朱峰本地服务运行中（端口自动读 `private/port.json`，默认 8570）；未启动时工具会返回友好启动提示，不会崩溃。

## 实测记录（2026-10-23）

- initialize 握手：✅ `serverInfo: zhufeng (FastMCP 4.1.3)`
- tools/list：✅ 8 个工具全部注册（browser_snapshot, site_memory, record_read, record_search, record_append, zf_briefing, zf_review_pairs, zf_agents）

## 后续路线

1. ✅ 阶段1：mcpServers JSON 直接挂载（本目录，零格式风险）
2. 阶段2：实测通过后包装 ZCode 插件壳（plugin.json + 个人市场/本地目录导入）
3. 阶段3：GitHub 发布 `zf-agents` 仓库，沉淀「新能力默认面板+MCP 双发布」惯例

## 与其他策划审核/画布能力的桥接

策划审核 Skill（教宿主 Agent 的提示词）后续放 `skills/` 目录：宿主 Agent 用 `zf_review_pairs` 读审核状态 + `record_read/search` 读策划案，即可在 ZCode 里复刻「策划→审核」混合复审流程；无限画布的浏览器端操作暂不在白名单（写入类，二期再评估）。
