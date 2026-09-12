# AI 自主迭代记录 — space-shooter

## 迭代 1（2026-09-06 14:24）

**输入**：server/data/telemetry/space-shooter/20260906_142247.json
- 时长 16.5s，射击 ~40 次，仅 2 次 kill，多次 `leak`（敌人漏底），score 停在 20
- 诊断：击杀效率太低 —— 子弹慢（520）+ 射速慢 + 敌人下落偏快，导致大部分敌人漏过

**改动**（全部走 config.json 热更，不改代码，验证热更通道）：
| 参数 | 旧 | 新 | 理由 |
|---|---|---|---|
| player.fireInterval | 0.16 | 0.14 | 提升火力密度 |
| bullet.speed | 520 | 620 | 缩短命中延迟 |
| bullet.radius | 5 | 7 | 提高命中容错 |
| enemy.speed | 110 | 100 | 降低漏底率 |
| enemy.spawnInterval | 1.1 | 1.25 | 同步降低压力 |

**预期**：kill/shoot 比例显著上升，leak 事件减少，单局分数提高。
**验证方式**：重跑一轮浏览器实测采集，对比 kill/shoot、leak 次数、score。
