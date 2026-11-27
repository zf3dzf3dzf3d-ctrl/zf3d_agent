/* zf-mem-watch.js — 前端内存哨兵（OOM 收口 2026-11-26；降噪优化 2026-11-06）
 * 每 60s 采样 performance.memory（Chrome），落 perf_log；
 * 内存总量超限或增速超阈值时右下角亮红告警灯（点击可静默 7 天）。
 * 降噪：样本窗 ≥30 分钟才按增速告警（消除冷启动误报）；仅 warn 落库，info 走 console。
 * 纯观测、不干预，加载失败静默降级，不影响主流程。 */
(function () {
  if (typeof performance === 'undefined' || !performance.memory) return; // 非 Chromium 环境跳过
  var samples = [];            // {t, used}
  var MAX_SAMPLES = 60;        // 保留最近 1 小时样本
  var MIN_RATE_SAMPLES = 30;   // 样本窗至少 30 分钟才按增速告警（防冷启动误报）
  var GROW_RATE_MB_H = 400;    // 告警阈值：内存增速 >400MB/小时（30 分钟窗稳定后）
  var ABS_LIMIT_MB = 1800;     // 绝对值告警：>1.8GB（不受样本窗限制，兜底）
  var MUTE_KEY = 'zfMemWatchMuted'; // 静默标记：点击灯后 7 天内不再亮灯
  var warned = false;
  var lamp = null;

  function mb(b) { return Math.round(b / 1048576); }

  function isMuted() {
    try {
      var until = parseFloat(localStorage.getItem(MUTE_KEY) || '0');
      return Date.now() < until;
    } catch (e) { return false; }
  }

  function muteForDays(days) {
    try { localStorage.setItem(MUTE_KEY, String(Date.now() + days * 86400000)); } catch (e) {}
  }

  function ensureLamp() {
    if (lamp) return lamp;
    lamp = document.createElement('div');
    lamp.id = 'zfMemWatchLamp';
    lamp.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;display:none;' +
      'padding:4px 10px;border-radius:12px;background:#e05252;color:#fff;font:12px sans-serif;cursor:pointer;';
    lamp.title = '内存哨兵告警 · 点击静默 7 天';
    lamp.addEventListener('click', function () {
      lamp.style.display = 'none';
      warned = false;
      muteForDays(7);
      log('warn', '用户点击告警灯，静默 7 天');
    });
    (document.body || document.documentElement).appendChild(lamp);
    return lamp;
  }

  function log(level, msg) {
    try {
      // 降噪：仅 warn 级落库，info 不写 IndexedDB，也不打印控制台（此前每分钟一条，长期累积数千条）
      if (level !== 'warn') { return; }
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
    // 增速判定：仅当样本窗 ≥30 分钟（排除冷启动/首小时正常堆分配误报）；绝对超限随时兜底
    var rateOk = samples.length >= MIN_RATE_SAMPLES;
    var rate = 0;
    if (rateOk) {
      var first = samples[0];
      var hours = (now - first.t) / 3600000;
      rate = hours > 0.02 ? mb(used - first.used) / hours : 0;
    }
    var over = isMuted() ? (mb(used) > ABS_LIMIT_MB * 1.2) // 静默期内仅绝对超限+20% 才再亮，防遮蔽真泄漏
              : (rateOk && rate > GROW_RATE_MB_H) || (mb(used) > ABS_LIMIT_MB);
    if (over && !warned) {
      warned = true;
      var lampEl = ensureLamp();
      lampEl.style.display = 'block';
      lampEl.textContent = '⚠ 内存增速 ' + Math.round(rate) + 'MB/h · ' + mb(used) + 'MB，点击静默 / 建议刷新页面';
      log('warn', '内存异常：' + msg + ', rate=' + Math.round(rate) + 'MB/h');
      if (window.App && App.toast) try { App.toast('⚠ 页面内存增长过快，建议刷新'); } catch (e) {}
    } else if (!over && warned) {
      warned = false;
      if (lamp) lamp.style.display = 'none';
      log('warn', '内存恢复正常：' + msg);
    }
    log('info', msg);
  }

  setInterval(function () { if (!document.hidden) { try { sample(); } catch (e) {} } }, 60000);
  setTimeout(function () { try { sample(); } catch (e) {} }, 5000);
})();
