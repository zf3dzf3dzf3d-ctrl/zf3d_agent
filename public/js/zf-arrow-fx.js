/* ============================================================
 * zf-arrow-fx.js —— 父子箭头「受击」特效（v1，2026-11-22）
 * 策划案：docs/策划案-父子箭头受击特效-v1.md
 * 出招 → 弹道 → 命中受击演出 + WebAudio 合成音效：
 *  - 送出（→pending/reviewing/discussing）   ：能量弹飞向子框 + arrowLaunch 嗖 + 徽标脉冲
 *  - 答案落定（→clarified/passed/gathered）  ：dst 端 sparkle（无声，回复完成时 app-sfx 已有 done 音）
 *  - 回注（→done/applied/modified/revising） ：能量弹飞回主框 + 命中四件套
 *  - 命中四件套：受击抖动（CSS translate 属性，不碰 left/top/transform）
 *    + 状态色闪光 + 火花粒子 + 伤害浮字（子对话分数≥90 → 暴击金字）
 *  - 失效（→failed）：dst 端灰色暗粒子（无声）
 * 接入：内核 zf-arrow-core.js setStatus 广播 window.__zfArrowFxHook（软引用），
 *       本模块注册钩子即全队箭头生效，五个箭头壳零改动。
 * 音效：注册进 app-sfx.js 的 __zfSfx.SFX 表（arrowLaunch/arrowHit/arrowCrit），
 *       自动继承 zf3d_sfx_off 总开关与 60ms 节流；app-sfx 缺失时自足降级。
 * 开关：localStorage zf3d_arrowfx_off='1' 只关视觉；zf3d_arrowsfx_off='1' 只关本组音效。
 * 调试：window.ZFArrowFX.demo() 在画布第一条箭头上试放整套演出。
 * 性能：无常驻 rAF（WAAPI+CSS animation）、粒子并发上限 3、document.hidden 跳过、
 *       定时回收零泄漏，事件驱动空闲零 CPU。
 * 依赖：zf-arrow-core.js（内核钩子）、app-sfx.js（音效底座，可缺失）。
 * 加载顺序：zf-arrow-core.js 之后即可。
 * 同步：改动后必须 copy 对齐 server/public/js/ 副本（双目录唯一同步项）。
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFArrowFX) return;

  /* ---------- 开关 ---------- */
  function fxOn() { try { return localStorage.getItem('zf3d_arrowfx_off') !== '1'; } catch (e) { return true; } }
  function sfxOn() { try { return localStorage.getItem('zf3d_arrowsfx_off') !== '1'; } catch (e) { return true; } }

  /* ---------- 样式注入（幂等；样式内联于 JS，避免双副本 CSS 同步） ---------- */
  function ensureStyle() {
    if (document.getElementById('zf-arrow-fx-style')) return;
    var st = document.createElement('style');
    st.id = 'zf-arrow-fx-style';
    st.textContent =
      /* 特效层：fixed 全屏，pointer-events 放行点击，z-index 高于箭头悬停层 9300 */
      '#zf-arrow-fx-layer{position:fixed;inset:0;pointer-events:none;z-index:9500;overflow:hidden;}' +
      /* 受击抖动+闪光合一动画（抖动用 translate 独立属性，与 left/top 定位、transform 缩放零冲突） */
      '.zf-hit-fx{animation:zafHitCombo .34s cubic-bezier(.36,.07,.19,.97) both;}' +
      '@keyframes zafHitCombo{' +
      '0%{translate:0 0;box-shadow:0 0 0 0 transparent;}' +
      '12%{translate:var(--zf-hx) var(--zf-hy);box-shadow:0 0 26px 8px var(--zf-fxc);}' +
      '26%{translate:calc(var(--zf-hx)*-.7) calc(var(--zf-hy)*-.7);box-shadow:0 0 16px 4px var(--zf-fxc);}' +
      '42%{translate:calc(var(--zf-hx)*.45) calc(var(--zf-hy)*.45);box-shadow:0 0 10px 2px var(--zf-fxc);}' +
      '60%{translate:calc(var(--zf-hx)*-.25) calc(var(--zf-hy)*-.25);}' +
      '78%{translate:calc(var(--zf-hx)*.12) calc(var(--zf-hy)*.12);box-shadow:0 0 4px 0 var(--zf-fxc);}' +
      '100%{translate:0 0;box-shadow:0 0 0 0 transparent;}}' +
      /* 能量弹 + 残影 */
      '.zaf-bolt{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;' +
      'background:radial-gradient(circle,#fff 0%,var(--pc) 42%,rgba(255,255,255,0) 72%);' +
      'box-shadow:0 0 14px 5px var(--pc);animation:zafBolt var(--bdur) linear both;}' +
      '@keyframes zafBolt{0%{translate:0 0;}100%{translate:var(--bx) var(--by);}}' +
      '.zaf-ghost1{opacity:.45;scale:.7;}.zaf-ghost2{opacity:.28;scale:.55;}.zaf-ghost3{opacity:.16;scale:.4;}' +
      /* 火花粒子 */
      '.zaf-particle{position:absolute;left:0;top:0;width:var(--ps);height:var(--ps);border-radius:50%;' +
      'background:var(--pc);box-shadow:0 0 6px var(--pc);animation:zafFly var(--pdur) cubic-bezier(.2,.5,.45,1) forwards;}' +
      '@keyframes zafFly{0%{translate:0 0;opacity:1;scale:1;}60%{opacity:.85;}' +
      '100%{translate:var(--px) var(--py);opacity:0;scale:.35;}}' +
      /* 冲击光环 */
      '.zaf-ring{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;' +
      'border:3px solid var(--pc);box-shadow:0 0 12px var(--pc),inset 0 0 8px var(--pc);' +
      'animation:zafRing .5s ease-out forwards;}' +
      '@keyframes zafRing{0%{scale:.25;opacity:.9;}100%{scale:1.6;opacity:0;}}' +
      /* 伤害浮字（独立 translate/rotate/scale 通道，centering 走 transform 互不打架） */
      '.zaf-float{position:absolute;transform:translate(-50%,-100%);' +
      "font:italic 900 20px/1.15 system-ui,'Segoe UI',sans-serif;letter-spacing:.5px;color:#fff;" +
      'text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 10px var(--fc),0 0 20px var(--fc);' +
      'white-space:nowrap;animation:zafFloatRise .78s ease-out forwards;}' +
      '.zaf-float-big{font-size:28px;}' +
      '.zaf-float-gold{color:#ffd54f;text-shadow:0 2px 0 rgba(80,40,0,.7),0 0 12px #ffb300,0 0 26px #ff9800;}' +
      '@keyframes zafFloatRise{0%{translate:0 10px;scale:.5;opacity:0;rotate:-8deg;}' +
      '16%{translate:0 -4px;scale:1.15;opacity:1;}32%{scale:1;}' +
      '100%{translate:0 -40px;opacity:0;rotate:4deg;}}';
    document.head.appendChild(st);
  }

  /* ---------- 特效层 ---------- */
  var _layer = null;
  function layer() {
    if (_layer && _layer.isConnected) return _layer;
    _layer = document.createElement('div');
    _layer.id = 'zf-arrow-fx-layer';
    document.body.appendChild(_layer);
    return _layer;
  }

  /* ---------- 音效合成（自足 ctx+手势解锁；函数注册进 __zfSfx.SFX 复用其总开关/节流） ---------- */
  var _actx = null, _unlocked = false;
  function _armUnlock() { _unlocked = true; }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, _armUnlock, { once: true, capture: true }); });
  function ctx() {
    if (!_unlocked) return null;
    if (!_actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { _actx = new AC(); } catch (e) { return null; }
    }
    if (_actx.state === 'suspended') { try { _actx.resume(); } catch (e) {} }
    return _actx;
  }
  function _tone(freq, dur, type, vol, delay, slideTo) {
    var c = ctx(); if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function _noise(dur, vol, f0, f1, type) {
    var c = ctx(); if (!c) return;
    var t0 = c.currentTime;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(f0, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    var g = c.createGain(); g.gain.value = vol || 0.08;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
  }
  var SYNTH = {
    arrowLaunch: function () { _noise(0.18, 0.05, 400, 3200, 'bandpass'); _tone(320, 0.16, 'sine', 0.09, 0, 720); },
    arrowHit:    function () { _noise(0.06, 0.10, 1200, null, 'lowpass'); _tone(165, 0.12, 'sine', 0.17, 0, 55); _tone(1150, 0.05, 'triangle', 0.07, 0.02); },
    arrowCrit:   function () { SYNTH.arrowHit(); [880, 1320, 1760].forEach(function (f, i) { _tone(f, 0.07, 'triangle', 0.10, 0.05 + i * 0.06); }); }
  };
  (function registerSfx(tries) { /* app-sfx.js 先于本文件加载，兜底重试仅防异常加载序 */
    try {
      var S = window.__zfSfx && window.__zfSfx.SFX;
      if (S) { S.arrowLaunch = SYNTH.arrowLaunch; S.arrowHit = SYNTH.arrowHit; S.arrowCrit = SYNTH.arrowCrit; return; }
    } catch (e) {}
    if (tries < 10) setTimeout(function () { registerSfx(tries + 1); }, 400);
  })(0);
  function playSnd(name) {
    if (!sfxOn()) return;
    try { if (window.__zfSfx && window.__zfSfx.play) { window.__zfSfx.play(name); return; } } catch (e) {}
    try { if (localStorage.getItem('zf3d_sfx_off') === '1') return; } catch (e2) {}
    try { if (SYNTH[name]) SYNTH[name](); } catch (e3) {}
  }

  /* ---------- 几何 ---------- */
  function findChat(id) {
    try {
      if (window.App && App.findChatBox) return App.findChatBox(id);
      var list = (window.App && App.chatBoxes) || [];
      for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) return list[i]; }
    } catch (e) {}
    return null;
  }
  function centerOfRect(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  /* 矩形中心指向 (tx,ty) 的射线与矩形边（略外扩 6px）的交点=命中点；附带中心→命中点的单位向量 */
  function edgePoint(r, tx, ty) {
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = tx - cx, dy = ty - cy;
    var len = Math.hypot(dx, dy);
    if (!len) return { x: cx, y: cy, ux: 0, uy: -1 };
    var ux = dx / len, uy = dy / len;
    var hx = r.width / 2 + 6, hy = r.height / 2 + 6;
    var t = Math.min(
      Math.abs(ux) > 1e-4 ? hx / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-4 ? hy / Math.abs(uy) : Infinity);
    if (!isFinite(t)) t = Math.min(hx, hy);
    return { x: cx + ux * t, y: cy + uy * t, ux: ux, uy: uy };
  }
  function hexAlpha(color, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
    if (!m) return color;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- 视觉原语 ---------- */
  var _bursts = []; /* 并发上限 3，超出回收最旧 */
  function burst(x, y, color, n) {
    if (!fxOn() || document.hidden) return;
    var L = layer();
    while (_bursts.length >= 3) { var old = _bursts.shift(); if (old) old.remove(); }
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;';
    for (var i = 0; i < n; i++) {
      var p = document.createElement('div');
      p.className = 'zaf-particle';
      var ang = Math.random() * Math.PI * 2;
      var d = 16 + Math.random() * 30;
      p.style.setProperty('--px', (Math.cos(ang) * d).toFixed(1) + 'px');
      p.style.setProperty('--py', (Math.sin(ang) * d * 0.75 + 12).toFixed(1) + 'px'); /* 重力下坠偏置 */
      p.style.setProperty('--ps', (2 + Math.random() * 3).toFixed(1) + 'px');
      p.style.setProperty('--pc', (i % 3 === 0) ? '#ffffff' : color);
      p.style.setProperty('--pdur', (380 + Math.random() * 240).toFixed(0) + 'ms');
      box.appendChild(p);
    }
    L.appendChild(box); _bursts.push(box);
    setTimeout(function () { var ix = _bursts.indexOf(box); if (ix >= 0) _bursts.splice(ix, 1); box.remove(); }, 700);
  }
  function ring(x, y, color) {
    if (!fxOn() || document.hidden) return;
    var r = document.createElement('div');
    r.className = 'zaf-ring';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    r.style.setProperty('--pc', color);
    layer().appendChild(r);
    setTimeout(function () { r.remove(); }, 540);
  }
  function floatText(x, y, text, color, big, gold) {
    if (!fxOn() || document.hidden) return;
    var el = document.createElement('div');
    el.className = 'zaf-float' + (big ? ' zaf-float-big' : '') + (gold ? ' zaf-float-gold' : '');
    el.style.left = Math.max(60, Math.min(window.innerWidth - 60, x)) + 'px';
    el.style.top = (y - 14) + 'px';
    el.style.setProperty('--fc', color);
    el.textContent = text;
    layer().appendChild(el);
    setTimeout(function () { el.remove(); }, 820);
  }
  /* 能量弹：光核 + 3 枚负延迟残影，纯 CSS 动画，到点回调 onHit */
  function travel(x0, y0, x1, y1, color, onHit) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.hypot(dx, dy) || 1;
    var dur = Math.max(150, Math.min(260, dist * 0.45));
    var L = layer();
    function mk(cls) {
      var el = document.createElement('div');
      el.className = cls;
      el.style.left = x0 + 'px'; el.style.top = y0 + 'px';
      el.style.setProperty('--pc', color);
      el.style.setProperty('--bx', dx + 'px');
      el.style.setProperty('--by', dy + 'px');
      el.style.setProperty('--bdur', dur + 'ms');
      L.appendChild(el);
      return el;
    }
    var el = mk('zaf-bolt');
    var ghosts = [mk('zaf-bolt zaf-ghost1'), mk('zaf-bolt zaf-ghost2'), mk('zaf-bolt zaf-ghost3')];
    ghosts.forEach(function (g, i) { g.style.animationDelay = (-(i + 1) * 55) + 'ms'; });
    setTimeout(function () { el.remove(); ghosts.forEach(function (g) { g.remove(); }); if (onHit) onHit(); }, dur + 20);
  }
  /* 受击抖动+闪光：目标 chatbox 加 class，setTimeout 收尾（子元素 animationend 会冒泡误判，故不用事件收尾） */
  function shakeAndFlash(boxEl, dx, dy, color) {
    if (!boxEl || !boxEl.isConnected || boxEl.dataset.zafHit === '1') return;
    boxEl.dataset.zafHit = '1';
    var amp = 4;
    boxEl.style.setProperty('--zf-hx', (dx * amp).toFixed(1) + 'px');
    boxEl.style.setProperty('--zf-hy', (dy * amp * 0.5).toFixed(1) + 'px');
    boxEl.style.setProperty('--zf-fxc', hexAlpha(color, 0.55));
    boxEl.classList.add('zf-hit-fx');
    setTimeout(function () {
      boxEl.classList.remove('zf-hit-fx');
      delete boxEl.dataset.zafHit;
    }, 380);
  }
  /* 箭头本体亮度脉冲（替代鞭梢：inline filter 被 WAAPI 短暂覆盖后自动还原） */
  function arrowFlash(inst, color) {
    if (!inst || !inst.el || !inst.el.isConnected) return;
    try {
      inst.el.animate(
        [{ filter: 'drop-shadow(0 0 8px ' + color + ')' },
         { filter: 'drop-shadow(0 0 20px ' + color + ') brightness(1.8)' },
         { filter: 'drop-shadow(0 0 8px ' + color + ')' }],
        { duration: 300, easing: 'ease-out' });
    } catch (e) {}
  }
  /* 徽标脉冲：composite:'add' 把均匀 scale 追加在 rotate 之后（rotate×均匀scale 可交换）；
     不支持 additive 的浏览器跳过，避免 replace 覆盖 inline 旋转导致箭头瞬回 0° */
  var _addOk = null;
  function additiveOk() {
    if (_addOk !== null) return _addOk;
    try {
      var k = new KeyframeEffect(document.body, [{ transform: 'scale(1)' }], { composite: 'add' });
      _addOk = (k.composite === 'add');
    } catch (e) { _addOk = false; }
    return _addOk;
  }
  function badgePulse(inst) {
    if (!additiveOk() || !inst || !inst.svg || !inst.svg.isConnected) return;
    try {
      inst.svg.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out', composite: 'add' });
    } catch (e) {}
  }

  /* ---------- 分数/暴击/连击 ---------- */
  function childScore(inst) {
    try {
      var c = findChat(inst.dstId);
      if (c && window.ZFChildRel && ZFChildRel.scoreOf) return ZFChildRel.scoreOf(c);
    } catch (e) {}
    return null;
  }
  var _combo = {};
  function comboTag(key) {
    var now = Date.now();
    var c = _combo[key];
    if (c && now - c.t < 2000) { c.n++; c.t = now; return c.n >= 2 ? ' x' + c.n : ''; }
    _combo[key] = { t: now, n: 1 };
    return '';
  }

  /* ---------- 状态迁移 → 演出映射 ---------- */
  var MAP = {
    pending: 'launch', reviewing: 'launch', discussing: 'launch',
    clarified: 'arrive', passed: 'arrive', gathered: 'arrive',
    done: 'return', applied: 'return', modified: 'return', revising: 'return',
    failed: 'fail'
  };
  var ARRIVE_TEXT = { passed: '审核通过！', gathered: '已汇总！', clarified: '结论落定！' };
  var FX_BOOT = Date.now(); /* 启动时刻：create 广播的 restore 风暴抑制窗口起点 */

  function onStatusChange(inst, from, to) {
    try {
      if (!inst || !to) return;
      var act = MAP[to];
      if (!act) return;
      /* 同状态去重，但 launch / return 放行：壳建箭头初始即 pending，首轮点箭头送出是
         pending→pending；回注同理，上一轮已回注过的箭头（done/applied）再次点箭头回注
         新结论是 done→done / applied→applied，都是真实操作必须演出
         （复用 60ms 音效节流防连点刷屏） */
      if (from === to && act !== 'launch' && act !== 'return') return;
      /* 创建广播（from=null，内核 v1.2）：页面刷新后 restore 会在数秒内批量重建
         全部箭头并逐个广播创建，启动窗口内忽略，避免每次刷新都全队齐射 */
      if (from === null && Date.now() - FX_BOOT < 12000) return;
      if (act === 'fail') {
        var fc = findChat(inst.dstId);
        if (fc && fc.el) {
          var fr = fc.el.getBoundingClientRect();
          if (fr.width) { var fcx = centerOfRect(fr); burst(fcx.x, fcx.y, '#9e9e9e', 6); }
        }
        return;
      }
      var fromChat = findChat(act === 'return' ? inst.dstId : inst.srcId);
      var toChat = findChat(act === 'return' ? inst.srcId : inst.dstId);
      if (!fromChat || !toChat || !fromChat.el || !toChat.el) return;
      var rFrom = fromChat.el.getBoundingClientRect(), rTo = toChat.el.getBoundingClientRect();
      if (!rFrom.width || !rTo.width) return;
      var a = centerOfRect(rFrom), b = centerOfRect(rTo);
      var color = (inst.statuses && inst.statuses[to] && inst.statuses[to].color) || '#b388ff';
      var vis = fxOn() && !document.hidden;

      if (act === 'arrive') {
        if (vis) {
          var ep = edgePoint(rTo, a.x, a.y);
          burst(ep.x, ep.y, color, 8);
          ring(ep.x, ep.y, color);
          floatText(ep.x, ep.y - 8, ARRIVE_TEXT[to] || '已送达！', color, false, to === 'passed');
        }
        return;
      }

      /* launch / return：出招（弹丸+嗖声+徽标脉冲）→ 命中四件套 */
      if (vis) badgePulse(inst);
      playSnd('arrowLaunch');
      if (!vis) return;
      var epTo = edgePoint(rTo, a.x, a.y);
      var epFrom = edgePoint(rFrom, b.x, b.y);
      travel(epFrom.x, epFrom.y, epTo.x, epTo.y, color, function () {
        hitFX(toChat, epTo, color, inst, act);
      });
    } catch (e) {}
  }

  /* ---------- 命中四件套：抖动+闪光 / 粒子 / 光环 / 浮字 / 命中音 ---------- */
  function hitFX(toChat, ep, color, inst, act) {
    var boxEl = toChat.el;
    if (!boxEl || !boxEl.isConnected) return;
    shakeAndFlash(boxEl, -ep.ux, -ep.uy, color); /* 沿弹道方向推入 */
    burst(ep.x, ep.y, color, 12);
    ring(ep.x, ep.y, color);
    arrowFlash(inst, color);
    var text = act === 'launch' ? '任务送达！' : (to === 'modified' ? '修改完成 ✓' : '结论命中！');
    var crit = false, big = false, gold = false;
    if (act === 'return') {
      var sc = childScore(inst);
      if (sc != null) {
        text = sc >= 90 ? '暴击 ' + sc + ' 分！' : (sc + ' 分！');
        crit = sc >= 90; big = crit; gold = crit;
      }
    }
    if (act === 'launch') {
      var tag = comboTag(String(inst.srcId));
      if (tag) text += tag;
    }
    floatText(ep.x, ep.y - 10, text, color, big, gold);
    playSnd(crit ? 'arrowCrit' : 'arrowHit');
  }

  /* ---------- 接入内核钩子 + 对外 API ---------- */
  window.__zfArrowFxHook = onStatusChange;
  ensureStyle();
  window.ZFArrowFX = {
    isFxOn: fxOn,
    isSfxOn: sfxOn,
    toggleFx: function () { var v = fxOn(); try { localStorage.setItem('zf3d_arrowfx_off', v ? '1' : '0'); } catch (e) {} return !v; },
    toggleSfx: function () { var v = sfxOn(); try { localStorage.setItem('zf3d_arrowsfx_off', v ? '1' : '0'); } catch (e) {} return !v; },
    /* 调试：在画布第一条存活箭头上试放一次「送出」演出 */
    demo: function () {
      var list = (window.ZFArrow && ZFArrow.all()) || [];
      var p = list[0];
      if (!p) { try { console.warn('[ZFArrowFX] 画布上没有箭头，demo 跳过'); } catch (e) {} return false; }
      onStatusChange({ srcId: p.srcId, dstId: p.dstId, statuses: p.statuses, el: p.el, svg: p.svg }, p.status, 'pending');
      return true;
    }
  };
})();
