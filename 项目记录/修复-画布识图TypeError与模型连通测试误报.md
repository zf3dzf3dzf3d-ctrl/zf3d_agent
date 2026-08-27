# 修复-画布识图TypeError与模型连通测试误报

## 日期
2026-08-27

## 问题
1. `app-kitecanvas.js` Uncaught TypeError: box.querySelector is not a function（deliverVisionResult 注入对话框分支）
2. 前端直连 `https://miaomio.net/v1/chat/completions` 被 CORS 拦截（浏览器缓存旧 JS / 旧逻辑直连）

## 修复
1. `public/js/app-kitecanvas.js`：deliverVisionResult 目标2 分支加 try/catch 兜底，注入失败不再抛未捕获异常
2. `public/js/models.js`：test() 连通测试原来把 `/api/proxy` 的 HTTP 200 当成功（resp.ok 判断），现改为解析代理返回 {ok,status,data}，真实反映上游连通性
3. `public/index.html`：app-kitecanvas.js?v=14→15、models.js?v=13→14，强制刷新缓存

## 验证
- node --check 两文件通过
