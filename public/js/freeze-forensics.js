// ========== freeze-forensics.js - 🧊 页面冻结取证黑匣子 ==========
// 目的：主线程死循环时用户连 F12 都打不开，无法定位凶手。
// 原理：
//   1. Web Worker（独立线程）每秒 ping 主线程，主线程立即回心跳 + 最近长任务记录；
//   2. 主线程用 PerformanceObserver 收集 >200ms 的长任务（含来源脚本 attribution）；
//   3. Worker 发现主线程静默 >6 秒 → 判定冻结 → 立即把「冻结时刻 + 长任务清单」
//      POST 到 /api/db/logs（worker 自己发，主线程死了也能发出去）；
//   4. 用户重开页面后，服务器日志里就有凶手脚本的文件名和函数调用点。
// 零依赖、零侵入：只读不改任何业务逻辑。
(function () {
  'use strict';
  if (window.__freezeForensics) return;
  window.__freezeForensics = true;

  // ---- 主线程：收集长任务（>200ms）与来源 ----
  var longTasks = [];
  var MAX_TASKS = 40;
  try {
    var po = new PerformanceObserver(function (list) {
      try {
        list.getEntries().forEach(function (e) {
          if (e.duration < 200) return;
          var attr = (e.attribution && e.attribution[0]) || {};
          longTasks.push({
            t: Math.round(e.startTime), dur: Math.round(e.duration),
            name: e.name,
            src: attr.containerSrc || '', name2: attr.containerName || ''
          });
          if (longTasks.length > MAX_TASKS) longTasks.shift();
        });
      } catch (e) {}
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch (e) { /* 浏览器不支持 longtask 则只用心跳冻结检测 */ }

  function snapshot() {
    return JSON.stringify({
      page: location.href.split('?')[0],
      at: Date.now(),
      ready: document.readyState,
      tasks: longTasks.slice(-12),
      ua: (navigator.userAgent || '').slice(0, 60)
    });
  }

  function reportToServer(payload) {
    try {
      fetch('/api/db/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'warn', boxId: '', action: 'freeze-forensics',
          detail: JSON.stringify(payload).slice(0, 1900)
        })
      }).catch(function () {});
    } catch (e) {}
  }

  // ---- Worker：独立线程心跳监控 ----
  var workerSrc = [
    'var last = Date.now();',
    'var reported = 0;',
    'var freezeStart = 0;',
    'onmessage = function (e) {',
    '  last = Date.now();',
    '  freezeStart = 0;',
    '  var d = e.data || {};',
    '  if (d.tasks && d.tasks.length && d.needReport) {',
    '    var now = Date.now();',
    '    if (now - reported > 30000) {',  // 同一冻结只上报一次（30秒节流）
    '      reported = now;',
    '      fetch(location.origin + "/api/db/logs", { method: "POST", "headers": { "Content-Type": "application/json" },',
    '        body: JSON.stringify({ level: "warn", boxId: "", action: "freeze-forensics",',
    '          detail: JSON.stringify({ frozeMs: now - (d.freezeStart || now - 8000), tasks: d.tasks }).slice(0, 1900) }) })',
    '        .catch(function(){});',
    '    }',
    '  }',
    '};',
    'setInterval(function () {',
    '  postMessage(Date.now());',   // ping 主线程，主线程回心跳 → onmessage 刷新 last
    '  var silent = Date.now() - last;',
    '  if (silent > 6000 && !freezeStart) freezeStart = Date.now() - silent;',
    '  if (freezeStart && silent > 6000) {',
    '    var now = Date.now();',
    '    if (now - reported > 30000) {',
    '      reported = now;',
    '      fetch(location.origin + "/api/db/logs", { method: "POST", "headers": { "Content-Type": "application/json" },',
    '        body: JSON.stringify({ level: "warn", boxId: "", action: "freeze-forensics",',
    '          detail: JSON.stringify({ frozeMs: silent, note: "main thread silent, no longtask data yet" }).slice(0, 1900) }) })',
    '        .catch(function(){});',
    '    }',
    '  }',
    '}, 1500);'
  ].join('\n');

  try {
    var blob = new Blob([workerSrc], { type: 'application/javascript' });
    var worker = new Worker(URL.createObjectURL(blob));
    var freezeStart = 0;
    worker.onmessage = function () {
      // 收到 ping → 立即回心跳 + 长任务快照
      worker.postMessage({ tasks: longTasks.slice(-12), freezeStart: freezeStart });
    };
    worker.onerror = function () {};
  } catch (e) { /* 不支持 Worker 则跳过 */ }
})();
