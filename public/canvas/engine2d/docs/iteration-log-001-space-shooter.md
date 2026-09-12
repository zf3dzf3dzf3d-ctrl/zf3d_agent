# AI 自主迭代记录 #1 — space-shooter

**日期**: 2026-09-06 14:20 ~ 14:28
**方式**: 采集真实玩法数据 → 分析诊断 → 代码/参数改动 → 重新采集验证

## 改动前数据（server/data/telemetry/space-shooter/20260906_142553.json 等）
- score = 0，kill = 0（自动玩家 100+ 次射击全空）
- 诊断1: 自动玩家不移动，子弹从固定位置发射，敌人 x 错开 → 0 命中
- 诊断2: kill 事件发生但 Telemetry.data.score 仍为 0 → score 只在 gameOver 时写入，快照数据失真
- 附带发现: 碰撞回调 onEnter 签名错误（引擎只传对方实体 1 参，game.js 误写 (self,hit) 两参 → 一碰就崩 TypeError: reading 'tag'）

## 改动
1. `game.js` 碰撞回调修复：`(self, hit) => hit.tag===...` → `(hit) => hit instanceof Enemy && ...`
2. `game.js` kill 处实时回写 `Telemetry.data.score / max_progress`（数据快照失真修复）
3. `config.json` 热更调参：bullet.radius 3→5、player.fireInterval 0.22→0.16
4. `collect_telemetry.py` 自动玩家升级：正弦摆动 → 跟踪最近敌人 x 坐标瞄准

## 改动后验证（20260906_142759.json）
- 局1: score=120（12 kills），局2: score=110（11 kills），115 events，0 JS 错误
- verify_games.py 全游戏 ALL PASS

## 结论
迭代闭环（数据→诊断→改动→验证）首次完整跑通，指标从 0 → 120，可复制到其他游戏。
