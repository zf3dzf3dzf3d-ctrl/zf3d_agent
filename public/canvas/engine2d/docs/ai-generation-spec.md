# AI 游戏生成接口规范 v0.1

> 目标：AI 只凭自然语言指令，按本规范生成可直接在 engine2d 上运行的游戏。
> 规则：本规范可随时增改（AI 多轮维护），每次修改记入文末变更日志。

## 1. 目录约定

```
engine2d/
├── games/                  # 所有 AI 生成游戏
│   └── <游戏名>/           # 小写-短横线命名，如 space-shooter/
│       ├── index.html      # 游戏入口（必须自包含 UI 与说明）
│       ├── game.js         # 游戏逻辑（唯一主逻辑文件）
│       ├── config.json     # 数值配置（AI 可热改）
│       └── telemetry.js    # 埋点采集（见第 4 节，必须有）
```

- 服务端无需改动：server.py 直接静态服务 games/ 目录。
- 入口地址：`http://localhost:8765/games/<游戏名>/index.html`

## 2. 可调用 API 清单（覆盖引擎核心系统）

| 系统 | 文件 | 主要类/接口 |
|---|---|---|
| 渲染 | engine.js | `Renderer`（WebGL2 instancing 批量精灵、一次 draw call）、`Fps` |
| 实体/场景 | core.js | `Entity`、`EntityManager`（SoA+自动池化）、`Scene`/`SceneManager`、`Save`、`UIManager`/`Button`/`HPBar`/`Panel`、`CollisionSystem`、`CameraEx`、`Config` |
| 物理 | physics.js | `Collider`、`RigidBody`、`World`、`DistanceJoint`、`Ragdoll` |
| 寻路 | pathfinding.js | `FlowField`（流场寻路） |
| 粒子 | particles.js | `Particle`、`ParticleEmitter` |
| 相机 | camera.js | `Camera`（跟随/震动） |
| 输入 | input.js | `Input`（键盘/鼠标） |
| 音频 | audio.js / audio-pro.js | `AudioSys` |
| 骨骼 | skeleton.js | `SkeletonPlayer`（硬骨骼 JSON） |
| 光照 | lighting.js | `Lighting` |
| 数值热更 | config/game-config.json | 改文件后游戏内 2 秒生效 |

## 3. game.js 生成约定

1. 必须暴露全局生命周期函数（供 index.html 引导调用）：
   - `gameInit(canvas)` — 初始化实体/场景/UI/输入
   - `gameUpdate(dt)` — 每帧逻辑（输入→更新→碰撞→相机）
   - `gameRender(r)` — 渲染
   - `gameTelemetry()` — 返回本局埋点 JSON（见第 4 节）
2. 禁止依赖 Node/npm；纯浏览器 JS + `<script>` 引引擎文件。
3. 所有可调数值放 config.json，game.js 启动时 fetch 读取，禁止硬编码关键数值。
4. 必须"开箱能玩"：入口页即游戏，含操作说明，死亡/胜利可重开。

## 4. telemetry.js 埋点规范（步骤 5 迭代数据的基础）

每局游戏结束（或每 30 秒）输出/POST 一次 JSON：

```json
{
  "game": "space-shooter",
  "session": "<随机ID>",
  "duration_sec": 0,
  "score": 0,
  "deaths": 0,
  "max_progress": "wave-3",
  "events": [ { "t": 12.3, "type": "death", "pos": [x,y], "cause": "enemy" } ]
}
```

- 默认 `console.log("[telemetry]", json)` 并 `localStorage` 累积（最近 20 局），验证脚本可读取。
- 可选 POST 到 `/api/telemetry`（server.py 预留）。

## 5. 验证约定（对应步骤 4）

- 一条命令验证：`python verify_game.py <游戏名>`（Python 起服务 + 浏览器/JS 语法检查 + 控制台无错 + telemetry 可取）。
- 验收线：页面无 JS 报错、能进入游戏循环（FPS>0）、telemetry 输出有效 JSON。

## 变更日志

- 2026-09-06 v0.1 初版：目录约定 / API 清单 / 生命周期函数 / 埋点 / 验证约定。
