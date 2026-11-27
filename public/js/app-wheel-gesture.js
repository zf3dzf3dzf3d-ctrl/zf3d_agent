/* ============================================================
 * app-wheel-gesture.js — 滚轮连滚模式切换手势 v3（累计强度版）
 * 依赖真源（已实查）：
 *   window.zfFocusMode.set(on)/isOn()/host(id)   专注模式（app-focus-mode.js:1149）
 *   window.App.canvasOverviewToggle()            缩小整理模式总览开关（app-canvas-overview.js）
 *   body class 'zf-overview-mode'                整理态标记（app-canvas-overview.js:531）
 * 规则（v3：2秒滑动窗口累计滚动量判定，防止过于灵敏误触）：
 *   ① 标准：2秒内向下累计滚动量≥ACC_TH 且向下占比≥DIR_RATIO → 进入缩小整理模式
 *   ② 整理：向上累计达标 → 回标准模式
 *   ③ 标准：悬停对话框上 向上累计达标 → 专注模式（聚焦该对话）
 *   ④ 专注：向下累计达标（阈值更高 ACC_TH_EXIT） → 回标准模式
 * ============================================================ */
(function () {
  'use strict';

  var WINDOW_MS     = 2000;  // 累计判定窗口：2秒
  var ACC_TH        = 2600;  // 累计滚动量阈值（deltaY 累加；一格格滚约需 20+ 下，快速甩约 6~10 下）
  var ACC_TH_EXIT   = 4200;  // 专注模式退出阈值（更高，防止看正文想下翻误退出）
  var ACC_TH_ORG    = 6800;  // 整理模式退出阈值（最高：【兼容缩放】整理态滚轮=以鼠标为锚缩放
                             // （app-canvas-overview.js:270），阈值必须远高于日常缩放用量，
                             // 只有刻意快速甩轮才退出整理态，普通缩放完全不抢 */
  var DIR_RATIO     = 0.85;  // 主方向累计量占比需 ≥85%，反向滚动过多则视为浏览不算手势
  var COOLDOWN_MS   = 1000;  // 触发后冷却

  var acc = 0, accPos = 0, accNeg = 0; // 窗口内累计总量 / 正向累计 / 反向累计
  var events = [];                     // [{t, dy}]
  var lastAction = 0;

  function mode() {
    try { if (window.zfFocusMode && window.zfFocusMode.isOn && window.zfFocusMode.isOn()) return 'focus'; } catch (e) {}
    if (document.body.classList.contains('zf-overview-mode')) return 'organize';
    return 'normal';
  }

  function inEditable(t) {
    if (!t) return true;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true;
    try { if (t.closest && t.closest('input,textarea,select,[contenteditable="true"]')) return true; } catch (e) {}
    return false;
  }

  // 在可滚动容器中间滚动 → 放行阅读不计数；到边界继续滚 → 计数
  function insideScrollableMiddle(e) {
    var el = e.target;
    while (el && el !== document.body) {
      try {
        var s = getComputedStyle(el);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
          var atTop = el.scrollTop <= 0;
          var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) return false;
          return true;
        }
      } catch (err) { return true; }
      el = el.parentElement;
    }
    return false;
  }

  function toast(msg) {
    try { if (window.showToast) window.showToast(msg); else console.log('[滚轮手势] ' + msg); } catch (e) {}
  }

  function resetAcc() { acc = 0; accPos = 0; accNeg = 0; events = []; }

  function doAction(m, d, e) {
    var now = Date.now();
    if (now - lastAction < COOLDOWN_MS) return;
    var app = window.App || {};

    if (m === 'normal' && d > 0 && typeof app.canvasOverviewToggle === 'function') {
      lastAction = now; resetAcc();
      app.canvasOverviewToggle();
      toast('⬇ 甩轮：已进入 i缩小整理模式');
      return;
    }
    if (m === 'organize' && d < 0 && typeof app.canvasOverviewToggle === 'function') {
      lastAction = now; resetAcc();
      app.canvasOverviewToggle();
      toast('⬆ 甩轮：已回到画布标准模式');
      return;
    }
    if (m === 'normal' && d < 0 && window.zfFocusMode && typeof window.zfFocusMode.set === 'function') {
      var box = null;
      try { box = e.target.closest && e.target.closest('.chatbox'); } catch (err) {}
      if (!box) return; // 必须悬停在对话框上，空白处上滚不触发
      lastAction = now; resetAcc();
      window.zfFocusMode.set(true);
      var id = box.id;
      setTimeout(function () {
        try { if (id && window.zfFocusMode.host) window.zfFocusMode.host(id); } catch (err) {}
      }, 80);
      toast('⬆ 甩轮：已进入专注模式');
      return;
    }
    if (m === 'focus' && d > 0 && window.zfFocusMode && typeof window.zfFocusMode.set === 'function') {
      lastAction = now; resetAcc();
      window.zfFocusMode.set(false);
      toast('⬇ 快速甩轮：已退出专注模式');
      return;
    }
  }

  document.addEventListener('wheel', function (e) {
    if (inEditable(e.target) || e.ctrlKey) { resetAcc(); return; }
    if (insideScrollableMiddle(e)) { resetAcc(); return; } // 阅读滚动立即清零，绝不误触

    var now = Date.now();
    // 滑动窗口：丢弃2秒外的事件
    while (events.length && now - events[0].t > WINDOW_MS) {
      var old = events.shift();
      acc -= Math.abs(old.dy);
      if (old.dy > 0) accPos -= old.dy; else accNeg += old.dy;
    }

    var dy = e.deltaY;
    if (!dy) return;
    events.push({ t: now, dy: dy });
    acc += Math.abs(dy);
    if (dy > 0) accPos += dy; else accNeg += dy; // accNeg 为负数累计

    var total = accPos - accNeg; // |dy|为0时不受影响；主方向判定：
    var mainDy = Math.max(accPos, -accNeg);
    if (mainDy < ACC_TH && acc < ACC_TH) return;
    var mainDir = accPos >= -accNeg ? 1 : -1;
    var mainAcc = mainDir > 0 ? accPos : -accNeg;
    // 主方向占比不足 → 用户在来回浏览，清零重来
    if (mainAcc / acc < DIR_RATIO) { resetAcc(); return; }

    // 阈值：专注退出 / 整理退出用更高门槛（整理态滚轮是缩放，绝不能抢）
    var m = mode();
    var th = ACC_TH;
    if (mainDir > 0 && m === 'focus') th = ACC_TH_EXIT;
    if (mainDir < 0 && m === 'organize') th = ACC_TH_ORG;
    if (mainAcc >= th) doAction(m, mainDir, e);
  }, { passive: true, capture: true });
})();
