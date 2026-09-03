# py-browser-2d 使用帮助

## 一键启动

在 `engine2d` 目录运行（注意：PATH 里的 python 是 WindowsApps 占位符，必须用完整路径或 py 启动器）：

```bat
cd /d F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.0\engine2d
"C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe" server.py
```

然后浏览器打开：

| 页面 | 地址 | 说明 |
|---|---|---|
| 引擎首页 | http://localhost:8765/ | 验证 Python 服务连通 + 引擎核心自检 |
| 完整游戏 | http://localhost:8765/game/game.html | 波次/Boss、商店、冲刺、暂停、结算（内容在 private 区，仅本机可见） |
| 基准测试 | http://localhost:8765/bench.html | 精灵渲染性能压测 |
| 骨骼基准 | http://localhost:8765/bench_skeleton.html | 硬骨骼万人同屏压测 |

端口占用时可改：`python server.py --port 9000`

## 目录说明

```
engine2d/
├── server.py            # 纯标准库 HTTP 服务 + /api/assets 资产接口
├── engine.js            # 运行时核心：WebGL2 instancing 渲染 / 输入 / SoA 世界 / 自动池化
├── skeleton.js          # 硬骨骼播放器（矩阵变换，万人同屏方案）
├── index.html           # 引擎首页
├── bench*.html          # 性能基准页
├── assets/              # 骨骼 JSON 等资产
└── docs/
    ├── architecture.md  # 架构与关键决策（含 Unity 对比）
    ├── comparison.md    # vs Unity / Steam 发布路径
    ├── bench_report.md  # 基准测试数据
    └── help.md          # 本文件
```

## 操作（游戏页）

- WASD / 方向键：移动　·　空格：攻击　·　Shift：冲刺
- B：商店（波次间隙）　·　P / Esc：暂停　·　死亡后自动结算可重开

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| `python server.py` 一闪就没（退出码 9009） | PATH 指向 WindowsApps 占位符，用上方完整路径 |
| 打不开 /game/game.html | 必须通过 server.py 访问，直接双击 html 文件不行（需要 /api/assets） |
| 黑屏无渲染 | 浏览器需支持 WebGL2（Chrome/Edge 近年版本均支持） |
| 端口被占 | `--port` 换端口 |

## 下一步可扩展

- 贴图图集 + Aseprite 导入管线
- 骨骼数据上传 GPU（bone texture），进一步降低 CPU 开销
- pywebview 壳打包 → Steam 上架（见 comparison.md）
