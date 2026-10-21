/* ========== panel-settings-drag.js - 设置面板：仅整体拖动平移（缩放/拖拽改大小已按需求禁用） ==========
 * 依赖：index.html 中 .settings-modal（dom-settings-panel.js 注入）、window.UserSettings（localStorage）
 * 键：settingsWin = JSON.stringify({ x, y, w, h })（历史字段，现只用 x/y）
 */
(function () {
  var KEY = 'settingsWin';
  var MIN_W = 480, MIN_H = 320;
  var EDGE = 24; // 缩放柄留白：保证 W/H 上下限留出屏幕边缘，缩放柄永远可见可抓

  function getModal() { return document.querySelector('#settingsOverlay .settings-modal'); }
  function loadPrefs() {
    try {
      var raw = window.UserSettings && UserSettings.get(KEY);
      if (!raw) return null;
      var p = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // 只信任 x/y/w/h 四个字段（历史上误存过 sx/sy/dir 等缩放临时字段，需剔除）
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.w) && Number.isFinite(p.h)) {
        return { x: p.x, y: p.y, w: p.w, h: p.h };
      }
    } catch (e) {}
    return null;
  }
  function savePrefs(p) {
    try { if (window.UserSettings) UserSettings.set(KEY, JSON.stringify({ x: p.x, y: p.y, w: p.w, h: p.h })); } catch (e) {}
  }
  function clamp(p) {
    var vw = window.innerWidth, vh = window.innerHeight;
    // 硬上限：宽高都不允许超过视口（留一点边缘），下限取 min(MIN, 视口) 防极小窗口死锁
    p.w = Math.min(p.w, vw - 16);
    p.h = Math.min(p.h, vh - EDGE);
    p.w = Math.max(Math.min(MIN_W, vw - 16), p.w);
    p.h = Math.max(Math.min(MIN_H, vh - EDGE), p.h);
    // 位置保证面板完整留在视口内（视口比面板还小时贴 0）
    p.x = Math.max(0, Math.min(p.x, Math.max(0, vw - p.w)));
    p.y = Math.max(0, Math.min(p.y, Math.max(0, vh - p.h)));
    return p;
  }
  function apply(m, p) {
    // 存档里 w/h 已归零（只记位置不记尺寸）：用面板当前真实尺寸参与钳制，
    // 否则 clamp 会按 480×320 下限算边界，导致恢复出的位置在窄屏上右侧/底部溢出。
    if (!p.w || !p.h) {
      var r0 = m.getBoundingClientRect();
      if (r0.width) p.w = r0.width;
      if (r0.height) p.h = r0.height;
    }
    clamp(p);
    // 修复「移动1缩放2」：.modal 弹出 transition 会让几何滞后，拖拽期间读到中间值导致基准被污染。
    m.classList.add('settings-no-anim');
    // 只平移不改尺寸：保持 CSS 默认尺寸（90vw/max960 × 85vh/max780，即 5.5.0 大小），
    // 不再加 .is-user-resized（其 width:auto !important 会清掉默认尺寸导致面板被内容撑大）
    m.style.setProperty('position', 'fixed', 'important');
    m.style.setProperty('left', p.x + 'px', 'important');
    m.style.setProperty('top', p.y + 'px', 'important');
    m.style.setProperty('right', 'auto', 'important');
    m.style.setProperty('bottom', 'auto', 'important');
    m.style.setProperty('margin', '0', 'important');
    // 只平移不改尺寸：不再强制设置 width/height（缩放功能已禁用）
    void m.offsetWidth; /* 强制回流，几何立即生效 */
  }

  // ===== 打开时恢复记忆的位置与大小 =====
  function restoreOnOpen() {
    var overlay = document.getElementById('settingsOverlay');
    if (!overlay || overlay.__dragRestoreBound) return;
    overlay.__dragRestoreBound = true;
    var obs = new MutationObserver(function () {
      if (!overlay.classList.contains('show')) return;
      var m = getModal();
      var p = loadPrefs();
      if (m && p) apply(m, p);
      // 一次性清理：历史版本存过被撑大的 w/h，恢复 5.5.0 默认尺寸后不再需要
      if (p && (p.w || p.h)) { try { if (window.UserSettings) UserSettings.set(KEY, JSON.stringify({ x: p.x, y: p.y, w: 0, h: 0 })); } catch (e) {} }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  // ===== 注入缩放柄并绑定拖动/缩放 =====
  function init() {
    var m = getModal();
    if (!m || m.__dragInit) return;
    m.__dragInit = true;

    // 1) 缩放柄/边缘热区已按需求禁用（只允许平移）：不再注入，也不绑定任何 resize
    var handle = m.querySelector('.settings-resize-handle');
    if (handle) { handle.style.display = 'none'; }
    m.querySelectorAll('.settings-edge-n,.settings-edge-s,.settings-edge-e,.settings-edge-w,.settings-edge-ne,.settings-edge-nw,.settings-edge-se,.settings-edge-sw').forEach(function (hz) { hz.remove(); });

    // 2) 拖动平移：顶部拖拽条 #settingsDragBar 与左侧导航标题栏（⚙️ 设置）两处都可拖。
    //    统一走同一套「位置记忆」逻辑（apply→position:fixed + savePrefs→UserSettings），
    //    松手即存档、下次打开/重启自动恢复（restoreOnOpen），实现「拖拽后记住位置」。
    var p = loadPrefs() || null;

    function currentRect() {
      var r = m.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    function bindDragZone(dragZone) {
      if (!dragZone || dragZone.__dragMemBound) return;
      dragZone.__dragMemBound = true;
      dragZone.style.cursor = 'move';
      var drag = null;
      dragZone.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        // 不拦截关闭按钮
        if (e.target.closest && e.target.closest('.settings-close-btn')) return;
        var r = currentRect();
        drag = { sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, rect: r };
        try { dragZone.setPointerCapture(e.pointerId); } catch (ex) {}
        // 顶部条 hover/拖拽视觉（旧内联拖拽同款 class，纯样式反馈）
        if (dragZone.id === 'settingsDragBar') dragZone.classList.add('is-dragging');
        e.preventDefault();
      });
      dragZone.addEventListener('pointermove', function (e) {
        if (!drag) return;
        if (!p) { p = drag.rect; apply(m, p); } // 延迟到首次移动再切 fixed，避免一帧跳动
        p = drag.rect;
        p.x = drag.ox + (e.clientX - drag.sx);
        p.y = drag.oy + (e.clientY - drag.sy);
        apply(m, p);
      });
      function endDrag(e) {
        if (!drag) return;
        drag = null;
        try { dragZone.releasePointerCapture(e.pointerId); } catch (ex) {}
        if (dragZone.id === 'settingsDragBar') dragZone.classList.remove('is-dragging');
        // 结束时以面板实际位置为准存档（p 可能尚未在无移动时更新）
        p = currentRect();
        apply(m, p);
        setTimeout(function () { m.classList.remove('settings-no-anim'); }, 60);
        savePrefs(p);
      }
      dragZone.addEventListener('pointerup', endDrag);
      dragZone.addEventListener('pointercancel', endDrag);
    }

    // 顶部拖拽条 + 左侧标题栏都接管为「可记忆平移」
    var _topBar = document.getElementById('settingsDragBar');
    bindDragZone(_topBar);
    bindDragZone(m.querySelector('.settings-nav-header') || m.querySelector('.settings-close-btn'));
    // 标记顶部条已被本脚本接管，避免 inline-04 的 _initSettingsDragMove（transform 平移、关闭即复位、不记忆）重复绑定冲突
    if (_topBar) _topBar.dataset.bound = '1';

    // 3) 双击拖动条/导航标题栏：恢复默认大小与位置
    function resetToDefault() {
      try { if (window.UserSettings) UserSettings.set(KEY, ''); } catch (e) {}
      try { localStorage.removeItem(KEY); } catch (e) {}
      m.classList.remove('is-user-resized');
      ['position', 'left', 'top', 'width', 'height', 'min-width', 'min-height', 'margin', 'right', 'bottom', 'transform'].forEach(function (k) { m.style.removeProperty(k); });
      p = null;
    }
    [document.getElementById('settingsDragBar'), m.querySelector('.settings-nav-header')].forEach(function (el) {
      if (el) el.addEventListener('dblclick', function (e) {
        if (e.target.closest && e.target.closest('.settings-close-btn')) return;
        resetToDefault();
      });
    });

    // 缩放柄已禁用（恢复 5.5.0 固定尺寸行为）：不注入、不绑定 resize
    void 0;

    // 缩放绑定整体移除：设置面板只允许平移，不允许拖拽放大/缩小（含四边/四角热区）

    // 窗口尺寸变化时兜底校正
    window.addEventListener('resize', function () {
      if (p && m.style.getPropertyValue('position') === 'fixed') apply(m, p);
    });
  }

  function boot() {
    restoreOnOpen();
    // 弹窗由 dom-settings-panel.js 同步注入，此时多半已在 DOM 中
    init();
    // 兜底：若注入晚于本脚本，监听一次
    if (!getModal() || !getModal().__dragInit) {
      var obs = new MutationObserver(function () {
        var m = getModal();
        if (m && !m.__dragInit) { init(); if (m.__dragInit) obs.disconnect(); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      // 兜底观察器 15 秒后自动断开，避免 modal 永不注入时常驻开销
      setTimeout(function () { try { obs.disconnect(); } catch (e) {} }, 15000);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
