/* ============================================================
 * app-canvas-engine-node.js - 无限画布「游戏引擎节点」
 * 零侵入：不改动任何现有文件逻辑，只往画布上挂一个可拖拽的
 * iframe 节点，内嵌 /engine2d/（内置 2D 游戏引擎演示）。
 *
 * 用法：
 *   1. 画布空白处右键 → 弹出菜单点「🎮 游戏引擎」
 *   2. 或控制台：EngineNode.add() / EngineNode.add(url, x, y)
 *   3. 顶栏按钮（自动注入到设置齿轮旁）：点一次开一个节点
 *
 * 节点特性：标题栏拖拽移动 / 尺寸拉手 / 刷新 / 新窗口打开 / 关闭
 * 挂 window.EngineNode
 * ============================================================ */
(function () {
  'use strict';

  var Z = 9000;          // 引擎节点层
  var _seq = 0;
  var _nodes = [];
  var PREF_KEY = 'engineNodesState.v1';
  var _saveTimer = 0;

  /* ---------- 位置/尺寸持久化（统一走后端 JSON：/api/user-preferences） ---------- */
  function saveState() {
    try {
      var data = _nodes.map(function (n) {
        var el = n.el;
        return {
          url: n.url,
          x: parseInt(el.style.left, 10) || 0,
          y: parseInt(el.style.top, 10) || 0,
          w: el.offsetWidth, h: el.offsetHeight
        };
      });
      _postPrefs(data);
    } catch (e) {}
  }
  // 节流：拖拽/缩放频繁触发时合并请求（beforeunload 走 keepalive 不节流）
  function _postPrefs(data, keepalive) {
    try {
      var payload = JSON.stringify({ preferences: { engineNodes: data } });
      fetch('/api/user-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: !!keepalive
      }).catch(function () {});
    } catch (e) {}
  }
  function saveStateThrottled() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(function () { _saveTimer = 0; saveState(); }, 300);
  }
  function saveStateNow() { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = 0; } _postPrefs(_collect(), true); }
  function _collect() {
    return _nodes.map(function (n) {
      var el = n.el;
      return {
        url: n.url,
        x: parseInt(el.style.left, 10) || 0,
        y: parseInt(el.style.top, 10) || 0,
        w: el.offsetWidth, h: el.offsetHeight
      };
    });
  }
  // 异步从后端 JSON 读取（callback 形式，boot 时等待回调）
  function loadState(cb) {
    try {
      fetch('/api/user-preferences').then(function (r) { return r.json(); }).then(function (j) {
        var prefs = (j && j.preferences) || {};
        var arr = prefs[PREF_KEY] || prefs.engineNodes || [];
        cb(Array.isArray(arr) ? arr : []);
      }).catch(function () { cb([]); });
    } catch (e) { cb([]); }
  }

  function _canvas() { return document.getElementById('canvasArea'); }

  // 画布坐标系中的最小 y：保证节点标题栏不会被页面顶栏遮挡（永远可抓取拖拽）
  function _minY() {
    var canvas = _canvas();
    if (!canvas) return 0;
    var cr = canvas.getBoundingClientRect();
    var tb = document.querySelector('.topbar');
    var tbBottom = tb ? tb.getBoundingClientRect().bottom : 0;
    // 顶栏底部在画布内容坐标系中的 y（含滚动偏移），再留 2px 余量
    return Math.max(0, Math.round(tbBottom - cr.top + (canvas.scrollTop || 0)) + 2);
  }

  function toast(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[EngineNode]', msg); } catch (e2) {}
  }

  /* ---------- 创建节点 ---------- */
  function add(url, x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) { toast('画布未就绪'); return null; }
    url = url || '/engine2d/index.html';

    // 缺省位置：画布视口中心附近，轻微错开
    if (x == null) {
      var r = canvas.getBoundingClientRect();
      x = Math.round(r.width / 2 - 300 + (_seq % 5) * 36 + (canvas.scrollLeft || 0));
      y = Math.round(r.height / 2 - 220 + (_seq % 5) * 30 + (canvas.scrollTop || 0));
    }
    w = w || 768; h = h || 432;   // 默认 16:9

    // 边界钳制：标题栏永远不被顶栏遮挡（minY 随画布滚动动态计算）
    y = Math.max(y, _minY());

    var id = 'engine-node-' + (++_seq);

    var el = document.createElement('div');
    el.className = 'engine-node';
    el.id = id;
    el.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;' +
      'z-index:' + (Z + _seq) + ';background:#1a1f26;border:1px solid #3a4150;' +
      'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);' +
      'display:flex;flex-direction:column;overflow:hidden;min-width:320px;min-height:240px;';

    // ---- 标题栏 ----
    var bar = document.createElement('div');
    bar.style.cssText =
      'height:34px;flex:0 0 34px;display:flex;align-items:center;gap:6px;padding:0 8px;' +
      'background:#222833;' +
      'cursor:move;user-select:none;border-bottom:1px solid #2c3340;font:12px/1 sans-serif;color:#c8ceda;';
    bar.innerHTML =
      '<span style="font-size:14px">🎮</span>' +
      '<span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:.9">游戏引擎 · engine2d</span>' +
      '<button data-act="reload" title="刷新" style="_btn">↻</button>' +
      '<button data-act="pop"   title="新窗口打开" style="_btn">↗</button>' +
      '<button data-act="max"   title="最大化（双击标题栏同样生效）" style="_btn">□</button>' +
      '<button data-act="close" title="关闭" style="_btn">✕</button>';
    bar.innerHTML = bar.innerHTML.replace(/_btn/g,
      'height:22px;min-width:22px;padding:0 4px;border:1px solid #3a4150;background:transparent;' +
      'color:#c8ceda;border-radius:5px;cursor:pointer;font-size:12px;line-height:1;');

    // ---- iframe ----
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.style.cssText = 'flex:1;width:100%;border:0;background:#1a1f26;';
    frame.setAttribute('allow', 'autoplay; gamepad');

    // ---- 右下角尺寸拉手 ----
    var grip = document.createElement('div');
    grip.style.cssText =
      'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;' +
      'background:linear-gradient(135deg,transparent 50%,rgba(200,206,218,.45) 50%);';

    // ---- 四边 + 四角缩放边条（覆盖在 iframe 上方，保证可拖） ----
    var edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    var edgeEls = {};
    var cur = {
      n:  ['top:0;left:0;right:0;height:6px;cursor:ns-resize;'],
      s:  ['bottom:0;left:0;right:0;height:6px;cursor:ns-resize;'],
      e:  ['right:0;top:0;bottom:0;width:6px;cursor:ew-resize;'],
      w:  ['left:0;top:0;bottom:0;width:6px;cursor:ew-resize;'],
      ne: ['right:0;top:0;width:14px;height:14px;cursor:nesw-resize;'],
      nw: ['left:0;top:0;width:14px;height:14px;cursor:nwse-resize;'],
      se: ['right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;'],
      sw: ['left:0;bottom:0;width:14px;height:14px;cursor:nesw-resize;']
    };
    edges.forEach(function (dir) {
      var d = document.createElement('div');
      d.setAttribute('data-edge', dir);
      d.style.cssText = 'position:absolute;z-index:5;' + cur[dir][0];
      edgeEls[dir] = d;
      el.appendChild(d);
    });

    el.appendChild(bar);
    el.appendChild(frame);
    el.appendChild(grip);
    canvas.appendChild(el);

    var node = { id: id, el: el, bar: bar, frame: frame, url: url };   // bar 补上：toggleMax 需要
    _nodes.push(node);
    try { if (window.CanvasNodeLock) CanvasNodeLock.register({ id: id, el: el }); } catch (e0) {}

    // ---- 拖拽移动（rAF 节流 + 拖拽期间屏蔽 iframe 抢事件/重绘） ----
    function startDragOverlay() {
      frame.style.pointerEvents = 'none';
      // 覆盖层：拖拽期间挡住 iframe 的合成渲染事件
      var ov = document.createElement('div');
      ov.style.cssText = 'position:absolute;inset:0;z-index:4;background:transparent;';
      el.appendChild(ov);
      // 关键优化：拖拽期间隐藏 iframe，彻底停止其合成层重绘（游戏内部状态不受影响）
      frame.style.visibility = 'hidden';
      el.style.willChange = 'left, top, width, height';
      return function () {
        frame.style.pointerEvents = '';
        frame.style.visibility = '';
        el.style.willChange = '';
        if (ov.parentNode) ov.remove();
      };
    }
    bar.addEventListener('pointerdown', function (ev) {
      if (ev.target.tagName === 'BUTTON') return;
      if (node._max) return;   // 最大化状态下禁用拖拽（由还原操作恢复）
      var sx = ev.clientX, sy = ev.clientY;
      var ox = parseInt(el.style.left, 10), oy = parseInt(el.style.top, 10);
      el.style.zIndex = ++Z;
      var endOverlay = startDragOverlay();
      var pending = null, raf = 0;
      function apply() {
        raf = 0;
        if (pending == null) return;
        var nx = ox + pending.x - sx, ny = oy + pending.y - sy;
        // 标题栏永远不被顶栏遮挡，其余方向自由（画布可滚动）
        ny = Math.max(ny, _minY());
        el.style.left = nx + 'px';
        el.style.top  = ny + 'px';
        pending = null;
      }
      function mv(e) {
        pending = { x: e.clientX, y: e.clientY };
        if (!raf) raf = requestAnimationFrame(apply);
      }
      function up() {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        try { document.body.style.userSelect = ''; } catch (e2) {}
        endOverlay();
        saveState();
      }
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      try { bar.setPointerCapture && bar.setPointerCapture(ev.pointerId); } catch (e2) {}
      try { document.body.style.userSelect = 'none'; } catch (e2) {}
      ev.preventDefault();
    });
    // 点击节点置顶
    el.addEventListener('mousedown', function () { el.style.zIndex = ++Z; }, true);

    // ---- 缩放（四边 + 四角，pointer capture） ----
    function startResize(dir, ev) {
      ev.stopPropagation(); ev.preventDefault();
      var sx = ev.clientX, sy = ev.clientY;
      var ol = parseInt(el.style.left, 10), ot = parseInt(el.style.top, 10);
      var ow = el.offsetWidth, oh = el.offsetHeight;
      var MINW = 320, MINH = 240;
      var endOverlay = startDragOverlay();
      var pending = null, raf = 0;
      function apply() {
        raf = 0;
        if (!pending) return;
        var dx = pending.x - sx, dy = pending.y - sy;
        if (dir.indexOf('e') >= 0) el.style.width  = Math.max(MINW, ow + dx) + 'px';
        if (dir.indexOf('s') >= 0) el.style.height = Math.max(MINH, oh + dy) + 'px';
        if (dir.indexOf('w') >= 0) {
          var nw = Math.max(MINW, ow - dx);
          el.style.left = (ol + (ow - nw)) + 'px';
          el.style.width = nw + 'px';
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          var nh = Math.max(MINH, oh - dy);
          el.style.top = (ot + (oh - nh)) + 'px';
          el.style.height = nh + 'px';
        }
        pending = null;
      }
      function mv(e) {
        pending = { x: e.clientX, y: e.clientY };
        if (!raf) raf = requestAnimationFrame(apply);
      }
      function up() {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        try { document.body.style.userSelect = ''; } catch (e2) {}
        endOverlay();
        saveState();
      }
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      try { document.body.style.userSelect = 'none'; } catch (e2) {}
    }
    edges.forEach(function (dir) {
      edgeEls[dir].addEventListener('pointerdown', function (ev) { startResize(dir, ev); });
    });

    // ---- 按钮动作 ----
    bar.addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'close') remove(node);
      else if (act === 'reload') { frame.src = url; toast('引擎节点已刷新'); }
      else if (act === 'pop') window.open(url, '_blank');
      else if (act === 'max') { toggleMaxOf(node); }
    });

    // ---- 双击标题栏：最大化 / 还原 ----
    var _dblT = 0;
    bar.addEventListener('dblclick', function (ev) {
      if (ev.target.tagName === 'BUTTON') return;
      toggleMaxOf(node);   // 【修复】原调用 toggleMax(node) 读已废弃的 n.bar 导致崩溃
    });

    function toggleMax(n) {
      var e = n.el, b = bar, f = n.frame;
      if (!b) return; // 老状态节点无标题栏，跳过
      var btn = b.querySelector('[data-act="max"]');
      if (!n._max) {
        // 记录原位置尺寸，然后铺满画布视口
        n._restore = {
          left: e.style.left, top: e.style.top,
          w: e.style.width || e.offsetWidth + 'px',
          h: e.style.height || e.offsetHeight + 'px'
        };
        var cv = _canvas();
        var r = cv ? cv.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        e.style.left = (cv ? (cv.scrollLeft || 0) : 0) + 'px';
        e.style.top  = (cv ? (cv.scrollTop || 0) : 0) + 'px';
        e.style.width  = Math.round(r.width) + 'px';
        e.style.height = Math.round(r.height) + 'px';
        e.style.borderRadius = '0';
        e.style.zIndex = ++Z;
        if (btn) { btn.textContent = '❐'; btn.title = '还原大小'; }
        n._max = true;
        toast('引擎已最大化（双击标题栏或点 ❐ 还原）');
      } else {
        var rs = n._restore || {};
        e.style.left = rs.left || '0px';
        e.style.top  = rs.top  || '0px';
        e.style.width  = rs.w || '768px';
        e.style.height = rs.h || '432px';
        e.style.borderRadius = '10px';
        if (btn) { btn.textContent = '□'; btn.title = '最大化'; }
        n._max = false;
      }
      saveState();
    }
    node._toggleMax = function () { toggleMax(node); };
    // 暴露给内部统一调用
    function toggleMaxOf(n) { if (n && n._toggleMax) n._toggleMax(); }

    saveState();

    toast('🎮 游戏引擎节点已创建');
    return node;
  }

  /* ---------- 移除 ---------- */
  function remove(node) {
    if (!node) return;
    try { if (window.CanvasNodeLock) CanvasNodeLock.unregister({ id: node.id, el: node.el }); } catch (e0) {}
    var i = _nodes.indexOf(node);
    if (i >= 0) _nodes.splice(i, 1);
    if (node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
    saveState();
  }
  function closeAll() { while (_nodes.length) remove(_nodes[0]); }

  /* ---------- 游戏内"退出"按钮支持 ----------
   * 游戏页面（engine2d/*.html）点「退出游戏」时 postMessage 过来，
   * 这里关闭对应的引擎节点（按事件源 iframe 匹配）。 */
  window.addEventListener('message', function (ev) {
    try {
      var d = ev.data;
      if (!d || d.type !== 'engine-node:close') return;
      for (var i = _nodes.length - 1; i >= 0; i--) {
        var n = _nodes[i];
        if (n.frame && n.frame.contentWindow === ev.source) { remove(n); toast('游戏已退出，引擎节点已关闭'); }
      }
    } catch (e) {}
  });

  /* ---------- 顶栏按钮注入 ---------- */
  function injectToolbarButton() {
    // 已整合进「更多」下拉（app-canvas-more-menu.js），不再单独注入顶栏按钮
    return;
    if (document.getElementById('btnEngineNode')) return;
    var host = document.getElementById('btnSettings') || document.getElementById('settingsBtn');
    if (!host) {
      // 兜底：找顶栏任意容器
      host = document.querySelector('.topbar, .toolbar, header') || document.body;
    }
    var btn = document.createElement('button');
    btn.id = 'btnEngineNode';
    btn.title = '在画布上打开游戏引擎节点';
    btn.textContent = '🎮';
    btn.style.cssText =
      'margin-left:6px;height:28px;min-width:30px;padding:0 6px;border:none;' +
      'background:transparent;color:inherit;opacity:.65;border-radius:6px;cursor:pointer;font-size:14px;';
    btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '.65'; });
    btn.addEventListener('click', function () {
      // 开关式：已打开 → 关闭；未打开 → 打开（同时只允许一个）
      if (_nodes.length) { closeAll(); toast('游戏引擎节点已关闭'); }
      else add();
    });
    if (host !== document.body && host.parentNode) host.parentNode.insertBefore(btn, host.nextSibling);
    else host.appendChild(btn);
  }

  /* ---------- 右键菜单注入（画布空白处） ---------- */
  function injectContextMenu() {
    var canvas = _canvas();
    if (!canvas) return;
    canvas.addEventListener('contextmenu', function (ev) {
      // 只在画布空白处生效（与系统右键创建条并存：延时插入，避免干扰原生菜单渲染）
      var t = ev.target;
      if (t !== canvas && !t.classList.contains('canvas-grid') && t.id !== 'canvasArea') return;
      setTimeout(function () {
        if (document.getElementById('ctx-engine-node')) return;
        var menu = document.createElement('div');
        menu.id = 'ctx-engine-node';
        menu.textContent = '🎮 游戏引擎节点';
        menu.style.cssText =
          'position:fixed;left:' + ev.clientX + 'px;top:' + ev.clientY + 'px;z-index:99999;' +
          'background:#222833;border:1px solid #3a4150;color:#c8ceda;border-radius:8px;' +
          'padding:8px 14px;font:13px/1.4 sans-serif;cursor:pointer;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.5);user-select:none;';
        menu.addEventListener('mouseenter', function () { menu.style.background = 'rgba(61,220,132,.15)'; });
        menu.addEventListener('mouseleave', function () { menu.style.background = '#161b22'; });
        menu.addEventListener('click', function () { add(null, ev.clientX, ev.clientY - 40); menu.remove(); });
        document.body.appendChild(menu);
        var kill = function () { if (menu.parentNode) menu.remove(); document.removeEventListener('mousedown', kill, true); };
        setTimeout(function () { document.addEventListener('mousedown', kill, true); }, 50);
      }, 60);
    }, true);
  }

  /* ---------- 启动 ---------- */
  function boot(retries) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      injectToolbarButton(); injectContextMenu();
      // 恢复上次保存的引擎节点（位置/尺寸）
      // 注意：readyState=interactive 时 #canvasArea 可能尚未渲染，
      // 必须等画布真正可用再恢复，否则 add() 返回 null 导致保存的节点静默丢失
      var canvas = _canvas();
      if (!canvas) {
        if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
        return;
      }
      var saved = [];
      var restored = false;
      function afterLoad() {
        if (restored) return; restored = true;
        if (saved && saved.length) {
          saved.forEach(function (s) { add(s.url, s.x, s.y, s.w, s.h); });
          toast('已恢复 ' + saved.length + ' 个游戏引擎节点');
        }
        // 兜底：页面关闭/刷新前再存一次（keepalive 确保请求不被中断），确保最后状态不丢
        window.addEventListener('beforeunload', saveStateNow);
      }
      // 异步从后端 JSON 读取；超时 3 秒兜底放行，避免接口异常时节点无法添加
      var timedOut = false;
      var t = setTimeout(function () { timedOut = true; afterLoad(); }, 3000);
      loadState(function (arr) {
        if (timedOut) return;
        clearTimeout(t);
        saved = arr; afterLoad();
      });
      return;
    }
    if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
  }
  boot();

  window.EngineNode = { add: add, remove: remove, closeAll: closeAll, nodes: function () { return _nodes.slice(); } };
})();
