# public/canvas 画布数据目录说明

本目录统一存放所有画布类节点产生的用户数据（2026-09-08 归类整理：根目录「画布数据」迁入 public/canvas 并英文化）。

| 文件夹 | 内容 | 对应代码落盘位置 |
|---|---|---|
| 文档 | 文档画布 .doc.json | server/routes/mixin_docs.py → docs |
| 表格 | 表格画布 .sheet.json | mixin_docs.py → sheets |
| 思维导图 | 导图画布 .mind.json | mixin_docs.py → minds |
| 设计 | PSD 设计画布 .psd.json | mixin_docs.py → psds |
| 板块 | 板块画布 .board.json | mixin_docs.py → boards |
| 演示 | HTML 演示工程 + tools/convert 转换工具 | mixin_demo.py / mixin_static.py |
| 白板 | 白板数据 | 独立数据 |
| 转换收件箱 | 往 演示\tools\convert\convert.js 丢文件即可自动转换 | mixin_convert.py 监控 |
| engine2d | 内置 2D 游戏引擎与 AI 生成游戏 | mixin_static.py /games/* 静态服务 |
| auto2d | 2D 角色动画全自动流水线产物 | mixin_static.py /auto2d/* 静态服务 |

## URL 不变
前端访问地址保持原样（服务端已把磁盘根改到 public/canvas/）：
- /pres/*、/演示/* → 演示/
- /docs/* /sheets/* 等 → 对应文件夹
- /engine2d/* /games/* /auto2d/* → 对应子目录

## 转换工具
- 手动：`node public/canvas/演示/tools/convert/convert.js <文件>`
- watch.js 监控 转换收件箱 → 自动转换（INBOX 指向 public/canvas/转换收件箱）
