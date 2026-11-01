# 策划案：ZCode 集成试点（zf-agents 插件包）
版本：v1.0（覆盖此前所有口头方案，含原对话「zcode集成试点方案」调研结论）
日期：2026-10-23

## 锁定参数（已确认，不再追问）
- 零流量零费用：一切本地运行，我们不出网络/算力/大模型费用
- 引擎归对方（ZCode 的 GLM + 用户自己的 key），界面归对方，我们的画布作为本机服务仅被调用
- 定位：「可插拔器官」——给任何智能体装上无限桌面和审核大脑

## 一、任务计划
- 阶段0（前置，半天）：盘点可暴露能力，选定 3 个试点工具（画布定位 set_camera / 策划审核 / 项目记录记忆）。依赖：无
- 阶段1（1-2天）：搭建 zf-agents 插件仓库目录：plugin.json + marketplace.json + skills/ + mcp 声明。依赖：阶段0
- 阶段2（1天）：写 stdio MCP 适配层（zf_bridge.py）：接收 MCP 调用 → 转发 127.0.0.1 本地端口（5.7.0 server HTTP）。依赖：阶段1
- 阶段3（1天）：写 2-3 个 Skill prompt 文件（教 ZCode Agent 何时/如何调画布、审核、记忆）。依赖：阶段1
- 阶段4（半天）：ZCode「个人市场」本地目录导入实测：插件启用→MCP 出现→Agent 真实调用画布成功。依赖：阶段2+3
- 阶段5（半天）：发布到 GitHub 仓库（零流量：下载走用户与 GitHub），写 README demo「5行配置获得无限桌面」。依赖：阶段4 通过

## 二、实现方法
- 插件结构（依据 ZCode 官方文档已确认）：纯目录包，plugin.json 声明 skill/command/MCP server/hooks；marketplace.json 供个人市场索引；支持 userConfig（用户填端口等）
- MCP 适配层：stdio 模式由 ZCode 在用户本机拉起进程，零网络出站。zf_bridge.py 用 mcp python-sdk（pip install mcp）实现 tools/list + tools/call，内部 requests.post 到 http://127.0.0.1:<port>/ 对应路由。坑：端口需可配置（userConfig）；5.7.0 server 未运行时报错要友好提示「请先启动朱峰智能体」
- Skill prompt：纯 markdown，零运行成本。写清「何时调用 zf_canvas / zf_review / zf_memory、参数格式、返回如何呈现」
- 策划审核工具：把现有审核流程 prompt 化，输入=对方 agent 的产出文本，输出=审核报告五部分。这是方法论级差异化，优先做
- 验证方式：MCP inspector 本地测 → ZCode 个人市场导入 → 真实对话中让 ZCode 调一次画布定位，浏览器弹出即成功

## 三、愿景
- 理想形态：任何支持 MCP 的智能体（ZCode/dsh/Cursor/Cline…）加 5 行配置，即获得「无限画布 + 策划审核 + 项目记忆」三器官；用户在别人家聊天，屏幕是我们挂的
- 扩展方向：① 工具数量从 3 → 10（能力进化树、蜂群调度、站点记忆）；② 同一套 zf_bridge 复用到 dsh/workbuddy 等其他 harness（MCP 通用，一次封装多平台吃）；③ 双发布惯例：新能力默认同时出面板版 + MCP 版

## 四、风险与备选
- 风险1：ZCode 插件格式文档与实际字段有出入 → 备选：先用 Claude Code 兼容市场格式（文档称已预置兼容），或退化为纯 MCP servers 配置（不打包插件，README 给 mcpServers JSON 片段）
- 风险2：我们的 server 路由无鉴权，暴露到 MCP 后任何本机进程可调 → 备选：bridge 限定白名单工具 + 只读操作先行，写操作加确认
- 风险3：用户没装 Python 环境 → 备选：bridge 用我们包内自带解释器，或发 PyPI 用 uvx 一键拉起
- 风险4：审核 skill 与 ZCode 内置行为冲突 → 备选：skill 命名空间化（zf- 前缀），默认不强制触发

## 五、推荐度评分（权重：影响0.40+低成本0.25+低风险0.20+亮点0.15）
【推荐度】策划审核 MCP 工具（zf_review） 89/100（影响95·低成本90·低风险85·亮点80）｜档位A
【推荐度】画布定位 MCP 工具（zf_canvas） 86/100（影响90·低成本85·低风险85·亮点80）｜档位A
【推荐度】项目记忆 MCP 工具（zf_memory） 78/100（影响75·低成本90·低风险80·亮点60）｜档位A
【推荐度】插件包包装（plugin.json+个人市场发布） 74/100（影响70·低成本80·低风险60·亮点75）｜档位B
【推荐度】纯 mcpServers JSON 片段发布（无插件壳） 80/100（影响75·低成本95·低风险90·亮点50）｜档位A
（注：纯 JSON 片段与插件壳二选一起步，建议先纯 JSON 后再包插件壳）

## 反驳项
反1：质疑 ZCode 文档字段与实际不符导致插件加载失败 → 应对：阶段4 本地目录实测前置暴露问题，兜底方案是纯 mcpServers JSON（不依赖插件格式）
反2：质疑暴露本机无鉴权接口有安全风险 → 应对：bridge 白名单 3 个工具、只读先行、端口可配，不做通用代理
反3：质疑试点无人用/白做 → 应对：试点成本仅 3-4 天且 zf_bridge 可复用到所有 MCP 智能体，非一次性投入
