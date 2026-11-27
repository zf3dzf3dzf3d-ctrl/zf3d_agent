# script.json Schema v1（i剧本杀 · 手写本数据结构）

> 配套校验器：server/script_engine/script_solver.py（CLI：python script_solver.py <book.json>）
> 设计原则：程序保骨架，文案任意长；Solver 可判定的字段必有且互斥。

## 顶层
```json
{
  "id": "str, 必填, 全局唯一（如 night_train）",
  "title": "str, 必填",
  "player_count": [min, max],
  "intro": "str, 开场白（主持人念）",
  "background": "str, 背景故事全文（所有玩家可见）",
  "scenes": [{"id":"str","name":"str","desc":"str","spots":["线索点位id..."]}],
  "characters": [...],
  "clues": [...],
  "timeline": [...],
  "tasks": [...],
  "win_conditions": {...}
}
```

## characters[]
| 字段 | 类型 | 说明 |
|---|---|---|
| id | str | 唯一，如 victim/chen |
| name | str | 公开显示名 |
| is_victim | bool | 恰好 1 个 true |
| is_murderer | bool | 恰好 1 个 true（非受害者） |
| persona | str | 公开人设（自我介绍用） |
| secret | str | 隐藏剧本（仅本人+主持人可见；凶手含作案手法） |
| prewritten | [str] | 降级预写台词（LLM 断网时轮换用，≥2 条） |
| knowledge | [str] | 该角色"知道"的事实 id 列表（防泄底裁剪的粒度单位） |

## clues[]
| 字段 | 类型 | 说明 |
|---|---|---|
| id | str | 唯一，如 clue_blood |
| spot | str | 所在点位 id |
| name/desc | str | 展示文案 |
| owner | str \| null | 归属限制：null=公开线索；角色id=只有该角色能看 |
| implies | [str] | 本线索支持的**事实链节点 id**（指向 timeline 事实，≥1 条） |

## timeline[]（真时间线，复盘 + 推理链原子）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | str | 事实 id，如 f_bought_poison |
| t | str | 时间标记（展示用，如 "20:15"） |
| who | str | 角色 id（"unknown" 允许） |
| what | str | 事实描述 |
| hidden | bool | true=只有复盘可见（如作案细节），不影响推理链 |
| is_key | bool | true=构成"指认凶手必需事实" |

## tasks[]
每角色 ≥1 条：{id, char, desc, check: {type:"know_clue", clue:"clue_id"} 或 {type:"survive"}，分值}

## win_conditions
{murderer_win: "str 条件文案", town_win: "str", vote_target: "str 凶手角色id 的程序判定字段直接取 characters[].is_murderer"}
> 投票判凶为程序确定性判定：得票最多且 ≥半数 → 投中；平票或不过半 → 凶手逃脱。低质量胜利（投中但任务链不完整）按 v2.2 第十一节记 0.5 分统计。

## Solver 判定规则（可解性门禁，CLI 退出码 0=过）
1. 结构完整性：必填字段、id 唯一、恰好 1 victim + 1 murderer、每角色 prewritten≥2、tasks 每角色≥1。
2. 线索引用完整：每个 clue.implies 指向存在的 timeline.id；每个 spot 属于某 scene。
3. 推凶可达性（核心）：从"公开线索 + 全体角色 knowledge 并集"出发，BFS 遍历事实依赖图（fact deps），**必须能推导出 murderer 的 is_key 事实链**——即：每条 is_key 事实，要么有 clue.implies 直接覆盖，要么其依赖的 facts 全部可达。
4. 凶手不可自查脱罪：凶手自己的 secret 不得包含能证明"自己无罪"的声明（文本规则，Solver 只查字段存在）。
5. 时间线自洽：timeline 按 t 可排序、id 唯一。
