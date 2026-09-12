/* ============================================================
 * app-quick-note-dock.js - 随手标题「钉到左侧」停靠栏（任务本式）
 * 功能：
 *  1) 按住任意随手标题拖到屏幕左缘（约 48px 热区）松手 → 钉住：
 *     画布上的标题收起，左侧屏幕固定位置出现一个常驻 chip（不随画布平移缩放）。
 *  2) 一个标题可连多个对话（复用 app-quick-note-link.js 的连线），
 *     钉住后 chip 上有折叠按钮 ▾/▸，可收纳/展开其连线对话。
 *  3) 把 chip 从左栏拖出去（x > 140px）松手 → 解除钉住，
 *     标题回到无限画布世界坐标，落点=松手位置。
 *  4) 持久化：UserSettings/localStorage 键 zf3d_qn_dock（按钉住顺序）。
 * 零侵入：不改 app-quick-note.js / app-quick-note-link.js，只读其 API。
 * 加载顺序：app-quick-note.js 与 app-quick-note-link.js 之后。
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'zf3d_qn_dock';
  var docked = [];            // [{id, text}] 按钉住顺序
  var bar = null, zone = null;
  var _saveTimer = null;

  function loadAll() {
    try {
      var raw = (window.UserSettings && UserSettings.get(LS_KEY, null)) || localStorage.getItem(LS_KEY);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (Array.isArray(raw)) docked = raw.filter(function (n) { return n && n.id; });
    } catch (e) { docked = []; }
  }
  function saveAll() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        if (window.UserSettings) UserSettings.set(LS_KEY, docked);
        else localStorage.setItem(LS_KEY, JSON.stringify(docked));
      } catch (e) {}
    }, 300);
  }

  function isDocked(id) {
    return docked.some(function (d) { return d.id === id; });
  }

  // 把画布上的标题 DOM 摘掉（数据仍在 QuickNote._notes 里，解除钉住时还原）
  function stripCanvasEl(id) {
    var el = document.querySelector('.quick-note[data-qn-id="' + id + '"]');
    if (el) el.remove();
  }

  function sfx(name) {
    try { window.dispatchEvent(new CustomEvent('zf-sfx', { detail: { name: name } })); } catch (e) {}
  }

  // ---- 钉住 ----
  function dockNote(id) {
    if (isDocked(id)) return;
    var n = (window.QuickNote && QuickNote.all() || []).find(function (x) { return x.id === id; });
    if (!n) return;
    docked.push({ id: id, text: n.text });
    stripCanvasEl(id);
    saveAll(); render(); redrawLinks();
    sfx('link');
  }

  // ---- 解除钉住（cx/cy 为屏幕坐标落点，可选）----
  function undockNote(id, cx, cy) {
    var i = docked.findIndex(function (d) { return d.id === id; });
    if (i < 0) return;
    docked.splice(i, 1);
    saveAll(); render();
    // 回到世界坐标：更新 note 位置并重渲染
    try {
      var notes = window.QuickNote && QuickNote._internal && QuickNote._internal.notes();
      var note = notes && notes.find(function (x) { return x.id === id; });
      if (note) {
        if (typeof cx === 'number' && typeof cy === 'number') {
          var p = screenToCanvas(cx, cy);
          note.x = Math.round(p.x); note.y = Math.round(p.y);
        }
        // 防御：若画布上已存在同 id 元素（钉住期间兜底轮询与重放的竞态），先摘掉再重建
        stripCanvasEl(id);
        QuickNote._internal.render(note);
        QuickNote._internal.saveAll();
        // 【修复】端点元素已重建，必须让连线层下次全量重建：
        // redraw 的拓扑签名优化会沿用旧签名，被摘掉的线永远不会重画
        try { if (window.QuickNoteLinks && QuickNoteLinks.invalidate) QuickNoteLinks.invalidate(); } catch (e2) {}
      }
    } catch (e) {}
    redrawLinks();
    sfx('pop');
  }

  // 屏幕坐标 → canvasContent 本地（世界）坐标
  function screenToCanvas(cx, cy) {
    var host = document.getElementById('canvasContent') || document.body;
    var r = host.getBoundingClientRect();
    var sc = 1;
    try {
      var t = getComputedStyle(host).transform;
      if (t && t !== 'none') {
        var m = t.match(/matrix\(([^,]+),/);
        if (m) sc = Math.abs(parseFloat(m[1])) || 1;
      }
    } catch (e) {}
    return { x: (cx - r.left) / sc, y: (cy - r.top) / sc };
  }

  function redrawLinks() {
    try { window.QuickNoteLinks && QuickNoteLinks.redraw(); } catch (e) {}
  }

  // ---- 渲染左侧停靠栏 ----
  function render() {
    if (!bar) return;
    bar.innerHTML = '';
    docked.forEach(function (d) {
      var chip = document.createElement('div');
      chip.className = 'qn-dock-chip';
      chip.dataset.qnId = d.id;
      chip.title = (d.text || '(空标题)') + ' · 拖出左栏可放回画布';

      var txt = document.createElement('span');
      txt.className = 'qn-dock-text';
      var full = d.text || '(空标题)';
      txt.textContent = full.length > 4 ? full.slice(0, 4) : full;
      txt.addEventListener('dblclick', function (e) { e.stopPropagation(); startEditChip(d.id, txt); });

      chip.appendChild(txt);

      // 拖出左栏 → 放回画布
      chip.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('.qn-dock-pin') || e.target.closest('.qn-dock-fold')) return;
        e.stopPropagation(); e.preventDefault();
        var sx = e.clientX, sy = e.clientY, moved = false;
        function onMove(ev) {
          if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
          moved = true;
          chip.classList.add('qn-dock-dragging');
        }
        function onUp(ev) {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          chip.classList.remove('qn-dock-dragging');
          if (moved && ev.clientX > 140) undockNote(d.id, ev.clientX, ev.clientY);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      bar.appendChild(chip);
    });
    bar.classList.toggle('is-empty', docked.length === 0);
  }

  // chip 上双击重命名（同步回 QuickNote 数据）
  function startEditChip(id, txt) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qn-input';
    input.value = txt.textContent;
    txt.style.display = 'none';
    txt.parentNode.insertBefore(input, txt);
    input.focus(); input.select();
    var done = false;
    function commit() {
      if (done) return; done = true;
      var v = input.value.trim();
      input.remove();
      txt.style.display = '';
      if (!v) return;
      txt.textContent = v;
      var d = docked.find(function (x) { return x.id === id; });
      if (d) d.text = v;
      try {
        var notes = window.QuickNote && QuickNote._internal && QuickNote._internal.notes();
        var note = notes && notes.find(function (x) { return x.id === id; });
        if (note) { note.text = v; QuickNote._internal.saveAll(); }
      } catch (e) {}
      saveAll();
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') commit();
    });
    input.addEventListener('blur', commit);
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  }

  // ---- 画布侧：拖随手标题到左缘热区 → 钉住 ----
  // 用 capture 阶段监听，quick-note 内部 stopPropagation 不影响
  function setupCanvasDrop() {
    var draggingId = null;
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var ne = e.target.closest && e.target.closest('.quick-note[data-qn-id]');
      if (!ne) return;
      if (e.target.closest('.qn-del') || e.target.closest('.qn-ball') || e.target.closest('.qn-fold')) return;
      draggingId = ne.dataset.qnId;
      if (zone) zone.classList.add('qn-zone-active');
    }, true);
    document.addEventListener('mouseup', function (e) {
      if (zone) zone.classList.remove('qn-zone-active');
      if (!draggingId) return;
      var id = draggingId; draggingId = null;
      if (e.clientX <= 48) dockNote(id);
    }, true);
  }

  // ---- 启动 ----
  function boot() {
    loadAll();
    // 左缘热区
    zone = document.createElement('div');
    zone.id = 'qnDockZone';
    document.body.appendChild(zone);
    // 停靠栏（fixed，屏幕恒定位置）
    bar = document.createElement('div');
    bar.id = 'qnDockBar';
    document.body.appendChild(bar);
    render();
    setupCanvasDrop();
    // 兜底：quick-note.js 因设置刷新重放后，把已钉住的画布标题再次摘掉
    setInterval(function () {
      docked.forEach(function (d) { stripCanvasEl(d.id); });
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  } else {
    setTimeout(boot, 800);
  }

  // ---- 导出 API ----
  window.QuickNoteDock = {
    dock: dockNote,
    undock: undockNote,
    isDocked: isDocked,
    render: render,
    all: function () { return JSON.parse(JSON.stringify(docked)); }
  };
})();
