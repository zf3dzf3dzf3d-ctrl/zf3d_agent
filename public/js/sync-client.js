/* sync-client.js - 双端界面实时同步客户端
 * 连接 /api/ui-sync/sse，收到事件后按类型分发刷新；失败自动降级轮询。
 * 事件类型: chat(聊天区) / panel(面板) / settings(设置) / db:changed(兜底整页数据刷新)
 */
(function () {
  'use strict';
  var CID = sessionStorage.getItem('__ui_sync_cid') ||
    (sessionStorage.setItem('__ui_sync_cid', 'c' + Date.now() + Math.random().toString(36).slice(2, 8)),
      sessionStorage.getItem('__ui_sync_cid'));

  var POLL_MS = 5000;
  var handlers = {};
  var es = null, pollTimer = null, closed = false;

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }

  function dispatch(ev) {
    try {
      var d = JSON.parse(ev.data);
      if (!d || d.from === CID) return; // 防回声：自己发的事件不处理
      (handlers[d.type] || []).forEach(function (fn) { try { fn(d); } catch (e) {} });
      (handlers['*'] || []).forEach(function (fn) { try { fn(d); } catch (e) {} });
    } catch (e) {}
  }

  function startPolling() {
    if (pollTimer) return;
    console.warn('[ui-sync] SSE 不可用，退化为', POLL_MS, 'ms 轮询');
    pollTimer = setInterval(function () {
      (handlers['poll'] || []).forEach(function (fn) { try { fn(); } catch (e) {} });
    }, POLL_MS);
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function connect() {
    if (closed) return;
    try {
      es = new EventSource('/api/ui-sync/sse?cid=' + encodeURIComponent(CID));
      es.onmessage = dispatch;
      es.onerror = function () {
        // EventSource 会自动重连；只有连接被拒(rejected/超限)才退化轮询
        if (es && es.readyState === EventSource.CLOSED) { es = null; startPolling(); }
      };
      es.onopen = stopPolling;
    } catch (e) { startPolling(); }
  }

  // 广播本端状态变化（埋点调用 UiSync.emit('chat', ...)）
  function emit(type, key, data) {
    try {
      fetch('/api/ui-sync/emit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, key: key || '', data: data || {}, cid: CID }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  window.UiSync = { on: on, emit: emit, cid: CID, connect: connect };
  // DOM 就绪后自动连接
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect);
  else connect();
})();
