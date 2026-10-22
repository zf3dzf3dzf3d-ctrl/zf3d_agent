/* ============================================================
 * app-canvas-tree-node.js - 无限画布「万物进化树·太空舱节点」
 * 零侵入：往画布上挂一个可拖拽的太空舱节点，内部用 iframe 内嵌
 *   /canvas/进化树/viewer.html?embed=1&file=project.tree.json，
 *   默认直接加载「项目进化树」（之前无 file 参数会落到 index 第二项 demo 树，
 *   导致舱内看不到我们的项目树）。
 *
 * 本次按用户三点要求改造：
 *   1) 默认落位「画布左下角」（避开底部状态栏），叠在左下角太空舱入口之上；
 *   2) 圆形事件隔离：容器用 clip-path 裁成正圆，圆舱内部正常交互（平移/缩放树、
 *      点节点），圆外区域既不渲染也不接收任何鼠标事件 → 外圈完全透出、不拦截，
 *      画布照常操作，鼠标经过舱外不受影响；
 *   3) 右键拖拽移动 + 滚轮缩放 + 双击全屏 / 再双击退出。
 *      （去掉了旧的左键顶部把手与右下角缩放手柄——左键留给 iframe 内的树交互。）
 *
 * 视觉：节点外层无边框、无背景、无标题栏、无关闭按钮，只露圆形舱体本身。
 * 用法：底部「🌳 万物进化树」→ TreePodNode.toggle()；控制台 add()/remove()。
 * 挂 window.TreePodNode
 * ============================================================ */
(function () {
  'use strict';

  var Z = 9400;
  var _seq = 0;
  var _nodes = [];
  // v3：换新 key，让旧的「居中」存档失效，重新按左下角默认落位
  var POS_KEY = 'tree_pod_node_pos_v3';
  // 显式加载项目进化树（viewer 的 load() 由 ?file= 决定，否则默认落到 demo 树）
  // 方案A：默认加载「全局涌现树」（候选统一归此树，confirm/reject/侦测落盘后 liveTick 自动刷新）
  var VIEWER = '/canvas/进化树/viewer.html?embed=1&file=_emergence.emergence.tree.json&v=5';
  var DEF_W = 256, DEF_H = 256;        // 默认尺寸：太空舱小巧，正方形贴合圆形舱
  var MIN_W = 180, MIN_H = 180;        // 缩放下限（须≤DEF_W，否则会把默认尺寸撑回下限）
  var MAX_W = 900, MAX_H = 900;        // 滚轮缩放上限

  function _canvas() { return document.getElementById('canvasArea'); }
  function toast(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[TreePodNode]', msg); } catch (e2) {}
  }
  function _loadPos() {
    try { var s = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return (s && s.w > 0) ? s : null; } catch (e) { return null; }
  }
  function _savePos(el) {
    // 全屏态不记录（退出时会恢复左下角原尺寸/位置）
    if (el && el._treeFull) return;
    if (!el || !el.offsetParent) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight
      }));
    } catch (e) {}
  }

  function add(x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) { toast('画布未就绪'); return null; }
    if (x == null) {
      var saved = _loadPos();
      if (saved) { x = saved.x; y = saved.y; w = saved.w; h = saved.h; }
    }
    // 默认落位：画布可视区【左下角】，bottom 预留状态栏(约40px)+边距
    if (x == null) {
      var dw = DEF_W;
      x = 18 + (canvas.scrollLeft || 0);
      y = Math.max(0, (canvas.clientHeight || 600) - dw - 52) + (canvas.scrollTop || 0);
    }
    // 旧存档尺寸过大时夹回默认（防历史 760×640 残留把舱撑大）
    w = (!w || w > DEF_W * 1.6) ? DEF_W : w;
    h = (!h || h > DEF_H * 1.6) ? DEF_H : h;

    var id = 'tree-node-' + (++_seq);
    var el = document.createElement('div');
    el.className = 'tree-node';
    el.id = id;
    // 外层完全透明：无边框、无背景、无阴影；圆舱之外用 clip-path 裁掉
    //   （裁掉区域不渲染、也不接收任何鼠标事件 → 事件隔离的核心）
    el.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;' +
      'z-index:' + (Z + _seq) + ';background:transparent;border:none;box-shadow:none;' +
      'clip-path:circle(46% at 50% 50%);';

    /* ---- 显示区（iframe 内嵌 viewer，embed 模式，透明，只露圆形舱）---- */
    // iframe 占满容器（无 flex gap），确保与 clip 圆完全对齐；左键事件交给舱内树交互
    var view = document.createElement('iframe');
    view.style.cssText = 'position:absolute;inset:0;border:none;width:100%;height:100%;background:transparent;pointer-events:auto;';
    view.setAttribute('allow', 'fullscreen');
    view.setAttribute('allowtransparency', 'true');
    view.setAttribute('scrolling', 'no');
    view.src = VIEWER;
    el.appendChild(view);
    canvas.appendChild(el);

    /* ---- 按画布缩放比例换算 + 锁定在可视范围内 ---- */
    function _scale() {
      try {
        var t = getComputedStyle(canvas).transform;
        if (t && t !== 'none') { var m = t.match(/matrix\(([^,]+),/); if (m) return parseFloat(m[1]) || 1; }
      } catch (e) {}
      return 1;
    }
    function _clampPos() {
      if (el._treeFull) return; // 全屏态不夹
      var vw = canvas.clientWidth, vh = canvas.clientHeight;
      var w2 = el.offsetWidth, h2 = el.offsetHeight;
      x = Math.max(0, Math.min(x, Math.max(0, vw - w2)));
      y = Math.max(0, Math.min(y, Math.max(0, vh - h2)));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
    _clampPos();

    /* ---- 右键拖拽移动（左键留给 iframe 内树交互，全屏时禁用拖拽）---- */
    var rdrag = false, sx = 0, sy = 0, ox = 0, oy = 0;
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 2 || el._treeFull) return;     // 仅右键
      rdrag = true; sx = e.clientX; sy = e.clientY; ox = x; oy = y;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!rdrag) return;
      var s = _scale();
      x = ox + (e.clientX - sx) / s; y = oy + (e.clientY - sy) / s;
      _clampPos();
    });
    document.addEventListener('mouseup', function (e) {
      if (rdrag && e.button === 2) { rdrag = false; _savePos(el); }
    });

    /* ---- 滚轮缩放舱体大小（正方形等比，clamp）---- */
    el.addEventListener('wheel', function (e) {
      if (el._treeFull) return;
      e.preventDefault(); e.stopPropagation();
      var cur = el.offsetWidth;
      var step = e.deltaY < 0 ? 24 : -24;
      var nw = Math.max(MIN_W, Math.min(MAX_W, cur + step));
      el.style.width = nw + 'px'; el.style.height = nw + 'px';
      _clampPos();
      _savePos(el);
    }, { passive: false });

    /* ---- 双击全屏 / 再双击退出 ---- */
    function _enterFull() {
      if (el._treeFull) return;
      el._restore = { parent: el.parentNode, x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
      el._treeFull = true;
      document.body.appendChild(el);          // 移到 body，避免画布 transform 影响 fixed
      el.style.cssText += 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;' +
        'clip-path:none;border-radius:0;';
      toast('进化树已全屏，再双击退出');
    }
    function _exitFull() {
      if (!el._treeFull) return;
      el._treeFull = false;
      var r = el._restore || {};
      el.style.cssText = el.style.cssText
        .replace(/position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;clip-path:none;/,
                 'position:absolute;') ;
      // 还原内联样式（重新写一遍，稳妥）
      var nw = r.w || DEF_W, nh = r.h || DEF_H;
      el.style.position = 'absolute'; el.style.width = nw + 'px'; el.style.height = nh + 'px';
      el.style.zIndex = Z + _seq; el.style.clipPath = 'circle(46% at 50% 50%)';
      el.style.borderRadius = '';
      (r.parent || canvas).appendChild(el);
      x = r.x != null ? r.x : 18; y = r.y != null ? r.y : 0;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      _clampPos();
      _savePos(el);
    }
    /* ---- 接收 iframe 内右键拖拽 postMessage：移动整个球 ----
       （embed 舱内右键不再移动内部圆形取景框，避免画面偏移被外层 clip 圆裁切）---- */
    /* ---- hovercard 委托渲染：iframe 内卡片会被外层 clip-path:circle 裁掉，
       故由 viewer postMessage 把节点信息发上来，在父窗口 body 上渲染，突破圆形裁剪。---- */
    var _hcEl = null;
    function _esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function _showHC(d) {
      if (!_hcEl) {
        _hcEl = document.createElement('div');
        _hcEl.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;display:none;' +
          'background:rgba(13,17,23,.96);border:1px solid #58d68d;border-radius:7px;padding:7px 10px;' +
          'color:#e6edf3;font-size:12px;line-height:1.5;max-width:260px;box-shadow:0 4px 14px rgba(0,0,0,.5);' +
          'font-family:"Microsoft YaHei",sans-serif;';
        document.body.appendChild(_hcEl);
      }
      if (!d || !d.node) { _hcEl.style.display = 'none'; return; }
      var n = d.node;
      _hcEl.innerHTML = '<b style="color:#58d68d">' + _esc(n.text) + '</b>' +
        '<div style="color:#8b949e">' + _esc(n.path) + '</div>' +
        '清晰度 ' + (Number(n.clarity || 0).toFixed(2)) + ' · 状态 ' + _esc(n.status) + ' · ' + _esc(n.kind) +
        '<div style="color:' + (n.binds ? '#f0b450' : '#8b949e') + '">' + (n.binds ? ('🔗挂接：' + _esc(n.binds)) : '（未挂接文件）') + '</div>';
      _hcEl.style.display = 'block';
      // iframe 视口坐标 → 父窗口屏幕坐标
      var rect = view.getBoundingClientRect();
      var px = rect.left + (d.mx || 0) + 30, py = rect.top + (d.my || 0) + 30;
      var w = _hcEl.offsetWidth, h = _hcEl.offsetHeight, M = 6;
      if (px + w > innerWidth - M) px = rect.left + (d.mx || 0) - w - 30;
      if (py + h > innerHeight - M) py = rect.top + (d.my || 0) - h - 30;
      if (px < M) px = M; if (py < M) py = M;
      _hcEl.style.left = Math.round(px) + 'px'; _hcEl.style.top = Math.round(py) + 'px';
    }
    function _onTreeMsg(ev) {
      var d = ev.data; if (!d || d.__tree !== 1) return;
      if (d.type === 'hovercard') { _showHC(d); return; }
      if (d.type === 'podDragStart') { rdrag = true; sx = d.x; sy = d.y; ox = x; oy = y; }
      else if (d.type === 'podDragMove') {
        if (!rdrag) return;
        var s = _scale(); x = ox + (d.x - sx) / s; y = oy + (d.y - sy) / s; _clampPos();
      } else if (d.type === 'podDragEnd') { if (rdrag) { rdrag = false; _savePos(el); } }
    }
    el._treeMsgHandler = _onTreeMsg;
    window.addEventListener('message', _onTreeMsg);
    // 鼠标移出舱体容器时，兜底隐藏委托渲染的 hovercard
    el.addEventListener('mouseleave', function () { if (_hcEl) _hcEl.style.display = 'none'; });

    el.addEventListener('dblclick', function () { el._treeFull ? _exitFull() : _enterFull(); });

    var node = { id: id, el: el, iframe: view };
    _nodes.push(node);
    // 【修复】进化树是透明小圆球查看器（非游戏/浏览器那种全屏模态节点），
    //   不应纳入 CanvasNodeLock 的「对话锁定」——否则一打开进化树，
    //   canvas-node-modal-lock.js 的 _guardClick 会拦截 .chatbox-inputrow 内
    //   「项目/分支/工作台/模型」等按钮的点击，导致对话框上方按钮全部点不动。
    //   故此处不再调用 CanvasNodeLock.register。
    try { if (window.ResizeObserver) new ResizeObserver(function () { _savePos(el); }).observe(el); } catch (e) {}
    return node;
  }

  function remove(node) {
    if (!node) return;
    try { if (node.el && node.el._treeMsgHandler) window.removeEventListener('message', node.el._treeMsgHandler); } catch (e0) {}
    // 进化树不再注册 CanvasNodeLock（见 add() 注释），故无需 unregister。
    var i = _nodes.indexOf(node);
    if (i >= 0) _nodes.splice(i, 1);
    if (node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
  }
  function closeAll() { while (_nodes.length) remove(_nodes[0]); }

  /* ---- 入口按钮语义：已开则关，未开则开（toggle）---- */
  function toggle() {
    if (_nodes.length) { remove(_nodes[_nodes.length - 1]); return null; }
    return add();
  }

  window.TreePodNode = {
    add: add, remove: remove, closeAll: closeAll, toggle: toggle,
    nodes: function () { return _nodes.slice(); }
  };
})();
