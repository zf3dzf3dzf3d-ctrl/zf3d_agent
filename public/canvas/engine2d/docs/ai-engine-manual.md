# AI 游戏引擎使用手册 v0.1

面向 AI（智能体自主开发）与人类开发者。

## 一、目录结构
```
engine2d/
├── server.py            # 本地服务（python server.py，端口 8512）
├── core.js              # Entity/EntityManager/Scene/CollisionSystem/Config 等
├── input.js             # 键盘/鼠标输入（绑 window，iframe 可用）
├── engine.js / physics.js / pathfinding.js / ...  # 各子系统
├── docs/
│   ├── ai-generation-spec.md   # AI 生成接口规范（生成游戏前必读）
│   └── iteration-log-*.md      # AI 自主迭代记录
└── games/<游戏名>/       # 每个游戏一个目录
    ├── index.html       # 页面（加载 input.js/core.js + 自身脚本）
    ├── game.js          # 游戏逻辑（生成物主体）
    ├── config.json      # 数值配置（支持 2 秒热更，迭代优先改这里）
    └── telemetry.js     # 玩法埋点（可选）
```

## 二、生成一个新游戏（AI 流程）
1. 读 `docs/ai-generation-spec.md`，按 games/ 目录约定建目录；
2. 写 game.js：用 `Input / EntityManager / CollisionSystem / Config` 全局类；
   - 注意 API 签名：`CollisionSystem.add(entity, shape, {tag, onEnter})`，
     **onEnter 只回传对方实体一个参数**（onEnter(hit)）；
3. 数值全部走 `cfg.get("player.speed", 默认值)`，写进 config.json；
4. 加 Telemetry 埋点：shoot/kill/hurt/leak 事件 + begin/end 生命周期。

## 三、验证（一条命令）
```
python server/verify_games.py            # 验证全部游戏
python server/verify_games.py super-mario # 验证单个
```
检查项：文件存在 / node --check 语法 / HTTP 200 / 无 JS 运行错误 / canvas 持续渲染。
全部 PASS 输出 `== RESULT: ALL PASS`，退出码 0。

## 四、玩法数据采集（自动玩家）
```
python server/collect_telemetry.py <游戏名> [局数] [每局秒数]
```
无头浏览器自动玩（跟踪瞄准 + 射击），Telemetry 快照落盘
`server/data/telemetry/<游戏名>/<时间戳>.json`。

## 五、自主迭代循环
1. `collect_telemetry.py` 采集 → 读 JSON：score/kills/leaks/时长；
2. 分析瓶颈（打不中？死太快？卡关？）；
3. 改动优先级：**config.json 热更参数 > game.js 逻辑 > 引擎层**；
4. 重采集对比指标 → `verify_games.py` 确认无回归；
5. 写迭代记录 `docs/iteration-log-XXX-<游戏>.md`（改前数据→改动→改后数据）。

## 六、已知坑（AI 生成时必看）
- 碰撞回调签名：onEnter(hit)，hit 是对方 Entity，不是碰撞条目；
- 字符串里的中文经某些通道会乱码吞引号 → HUD 文案建议用英文或写完必跑 verify；
- 实体池复用：spawn 复用死亡实体，reset 时用 `em.list.length = 0` 清场；
- wasPressed 是"本帧刚按下"，持续按住用 isDown。
