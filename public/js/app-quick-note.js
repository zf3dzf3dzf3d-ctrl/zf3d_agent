/* ============================================================
 * app-quick-note.js - 随手标题（画布便签标记）
 * 功能：在创建对话框中点击「随手标题」，在画布对应位置创建一个小标签；
 *      回车确认 / 双击可再编辑 / 空内容回车取消 / 悬停出 ✕ 直接删除 / 可拖动。
 * 节点挂在 canvasContent 内，随画布平移缩放（用户确认：跟随画布）。
 * 持久化：UserSettings（localStorage + 服务器 user_settings.json），键 zf3d_quick_notes。
 * 加载顺序：放在 app-kite-links.js 之后即可（仅依赖 window.UserSettings 延迟取用）。
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'zf3d_quick_notes';
  var _notes = [];        // [{id, x, y, text}]
  var _seq = 0;
  var _saveTimer = null;

  function hostEl() {
    return document.getElementById('canvasContent') || document.body;
  }

  function loadAll() {
    try {
      var raw = (window.UserSettings && UserSettings.get(LS_KEY, null)) || localStorage.getItem(LS_KEY);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (Array.isArray(raw)) _notes = raw.filter(function (n) { return n && typeof n.x === 'number' && typeof n.y === 'number'; });
    } catch (e) { _notes = []; }
    return _notes;
  }

  function saveAll() {
    // 防抖 300ms 合并写
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        if (window.UserSettings) UserSettings.set(LS_KEY, _notes);
        else localStorage.setItem(LS_KEY, JSON.stringify(_notes));
      } catch (e) {}
    }, 300);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---- 撤销/重做记录（走画布菜单 CanvasMenu 统一历史栈）----
  function recordQn(op) {
    try {
      if (window.__qnApplying) return; // 撤销/重做回放期间不再记录
      if (window.CanvasMenu && typeof CanvasMenu.record === 'function') CanvasMenu.record(op);
    } catch (e) {}
  }

  // ---- 渲染单个节点 ----
  function render(note) {
    var host = hostEl();
    var el = document.createElement('div');
    el.className = 'quick-note';
    el.dataset.qnId = note.id;
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.title = '双击编辑 · 拖动移动 · ✕ 删除';
    // 初始位置在屏幕左侧时保持收窄（刷新/恢复后仍生效）
    requestAnimationFrame(function () {
      try { if (el.getBoundingClientRect().left <= 100) el.classList.add('qn-narrow'); } catch (e) {}
    });
    el.innerHTML =
      '<span class="qn-icon">📍</span>' +
      '<span class="qn-text">' + esc(note.text) + '</span>' +
      '<button type="button" class="qn-del" title="删除随手标题">✕</button>';

    // 删除（直接删，用户已确认不要二次确认）
    el.querySelector('.qn-del').addEventListener('click', function (e) {
      e.stopPropagation();
      remove(note.id);
    });

    // 双击进入编辑
    el.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      if (e.target.closest('.qn-ball') || e.target.closest('.qn-fold')) return;
      startEdit(note.id);
    });

    // 拖动（按住标签主体拖动；按下后移动超过 3px 才算拖动，避免干扰双击）
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      // 连线小圆球 / 折叠按钮 / 删除按钮：不触发标题拖动
      if (e.target.closest('.qn-del') || e.target.closest('.qn-ball') || e.target.closest('.qn-fold')) return;
      // 阻止冒泡，避免触发画布整体平移（拖拽的应是标签本身）
      e.stopPropagation();
      var startX = e.clientX, startY = e.clientY;
      var nx = note.x, ny = note.y;
      var moved = false;
      // 联动：拖标题时连线对话框保持相对位置跟随（快照偏移）
      var followSnap = null;
      try { if (window.QuickNoteLinks && QuickNoteLinks.beginFollow) followSnap = QuickNoteLinks.beginFollow(note.id); } catch (err) {}
      function onMove(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;
        e.preventDefault();
        nx = note.x + dx / _scale(); ny = note.y + dy / _scale();
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        // 拖到屏幕左侧时收窄（宽度不超过 40px），离开后恢复
        if (el.getBoundingClientRect().left <= 100) el.classList.add('qn-narrow');
        else el.classList.remove('qn-narrow');
        try { if (followSnap && QuickNoteLinks.applyFollow) QuickNoteLinks.applyFollow(followSnap, nx, ny); } catch (err) {}
        // 松手后仍按最终位置决定是否保持收窄
        if (el.getBoundingClientRect().left <= 100) el.classList.add('qn-narrow');
        else el.classList.remove('qn-narrow');
      }
      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          var fx = note.x, fy = note.y;
          note.x = nx; note.y = ny;
          saveAll();
          try { if (followSnap && QuickNoteLinks.endFollow) QuickNoteLinks.endFollow(followSnap); } catch (err) {}
          recordQn({ type: 'qn-note-move', label: '移动随手标题', id: note.id, from: { x: fx, y: fy }, to: { x: nx, y: ny } });
          ev.stopPropagation(); e.preventDefault();
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    host.appendChild(el);
    note._el = el;
    return el;
  }

  // 画布缩放比例（canvasContent 的 transform scale），拖动时抵消
  function _scale() {
    try {
      var t = getComputedStyle(hostEl()).transform;
      if (t && t !== 'none') {
        var m = t.match(/matrix\(([^,]+),/);
        if (m) return Math.abs(parseFloat(m[1])) || 1;
      }
    } catch (e) {}
    return 1;
  }

  // ---- 编辑态：input 小输入框，回车确认，空回车取消 ----
  function startEdit(id) {
    var note = _notes.find(function (n) { return n.id === id; });
    if (!note) return;
    var el = note._el;
    if (!el || !document.body.contains(el)) el = render(note);
    el.classList.add('qn-editing');
    var textSpan = el.querySelector('.qn-text');
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qn-input';
    input.value = note.text;
    textSpan.style.display = 'none';
    textSpan.parentNode.insertBefore(input, textSpan);
    input.focus();
    input.select();

    var _committed = false;
    function commit() {
      if (_committed || !input.isConnected) return; // 防止 remove 触发 blur 导致二次 commit 报错
      _committed = true;
      var v = input.value.trim();
      input.remove();
      textSpan.style.display = '';
      el.classList.remove('qn-editing');
      if (!v) {
        // 新建时空内容回车 → 取消；已有内容时空回车 → 保留原文
        if (!note.text) remove(id);
        return;
      }
      if (v !== note.text) {
        var oldText = note.text;
        note.text = v;
        textSpan.textContent = v;
        saveAll();
        recordQn({ type: 'qn-note-rename', label: '重命名随手标题', id: id, from: oldText, to: v });
      }
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation(); // 不让画布快捷键接管
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') {
        input.value = note.text; commit(); // Esc 取消修改
      }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }

  // ---- 新建 ----
  function create(canvasX, canvasY, initialText) {
    var note = { id: 'qn' + Date.now() + '_' + (++_seq), x: Math.round(canvasX), y: Math.round(canvasY), text: initialText || '' };
    _notes.push(note);
    render(note);
    saveAll();
    recordQn({ type: 'qn-note-add', label: '新建随手标题', note: JSON.parse(JSON.stringify(note)) });
    startEdit(note.id);
    return note;
  }

  // ---- 删除 ----
  function removeNote(id) {
    var idx = _notes.findIndex(function (n) { return n.id === id; });
    if (idx < 0) return null;
    var el = _notes[idx]._el;
    if (el && el.parentNode) el.remove();
    var snapshot = JSON.parse(JSON.stringify({ note: _notes[idx], index: idx }));
    _notes.splice(idx, 1);
    saveAll();
    return snapshot;
  }
  function remove(id) {
    var snap = removeNote(id);
    if (snap) recordQn({ type: 'qn-note-remove', label: '删除随手标题', note: snap.note, index: snap.index });
  }

  // ---- 恢复所有已保存的标题 ----
  function restoreAll() {
    loadAll().forEach(render);
  }

  // ---- 导出 API ----
  window.QuickNote = {
    create: create,
    remove: remove,
    restoreAll: restoreAll,
    all: function () { return _notes.slice(); },
    // ---- 撤销/重做内部句柄（供 app-undo.js 回放）----
    _internal: {
      notes: function () { return _notes; },
      render: render,
      removeNote: removeNote,
      saveAll: saveAll
    }
  };

  // 页面就绪后恢复（延迟等 UserSettings 服务器数据到达；并在设置刷新后重放，防止被服务器覆盖丢失）
  function _safeRestoreAll() {
    // 先把已渲染的清掉再重放，避免重复
    _notes.forEach(function (n) { if (n._el && n._el.parentNode) n._el.remove(); n._el = null; });
    restoreAll();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_safeRestoreAll, 500); });
  } else {
    setTimeout(_safeRestoreAll, 500);
  }
  window.addEventListener('user-settings-refreshed', function () {
    setTimeout(_safeRestoreAll, 50);
  });
})();
