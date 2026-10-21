# 办公文档预览工具（office-viewer）

独立的办公文档查看工具模块，与主程序解耦。后续 Word/Excel/PDF 等内置预览功能统一加到这里。

## 文件
- `office_viewer.py` — 后端解析引擎。实现 `/api/fs/pptx`（PPTX 解析：文字大纲 + 嵌入图片）。
  主程序 `server/routes/mixin_project.py` 只留一行薄接入点调用 `handle_fs_pptx(handler, parsed)`。
- `office-viewer.js` — 前端预览弹窗。全局暴露 `window.OfficeViewer`：
  - `OfficeViewer.open(path, name, esq)` — 按扩展名分发（目前支持 pptx）
  - `OfficeViewer.openPptx(path, name, esq)` — PPTX 高保真渲染，失败自动降级大纲预览
  - `OfficeViewer.openPptxOutline(path, name, esq)` — 简版大纲预览
- `pptx-preview.js` — 第三方高保真 PPT 渲染库（pptx-preview，无需 Office）。

## 静态资源访问
浏览器通过 `/tools/office-viewer/xxx.js` 访问本目录文件。
映射规则在 `server/routes/mixin_static.py`（仅允许 .js/.css/.md，防目录穿越）。

## 扩展新工具（如 Word 预览）
1. 后端：在 `office_viewer.py` 加 `handle_fs_docx(handler, parsed)` 之类的函数；
2. 路由：`mixin_project.py`/`api_dispatch_get.py` 加 `/api/fs/docx` 薄接入；
3. 前端：`office-viewer.js` 的 `OfficeViewer.open` 里按扩展名分发。
