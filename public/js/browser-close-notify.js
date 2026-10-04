// browser-close-notify.js —— 页面卸载前通知服务端（浏览器关闭通知机制）
// 说明：Agent 主循环运行在浏览器 JS 侧。用户关闭/刷新页面前，
// 用 navigator.sendBeacon 发送"我要关了"通知，服务端记录到
// private/browser_close.log，供 loop_checkpoint 续跑决策与运维排查参考。
// sendBeacon 在页面卸载时仍能可靠送达（不阻塞关闭，无需等待响应）。
(function () {
  'use strict';
  if (window.__browserCloseNotifyBound) return;
  window.__browserCloseNotifyBound = true;

  function notifyClosing() {
    try {
      var url = (window.API_BASE || '/api') + '/agent/browser-closing';
      navigator.sendBeacon(url, new Blob(['{}'], { type: 'application/json' }));
    } catch (e) { /* 忽略：关闭路径上不能抛错 */ }
  }

  window.addEventListener('beforeunload', notifyClosing);
  window.addEventListener('pagehide', notifyClosing); // 移动端/休眠兜底
})();
