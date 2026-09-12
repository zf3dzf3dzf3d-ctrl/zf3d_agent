# 大模型 Word（文档）· 输出协议

## 角色
- `文档/viewer.html` 是引擎，模型永远不修改它
- 模型只创建/修改 `docs/*.doc.json`，并在新建时同步更新 `文档/index.json`
- 画布/浏览器打开：`/文档/viewer.html`（列表模式）或 `/文档/viewer.html?file=xxx.doc.json`

## 文件格式（.doc.json）
```json
{
  "meta": { "title": "文档标题", "author": "作者", "created": "YYYY-MM-DD" },
  "blocks": [ ...内容块数组... ]
}
```

## 内容块类型（blocks）
1. 段落：`{ "type": "p", "text": "一段话" }`（省略 type 也按段落处理）
2. 章标题：`{ "type": "h2", "text": "章节名" }` —— 自动进左侧目录
3. 节标题：`{ "type": "h3", "text": "小节名" }`
4. 引用：`{ "type": "quote", "text": "金句/引用" }`
5. 无序列表：`{ "type": "ul", "items": ["a", "b"] }`
6. 有序列表：`{ "type": "ol", "items": ["a", "b"] }`
7. 表格：`{ "type": "table", "columns": ["列A","列B"], "rows": [["a","b"]] }`
8. 图片：`{ "type": "img", "src": "url或data-uri", "alt": "说明" }`
9. 代码块：`{ "type": "code", "text": "代码" }`
10. 分隔线：`{ "type": "hr" }`

## 查看器能力
- 左侧目录（点击跳转、滚动定位）、A+/A- 字号调节、右上角 📂 文件列表切换

## 禁止
- 不要往 doc.json 里塞 HTML 标签（查看器会转义）
- 不要改 viewer.html 来实现单次文档需求
