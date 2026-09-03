# 知识图谱 开发日志

## 2026-09-02

- **05:15** 计划创建（lp-20260902-051533，7 步）
- **05:17** 步骤 1：kg-data.js 数据层（实体/关系/元 KV、upsert 合并、置信度、N 跳邻居、导入导出）
- **05:19** 步骤 2：kg-extract.js 文档 LLM 提取引擎（docs/ + 项目记录/，分段提取，文件级增量缓存，Mock E2E 通过）
- **05:21** 步骤 3：kg-code.js 代码静态提取（JS: window 挂载/函数/类/引用；PY: class/def/import；sig 哈希增量缓存）
- **05:21** 步骤 4：app-knowledge-graph.js 可视化（SVG 力导向，霓虹 9 色类型节点、搜索、关系类型过滤、详情面板、平移缩放）
- **05:22** 步骤 5：kg-tools-defs.js「知识图谱 🔮」分类（query_knowledge 四模式 / open_knowledge_graph / rebuild_knowledge，包裹 Tools.execute 拦截）
- **05:22** 步骤 6：kg-watch.js 增量更新（git 提交轮询 → diff 定位变更文件 → 增量重提 → 刷新视图；置信度衰减防膨胀）
- **05:23** 步骤 7：E2E 验证 6/6 通过（entity/relation/fuzzy/stats/answer-src/neighbors），修复三处 API 名称对齐（addRelation→upsertRelation、allEntities→exportAll、meta()→stats().meta）；帮助文档 + git 收尾

### 关键决策
- 可视化用自实现力导向（120~300 步收敛）而非引 d3，保持零外部依赖
- 代码结构提取走纯正则静态分析，不耗 LLM token，结果稳定可复现
- 工具执行器用「包裹原 Tools.execute」方式注册，与 canvas-tools-defs 同模式，不动现有分类
