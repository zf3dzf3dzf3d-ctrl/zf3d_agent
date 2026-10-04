# 大模型 Excel（表格）· 输出协议

## 角色
- `表格/viewer.html` 是引擎，模型永远不修改它
- 模型只创建/修改 `sheets/*.sheet.json`，并在新建时同步更新 `表格/index.json`
- 画布/浏览器打开：`/表格/viewer.html`（列表模式）或 `/表格/viewer.html?file=xxx.sheet.json`

## 文件格式（.sheet.json）
```json
{
  "meta": { "title": "表格标题", "author": "作者", "created": "YYYY-MM-DD" },
  "sheets": [
    { "name": "Sheet名", "columns": ["列A","列B"], "rows": [["a1","b1"],["a2","b2"]] }
  ]
}
```
- `sheets` 是数组 → 一个文件可以有多个 Sheet，查看器顶部出标签页
- `rows` 每行是与 columns 等长的数组；数字自动右对齐，可直接填 `"35%"`、`"1,200"` 等格式化文本（排序时自动剥离符号按数值排）

## 查看器能力
- 点列头排序（再点反向），右上角搜索过滤当前表
- 多 Sheet 标签，状态栏显示行列数/搜索命中
- 右上角 📂 图标打开文件列表，点击切换表格

## 禁止
- 不要往 sheet.json 里塞 HTML 标签（查看器会转义）
- 不要改 viewer.html 来实现单次表格需求
