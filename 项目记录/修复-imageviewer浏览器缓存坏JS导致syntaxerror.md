# 修复 imageviewer 语法报错 Uncaught SyntaxError catch（2026-08-27）

- 现象：控制台报 app-imageviewer.js:33:82 Unexpected token 'catch'。
- 排查：
  - 磁盘上的 public/js/app-imageviewer.js 当前版本 node --check 通过，第 33 行 usSet() 语法正确。
  - 浏览器加载的是缓存损坏的旧版（v=7 缓存），旧版 usSet() 少一个右花括号，catch 出现在 try 块内。
- 修复：index.html 中引用版本号 js/app-imageviewer.js?v=7 → v=8，强制浏览器刷新新文件。
- 备注：public/js/ 下遗留多份 .bak 备份文件语法均不通过（仅是备份，不被页面引用，无影响）。
- 验证：请 Ctrl+F5 强制刷新页面后确认控制台无报错。