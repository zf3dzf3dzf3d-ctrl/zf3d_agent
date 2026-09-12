/* ============================================================
 * app-canvas-presentation-node.js - 无限画布「演示节点」
 * 零侵入：往画布上挂一个可拖拽的 HTML 演示播放器节点。
 * 显示层：iframe 内嵌 /演示/viewer.html（主服务同源，fetch 直达）。
 *
 * 用法：
 *   1. 画布空白处右键 → 「📽 演示节点」
 *   2. 控制台：PresNode.add() / PresNode.add('demo.pres.json')
 *   3. 顶栏按钮：📽
 * 挂 window.PresNode
 * ============================================================ */
(function () {
  'use strict';

  var Z = 9400;
  var _seq = 0;
  var _nodes = [];
  var _savedLayouts = [];   // 上次保存的节点布局（持久化在 user_preferences.json）
  var _saveT = 0;

  // 启动时拉取上次布局习惯
  try {
    fetch('/api/user-preferences').then(function (r) { return r.json(); }).then(function (d) {
      var l = d && d.preferences && d.preferences.presNodeLayouts;
      if (Array.isArray(l)) _savedLayouts = l;
    }).catch(function () {});
  } catch (e) {}

  // 防抖保存所有节点当前布局到用户习惯 json
  function _saveAll() {
    clearTimeout(_saveT);
    _saveT = setTimeout(function () {
      var layouts = _nodes.map(function (n) {
        return { x: n.el.offsetLeft, y: n.el.offsetTop, w: n.el.offsetWidth, h: n.el.offsetHeight };
      });
      try {
        fetch('/api/user-preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: { presNodeLayouts: layouts } })
        }).catch(function () {});
      } catch (e2) {}
    }, 400);
  }

  function _canvas() { return document.getElementById('canvasArea'); }
  function toast(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[PresNode]', msg); } catch (e2) {}
  }

  function add(file, x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) { toast('画布未就绪'); return null; }
    if (x == null) {
      /* 恢复用户上次保存的布局习惯（按节点序号对应） */
      var saved = _savedLayouts[_nodes.length];
      if (saved && saved.w > 0) { x = saved.x; y = saved.y; w = saved.w; h = saved.h; }
    }
    if (x == null) {
      var r = canvas.getBoundingClientRect();
      x = Math.round(r.width / 2 - 360 + (_seq % 5) * 40 + (canvas.scrollLeft || 0));
      y = Math.round(r.height / 2 - 250 + (_seq % 5) * 34 + (canvas.scrollTop || 0));
    }
    w = w || 760; h = h || 540;

    var id = 'pres-node-' + (++_seq);
    var el = document.createElement('div');
    el.className = 'pres-node';
    el.id = id;
    el.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;' +
      'z-index:' + (Z + _seq) + ';background:#0d0f14;border:1px solid #3a4150;' +
      'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);' +
      'display:flex;flex-direction:column;overflow:hidden;min-width:420px;min-height:320px;';

    /* ---- 标题栏 ---- */
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;' +
      'background:#161b22;border-bottom:1px solid #2a3140;cursor:move;user-select:none;flex:0 0 auto;';
    var dot = document.createElement('span');
    dot.textContent = '📽';
    dot.style.cssText = 'font-size:14px;';
    var title = document.createElement('span');
    title.textContent = 'HTML 演示';
    title.style.cssText = 'flex:1;color:#c8ceda;font:12px/1.4 sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    var close = document.createElement('button');
    close.textContent = '✕';
    close.title = '关闭演示节点';
    close.style.cssText = 'background:none;border:none;color:#889;cursor:pointer;font-size:14px;padding:2px 6px;';
    close.addEventListener('click', function () { remove(node); });
    bar.appendChild(dot); bar.appendChild(title); bar.appendChild(close);

    /* ---- 类型选择（分类：PPT / Word / Excel / PDF）---- */
    var kindSel = document.createElement('select');
    kindSel.title = '选择文档类型';
    kindSel.style.cssText = 'flex:0 0 auto;max-width:130px;background:#1c2230;color:#c8ceda;border:1px solid #3a4150;' +
      'border-radius:6px;font:12px sans-serif;padding:3px 6px;outline:none;';
    kindSel.addEventListener('change', function () {
      _indexData && fillFiles(kindSel.value);
    });

    /* ---- 文件选择 ---- */
    var fileSel = document.createElement('select');
    fileSel.title = '选择文档';
    fileSel.style.cssText = 'flex:0 0 auto;max-width:160px;background:#1c2230;color:#c8ceda;border:1px solid #3a4150;' +
      'border-radius:6px;font:12px sans-serif;padding:3px 6px;outline:none;';
    fileSel.addEventListener('change', function () { navTo(fileSel.value); });

    /* ---- 播放区（iframe）---- */
    var view = document.createElement('iframe');
    view.style.cssText = 'flex:1;border:none;width:100%;background:#0d0f14;';
    view.setAttribute('allow', 'fullscreen');

    var iframeReady = false;
    view.addEventListener('load', function () { iframeReady = true; if (_curFile) navTo(_curFile); });

    bar.insertBefore(fileSel, title);
    bar.insertBefore(kindSel, fileSel);
    el.appendChild(bar);
    el.appendChild(view);
    canvas.appendChild(el);
    _clampPos(); // 初始位置也锁定在屏幕内

    /* ---- 拖拽（按画布缩放比例换算，且锁定在画布可视范围内） ---- */
    function _scale() {
      try {
        var t = getComputedStyle(canvas).transform;
        if (t && t !== 'none') { var m = t.match(/matrix\(([^,]+),/); if (m) return parseFloat(m[1]) || 1; }
      } catch (e) {}
      return 1;
    }
    function _clampPos() {
      var vw = canvas.clientWidth, vh = canvas.clientHeight;
      var w2 = el.offsetWidth, h2 = el.offsetHeight;
      x = Math.max(0, Math.min(x, Math.max(0, vw - w2)));
      y = Math.max(0, Math.min(y, Math.max(0, vh - h2)));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
    (function () {
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      bar.addEventListener('mousedown', function (e) {
        var t = e.target;
        if (t === close || t === fileSel || t === kindSel || (t && t.tagName === 'SELECT' && bar.contains(t))) return;
        dragging = true; sx = e.clientX; sy = e.clientY; ox = x; oy = y; e.preventDefault(); e.stopPropagation();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var s = _scale();
        x = ox + (e.clientX - sx) / s; y = oy + (e.clientY - sy) / s;
        _clampPos();
      });
      document.addEventListener('mouseup', function () {
        if (dragging) { dragging = false; _saveAll(); } // 拖完保存习惯
      });
    })();

    /* ---- 自定义缩放手柄（叠在 iframe 之上，否则被 iframe 挡住点不到） ---- */
    (function () {
      var grip = document.createElement('div');
      grip.title = '拖拽调整大小';
      grip.style.cssText = 'position:absolute;right:0;bottom:0;width:18px;height:18px;z-index:5;cursor:nwse-resize;' +
        'background:linear-gradient(135deg,transparent 50%,#5a6478 50%);border-bottom-right-radius:9px;user-select:none;';
      el.appendChild(grip);
      var rz = false, sx = 0, sy = 0, ow = 0, oh = 0;
      grip.addEventListener('mousedown', function (e) {
        rz = true; sx = e.clientX; sy = e.clientY; ow = el.offsetWidth; oh = el.offsetHeight;
        e.preventDefault(); e.stopPropagation();
      });
      document.addEventListener('mousemove', function (e) {
        if (!rz) return;
        var s = _scale();
        var vw = canvas.clientWidth, vh = canvas.clientHeight;
        var nw = Math.min(Math.max(420, ow + (e.clientX - sx) / s), Math.max(420, vw - x));
        var nh = Math.min(Math.max(320, oh + (e.clientY - sy) / s), Math.max(320, vh - y));
        el.style.width = nw + 'px'; el.style.height = nh + 'px';
      });
      document.addEventListener('mouseup', function () {
        if (rz) { rz = false; _saveAll(); }
      });
    })();
    bar.addEventListener('dblclick', function () {
      if (el.style.position === 'fixed') {
        el.style.position = 'absolute'; el.style.left = x + 'px'; el.style.top = y + 'px';
        el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.zIndex = Z + _seq;
      } else {
        el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
        el.style.width = '100%'; el.style.height = '100%'; el.style.zIndex = 99990;
      }
    });

    /* ---- 加载清单（分门别类：ppt / doc / sheet / pdf）---- */
    var _indexData = null;
    var _curKind = 'ppt';

    function _kinds() {
      if (_indexData && Array.isArray(_indexData.categories)) return _indexData.categories;
      return [{ kind: 'ppt', label: '📽 演示稿 PPT', viewer: 'viewer.html', items: _indexData || [] }];
    }
    function _kindOf(file) {
      var flat = _indexData && Array.isArray(_indexData.flat) ? _indexData.flat : null;
      if (flat) { for (var i = 0; i < flat.length; i++) if (flat[i].file === file) return flat[i].kind || 'ppt'; }
      var ext = (file || '').toLowerCase();
      if (ext.endsWith('.doc.json')) return 'doc';
      if (ext.endsWith('.sheet.json')) return 'sheet';
      if (ext.endsWith('.pdf.json')) return 'pdf';
      return 'ppt';
    }
    function _viewerOf(kind) {
      var ks = _kinds();
      for (var i = 0; i < ks.length; i++) if (ks[i].kind === kind) return ks[i].viewer || 'viewer.html';
      return 'viewer.html';
    }

    function fillKinds() {
      kindSel.innerHTML = '';
      _kinds().forEach(function (k) {
        var opt = document.createElement('option');
        opt.value = k.kind;
        opt.textContent = k.label || k.kind;
        kindSel.appendChild(opt);
      });
      kindSel.value = _curKind;
    }
    function fillFiles(kind) {
      _curKind = kind;
      var ks = _kinds(), items = [];
      for (var i = 0; i < ks.length; i++) if (ks[i].kind === kind) items = ks[i].items || [];
      fileSel.innerHTML = '';
      items.forEach(function (item) {
        var opt = document.createElement('option');
        opt.value = item.file;
        opt.textContent = item.title || item.file;
        fileSel.appendChild(opt);
      });
      if (items.length) navTo(items[0].file);
    }

    function loadIndex() {
      fetch('/pres/index.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          _indexData = data;
          fillKinds();
          if (file) {
            var k = _kindOf(file);
            kindSel.value = k;
            fillFiles(k);
            fileSel.value = file;
            navTo(file);
          } else {
            fillFiles('ppt');
          }
        })
        .catch(function () { toast('演示清单加载失败'); });
    }

    /* ---- 切换文档：按类型路由到对应查看器页面 ---- */
    var _curFile = null;
    function navTo(f) {
      if (!f) return;
      _curFile = f;
      fileSel.value = f;
      var kind = _kindOf(f);
      var viewer = _viewerOf(kind);
      var icon = { ppt: '📽', doc: '📄', sheet: '📊', pdf: '📕' }[kind] || '📽';
      title.textContent = icon + ' ' + f.replace(/\.(pres|doc|sheet|pdf)\.json$/i, '');
      if (!iframeReady) return; // load 后会自动补发
      var cur = view.src || '';
      var wantUrl = '/pres/' + viewer + '?embed=1&file=' + encodeURIComponent(f);
      if (kind === 'ppt' && cur.indexOf(viewer) >= 0) {
        try { view.contentWindow.postMessage({ type: 'pres-load', file: f }, '*'); } catch (e) {}
      } else if (cur.indexOf('file=' + encodeURIComponent(f)) < 0) {
        /* 查看器页面或文件变了：重新加载 iframe */
        view.src = wantUrl;
      }
    }

    var node = { id: id, el: el, iframe: view, fileSel: fileSel, navTo: navTo };
    _nodes.push(node);
    try { if (window.CanvasNodeLock) CanvasNodeLock.register({ id: id, el: el }); } catch (e0) {}
    loadIndex();
    view.src = '/pres/viewer.html?embed=1' + (file ? '&file=' + encodeURIComponent(file) : '');
    /* 缩放（右下角拖拽 resize）结束后保存习惯 */
    try { if (window.ResizeObserver) new ResizeObserver(function () { _saveAll(); }).observe(el); } catch (e) {}
    return node;
  }

  function remove(node) {
    try { if (window.CanvasNodeLock && node) CanvasNodeLock.unregister({ id: node.id, el: node.el }); } catch (e0) {}
    var i = _nodes.indexOf(node);
    if (i >= 0) _nodes.splice(i, 1);
    if (node && node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
  }
  function closeAll() { while (_nodes.length) remove(_nodes[0]); }

  /* ---- 顶栏按钮 ---- */
  function injectToolbarButton() {
    // 已整合进「更多」下拉（app-canvas-more-menu.js），不再单独注入顶栏按钮
    return;
    if (document.getElementById('btnPresNode')) return;
    var host = document.getElementById('btnBrowserNode') || document.getElementById('btnSettings') ||
      document.querySelector('.topbar, .toolbar, header') || document.body;
    var btn = document.createElement('button');
    btn.id = 'btnPresNode';
    btn.title = '在画布上打开 HTML 演示节点';
    btn.textContent = '📽';
    btn.style.cssText = 'margin-left:6px;height:28px;min-width:30px;padding:0 6px;border:none;' +
      'background:transparent;color:inherit;opacity:.65;border-radius:6px;cursor:pointer;font-size:14px;';
    btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '.65'; });
    btn.addEventListener('click', function () { add(); });
    if (host !== document.body && host.parentNode) host.parentNode.insertBefore(btn, host.nextSibling);
    else host.appendChild(btn);
  }

  /* ---- 右键菜单 ---- */
  function injectContextMenu() {
    var canvas = _canvas();
    if (!canvas) return;
    canvas.addEventListener('contextmenu', function (ev) {
      var t = ev.target;
      if (t !== canvas && !t.classList.contains('canvas-grid') && t.id !== 'canvasArea') return;
      setTimeout(function () {
        if (document.getElementById('ctx-pres-node')) return;
        var menu = document.createElement('div');
        menu.id = 'ctx-pres-node';
        menu.textContent = '📽 演示节点';
        menu.style.cssText =
          'position:fixed;left:' + ev.clientX + 'px;top:' + ev.clientY + 'px;z-index:99999;' +
          'background:#222833;border:1px solid #3a4150;color:#c8ceda;border-radius:8px;' +
          'padding:8px 14px;font:13px/1.4 sans-serif;cursor:pointer;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.5);user-select:none;';
        menu.addEventListener('mouseenter', function () { menu.style.background = 'rgba(80,160,255,.15)'; });
        menu.addEventListener('mouseleave', function () { menu.style.background = '#161b22'; });
        menu.addEventListener('click', function () { add(null, ev.clientX, ev.clientY - 40); menu.remove(); });
        document.body.appendChild(menu);
        var kill = function () { if (menu.parentNode) menu.remove(); document.removeEventListener('mousedown', kill, true); };
        setTimeout(function () { document.addEventListener('mousedown', kill, true); }, 50);
      }, 60);
    }, true);
  }

  function boot(retries) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      injectToolbarButton(); injectContextMenu();
      return;
    }
    if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
  }
  boot();

  window.PresNode = {
    add: add, remove: remove, closeAll: closeAll,
    nodes: function () { return _nodes.slice(); }
  };
})();
