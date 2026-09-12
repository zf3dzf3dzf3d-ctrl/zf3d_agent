# 演示工作台 · 设计方案 v1（2026-09-06）

## 一、结论：不造传统编辑器，造「协商工作台」
传统拖拽编辑器是给人手工制作用的；我们的定位是**人和大模型商量演示稿的界面**。
调研结论：GitHub 上的现成项目（lectern / Slides-AI / deckware 等）都围绕 reveal.js 或自家格式，与我们
`.pres.json + viewer.html` 协议不匹配，且引入依赖会破坏"单文件即开即用"原则。**采用自研，借鉴其交互思路**
（lectern 的"AI 生成 + 人工微调"、deckware 的"轻量文本即文档"）。

## 二、双态数据模型（核心设计）
每个 .pres.json 增加两个协商层字段（向后兼容，viewer 忽略它们）：
```
{
  "meta": {...},
  "outline": [            // 协商态 1：大纲卡（先商量再生成）
    { "page": 1, "type": "cover", "idea": "标题+副标题方向", "status": "approved|pending|rejected" },
    { "page": 2, "type": "chart", "idea": "用柱状图展示增长", "status": "pending" }
  ],
  "animations": {          // 协商态 2：动画参数表（后商量动态）
    "3:bar-0": { "enter": "fade", "delay": 0.2, "note": "用户要求从下往上" }
  },
  "slides": [...]          // 成品（现状不变）
}
```

## 三、界面：工作台 workbench.html（画布 iframe 节点，与 viewer 同款形态）
三栏布局（1280×720 画布内自适应）：
- 左栏：大纲卡片流 —— 每页一张卡（类型/一句话构想/状态徽标）
  按钮：✅通过 / ✏️改（弹出输入框，改 idea）/ ❌去掉 / ➕插入页
- 中栏：成品预览 —— 直接 iframe 嵌 viewer 的单页渲染
- 右栏：协商对话框 —— 底部输入框，选中某页/某元素时自动带上下文
  （例：选中柱状图输入"改成从下往上长"，模型返回新 animations 参数，预览实时刷新）

## 四、协作流程（两段式协商）
1. 页面协商：模型先只写 outline → 用户逐卡通过 → 全部 approved 后模型按大纲生成 slides
2. 动态协商：成品出来后，用户点选元素 → 对话改动画/布局 → 模型局部更新 → 秒级预览
（改大纲/参数比整页重生成省 token 一个数量级）

## 五、服务端（server 侧，编码已踩坑：URL 中文路径需 decodeURIComponent）
- GET  /api/demo/outline?file=xx     读大纲
- POST /api/demo/outline             写大纲（用户操作卡片时）
- POST /api/demo/talk                协商消息转发给大模型（带当前 outline/slides 上下文）
- GET  /api/demo/page?file=xx&n=3    单页渲染数据（中栏预览用）

## 六、实施步骤
1. workbench.html 骨架 + 三栏布局 + 大纲卡片交互（纯前端，读 index.json）
2. 服务端 4 个 API（注意百分号编码 decode）
3. 大模型协商协议：新增 WORKBENCH.md（模型如何读写 outline/animations）
4. 动态预览联动 + 动画参数编辑器
5. 注册到画布节点（与网页浏览器/游戏面板同款入口）

## 七、验收标准
- 从画布打开工作台 → 新建演示 → 大纲协商 → 生成 → 改动画，全程不出画布
- 旧 .pres.json（无新字段）打开不报错，兼容
