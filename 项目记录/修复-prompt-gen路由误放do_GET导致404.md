# 修复 /api/prompt-gen 404（2026-08-27）

- 现象：拉线小圈请求大模型生成提示词时，POST /api/prompt-gen 返回 404 "Unknown path"。
- 原因：路由判断 `if path == '/api/prompt-gen' and self.command == 'POST'` 被误写在 `do_GET()` 方法内（约823行），POST 请求走 do_POST() 无此路由 → 落到兜底 404。
- 修复：将路由移至 `do_POST()`（在 /api/models/config 之后），并去掉多余的 command 判断。
- 文件：server/handler_routes.py（已自动备份 .bak）。
- 验证：curl POST /api/prompt-gen 返回 200 且 ok:true；服务器已在修改后自动重启。
- 另注：app-imageviewer.js 磁盘文件语法正常（node --check 通过，index.html 已是 ?v=8），若浏览器仍报 catch 错误为缓存旧版，Ctrl+F5 即可。
