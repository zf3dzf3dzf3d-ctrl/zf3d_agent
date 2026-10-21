/* ============================================================
 * rocket-launch.js —— 太空无限风·对话框"火箭发射"特效（底部整条 + 双阶段 + 仅本对话）
 *
 * 触发源（关键）：不再监听全局 zf-combo-hit（它在工具命中/新建对话/小游戏等多处派发，
 *   会误触发且不带归属信息），改为用 MutationObserver 监听每个发送按钮 .send-btn 的
 *   class 中 'sending' 类的跃变：
 *     无 -> 有 = 用户点发送       -> 发射（向上 whoosh）
 *     有 -> 无 = AI 本轮回答完成   -> 返航点火（柔和 whoosh）
 *   其余中间态（流式输出中、工具执行中）sending 恒为有，无跃变 -> 不出特效。
 *
 * 仅本对话：从发生跃变的 .send-btn 用 closest('.chatbox') 反查所属对话框；
 *   只有该框是"当前前台框"(active/被聚焦/画布选中)时才触发，后台并发框不打扰。
 *
 * 不卡保障：① FpsGuard.allow('rocket') 掉帧自动停做；② 连发节流；
 *   ③ 只用 transform/opacity（GPU）；④ 喷焰用完即清空，空闲零开销；
 *   ⑤ prefers-reduced-motion 彻底静默。
 * 音效：Web Audio 现场合成 whoosh（0 文件、无网络），在真实手势栈里提前解锁 AudioContext，
 *   localStorage 持久静音。
 * ============================================================ */
(function () {
  'use strict';
  if (window.__zfRocketInit) return; // 防重复加载
  window.__zfRocketInit = true;

  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var isReduced = function () { return !!(RM && RM.matches); };

  // ---- 节流：两次发射最小间隔，连发复用而非叠加 ----
  var lastFire = 0;
  var MIN_INTERVAL = 140; // ms

  // ---- 复用单个浮层 + 喷焰锚点（不每次新建 overlay） ----
  var overlay = null, thrust = null;
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'zfr-overlay';
    thrust = document.createElement('div');
    thrust.className = 'zfr-thrust';
    overlay.appendChild(thrust);
    document.body.appendChild(overlay);
  }

  function clearThrust() {
    if (!thrust) return;
    while (thrust.firstChild) thrust.removeChild(thrust.firstChild);
  }

  // 是否"当前前台对话框"：active 类 / 框内持有焦点 / 画布选中，任一即算。
  function isCurrentChat(box) {
    if (!box) return false;
    if (box.classList.contains('active') || box.classList.contains('selected')) return true;
    try {
      if (document.activeElement && document.activeElement !== document.body && box.contains(document.activeElement)) return true;
    } catch (e) {}
    return false;
  }

  // 定位喷焰到「该框底部那一横条」（输入行底边整条），按框宽自适应。
  // 返回该横条的像素宽度（用于排布喷焰柱），找不到则 0。
  function positionThrust(box) {
    var row = box.querySelector('.chatbox-inputrow') || box.querySelector('.send-btn');
    if (!row) return 0;
    var r = row.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return 0; // 隐藏态，跳过本次
    thrust.style.left = r.left + 'px';
    thrust.style.top = r.bottom + 'px';   // 喷焰贴在该行底边，向上下溢出可见
    thrust.style.width = r.width + 'px';
    return r.width;
  }

  function spawnFlame(width) {
    clearThrust();
    // 泛光（整条底边向上暖橙光晕）
    var glow = document.createElement('div'); glow.className = 'zfr-glow'; thrust.appendChild(glow);
    // 喷火线（横铺整条底边）
    var line = document.createElement('div'); line.className = 'zfr-barline'; thrust.appendChild(line);
    // 沿底边排开的喷焰柱，按宽度自适应数量（约每 64px 一根，封顶 14 根防宽屏过多）
    var n = Math.max(3, Math.min(14, Math.round(width / 64)));
    for (var i = 0; i < n; i++) {
      var jet = document.createElement('div');
      jet.className = 'zfr-jet';
      jet.style.left = (((i + 0.5) / n) * 100) + '%';
      // 轻微随机高度与延迟，喷射更有"活"感但只用 transform/opacity 动画
      jet.style.animationDelay = (Math.random() * 0.08).toFixed(3) + 's';
      thrust.appendChild(jet);
    }
    // 动画结束后清空（以最长的线/光晕动画为准 + 兜底 setTimeout）
    var kill = setTimeout(clearThrust, 900);
    line.addEventListener('animationend', function () { clearTimeout(kill); setTimeout(clearThrust, 60); });
  }

  // ============ Web Audio 合成 whoosh ============
  var actx = null;
  function ensureAudio() {
    if (actx) return actx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    } catch (e) { actx = null; }
    return actx;
  }
  // AudioContext 必须在「真实用户手势的同步栈」里创建/解锁；特效触发发生在异步流程，
  // 那时才 new 会被浏览器判 suspended 拒启 -> 看得到火焰听不到声。提前在首个手势解锁。
  function unlockAudio() {
    var c = ensureAudio();
    if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} }
  }
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);

  // mode: 'launch'(发射,上扬 whoosh) | 'landing'(完成,柔和下行 whoosh)
  function playWhoosh(mode) {
    if (isMuted()) return;
    var c = ensureAudio();
    if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    var now = c.currentTime;
    var landing = (mode === 'landing');
    var dur = landing ? 0.5 : 0.55;

    if (!playWhoosh._noise) {
      var buf = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      playWhoosh._noise = buf;
    }
    var src = c.createBufferSource();
    src.buffer = playWhoosh._noise;
    src.loop = false;

    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = landing ? 1.6 : 1.1;
    if (landing) {
      // 返航：中心频率下行 + 收束，柔和"落"感
      bp.frequency.setValueAtTime(1500, now);
      bp.frequency.exponentialRampToValueAtTime(420, now + dur);
    } else {
      // 发射：中心频率快速上行，"嗖"上升喷气
      bp.frequency.setValueAtTime(320, now);
      bp.frequency.exponentialRampToValueAtTime(1900, now + 0.28);
      bp.frequency.exponentialRampToValueAtTime(500, now + dur);
    }

    var g = c.createGain();
    var vol = (window.__zfRocketVol != null) ? window.__zfRocketVol : (landing ? 0.22 : 0.3);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + (landing ? 0.08 : 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    var lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = landing ? 200 : 260;
    var lg = c.createGain(); lg.gain.value = vol * 0.5;

    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.connect(lp); lp.connect(lg); lg.connect(c.destination);

    src.start(now);
    src.stop(now + dur + 0.05);
  }

  // ============ 静音开关（localStorage 持久化）============
  function isMuted() {
    try { return localStorage.getItem('zfRocketMuted') === '1'; } catch (e) { return false; }
  }
  function setMuted(v) {
    try { localStorage.setItem('zfRocketMuted', v ? '1' : '0'); } catch (e) {}
  }
  // 静音按钮 UI 已按需求移除（不再构建按钮节点，相关死代码一并清理）。
  // 音效开关能力仅保留 setMuted / isMuted，可经 window.RocketLaunch 调试调用。

  // ============ 主发射流程（box=触发对话框, mode=launch/landing）============
  function fire(box, mode) {
    if (isReduced()) return;
    if (window.FpsGuard && !FpsGuard.allow('rocket')) return; // 掉帧：跳过装饰
    var t = Date.now();
    if (t - lastFire < MIN_INTERVAL) return;                   // 连发节流
    lastFire = t;
    ensureOverlay();
    var w = positionThrust(box);
    if (!w) return;                                             // 该框不可见，跳过
    spawnFlame(w);
    playWhoosh(mode);
  }

  // ============ 触发监听：MutationObserver 监测各 .send-btn 的 sending 类跃变 ============
  var prevSending = (window.WeakMap ? new WeakMap() : null);
  var hasSending = function (btn) { return btn.classList.contains('sending'); };

  function onClassMutations(list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
      var btn = m.target;
      if (!btn.classList || !btn.classList.contains('send-btn')) continue; // 快速过滤：只关心发送按钮
      var now = hasSending(btn);
      if (!prevSending) { prevSending = {}; }
      var prev;
      if (window.WeakMap) {
        prev = prevSending.get(btn);
      } else {
        if (!btn.__zfPrevSending) btn.__zfPrevSending = {};
        prev = btn.__zfPrevSending.v;
      }
      // 首次观测到该按钮：只记基线，不触发（避免页面已处于某态时误报）
      if (prev === undefined) {
        if (window.WeakMap) prevSending.set(btn, now); else btn.__zfPrevSending.v = now;
        continue;
      }
      if (prev === now) continue; // 其它 class 变化，无 sending 跃变
      if (window.WeakMap) prevSending.set(btn, now); else btn.__zfPrevSending.v = now;
      var box = btn.closest ? btn.closest('.chatbox') : null;
      if (!box) continue;
      if (!isCurrentChat(box)) continue;            // 仅本对话：后台框不打扰
      // 无->有=发射；有->无=回答完成返航
      fire(box, (!prev && now) ? 'launch' : 'landing');
    }
  }

  var mo = new MutationObserver(onClassMutations);
  function startObserve() {
    try { mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] }); } catch (e) {}
  }

  if (document.body) { startObserve(); }
  else document.addEventListener('DOMContentLoaded', function () { startObserve(); });

  // 暴露极小调试接口（可选）
  window.RocketLaunch = { fire: fire, setMuted: setMuted, isMuted: isMuted };
})();
