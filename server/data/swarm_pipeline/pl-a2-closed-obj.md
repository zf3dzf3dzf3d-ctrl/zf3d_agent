# 蜂群流水线报告 pl-a2-closed-obj

目标：为「server/routes/mixin_jobs.py 的 /api/jobs/submit 接口」设计一套任务超时自动回收方案（纯方案调查，不写代码，不修改任何文件）
目录：F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0
耗时：12935.1s

## 结论头

【结果】任务： ｜ 结果：未知 ｜ 一句话简介：

## 收口裁决

# 收口判定：jobs 任务超时自动回收方案

## 一、方案对比与采纳判定

本次仅收到 **策划案1**（无跨窗竞品），故对比在其内部四个候选方案与 P0/P1/P2 分期结构之间进行：

| 方案 | 内容 | 判定 | 理由 |
|---|---|---|---|
| A 看门狗+天然心跳（P0） | `_JOBS_LIVE` 登记 + reaper 扫描 + agent_turns 心跳 + 终态守卫 | ✅ **采纳** | 唯一能堵死「永久 running/queued」主洞的方案；零改内核、只动 2 文件、无强杀风险，评估 92/S 档成立 |
| B 协作取消接线（P1） | dispatch_swarm cancel 通道接 job 级 | ⏸ **条件采纳（缓启动）** | 方向正确但需动 swarm_pipeline 内核；采纳其「实际出现僵尸占槽才启动」的触发式策略，不进本轮施工 |
| C 子进程隔离硬杀 | 改线程为进程便于 kill | ❌ **不采纳** | 架构级重写（submit→daemon 线程模型全换），成本 3 分/风险 4 分的评分属实，收益不成比例 |
| D 固定墙钟超时 | 到时即杀 | ❌ **不采纳** | 与 swarm_pipeline L293/L305「无限重试直到成功」的施工语义直接冲突，会系统性误杀长任务，30/C 档判定成立 |
| P2 timeout 独立状态 | 前端徽标+一键重跑 | ⏸ **条件采纳（缓启动）** | P0 用 failed+`[超时回收]` 前缀已零成本达成可识别性，P2 待 P0 验收后再升级 |

**分期结构采纳**：P0 立即施工，P1/P2 带明确触发条件挂起。

## 二、被采纳方案反驳项逐条回应

策划案1 含【反驳项】小节且已采纳，逐条回应如下：

**反1（agent_turns 是旁路心跳，大改造整段不落库会误杀）— 成立，纳入改动要点。**
- 心跳取 `max(agent_turns 最新 created_at, jobs.updated_at)` 双源，单看任一源都会漏；
- 阈值 30min = 单请求强收线（`_RUN_TIMEOUT=5min`）的 3 倍余量，与既有保护层级对齐；
- error 字段强制写入判定依据（job_id、最后心跳时间戳、判定阈值），保证误杀可复核、可重跑。

**反2（只翻状态不杀线程=假回收，僵尸可占满 4 槽）— 成立，纳入改动要点。**
- P0 阶段接受「线程占槽至自然退出」为已知限制，但必须配三道缓解，全部列入清单：① worker 收尾条件更新防止状态互相覆盖；② queued>2h 告警日志（信号量饿死的可见性）；③ P1 取消通道的接线点在 reaper 代码中预留（超时分支先判取消写入器是否可用），触发条件=生产出现僵尸占槽，届时启动 P1。

**反3（终态守卫可能吞掉迟到真完成）— 部分成立，缓解措施纳入。**
- 迟到完成需满足「30min 无任何落库心跳后又瞬间完成」，概率低；report 全量在 agent_turns 可回看，业务零损失成立；
- 但为可追溯性，强化一点：worker 收尾发现已被守卫翻态时，除 log 外须输出 report 落点摘要（session_id/最后 turn id），人工可据此恢复结论，无需重跑。

## 三、最终执行清单

**只改 2 个文件，不动 swarm_pipeline.py、不动前端、不动部署层。**

### 1. `server/routes/mixin_jobs.py`
- 新增模块级 `_JOBS_LIVE{job_id: Thread}` 存活登记：submit/worker 启动时登记，worker finally 退出时注销；
- 新增 reaper 看门狗：懒启动（首次 submit 触发）、daemon 线程、60s 扫描间隔、单例锁防重复启动；
- reaper 判定逻辑（按序）：
  1. **终态守卫**：done/failed/await_review 一律跳过；
  2. **重启孤儿**：queued/running 但不在 `_JOBS_LIVE` → 直接翻 failed 收尸；
  3. **无进展超时**：running 且 `now - max(get_last_turn_ts(session_id), updated_at) > 30min` → 翻 failed，error=`'[超时回收] 无进展超30min，最后心跳=<ts>'`；
  4. **绝对兜底**：任何非终态超 24h → 翻 failed；
  5. **排队告警**：queued > 2h → 仅打告警日志，不翻态；
- worker 收尾改为**条件更新**：先查当前状态，已终态则不覆盖，只打 log 并输出 report 摘要；
- 阈值（30/120/1440 分钟）读现有 cfg 机制，允许覆盖，写死默认值。

### 2. `db.py`
- 新增只读查询 `get_last_turn_ts(session_id)`：返回 `max(created_at) WHERE session_id FROM agent_turns`，供 reaper 心跳读数，只读不写。

### 3. 预留（不施工）
- P1：reaper 超时分支预留「调 dispatch_swarm 取消写入器」的接缝注释，触发条件=实际出现僵尸占满信号量槽；
- P2：error 前缀 `[超时回收]` 的解析规则保持稳定，为将来升级独立 timeout 状态留口。

## 四、验收口径（照抄策划案1，三项全过才收工）

1. 人为卡死任务 30 分钟内被标 failed 且 error 带 `[超时回收]` 及心跳证据；
2. 重启后遗留的假 running/queued 行被 reaper 直接收尸；
3. 正常长流水线（含无限重试段）连续运行零误伤。

【反驳项】（反驳师红队意见，需逐条回应/核验）
▶ 反驳报告1：
## 最终结论

**总体判定：整体架构成立，但原审查中“最严重发现”需要降级修正——子任务取消机制其实存在，缺的最多是 HTTP 路由接线，而非底层能力。**

### 逐条裁定

| # | 原发现 | 裁定 | 依据 |
|---|--------|------|------|
| 1 | MixinJobs 未挂载/端点是死代码 | **撤回** | HandlerRoutes L61/L102 已确认注册，端点真实在线 |
| 2 | `_JOBS_LIVE` 进程内 dict 在多进程部署下失效 | **撤回** | 服务为单进程多线程模型（ThreadingHTTPServer），进程内 dict + 锁 + TTL 清理成立 |
| 3 | mixin 停止操作无法真正停止 worker，**取消通道不存在** | **修正（核心修正）** | 取消原语已存在：`dispatch_swarm_seg1.py` L692–712 有完整协作式取消链路——`_CANCELLED` 集合（带锁）、`cancel_subtask(batch_id, task_id)`、`is_cancelled()`，且 `_Heartbeat.tick()` 在 worker 侧主动轮询，命中后把状态写 `'cancelled'` 回持久化批次文件。**worker 侧是可被停的** |
| 4 | Turn 级取消缺失 | **不成立** | `chat_pool.py` L526 `cancel(box_id, turn_id)` → `cancel_evt` 全链路完整，含排队期取消（L623）、非流式阻塞读取后的意图服从（L635–637）、AIMD 不毒化、断点登记清理 |

### 修正后的真实风险面

原报告的最高危项从“取消机制缺失”降级为：

- **待确认项（唯一残留）**：`cancel_subtask` 是否有 HTTP 路由暴露（即 mixin 的 stop 是否接线到它）。我在路由表中检索未见匹配，但最后一次全局搜索命中了 20 条结果上限，**不能排除截断**。修正确认只需一条命令：在 HandlerRoutes 所在文件 grep `cancel`。
- 若确实未接线，修复也极小（路由 → `cancel_subtask` 一行委托），因为 worker 侧心跳轮询、状态落盘、幂等性全部现成。

### 一句话总结

系统没有“停不下来”的架构缺陷：swarm 子任务有 `_Heartbeat` 协作式取消，Turn 有 `cancel_evt` 全路径取消，两者均为进程内单例、与部署模型匹配。剩余工作只是核实并补上 stop 路由到 `cancel_subtask` 的接线，属小时级修复，非结构性问题。

## 审核结论


