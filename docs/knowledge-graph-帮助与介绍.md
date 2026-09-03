# 知识图谱（Knowledge Graph）帮助与介绍

> 长任务 lp-20260902-051533 · 2026-09-02 完成
> 从项目文档与代码中自动提取「概念-关系」知识网，可视化 + AI 问答 + 增量更新

## 是什么

知识图谱把项目文档（docs/、项目记录/）里的概念和代码里的结构（类/函数/模块）提取成**实体**，把它们之间的依赖/引用/同类关系提取成**连线**，形成一张可查询、可视化的知识网络。

## 核心特性（8 项）

| # | 特性 | 说明 |
|---|------|------|
| 1 | 文档知识提取 | 扫描 md 文档，分段调 LLM 抽取三元组（kg-extract.js） |
| 2 | 代码结构提取 | 静态分析 JS/PY 的类/函数/挂载/引用，不依赖 LLM（kg-code.js） |
| 3 | 可视化图谱 | 全屏力导向图，霓虹节点 + 关系连线（app-knowledge-graph.js） |
| 4 | AI 问答 | 「知识图谱 🔮」工具分类，AI 可查「XX 是什么/和 YY 什么关系」 |
| 5 | 增量更新 | 监听 git 提交，只重提变更文件，不重建不膨胀（kg-watch.js） |
| 6 | 置信度机制 | 重复出现提升置信度，30 天未更新自动衰减 |
| 7 | 独立存储 | KV：kg_entities / kg_relations / kg_meta，与现有系统零耦合 |
| 8 | 零耦合可卸载 | 6 个新文件 + index.html 挂 script，删掉即可完全卸载 |

## 使用指南

### 三步上手
1. **建库**：浏览器控制台执行 `KGExtract.run()`（文档 LLM 提取，需选好模型）+ `KGCode.run()`（代码静态提取，秒级）
2. **看图**：控制台执行 `KGView.toggle()` 打开可视化（搜索 / 按关系类型过滤 / 拖拽缩放 / 点节点看详情）
3. **问答**：对话中切换到「知识图谱 🔮」工具分类，直接问「远程控制是什么」「知识图谱和 FlowGlam 什么关系」

### 增量更新
- `KGWatch` 自动运行（每 5 分钟检查 git 提交），新提交的变更文件自动重提
- `KGWatch.status()` 查看监听状态；`KGWatch.stop()` 停止
- 也可手动 `rebuild_knowledge` 工具触发

## 相关文件清单

| 文件 | 职责 |
|------|------|
| `public/js/kg-data.js` | 数据层：实体/关系/元信息 KV 存储 |
| `public/js/kg-extract.js` | 文档 LLM 提取引擎（含文件级增量缓存） |
| `public/js/kg-code.js` | 代码静态结构提取 |
| `public/js/app-knowledge-graph.js` | 可视化力导向图 |
| `public/js/canvas/kg-tools-defs.js` | 「知识图谱 🔮」工具分类注册 |
| `public/js/kg-watch.js` | git 提交监听 + 增量更新 + 置信度衰减 |
| `public/index.html` | 仅追加 6 行 script 挂载（唯一对现有文件的改动） |

## 常见问题

- **图是空的？** 先跑 `KGExtract.run()` 和 `KGCode.run()` 建库。
- **AI 问答说找不到？** 知识库覆盖 docs/ 与项目记录/ 的文档和 public/js、server、tools 的代码；不在其中的概念查不到，可用 `rebuild_knowledge` 补充。
- **怎么清空重来？** 控制台 `KGData.clear()`，再全量 `KGExtract.run({force:true})`。
- **会拖慢系统吗？** 不会。所有模块懒加载、监听为 5 分钟一次的轻量轮询，存储走现有 KV。
