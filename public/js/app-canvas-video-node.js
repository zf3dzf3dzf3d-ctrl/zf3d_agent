/* ============================================================
 * app-canvas-video-node.js - 无限画布「AI 视频剪辑」节点
 * 仿 PresNode：可拖拽浮动窗口，iframe 内嵌 /video-studio.html。
 * 入口：
 *   1. 顶栏「⋯ 更多」下拉 → 🎬 视频剪辑
 *   2. 控制台：VideoNode.add()
 * 挂 window.VideoNode
 * ============================================================ */
(function () {
  'use strict';

  var Z = 9400;
  var _seq = 0;
  var _nodes = [];

  function _canvas() { return document.getElementById('canvasArea'); }
  function toast(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[VideoNode]', msg); } catch (e2) {}
  }

  function add(x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) { toast('画布未就绪'); return null; }
    if (x == null) {
      var r = canvas.getBoundingClientRect();
      x = Math.round(r.width / 2 - 330 + (_seq % 5) * 40 + (canvas.scrollLeft || 0));
      y = Math.round(r.height / 2 - 240 + (_seq % 5) * 34 + (canvas.scrollTop || 0));
    }
    w = w || 660; h = h || 600;

    var id = 'video-node-' + (++_seq);
    var el = document.createElement('div');
    el.className = 'video-node'; /* 供画布 _isCanvasBlankTarget 排除，防止画布平移/框选抢事件 */
    el.id = id;
    el.style.cssText = 'position:absolute;z-index:' + (Z + _seq) + ';left:' + x + 'px;top:' + y + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;background:#0d0f14;' +
      'border:1px solid #3a4150;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);' +
      'display:flex;flex-direction:column;overflow:hidden;min-width:480px;min-height:380px;';

    /* ---- 标题栏 ---- */
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;' +
      'background:#161b22;border-bottom:1px solid #2a3140;cursor:move;user-select:none;flex:0 0 auto;';
    var dot = document.createElement('span');
    dot.textContent = '🎬';
    dot.style.cssText = 'font-size:14px;';
    var title = document.createElement('span');
    title.textContent = 'AI 视频剪辑';
    title.style.cssText = 'flex:1;color:#c8ceda;font-size:12px;';
    var btnPop = document.createElement('button');
    btnPop.textContent = '⤢ 独立窗口';
    btnPop.style.cssText = 'background:#2a3140;color:#c8ceda;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;';
    btnPop.addEventListener('click', function () { window.open('/video-studio.html', '_blank'); });
    var btnClose = document.createElement('button');
    btnClose.textContent = '✕';
    btnClose.style.cssText = 'background:#3a2530;color:#ff8a8a;border:none;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:12px;';
    btnClose.addEventListener('click', function () {
      var i = _nodes.indexOf(el); if (i >= 0) _nodes.splice(i, 1);
      el.remove(); _saveLayouts();
    });
    bar.appendChild(dot); bar.appendChild(title); bar.appendChild(btnPop); bar.appendChild(btnClose);

    /* ---- 内容区（iframe）---- */
    var view = document.createElement('iframe');
    view.style.cssText = 'flex:1;border:none;width:100%;background:#0d0f14;';
    view.src = '/video-studio.html';

    el.appendChild(bar);
    el.appendChild(view);
    canvas.appendChild(el);
    _nodes.push(el);

    /* ---- 拖拽（按画布缩放比例换算，锁定在画布内） ---- */
    function _scale() {
      try {
        var t = getComputedStyle(canvas).transform;
        if (t && t !== 'none') { var m = t.match(/matrix\(([^,]+),/); if (m) return parseFloat(m[1]) || 1; }
      } catch (e) {}
      return 1;
    }
    function _clamp() {
      var vw = canvas.clientWidth, vh = canvas.clientHeight;
      x = Math.max(0, Math.min(x, Math.max(0, vw - el.offsetWidth)));
      y = Math.max(0, Math.min(y, Math.max(0, vh - el.offsetHeight)));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
    (function () {
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      bar.addEventListener('mousedown', function (ev) {
        if (ev.target.tagName === 'BUTTON') return;
        dragging = true; sx = ev.clientX; sy = ev.clientY; ox = x; oy = y;
        ev.preventDefault();
      });
      document.addEventListener('mousemove', function (ev) {
        if (!dragging) return;
        var s = _scale();
        x = ox + (ev.clientX - sx) / s;
        y = oy + (ev.clientY - sy) / s;
        _clamp();
      });
      document.addEventListener('mouseup', function () { if (dragging) { dragging = false; _saveLayouts(); } });
    })();

    /* ---- 右下角缩放 ---- */
    var rz = document.createElement('div');
    rz.style.cssText = 'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;';
    rz.addEventListener('mousedown', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var sw = el.offsetWidth, sh = el.offsetHeight, sx2 = ev.clientX, sy2 = ev.clientY, s = _scale();
      function mv(e2) {
        w = Math.max(480, sw + (e2.clientX - sx2) / s);
        h = Math.max(380, sh + (e2.clientY - sy2) / s);
        el.style.width = w + 'px'; el.style.height = h + 'px';
      }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); _saveLayouts(); }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    el.appendChild(rz);

    _saveLayouts();
    toast('🎬 视频剪辑节点已打开');
    return el;
  }

  function closeAll() {
    _nodes.forEach(function (n) { n.remove(); });
    _nodes = [];
    _saveLayouts();
  }

  /* ---- 布局持久化 ---- */
  var _layouts = [];
  try {
    fetch('/api/user-preferences').then(function (r) { return r.json(); }).then(function (d) {
      var l = d && d.preferences && d.preferences.videoNodeLayouts;
      if (Array.isArray(l)) _layouts = l;
    }).catch(function () {});
  } catch (e) {}
  var _saveT = 0;
  function _saveLayouts() {
    clearTimeout(_saveT);
    _saveT = setTimeout(function () {
      _layouts = _nodes.map(function (n) {
        return { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
      });
      try {
        fetch('/api/user-preferences', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: { videoNodeLayouts: _layouts } })
        }).catch(function () {});
      } catch (e2) {}
    }, 400);
  }

  function boot(retries) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      _restore();
      return;
    }
    if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
  }
  function _restore() {
    if (_layouts.length && _canvas()) {
      _layouts.forEach(function (l) { if (l && l.w > 0) add(l.x, l.y, l.w, l.h); });
    }
  }
  boot();

  window.VideoNode = { add: add, closeAll: closeAll, nodes: function () { return _nodes.slice(); } };
})();
