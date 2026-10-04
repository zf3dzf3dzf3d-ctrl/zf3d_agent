/* ============================================================
 * fps-guard.js —— 全局 FPS 监控 + 动画自动降级守卫
 * 目标：系统已经很卡（FPS 低）时，前台装饰性动画一律不再执行，
 *       避免雪上加霜。
 *
 * 用法（各动画系统接入）：
 *   1. 动画循环开始处：
 *        if (!FpsGuard.allow('kite')) { ...跳过本帧绘制/跳过整个循环... }
 *      allow() 返回 false 表示当前处于降级状态，装饰动画应停做。
 *   2. 需要在降级开始/恢复时做一次性处理（如清屏、暂停定时器）：
 *        FpsGuard.onDegraded(function(){ ... });
 *        FpsGuard.onRecovered(function(){ ... });
 *   3. FpsGuard.fps() 可读当前估算帧率。
 *
 * 设计要点：
 *   - 用一个独立的 requestAnimationFrame 采样循环测 FPS（本身开销近零，
 *     只做时间戳记录），rAF 在页面隐藏时自动暂停，不产生后台功耗。
 *   - 连续窗口评估：每秒统计一次，若 avgFps < LOW_FPS(10) 持续
 *     LOW_ROUNDS(2) 轮 → 进入降级；恢复需 avgFps > HIGH_FPS(20)
 *     持续 RECOVER_ROUNDS(3) 轮 → 退出降级（带迟滞，防抖动）。
 *   - 页面隐藏(document.hidden)时 rAF 停，恢复时重置统计，避免误判。
 * ============================================================ */
(function () {
  'use strict';
  if (window.FpsGuard) return; // 防重复加载

  var LOW_FPS = 10;        // 低于此帧率视为卡顿
  var HIGH_FPS = 20;       // 恢复阈值（迟滞）
  var LOW_ROUNDS = 2;      // 连续几轮低帧才降级（每轮1秒）
  var RECOVER_ROUNDS = 3;  // 连续几轮高帧才恢复
  var CPU_HIGH = 80;       // 叫停双条件之一：CPU 高于此值(%)
  var CPU_UNKNOWN_RETRY = 3000; // CPU 未知时补拉接口的最小间隔(ms)

  // CPU 读取：优先用 app-kite 红绿灯轮询写入的 window._kiteCpu；
  // 若未知则主动补拉 /api/gate/active（节流），避免永远拿不到 CPU 而无法叫停
  var _cpuLastFetch = 0;
  function cpuHigh() {
    var v = (typeof window._kiteCpu === 'number') ? window._kiteCpu : null;
    if (v !== null) return v > CPU_HIGH;
    var t = Date.now();
    if (t - _cpuLastFetch > CPU_UNKNOWN_RETRY) {
      _cpuLastFetch = t;
      try {
        fetch('/api/gate/active', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j && typeof j.cpu === 'number') window._kiteCpu = Math.round(j.cpu);
          }).catch(function () {});
      } catch (e) {}
    }
    return false; // CPU 未知时不叫停（宁可不降级也不误伤）
  }

  var state = {
    fps: 60,          // 最近一轮估算帧率
    degraded: false,  // 是否处于降级状态
    _last: 0,
    _frames: 0,
    _winStart: 0,
    _lowRounds: 0,
    _highRounds: 0,
    _autoLow: 0,          // 【自动提速】FPS 持续低于 AUTO_BOOST_FPS 的累计秒数
    _lastAutoBoost: 0,    // 【自动提速】上次自动触发时间戳（冷却用）
    _cbDegraded: [],
    _cbRecovered: []
  };

  // 【自动提速】页面健康提速联动：
  // FPS 持续低于 AUTO_BOOST_FPS（10）达 AUTO_BOOST_ROUNDS（5）秒，
  // 且不在提速冻结中、且距上次自动提速超过冷却期 → 自动执行 zfQuickBoost（就地减负，
  // 不清缓存不刷新页面，安全无感），并弹提示告知用户。
  var AUTO_BOOST_FPS = 10;
  var AUTO_BOOST_ROUNDS = 5;
  var AUTO_BOOST_COOLDOWN = 5 * 60 * 1000; // 5 分钟冷却，防反复触发
  function _maybeAutoBoost() {
    if (typeof window.zfQuickBoost !== 'function') return;
    if (window._zfBoostFrozen) return; // 已在提速冻结中，无需重复
    var t = Date.now();
    if (t - state._lastAutoBoost < AUTO_BOOST_COOLDOWN) return;
    state._lastAutoBoost = t;
    state._autoLow = 0;
    try {
      window.zfQuickBoost();
      if (typeof window.toast === 'function') {
        window.toast('⚠️ 帧率持续低于 ' + AUTO_BOOST_FPS + ' FPS，已自动执行「页面健康提速」（暂停装饰动画、清理内存），帧率恢复后动画自动复常。', true);
      }
      if (window.__FPS_VERBOSE) try { console.warn('[FpsGuard] FPS 持续 < ' + AUTO_BOOST_FPS + '，已自动触发页面健康提速'); } catch (e) {}
    } catch (e) {}
  }

  function _enterDegraded() {
    state.degraded = true;
    state._lowRounds = 0;
    try { document.body.classList.add('fps-degraded'); } catch (e) {}
    for (var i = 0; i < state._cbDegraded.length; i++) {
      try { state._cbDegraded[i](); } catch (e) {}
    }
    if (window.__FPS_VERBOSE) try { console.warn('[FpsGuard] FPS=' + Math.round(state.fps) + ' < ' + LOW_FPS + '，已进入动画降级模式（装饰动画暂停）'); } catch (e) {}
  }

  function _exitDegraded() {
    state.degraded = false;
    state._highRounds = 0;
    try { document.body.classList.remove('fps-degraded'); } catch (e) {}
    for (var i = 0; i < state._cbRecovered.length; i++) {
      try { state._cbRecovered[i](); } catch (e) {}
    }
    if (window.__FPS_VERBOSE) try { console.info('[FpsGuard] FPS 恢复 > ' + HIGH_FPS + '，退出动画降级模式'); } catch (e) {}
  }

  function _sample(ts) {
    if (!state._winStart) { state._winStart = ts; state._last = ts; state._frames = 0; }
    state._frames++;
    if (ts - state._winStart >= 1000) {
      state.fps = Math.round(state._frames * 1000 / (ts - state._winStart));
      state._winStart = ts;
      state._frames = 0;

      if (!state.degraded) {
        // 叫停 = 双条件同时满足：FPS 低 + CPU 高
        if (state.fps < LOW_FPS) {
          state._lowRounds++;
          state._highRounds = 0;
          if (state._lowRounds >= LOW_ROUNDS && cpuHigh()) _enterDegraded();
          else if (state._lowRounds >= LOW_ROUNDS && !cpuHigh()) state._lowRounds = LOW_ROUNDS - 1; // CPU 不高则持续观察，不累计触发
        } else {
          state._lowRounds = 0;
        }

        // 【自动提速】持续低帧累计：低于阈值累加，恢复正常清零；累计满则自动触发
        if (state.fps < AUTO_BOOST_FPS) {
          state._autoLow++;
          if (state._autoLow >= AUTO_BOOST_ROUNDS) _maybeAutoBoost();
        } else {
          state._autoLow = 0;
        }
      } else {
        if (state.fps > HIGH_FPS) {
          state._highRounds++;
          if (state._highRounds >= RECOVER_ROUNDS) _exitDegraded();
        } else {
          state._highRounds = 0;
        }
      }
    }
    requestAnimationFrame(_sample);
  }

  // 页面从后台回来时 rAF 时间戳会跳变，重置统计窗口避免算出离谱低帧率
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      state._winStart = 0;
      state._frames = 0;
      state._lowRounds = 0;
    }
  });

  requestAnimationFrame(_sample);

  window.FpsGuard = {
    /** 当前估算 FPS */
    fps: function () { return state.fps; },
    /** 是否处于降级状态 */
    isDegraded: function () { return state.degraded; },
    /**
     * 动画帧入口守卫：降级时返回 false（应跳过动画）。
     * @param {string} [tag] 可选标签，仅用于调试
     * @returns {boolean} true=允许播放动画
     */
    allow: function (tag) { return !state.degraded; },
    /** 注册降级回调（进入降级瞬间触发一次） */
    onDegraded: function (fn) { state._cbDegraded.push(fn); },
    /** 注册恢复回调（退出降级瞬间触发一次） */
    onRecovered: function (fn) { state._cbRecovered.push(fn); },
    /** 手动强制降级/恢复（提速面板「立即提速」用，true=强停装饰动画，false=交回自动判断） */
    forceDegrade: function (on) {
      if (on && !state.degraded) _enterDegraded();
      else if (!on && state.degraded) _exitDegraded();
      state._forced = !!on;
    },
    isForced: function () { return !!state._forced; },
    /** 阈值（供调试/调整） */
    LOW_FPS: LOW_FPS,
    HIGH_FPS: HIGH_FPS,
    CPU_HIGH: CPU_HIGH
  };
})();

/* ============================================================
 * FPS 坠落真凶追查 (主脑指令: fps<10 必须记录一次并找出元凶)
 * - 全工具监控: 包裹 fetch / XHR / WebSocket 发送 / 长任务观察,
 *   页面上发生的每一次工具类调用(无一遗漏)都记录 {what, ms, fps}
 * - fps<10 触发: 立即 POST /api/fps-guard/report 上报现场
 *   (含活动工具、最慢工具排行、低帧前 60s 调用时间线、主线程长任务)
 * - 服务端落盘 private/logs/fps-guard-*.jsonl + SQLite app_data
 *   主脑查询: GET /api/fps-guard/list?limit=50 (fps 最惨的排最前)
 * ============================================================ */
(function () {
  'use strict';
  if (window.FpsCrime) return;

  var MAX_TIMELINE = 200;          // 内存中最多保留最近 N 条调用
  var REPORT_COOLDOWN = 15000;     // 两次上报最小间隔(ms), 防刷屏
  var timeline = [];               // 工具调用时间线
  var longTasks = [];              // 主线程长任务(>50ms)
  var lastReportAt = 0;
  var seq = 0;

  function now() { return Date.now(); }
  function fpsNow() {
    try { return window.FpsGuard ? FpsGuard.fps() : 60; } catch (e) { return 60; }
  }

  function record(what, startTs, extra) {
    var ms = Math.max(0, now() - startTs);
    var item = {
      seq: ++seq,
      t: new Date().toISOString(),
      what: String(what || 'unknown'),
      ms: Math.round(ms),
      fps: fpsNow(),
      extra: extra || null
    };
    timeline.push(item);
    if (timeline.length > MAX_TIMELINE) timeline.splice(0, timeline.length - MAX_TIMELINE);
    return item;
  }

  function slowest(n) {
    var arr = timeline.slice().sort(function (a, b) { return b.ms - a.ms; });
    return arr.slice(0, n || 5);
  }

  function activeTool() {
    // 嫌疑判定改为“近距耗时最长”，避免把恰好赶上的常规轮询当元凶
    var recent = timeline.slice(-20);
    if (!recent.length) return null;
    var best = recent[0];
    for (var i = 1; i < recent.length; i++) if (recent[i].ms > best.ms) best = recent[i];
    return best;
  }

  function report(reason) {
    var t = now();
    if (t - lastReportAt < REPORT_COOLDOWN) return;
    lastReportAt = t;
    var cur = activeTool();
    var payload = {
      fps: fpsNow(),
      url: location.href,
      userAgent: navigator.userAgent,
      reason: reason || 'fps_low',
      activeTool: cur ? cur.what : null,
      activeToolMs: cur ? cur.ms : null,
      slowestTools: slowest(8),
      timeline: timeline.slice(-60),
      longTasks: longTasks.slice(-20),
      extra: (function () {
        var x = { degraded: window.FpsGuard ? !!FpsGuard.isDegraded() : false };
        try {
          if (performance.memory && performance.memory.usedJSHeapSize) {
            x.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
            x.heapLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
          }
        } catch (e) {}
        try { x.domNodes = document.getElementsByTagName('*').length; } catch (e) {}
        try { x.uptimeMin = Math.round(performance.now() / 60000); } catch (e) {}
        return x;
      })()
    };
    try {
      fetch('/api/fps-guard/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
    if (window.__FPS_VERBOSE) try { console.warn('[FpsCrime] 已记录低帧现场 fps=' + payload.fps + ' 嫌疑工具=' + payload.activeTool); } catch (e) {}
    if (window.__FPS_VERBOSE) { if (longTasks.length) { var lt = longTasks[longTasks.length - 1]; console.warn('[FpsCrime] LT=' + (lt.name || '(fn)') + ' ' + lt.ms + 'ms @' + lt.t); } } // longtask attribution
  }

  // 1) 包裹 fetch —— 所有 /api/* 调用(含各工具后端)全部记录
  if (window.fetch && !fetch.__fpsWrapped) {
    var _fetch = window.fetch;
    var wrapped = function (input, init) {
      var what = 'fetch:';
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        what += (url.split('?')[0] || 'unknown');
        if (init && init.method) what += ' ' + init.method;
      } catch (e) { what += 'parse_err'; }
      var t0 = now();
      var isNoise = /\/api\/(gate\/active|fps-guard\/report|agent\/protocol\/last|worklog)(\?|$)/.test(url);
      return _fetch.apply(this, arguments).then(function (res) {
        if (!isNoise) record(what, t0, { status: res && res.status });
        return res;
      }, function (err) {
        if (!isNoise) record(what + ' (FAIL)', t0, { err: String(err && err.message || err) });
        throw err;
      });
    };
    wrapped.__fpsWrapped = true;
    // 【网络抖动自愈】Windows 网络配置文件偶发变更(NCSI 4004/10001)会瞬间掐断
    // 全部在途请求(ERR_NETWORK_CHANGED / Failed to fetch)，表现为"消息偶尔发不出"。
    // GET 请求自动重试一次；非 GET 不重试以免重复提交。
    var _netChurn = /network changed|failed to fetch/i;
    var wrappedWithRetry = function (input, init) {
      var method = 'GET';
      try { method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); } catch (e) {}
      var p = wrapped.apply(this, [input, init]);
      if (method !== 'GET') return p;
      return p.catch(function (err) {
        if (!_netChurn.test(String(err && err.message || err))) throw err;
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            wrapped.call(this, input, init).then(resolve, reject);
          }, 350);
        });
      });
    };
    wrappedWithRetry.__fpsWrapped = true;
    window.fetch = wrappedWithRetry;
  }

  // 2) 包裹 XMLHttpRequest.open —— 兜底捕获非 fetch 的工具请求
  if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__fpsWrapped) {
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__fpsWhat = 'xhr:' + (method || '') + ' ' + String(url || '').split('?')[0];
      this.__fpsT0 = now();
      this.addEventListener('loadend', function () {
        try { record(this.__fpsWhat, this.__fpsT0, { status: this.status }); } catch (e) {}
      });
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__fpsWrapped = true;
  }

  // 3) WebSocket 发送计数 (流式/推送通道)
  if (window.WebSocket && !WebSocket.prototype.__fpsWrapped) {
    var _send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { record('ws:send(' + ((data && data.length) || 0) + 'B)', now()); } catch (e) {}
      return _send.apply(this, arguments);
    };
    WebSocket.prototype.__fpsWrapped = true;
  }

  // 4) 主线程长任务观察 —— JS 阻塞的真凶直接抓现行
  try {
    if (window.PerformanceObserver) {
      var po = new PerformanceObserver(function (list) {
        var entries = list.getEntries() || [];
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (e.duration > 100) {
            longTasks.push({ t: new Date(e.startTime + performance.timeOrigin).toISOString(), ms: Math.round(e.duration) });
            if (longTasks.length > 100) longTasks.splice(0, longTasks.length - 100);
          }
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { /* 浏览器不支持则跳过 */ }

  // 5) fps<10 触发记录 —— 挂在 FpsGuard 降级瞬间 + 每秒巡检双保险
  function armTrigger() {
    if (window.FpsGuard) {
      FpsGuard.onDegraded(function () { report('degraded_enter'); });
      setInterval(function () { if (FpsGuard.fps() < 10) report('fps_below_10'); }, 5000);
    } else {
      setTimeout(armTrigger, 500);
    }
  }
  armTrigger();

  window.FpsCrime = {
    timeline: timeline,
    longTasks: longTasks,
    slowest: slowest,
    report: report,
    record: record
  };
})();

/* ============================================================
 * 自愈守卫（2026-09-16）—— 长活标签页劣化自动恢复
 * 根因结论：标签页长期不关（数天），堆内存涨到 2GB+ 后，GC 与
 * 轮询响应处理产生持续 200~400ms 主线程长任务 → fps 跌到 3。
 * 刷新页面立愈（服务端已持久化，agent 由 auto-resume/pool 自动续跑）。
 * 策略：fps<5 连续 10 分钟 且 堆>1GB（或 DOM>15万节点）→ 30s 倒计时
 * 提示后自动 location.reload()；期间 fps 恢复则取消。
 * ============================================================ */
(function () {
  'use strict';
  function heapMB() {
    try {
      if (performance.memory && performance.memory.usedJSHeapSize) {
        return Math.round(performance.memory.usedJSHeapSize / 1048576);
      }
    } catch (e) {}
    return -1;
  }
  function domNodes() {
    try { return document.getElementsByTagName('*').length; } catch (e) { return -1; }
  }
  // 暴露给上报接口
  window.FpsGuard.heapMB = heapMB;
  window.FpsGuard.domNodes = domNodes;

  var LOW_MS = 10 * 60 * 1000;     // fps<5 需连续持续 10 分钟
  var HEAP_LIMIT_MB = 1024;        // 堆超过 1GB 视为劣化
  var DOM_LIMIT = 150000;          // 无 memory API 时的替代信号
  var COUNTDOWN_SEC = 30;

  var lowSince = 0, timer = null, armed = false;

  function toast(msg, stay) {
    try {
      var t = document.createElement('div');
      t.id = 'fps-selfheal-toast';
      t.style.cssText = 'position:fixed;top:52px;right:16px;z-index:100001;max-width:380px;' +
        'padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.6;' +
        'background:rgba(140,40,20,.94);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.4);' +
        'white-space:pre-wrap;';
      t.textContent = msg;
      var old = document.getElementById('fps-selfheal-toast');
      if (old) old.remove();
      document.body.appendChild(t);
      if (!stay) setTimeout(function () { try { t.remove(); } catch (e) {} }, 8000);
    } catch (e) {}
  }

  setInterval(function () {
    try {
      var fps = window.FpsGuard.fps();
      if (fps >= 5) { lowSince = 0; if (armed) { armed = false; var o = document.getElementById('fps-selfheal-toast'); if (o) o.remove(); if (timer) { clearInterval(timer); timer = null; } } return; }
      var now = Date.now();
      if (!lowSince) { lowSince = now; return; }
      if (armed) return;
      if (now - lowSince < LOW_MS) return;

      var h = heapMB(), d = domNodes();
      var heavy = (h > 0 && h > HEAP_LIMIT_MB) || (h <= 0 && d > DOM_LIMIT);
      if (!heavy) return; // 帧率低但内存不大 → 另有原因,不盲目刷新

      armed = true;
      var left = COUNTDOWN_SEC;
      toast('⚠ 页面已长时间低帧（fps=' + fps + '），内存 ' + h + 'MB / DOM ' + d + ' 节点。\n' +
            '这是长期不关页导致的状态积累，刷新即恢复。\n' + left + ' 秒后自动刷新（agent 任务会自动续跑，点此取消）…', true);
      var el = document.getElementById('fps-selfheal-toast');
      if (el) el.onclick = function () { armed = false; lowSince = Date.now(); if (timer) { clearInterval(timer); timer = null; } el.remove(); };
      timer = setInterval(function () {
        left--;
        if (left <= 0) {
          try { sessionStorage.setItem('fps_selfheal_reload', String(Date.now())); } catch (e) {}
          location.reload();
          return;
        }
        var e2 = document.getElementById('fps-selfheal-toast');
        if (e2) e2.textContent = '⚠ 页面已长时间低帧，' + left + ' 秒后自动刷新（agent 任务会自动续跑，点此取消）…';
      }, 1000);
    } catch (e) {}
  }, 5000);

  // 刷新后提示一次（说明刚发生了自愈）
  try {
    var ts = parseInt(sessionStorage.getItem('fps_selfheal_reload') || '0', 10);
    if (ts && Date.now() - ts < 120000) {
      sessionStorage.removeItem('fps_selfheal_reload');
      window.addEventListener('load', function () {
        setTimeout(function () { toast('✅ 已自动刷新恢复（此前页面因长期运行帧率过低）。', false); }, 3000);
      });
    }
  } catch (e) {}


/* ============================================================
 * 浏览器端轻量提速（供底部停靠栏「提速」弹层调用）
 * 原理：清理 Cache Storage 并强制重载，重置内存/DOM/定时器堆积。
 * 已移除原右下角悬浮按钮，入口统一到 index.html 的提速弹层。
 * ============================================================ */
  try {
    window.zfBoostReload = function () {
      if (window.caches && caches.keys) {
        caches.keys().then(function (ks) {
          ks.forEach(function (k) { caches.delete(k); });
        }).catch(function () {});
      }
      sessionStorage.setItem('fps_selfheal_reload', String(Date.now()));
      sessionStorage.setItem('zf_manual_boost', '1');
      setTimeout(function () { location.reload(true); }, 80);
    };

    // 手动提速后提示一次
    if (sessionStorage.getItem('zf_manual_boost') === '1') {
      sessionStorage.removeItem('zf_manual_boost');
      window.addEventListener('load', function () {
        setTimeout(function () { toast('已一键提速：缓存已清理，帧率已恢复。', false); }, 1500);
      });
    }
  } catch (e) {}
})();
