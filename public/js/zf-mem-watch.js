/* zf-mem-watch.js — 前端内存哨兵（OOM 收口 2026-11-26）
 * 每 60s 采样 performance.memory（Chrome），落 perf_log；
 * 增速超阈值时在页面右上角亮红状态灯并 toast 告警。
 * 纯观测、不干预，加载失败静默降级，不影响主流程。 */
(function () {
  if (typeof performance === 'undefined' || !performance.memory) return; // 非 Chromium 环境跳过
  var samples = [];            // {t, used}
  var MAX_SAMPLES = 60;        // 保留最近 1 小时样本
  var GROW_RATE_MB_H = 150;    // 告警阈值：内存增速 >150MB/小时
  var ABS_LIMIT_MB = 1800;     // 绝对值告警：>1.8GB
  var warned = false;
  var lamp = null;

  function mb(b) { return Math.round(b / 1048576); }

  function ensureLamp() {
    if (lamp) return lamp;
    lamp = document.createElement('div');
    lamp.id = 'zfMemWatchLamp';
    lamp.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;display:none;' +
      'padding:4px 10px;border-radius:12px;background:#e05252;color:#fff;font:12px sans-serif;cursor:default;';
    lamp.title = '内存哨兵告警';
    (document.body || document.documentElement).appendChild(lamp);
    return lamp;
  }

  function log(level, msg) {
    try {
      if (window.Store && Store.addLog) Store.addLog(level, 'mem-watch', 'perf', msg);
      else console.log('[mem-watch]', level, msg);
    } catch (e) {}
  }

  function sample() {
    var m = performance.memory;
    if (!m) return;
    var used = m.usedJSHeapSize;
    var now = Date.now();
    samples.push({ t: now, used: used });
    if (samples.length > MAX_SAMPLES) samples.shift();

    var msg = 'heap=' + mb(used) + 'MB, limit=' + mb(m.jsHeapSizeLimit) + 'MB';
    if (samples.length >= 6) {
      var first = samples[0];
      var hours = (now - first.t) / 3600000;
      var rate = hours > 0.02 ? mb(used - first.used) / hours : 0; // MB/h，样本窗至少~1.2分钟
      var over = (rate > GROW_RATE_MB_H) || (mb(used) > ABS_LIMIT_MB);
      if (over && !warned) {
        warned = true;
        var lamp = ensureLamp();
        lamp.style.display = 'block';
        lamp.textContent = '⚠ 内存增速 ' + Math.round(rate) + 'MB/h · ' + mb(used) + 'MB，建议刷新页面';
        log('warn', '内存异常：' + msg + ', rate=' + Math.round(rate) + 'MB/h');
        if (window.App && App.toast) try { App.toast('⚠ 页面内存增长过快，建议刷新'); } catch (e) {}
      } else if (!over && warned) {
        warned = false;
        if (lamp) lamp.style.display = 'none';
        log('info', '内存恢复正常：' + msg);
      }
    }
    log('info', msg);
  }

  setInterval(function () { if (!document.hidden) { try { sample(); } catch (e) {} } }, 60000);
  setTimeout(function () { try { sample(); } catch (e) {} }, 5000);
})();
