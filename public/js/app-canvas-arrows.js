/* ============================================================
 * app-canvas-arrows.js - 画布方向箭头（无限画布小图标）
 * 功能：
 *  - 在双击创建面板「随手标题」下方点击「方向箭头」→ 画布对应位置创建一个箭头；
 *  - 拖动箭头主体 → 调整位置；
 *  - 按住箭头尾部的圆形手柄拖拽 → 调整方向（任意角度）；
 *  - 单击箭头主体（未拖动）→ 反转方向（+180°）；
 *  - 悬停出现 ✕ → 删除；
 *  - 可放任意多个，位置持久化（UserSettings，键 zf3d_canvas_arrows）。
 * 节点挂在 canvasContent 内，随画布平移缩放（与随手标题一致）。
 * 依赖：window.UserSettings（延迟取用），挂 canvasContent。
 * 加载顺序：app-quick-note.js 之后即可。
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'zf3d_canvas_arrows';
  var _arrows = [];   // [{id, x, y, angle}]
  var _seq = 0;
  var _saveTimer = null;

  function hostEl() {
    return document.getElementById('canvasContent') || document.body;
  }

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

  function loadAll() {
    try {
      var raw = (window.UserSettings && UserSettings.get(LS_KEY, null)) || localStorage.getItem(LS_KEY);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (Array.isArray(raw)) _arrows = raw.filter(function (a) {
        return a && typeof a.x === 'number' && typeof a.y === 'number' && typeof a.angle === 'number';
      });
    } catch (e) { _arrows = []; }
    return _arrows;
  }

  function saveAll() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        if (window.UserSettings) UserSettings.set(LS_KEY, _arrows);
        else localStorage.setItem(LS_KEY, JSON.stringify(_arrows));
      } catch (e) {}
    }, 300);
  }

  function norm(a) { return ((a % 360) + 360) % 360; }

  // ---- 渲染单个箭头 ----
  function render(a) {
    var host = hostEl();
    var el = document.createElement('div');
    el.className = 'canvas-arrow';
    el.dataset.arrowId = a.id;
    el.style.left = a.x + 'px';
    el.style.top = a.y + 'px';
    el.title = '单击反转方向 · 拖动移动 · 拖圆点调方向 · ✕删除';
    el.innerHTML =
      '<div class="ca-body">' +
        '<svg viewBox="0 0 48 24" class="ca-svg"><path d="M2 12 H34 M34 12 L24 5 M34 12 L24 19" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</div>' +
      '<div class="ca-handle" title="拖动调整方向"></div>' +
      '<button type="button" class="ca-del" title="删除箭头">✕</button>';
    _applyAngle(el, a.angle);

    el.querySelector('.ca-del').addEventListener('click', function (e) {
      e.stopPropagation();
      remove(a.id);
    });

    // 方向手柄：按住拖拽调整角度
    el.querySelector('.ca-handle').addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      var hostRect = hostEl().getBoundingClientRect();
      var sc = _scale();
      function onMove(ev) {
        // 箭头中心（画布内坐标）
        var cx = a.x + 24, cy = a.y + 12; // 已用画布内坐标，与 mx/my 同系
        var mx = (ev.clientX - hostRect.left) / sc;
        var my = (ev.clientY - hostRect.top) / sc;
        a.angle = norm(Math.atan2(my - cy, mx - cx) * 180 / Math.PI);
        _applyAngle(el, a.angle);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveAll();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 主体：拖动移动位置；未移动的单击 → 反转
    el.querySelector('.ca-body').addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      var startX = e.clientX, startY = e.clientY;
      var nx = a.x, ny = a.y, moved = false;
      function onMove(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;
        ev.preventDefault();
        nx = a.x + dx / _scale(); ny = a.y + dy / _scale();
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
      }
      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          a.x = Math.round(nx); a.y = Math.round(ny);
          saveAll();
          ev.stopPropagation(); ev.preventDefault();
        } else {
          // 单击反转
          a.angle = norm(a.angle + 180);
          _applyAngle(el, a.angle);
          saveAll();
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    host.appendChild(el);
    a._el = el;
    return el;
  }

  function _applyAngle(el, angle) {
    el.style.setProperty('--ca-angle', angle + 'deg');
  }

  // ---- 新建 ----
  function create(canvasX, canvasY) {
    var a = { id: 'ca' + Date.now() + '_' + (++_seq), x: Math.round(canvasX), y: Math.round(canvasY), angle: 0 };
    _arrows.push(a);
    render(a);
    saveAll();
    return a;
  }

  // ---- 删除 ----
  function remove(id) {
    var idx = _arrows.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    if (_arrows[idx]._el && _arrows[idx]._el.parentNode) _arrows[idx]._el.remove();
    _arrows.splice(idx, 1);
    saveAll();
  }

  function restoreAll() {
    loadAll().forEach(render);
  }

  window.CanvasArrows = {
    create: create,
    remove: remove,
    restoreAll: restoreAll,
    all: function () { return _arrows.slice(); }
  };

  // 页面就绪后恢复
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(restoreAll, 600); });
  } else {
    setTimeout(restoreAll, 600);
  }
  window.addEventListener('user-settings-refreshed', function () {
    setTimeout(function () {
      _arrows.forEach(function (a) { if (a._el && a._el.parentNode) a._el.remove(); a._el = null; });
      restoreAll();
    }, 80);
  });
})();
