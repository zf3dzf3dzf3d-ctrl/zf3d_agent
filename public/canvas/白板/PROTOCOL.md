{
  "meta": { "title": "白板格式协议 .board.json", "author": "朱峰智能体", "created": "2026-09-07" },
  "blocks": [
    { "type": "p", "text": "白板（对标 Miro / draw.io）由白板/viewer.html 渲染。模型只创建/修改 boards/*.board.json，新建时同步更新 白板/index.json。打开方式：/白板/viewer.html 或 ?file=xxx.board.json" },
    { "type": "h2", "text": "文件格式" },
    { "type": "code", "text": "{\n  \"meta\": { \"title\": \"白板标题\" },\n  \"nodes\": [\n    { \"id\": \"n1\", \"x\": 120, \"y\": 80, \"w\": 180, \"h\": 64,\n      \"text\": \"节点文字\", \"shape\": \"rect|round|diamond|ellipse\",\n      \"color\": \"#4da3ff\" },\n    ...\n  ],\n  \"edges\": [\n    { \"from\": \"n1\", \"to\": \"n2\", \"label\": \"是\", \"dash\": false },\n    ...\n  ]\n}" },
    { "type": "h2", "text": "节点字段" },
    { "type": "ul", "items": [
      "id：唯一标识，连线用",
      "x,y：画布坐标（画布可无限拖拽平移）",
      "w,h：尺寸，缺省 180×64",
      "shape：rect 方形 / round 圆角 / diamond 菱形（判断）/ ellipse 椭圆",
      "color：边框与文字强调色，缺省 #4da3ff",
      "text：节点内容，支持 \\n 换行"
    ]},
    { "type": "h2", "text": "连线字段" },
    { "type": "ul", "items": [
      "from,to：节点 id",
      "label：连线上的文字（可选）",
      "dash：true 虚线（可选）"
    ]},
    { "type": "h2", "text": "查看器操作" },
    { "type": "ul", "items": [
      "拖空白处平移画布；拖节点移动节点（位置实时保存到服务器）",
      "滚轮缩放；右上角 ➕ 新建节点；✏️ 编辑 JSON；🖨 打印导出 PDF；📂 文件列表"
    ]},
    { "type": "p", "text": "禁止：不要往 JSON 里塞 HTML；不要改 viewer.html 实现单次需求。" }
  ]
}
