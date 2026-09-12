/* ============================================================
 * perf-monitor.js — 前端功能级性能监控（FPS 掉帧排查专用）
 * 用法：
 *   Perf.mark('风筝', t0)  → 记录某段代码耗时
 *   var t0 = performance.now(); ...干活...; Perf.mark('对话框', t0);
 *   长按 Ctrl+Shift+P 3秒 → 立即上报；每 30s 自动上报一次。
 *   Log 写到服务端 logs/perf_log.csv，可用 Excel 打开按"模块"排序。
 * ============================================================ */
(function () {
  'use strict';
  if (window.Perf) return; // 防重复加载

  var stats = {};          // name -> {total, calls, max}
  var lastReport = Date.now();
  var REPORT_MS = 30000;   // 30 秒自动上报
  var fpsFrames = 0, fpsLast = performance.now(), fpsCur = 60, fpsMin = 999, longFrames = 0;

  /* ---------- FPS 主循环（独立，轻量） ---------- */
  function fpsLoop(now) {
    var dt = now - fpsLast;
    fpsFrames++;
    if (dt > 50) longFrames++;               // 单帧 >50ms 记一次卡顿
    if (now - fpsLast >= 1000) {
      fpsCur = Math.round(fpsFrames * 1000 / (now - fpsLast));
      if (fpsCur < fpsMin) fpsMin = fpsCur;
      fpsFrames = 0; fpsLast = now;
    }
    requestAnimationFrame(fpsLoop);
  }
  requestAnimationFrame(fpsLoop);

  /* ---------- 记录某模块耗时 ---------- */
  function mark(name, t0) {
    var cost = performance.now() - t0;
    var s = stats[name] || (stats[name] = { total: 0, calls: 0, max: 0 });
    s.total += cost; s.calls++;
    if (cost > s.max) s.max = cost;
  }

  /* ---------- 上报到服务端 → 写 logs/perf_log.csv ---------- */
  function report(force) {
    var now = Date.now();
    if (!force && now - lastReport < REPORT_MS) return;
    lastReport = now;
    var rows = [];
    rows.push(['时间', 'FPS', '最低FPS', '长帧数(>50ms)', '模块', '总耗时ms', '调用次数', '单次均值ms', '最慢单次ms'].join(','));
    rows.push(['', fpsCur, fpsMin === 999 ? '' : fpsMin, longFrames, '', '', '', '', ''].join(','));
    longFrames = 0; fpsMin = 999;
    var names = Object.keys(stats);
    for (var i = 0; i < names.length; i++) {
      var n = names[i], s = stats[n];
      rows.push(['', '', '', '', n, s.total.toFixed(1), s.calls, (s.total / s.calls).toFixed(2), s.max.toFixed(1)].join(','));
    }
    stats = {};
    if (rows.length <= 1) return;
    try {
      fetch('/api/perf-log', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: rows.slice(1).join('\n')
      });
    } catch (e) { /* 离线不报错 */ }
  }
  setInterval(function () { report(false); }, REPORT_MS);
  // 快捷键：Ctrl+Shift+P 按住即强制上报一次
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) report(true);
  });

  window.Perf = {
    mark: mark,
    report: report,
    /** 包裹任意函数：Perf.wrap('风筝', fn) */
    wrap: function (name, fn) {
      return function () {
        var t0 = performance.now();
        try { return fn.apply(this, arguments); }
        finally { mark(name, t0); }
      };
    }
  };
  console.log('[Perf] 性能监控已启动：模块耗时→logs/perf_log.csv，Ctrl+Shift+P 强制上报');
})();
