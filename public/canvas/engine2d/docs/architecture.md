# 智能体内嵌 2D 游戏引擎架构（Python + 浏览器）

## 目标
在仅有 Python（无 Node）的智能体环境中，搭一个 2D 游戏引擎原型：
- 渲染跑在浏览器（WebGL，GPU 加速）
- 游戏逻辑/资产处理跑在 Python 侧
- 架构极简：数据驱动 + 自动池化，避免之前 Unity fight 项目"每组件手写对象池+事件系统"的混乱

## 职责划分

```
┌─────────────── Python 侧（开发期工具 + 逻辑服务）───────────────┐
│ server.py   标准 http.server，无第三方依赖                        │
│  ├─ 静态文件：index.html / engine.js / bench.html               │
│  ├─ /api/assets  返回资产清单（贴图/骨骼 JSON）                   │
│  ├─ /api/state   游戏逻辑状态（可选：服务器权威模式）              │
│  └─ 资产管线：把 PNG/Aseprite/骨骼数据编译成打包 JSON             │
└──────────────────────────────────────────────────────────────┘
                    │  HTTP (JSON)  开发期用
                    ▼
┌─────────────── 浏览器侧（运行时引擎，纯静态 JS）───────────────┐
│ engine.js                                                      │
│  ├─ Renderer   WebGL2 instancing 批量精灵渲染（一次 draw call） │
│  ├─ Skeleton   硬骨骼播放器：矩阵变换，骨骼数据可选上传 GPU      │
│  ├─ Input      键盘/鼠标，直接浏览器事件，不需要 Python 参与     │
│  ├─ World      数据驱动实体表（SoA 数组结构，天然适合池化）      │
│  └─ Pool       自动池化：实体死了不 delete，标记回收重用          │
└──────────────────────────────────────────────────────────────┘
```

## 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 渲染 API | WebGL2 + instancing | 万精灵/万人骨骼一个 draw call；浏览器原生，无依赖 |
| 通信 | 开发期 HTTP JSON；运行期逻辑全在浏览器 | 避免每帧走网络，性能和 Unity 单进程一致 |
| Python 角色 | 资产管线 + 逻辑校验/热更数据源 + 服务器（将来多人） | Python 慢但只做开发期和低频逻辑 |
| 对象池 | 自动（SoA + 代际回收） | 不再像 Unity 项目每个组件手写池 |
| 事件系统 | 直接函数调用/数组遍历，不做总线 | 之前事件系统是混乱源头之一，砍掉 |
| 骨骼 | 硬骨骼 JSON（参考 fight 新系统_v2），CPU 算矩阵或 bone texture | 硬骨骼是万人同屏的既有优势，保留 |

## 数据流
1. Python 资产管线：贴图 → 图集 JSON；骨骼 → skeleton.json
2. 浏览器启动时 GET /api/assets 拉清单 → 拉图集和骨骼
3. 每帧：Input → World.update (逻辑，纯 JS 数组操作) → Renderer.render (一次 instanced draw)
4. 可选：Python /api/state 下发热更数值表（伤害、关卡配置）

## Steam 发布路径（结论预告，详见 comparison.md）
不需要 Node：Python 起 WebView2 壳（pywebview）或打包为本地服务 + 浏览器内核壳即可上架 Steam。
