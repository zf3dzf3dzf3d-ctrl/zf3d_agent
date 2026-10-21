# 大模型思维导图 · 输出协议

## 角色
- `思维导图/viewer.html` 是引擎，模型永远不修改它
- 模型只创建/修改 `maps/*.mind.json`，并在新建时同步更新 `思维导图/index.json`
- 画布/浏览器打开：`/思维导图/viewer.html`（默认第一篇）或 `/思维导图/viewer.html?file=xxx.mind.json`

## 文件格式（.mind.json）
```json
{
  "meta": { "title": "导图标题", "author": "作者", "created": "YYYY-MM-DD" },
  "root": {
    "text": "中心主题",
    "color": "#4da3ff",
    "children": [
      { "text": "分支1", "children": [ { "text": "子节点" } ] },
      { "text": "分支2" }
    ]
  }
}
```
- `root` 递归嵌套：每个节点必有 `text`，可选 `color`（十六进制色）、`children`（子节点数组）
- 不写 color 时查看器按调色板自动配色

## 查看器能力
- 经典思维导图横向布局、连接线自动跟随
- 点任意分支节点折叠/展开（+ / −）
- 右下角 ＋/－/▢ 缩放（▢ 自动适应窗口）
- 🖨 打印导出 PDF、📂 文件列表切换

## 禁止
- 不要往 mind.json 里塞 HTML 标签（查看器会转义）
- 不要改 viewer.html 来实现单次导图需求
