# HTML 演示格式 · 大模型输出协议

## 角色
- `viewer.html` 是引擎，模型永远不修改它
- 模型只创建/修改 `slides/*.pres.json`，并在新建时同步更新 `index.json`

## 文件格式（.pres.json）
```json
{
  "meta": { "title": "演示标题", "author": "作者", "created": "YYYY-MM-DD" },
  "slides": [ ...页对象数组... ]
}
```

## 页对象类型
1. 封面页：`{ "type": "cover", "title": "...", "subtitle": "..." }`
2. 列表页：`{ "title": "...", "bullets": ["...", "..."] }`
3. 文本页：`{ "title": "...", "text": "一段话" }`
4. 自由画布页：`{ "type": "scene", "title": "...", "bg": "...", "elements": [ ... ] }`
   元素对象：`{ "type": "text|shape|image", "x": px, "y": px, "w": px, "h": px, ... }`
   - 定位/尺寸：x/y/w/h（1280×720 画布像素坐标，可超出但超出部分被裁剪）
   - 变换：`rotate`（度）、`scale`（倍数）、`opacity`（0~1）
   - 入场动画：`"enter": "fade|up|down|left|right|zoom|pop|spin"` + `"delay": 秒`
   - 循环动画：`"loop": "float|pulse|spin|blink"`
   - text 专用：`text、color、size、bold、align、font、line、shadow`
   - shape 专用：`color、radius、border、shadow`
   - image 专用：`src`（任意 url 或 data-uri，SVG data-uri 可离线内嵌）、`fit`（contain/cover）

5. 大数字页（KPI 展示）：`{ "type": "stats", "title": "...", "stats": [{"value":"99%", "label":"满意率"}, ...] }`
   - value 可含 HTML small 标签（仅允许 <small>），如 `"1200<small>万</small>"`
6. 图表页：`{ "type": "chart", "title": "...", "chart": { "kind": "bar|line|donut", "data": [{"value":数字, "label":"...", "color":"#hex可选"}, ...] } }`
   - bar=柱状图（依次生长动画）、line=折线图（描线动画）、donut=环形占比图
   - 也可简写 `{ "type":"chart", "kind":"bar", "data":[...] }`
   - ⚠️ 写图表页前务必先读 `CHARTS.md`（动画细节 + 选型/数据量创作建议）
7. 时间轴页：`{ "type": "timeline", "title": "...", "timeline": [{"time":"2024", "title":"阶段名", "desc":"说明"}, ...] }`
   - time 可省略，只写 title/desc
8. 引用页（金句）：`{ "type": "quote", "quote": "金句内容", "author": "署名", "title": "可选小标题" }`
9. 图文分栏页：`{ "type": "split", "title": "...", "img": "url或data-uri", "bullets": [...] 或 "text": "..." }`
10. 表格页：`{ "type": "table", "title": "...", "table": { "head": ["列1","列2"], "rows": [["a","b"], ...] } }`

通用可选字段：`accent`（主题色，如 "#e05555"）、`bg`（CSS 背景）、`footer`（页脚小字）。

## 修改规则
- 用户要求改第 N 页 → 只改 slides[N-1]，其余原样保留
- 用户要求"换个风格" → 只改 accent/bg，不动文字内容
- 新建演示稿 → 文件写到 `slides/`（文件名小写英文 + `.pres.json`），并在 `index.json` 追加 `{ "title": "中文名", "file": "文件名" }`

## 禁止
- 不要往 pres 里塞 HTML 标签（查看器会转义，安全第一）
- 不要改 viewer.html 来实现单次演示需求

## 导入 .pptx
- 旧 PPT 用 `tools/import_pptx.py` 导入：`python tools/import_pptx.py 文件.pptx [输出名]`
- 自动提取文本/图片转成 .pres.json 并更新 index.json；动画等复杂效果不迁移

## 导入/生成 .md（推荐的大模型写作入口）
- 用 `tools/import_md.py`：`python tools/import_md.py 文件.md [输出名]`
- md 约定：`---` 分页；第一个 `# ` = 封面（下一行文字作副标题）；`## ` = 页标题；`- ` = 列表项；`>` 或纯文本 = 段落；`![说明](图片路径/url)` = 图片（本地图片自动内嵌 data-uri）
- 大模型直接写一段 md 存成文件后调用该脚本即可生成演示稿，无需手写 JSON
