# 数据库分离化改造指南（2026-11-12，v2 收口版）

## 现状
原 `private/db/zf3d_canvas.db` 一个大库 22 张表，已按域拆成 5 个分库：

| 分库文件 | 域 | 表 |
|---|---|---|
| zf3d_chat.db | 对话 | sessions, chat_history, chat_history_archive, agent_turns |
| zf3d_apps.db | i桌面应用 | app_data, kv_store, settings, app_logs, jobs, task_stats, trash_items |
| zf3d_roles.db | 角色画布 | canvas_nodes, canvas_view |
| zf3d_projects.db | 项目 | projects |
| zf3d_system.db | 系统 | token_usage, capability, capability_link, emergence_event, health_state, health_events, health_daily |

## 代码改动（v2 收口，2026-11-12）
- `server/config.py`：5 个库路径 + `DB_ATTACH_MAP`（别名→路径）+ `TABLE_DB_MAP`（表→路径）+ `TABLE_ALIAS_MAP`（表→别名）；`DB_PATH`/`DB_CHAT_PATH` 指向 chat 库
- `server/db.py`：
  - `_attach_and_proxy()`：每条新连接 ATTACH 全部分库。**ATTACH 失败硬失败 raise**（不再静默降级——静默会双写漂移）
  - `_sweep_misplaced_tables()`：**启动清扫**。init_db 成功后自动执行：把 chat 库中残留的非 chat 域表搬回对应分库（目标库已有则 INSERT OR IGNORE 合并增量），搬完 DROP。此后裸表名解析（temp→main→attached）直达分库
  - `_new_split_conn()`：主连接=chat 库 + ATTACH 分库
  - 已删除死代码 `_attach_split_dbs`（原 VIEW 方案，从未被调用；且实测 SQLite view 不可写，该方案作废）
- 路由原理：SQLite 裸表名按 temp→main→attached 顺序解析。只要 main（chat.db）无非 chat 域表（由启动清扫保证），业务 SQL 零改动且物理落对库

## 修复方式（v2 起，比 v1 大幅简化）
❌ 不再需要手动跑 repair 脚本重建（v1 方案会丢 08:48 后写入 chat.db 的增量）
✅ **只需重启 server.py**：启动时 `init_db()` → `_sweep_misplaced_tables()` 自动把 13 张错位表（app_logs 4182 行、token_usage 455 行等）搬回归位，chat 域 4 表不动，数据零丢失
- 验证：重启后跑 `python server/_check_dbs.py`，各分库表归属应全部 ✓
- 兜底：sweep 前自动备份？——迁移脚本与 v1 repair 已留备份（private/backups/split_migration_*、pre_repair3_*），真实库重启前建议再手工 copy 一份 chat.db

## 注意
- agent_chat_watch.py / backfill_growth.py 等独立脚本直连 `config.DB_PATH`（=chat 库），只操作 chat 域表，无需修改
- capability_tree 工具连旧大库 `zf3d_canvas.db` 的 capability 三表 → 待办：改连 zf3d_system.db 后旧大库归档 .bak
- 全局 _db_lock 仍保护写事务（跨 5 库一把锁），锁粒度未细分——后续优化方向
- 不要在 db.py 里用 TEMP VIEW 代理分库表：实测 `cannot modify ... because it is a view`，view 不可写
