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
  // v4：位置/尺寸改走 UserSettings（服务器 private/用户设置/user_settings.json，
  //   出厂默认在 system/default_settings.json 的 "tree_pod_pos"）→ 新装机即按出厂位置开启。
  var US_KEY = 'tree_pod_pos';
  // 出厂默认尺寸兜底（服务器未配置时按此计算左下角落位）
  var US_DEFAULT = { x: 18, dy: -52, w: 158, h: 158 };
  // 显式加载项目进化树（viewer 的 load() 由 ?file= 决定，否则默认落到 demo 树）
  // 方案A：默认加载「全局涌现树」（候选统一归此树，confirm/reject/侦测落盘后 liveTick 自动刷新）
  var VIEWER = '/canvas/进化树/viewer.html?embed=1&file=_emergence.emergence.tree.json&v=5';
  var DEF_W = 158, DEF_H = 158;        // 默认尺寸：与导航缩略图 150×150 舷窗对齐后再累计放大 8px（用户逐次校准）
  var MIN_W = 120, MIN_H = 120;        // 缩放下限（须≤DEF_W，否则会把默认尺寸撑回下限）
  var MAX_W = 900, MAX_H = 900;        // 滚轮缩放上限

  function _canvas() { return document.getElementById('canvasArea'); }
  function toast(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[TreePodNode]', msg); } catch (e2) {}
  }
  function _loadPos() {
    // 优先服务器 UserSettings（出厂默认/跨机迁移），回退旧 localStorage 存档
    function _inView(p) {
      // 【旧坐标语义兜底】历史版本 y 为不同语义（如绝对画布 y:352），旧存档会把舱
      // 落到可视区外导致"科技树看不到"。存档必须落在当前可视画布内才可信，
      // 否则视为无效 → 回落出厂默认左下角（多端旧 localStorage 同样被此闸门拦截）。
      try {
        var c = _canvas();
        if (!c) return true;   // 画布未就绪时不判，交给调用方默认逻辑
        var vh = c.clientHeight || window.innerHeight || 800;
        var vw = c.clientWidth || window.innerWidth || 1200;
        if (p.y < -10 || p.y > vh - 40) return false;
        if (p.x < -(p.w / 2) || p.x > vw - 10) return false;
        return true;
      } catch (e) { return true; }
    }
    try {
      if (window.UserSettings) {
        var s = UserSettings.get(US_KEY, null);
        if (s && typeof s === 'object' && s.w > 0 && _inView(s)) return s;
      }
    } catch (e) {}
    try {
      var s2 = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      return (s2 && s2.w > 0 && _inView(s2)) ? s2 : null;
    } catch (e) { return null; }
  }
  function _savePos(el) {
    // 全屏态不记录（退出时会恢复左下角原尺寸/位置）
    if (el && el._treeFull) return;
    el._treeUserMoved = true;   // 标记用户已手动定位：晚到的 user-settings-refreshed 不再覆盖
    if (!el || !el.offsetParent) return;
    var pos = {
      x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight
    };
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch (e) {}
    try { if (window.UserSettings) UserSettings.set(US_KEY, pos); } catch (e2) {}
    /* 【位置保存可靠性修复】UserSettings.set 是 400ms 防抖异步写服务器：
       拖完舱立刻关闭/重启程序时防抖未触发 → 服务器文件里永远是旧位置，
       重启后按旧位置落位 = "位置总是弹回去"的病灶。
       此处绕过防抖立即 POST，并在页面关闭时用 sendBeacon 兜底。 */
    try {
      var payload = JSON.stringify({ changes: (function(){ var o={}; o[US_KEY]=pos; return o; })() });
      fetch('/api/user-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload
      }).catch(function(){});
      if (navigator.sendBeacon) {
        window.addEventListener('pagehide', function () {
          try { navigator.sendBeacon('/api/user-settings',
            new Blob([payload], { type: 'application/json' })); } catch (e3) {}
        }, { once: true });
      }
    } catch (e4) {}
  }

  /* ============================================================
   * 导航地图（右下角小地图）开关 · 进化树右侧裸图标按钮
   * 设计：无背景、无边框的线形简易图标（罗盘），关闭态加斜线并变暗。
   * 位置：贴在进化树圆舱右侧（垂直居中），随舱体移动/缩放/显隐自动跟随。
   * 持久化：UserSettings（服务器 private/用户设置）+ localStorage 兜底。
   * ============================================================ */
  var MM_KEY = 'zf_minimap_off';           // '1' = 导航地图已关闭
  var MM_BODY_CLS = 'zf-minimap-off';      // 加在 body 上（CSS 用它隐藏 #minimap）
  /* 【2026-10-26 调整】开关按钮移到底部状态栏（#minimapToggleBtn，见 dom-status.js），
     进化树圆舱右侧不再挂浮动按钮；本文件的开关状态/持久化逻辑保留，供状态栏调用。 */
  var MM_IN_DOCK = true;
  var _mmBtn = null;                       // 开关按钮（单例，跟随活动舱体）
  var _mmActive = null;                    // 当前按钮归属的舱体 el

  function _mmSave(off) {
    try { localStorage.setItem(MM_KEY, off ? '1' : '0'); } catch (e) {}
    try { if (window.UserSettings) UserSettings.set(MM_KEY, off ? '1' : '0'); } catch (e) {}
  }
  function _mmOff() {
    try {
      if (window.UserSettings) {
        var v = UserSettings.get(MM_KEY, null);
        if (v !== null && v !== undefined && v !== '') return String(v) === '1';
      }
    } catch (e) {}
    try { return localStorage.getItem(MM_KEY) === '1'; } catch (e) { return false; }
  }
  /* 把状态写到 DOM：只切 body 标记类（CSS 用 visibility 隐藏，
     保留几何尺寸，避免 app-quick-create 搬移/回位逻辑误判"不可见"而清掉拖拽记忆的位置） */
  function _mmApply(off) {
    try {
      if (off) document.body.classList.add(MM_BODY_CLS);
      else document.body.classList.remove(MM_BODY_CLS);
    } catch (e) {}
    if (!off) {
      setTimeout(function () {
        try { if (window.App && typeof App.updateMinimap === 'function') App.updateMinimap(); } catch (e) {}
      }, 30);
    }
    _mmPaint(off);
    _mmNotify(off);   // 通知外部订阅者（底部状态栏开关按钮等）刷新图标
  }
  /* 状态变化订阅：外部（dom-status.js 的状态栏按钮）注册回调同步视觉 */
  var _mmHooks = [];
  function _mmNotify(off) {
    for (var i = 0; i < _mmHooks.length; i++) { try { _mmHooks[i](off); } catch (e) {} }
  }
  function _mmSubscribe(fn) {
    if (typeof fn !== 'function') return;
    _mmHooks.push(fn);
    try { fn(_mmOff()); } catch (e) {}
  }
  /* 按钮视觉：开=罗盘；关=罗盘+斜线（变暗） */
  var MM_SVG_ON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.1"/><path d="M10.6 5.4 9.15 9.15 5.4 10.6 6.85 6.85Z"/></svg>';
  var MM_SVG_OFF = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.1"/><path d="M10.6 5.4 9.15 9.15 5.4 10.6 6.85 6.85Z"/><path d="M2.6 13.4 13.4 2.6"/></svg>';
  function _mmPaint(off) {
    if (!_mmBtn) return;
    _mmBtn.innerHTML = off ? MM_SVG_OFF : MM_SVG_ON;
    _mmBtn.title = off ? '开启导航地图' : '关闭导航地图';
    _mmBtn.classList[off ? 'add' : 'remove']('off');
  }
  /* 导航地图元素（不同版本里可能是 id=minimap 或 class=minimap，两个都认） */
  function _mmEl() {
    try { return document.getElementById('minimap') || document.querySelector('.minimap'); } catch (e) { return null; }
  }
  /* 兜底：舱体不在/全屏时，按钮吸附到导航地图原位（右下角，fixed），
     保证「导航地图被关掉、球也被关掉」后仍可一键开回来。
     即使找不到导航地图元素，也用右下角默认坐标显示按钮（否则将无法再开回）。 */
  function _mmPin(_mm) {
    var b = _mmBtn;
    if (b.parentNode !== document.body) { try { document.body.appendChild(b); } catch (e) { return; } }
    var left = null, top = null;
    if (_mm) {
      var r = _mm.getBoundingClientRect();
      if (r.width > 0) { left = r.left + r.width - 3; top = r.top - 26; }
    }
    if (left === null) {   // 导航地图元素找不到/被隐藏到无尺寸：贴右下角默认位
      var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
      left = vw - 214; top = vh - 208;
    }
    b.style.position = 'fixed';
    b.style.left = left + 'px';
    b.style.top = top + 'px';
    b.style.zIndex = 9800;
    b.style.display = 'flex';
  }
  /* 按钮落位：舱体右侧、垂直居中（画布坐标系，随舱体一起缩放） */
  function _mmSync() {
    if (!_mmBtn) return;
    var el = _mmActive;
    var mm = _mmEl();
    if (!el || !el.isConnected || el.style.display === 'none' || el._treeFull || !el.parentNode) {
      _mmPin(mm);
      return;
    }
    if (_mmBtn.parentNode !== el.parentNode) { try { el.parentNode.appendChild(_mmBtn); } catch (e) { return; } }
    var w = el.offsetWidth || DEF_W;
    var h = el.offsetHeight || DEF_H;
    _mmBtn.style.position = 'absolute';
    _mmBtn.style.left = (el.offsetLeft + w + 3) + 'px';
    _mmBtn.style.top = (el.offsetTop + h / 2 - 11) + 'px';
    _mmBtn.style.zIndex = Math.min(Z + 52, 9700);
    _mmBtn.style.display = 'flex';
  }
  function _mmBuild() {
    if (MM_IN_DOCK) return null;   // 舱侧浮动按钮已停用（改到底部状态栏）
    if (_mmBtn) return _mmBtn;
    var b = document.createElement('div');
    b.className = 'tree-mm-toggle';
    b.style.cssText = 'display:none;position:absolute;width:22px;height:22px;align-items:center;justify-content:center;' +
      'cursor:pointer;color:#8b949e;';
    b.innerHTML = MM_SVG_ON;
    // 阻止冒泡：左键不触发画布平移/框选，右键不触发画布菜单
    b.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    b.addEventListener('mouseup', function (e) { e.stopPropagation(); });
    b.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      var off = !_mmOff();
      _mmSave(off);
      _mmApply(off);
      _mmSync();
      toast(off ? '导航地图已关闭' : '导航地图已开启');
    });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('mouseenter', function () { b.style.color = '#58d68d'; });
    b.addEventListener('mouseleave', function () { b.style.color = _mmOff() ? '#6e7681' : '#8b949e'; });
    _mmBtn = b;
    return b;
  }
  /* 舱体（或 minimap）就绪后挂按钮 */  function _mmAttach(el) {
    if (MM_IN_DOCK) return;   // 舱侧浮动按钮已停用
    _mmActive = el || null;
    _mmBuild();
    _mmPaint(_mmOff());
    _mmSync();
  }
  /* 启动时应用持久化状态（minimap 可能晚于本脚本创建，轮询等它出现） */
  function _mmBoot(tries) {
    _mmApply(_mmOff());
    _mmBuild();
    _mmSync();
    if (!document.getElementById('minimap') && (tries || 0) < 40) {
      setTimeout(function () { _mmBoot((tries || 0) + 1); }, 250);
      return;
    }
    // 兜底态（按钮吸附在导航地图原位）下，minimap 可能被搬移，低频跟随一次即可
    if (_mmBtn && !_mmBtn._pinTick) {
      _mmBtn._pinTick = setInterval(function () {
        try { if (_mmBtn.style.position === 'fixed' && _mmBtn.style.display !== 'none') _mmSync(); } catch (e) {}
      }, 600);
    }
  }

  function add(x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) { toast('画布未就绪'); return null; }
    if (x == null) {
      var saved = _loadPos();
      if (saved) { x = saved.x; y = saved.y; w = saved.w; h = saved.h; }
    }
    // 默认落位：优先出厂默认（UserSettings 的 tree_pod_pos，x 绝对 / dy 相对底边），否则画布可视区【左下角】
    if (x == null) {
      var dw = (US_DEFAULT.w || DEF_W);
      x = (US_DEFAULT.x != null ? US_DEFAULT.x : 18) + (canvas.scrollLeft || 0);
      y = Math.max(0, (canvas.clientHeight || 600) - dw + (US_DEFAULT.dy || -52)) + (canvas.scrollTop || 0);
    }
    // 旧存档尺寸（无论过大/过小）统一夹回默认 158×158（外圈舱观感升级后旧存档须归位，避免持久化的小尺寸"锁死"）
    w = (!w || Math.abs(w - DEF_W) > 0.5) ? DEF_W : w;
    h = (!h || Math.abs(h - DEF_H) > 0.5) ? DEF_H : h;

    var id = 'tree-node-' + (++_seq);
    var el = document.createElement('div');
    el.className = 'tree-node';
    el.id = id;
    // 外层完全透明：无边框、无背景、无阴影；圆舱之外用 clip-path 裁掉
    //   （裁掉区域不渲染、也不接收任何鼠标事件 → 事件隔离的核心）
    el.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;' +
      'z-index:' + Math.min(Z + _seq, 9690) + ';background:transparent;border:none;box-shadow:none;' +
      'clip-path:circle(50% at 50% 50%);';

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
    _mmAttach(el);   // 导航地图开关按钮：挂到本舱右侧

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
      _mmSync();
    }
    _clampPos();

    /* ---- 右键拖拽移动（左键留给 iframe 内树交互，全屏时禁用拖拽）---- */
    var rdrag = false, sx = 0, sy = 0, ox = 0, oy = 0, lx = 0, ly = 0;
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
      _mmSync();   // 全屏时隐藏导航开关（贴不到舱右侧）
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
      el.style.zIndex = Math.min(Z + _seq, 9690); el.style.clipPath = 'circle(50% at 50% 50%)';
      el.style.borderRadius = '';
      (r.parent || canvas).appendChild(el);
      x = r.x != null ? r.x : 18; y = r.y != null ? r.y : 0;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      _clampPos();
      _savePos(el);
      _mmAttach(el);   // 退出全屏：按钮重新跟随本舱
    }
    /* ---- 接收 iframe 内右键拖拽 postMessage：移动整个球 ----
       （embed 舱内右键不再移动内部圆形取景框，避免画面偏移被外层 clip 圆裁切）---- */
    /* ---- hovercard 委托渲染：iframe 内卡片会被外层 clip-path:circle 裁掉，
       故由 viewer postMessage 把节点信息发上来，在父窗口 body 上渲染，突破圆形裁剪。---- */
    var _hcEl = null;
    function _esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function _showHC(d) {
      // 【按需求】悬浮节点不再弹出背景卡片，保持裸图表（父窗口委托渲染停用）
      if (_hcEl) _hcEl.style.display = 'none';
      return;
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
        '<div style="color:#8b949e">🌿 子节点：直接 ' + (n.childCount || 0) + ' 个 · 含后代共 ' + (n.descCount || 0) + ' 个</div>' +
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
    /* treelabel：进化树节点文字标签（embed 时从舱内 canvas 委托到父窗口渲染，突破圆形 clip 裁剪） */
    var _tlEl = null;
    function _tlBuild() {
      _tlEl = document.createElement('div');
      _tlEl.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;display:none;' +
        'transparent;padding:2px 6px;text-shadow:0 1px 3px rgba(0,0,0,.9);' +
        'color:#d7e2ec;font-size:9.5px;line-height:1.4;white-space:nowrap;' +
        'font-family:"Microsoft YaHei",sans-serif;transform:translateX(-50%);';
      document.body.appendChild(_tlEl);
    }
    function _showTL(d) {
      if (!_tlEl) _tlBuild();
      var rect = view.getBoundingClientRect();
      var s = _scale();
      _tlEl.textContent = d.text || '';
      _tlEl.style.opacity = Math.min(1, Math.max(0, d.alpha == null ? 1 : d.alpha)) * 0.92;
      _tlEl.style.left = (rect.left + (d.x || 0) / s) + 'px';
      _tlEl.style.top = (rect.top + (d.y || 0) / s) + 'px';
      _tlEl.style.display = 'block';
    }
    function _hideTL() { if (_tlEl) _tlEl.style.display = 'none'; }
    function _onTreeMsg(ev) {
      var d = ev.data; if (!d || d.__tree !== 1) return;
      if (d.type === 'hovercard') { _showHC(d); return; }
      /* treelabel：舱内鼠标最近节点的文字标签委托渲染（iframe canvas 上的标签会被外层 clip-path:circle 裁掉） */
      if (d.type === 'treelabel') { _showTL(d); return; }
      if (d.type === 'treelabelHide') { _hideTL(); return; }
      if (d.type === 'podDragStart') { rdrag = true; el._lx = d.x; el._ly = d.y; }
      else if (d.type === 'podDragMove') {
        // 增量式拖拽 + 屏幕绝对坐标（screenX/screenY）：
        // 晃动真病灶 = iframe 内传来的 clientX 随舱体移动而失真（反馈回路）；
        // 已改传 screenX（viewer.html 同步），此处增量累加无反馈，天然稳定。
        // 基准坐标挂 el 上：多 pod 并存拖拽不互抢（原模块级 lx/ly 会串位）。
        if (!rdrag) return;
        var s = _scale();
        x += (d.x - (el._lx||d.x)) / s; y += (d.y - (el._ly||d.y)) / s;
        el._lx = d.x; el._ly = d.y;
        _clampPos();
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
    try { if (window.ResizeObserver) new ResizeObserver(function () { _savePos(el); _mmSync(); }).observe(el); } catch (e) {}
    return node;
  }

  function remove(node) {
    if (!node) return;
    // 该舱被移除：若按钮属于它，从页面摘下（下次 add 会重新挂）
    try {
      if (_mmBtn && _mmActive === node.el) {
        _mmActive = null;
        if (_mmBtn.parentNode) _mmBtn.parentNode.removeChild(_mmBtn);
        _mmBtn.style.display = 'none';
        // 若还有其他舱体，按钮改挂到最后一个上
        for (var _k = _nodes.length - 1; _k >= 0; _k--) {
        if (_nodes[_k] !== node && _nodes[_k].el && _nodes[_k].el.style.display !== 'none') { _mmAttach(_nodes[_k].el); break; }
      }
      }
    } catch (e) {}
    try { if (node.el && node.el._treeMsgHandler) window.removeEventListener('message', node.el._treeMsgHandler); } catch (e0) {}
    // 进化树不再注册 CanvasNodeLock（见 add() 注释），故无需 unregister。
    var i = _nodes.indexOf(node);
    if (i >= 0) _nodes.splice(i, 1);
    if (node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
  }
  function closeAll() { while (_nodes.length) remove(_nodes[0]); }

  /* ---- 入口按钮语义：已开则关，未开则开（toggle）---- */
  function toggle() {
    // 性能修复：不再销毁/重建 iframe（viewer 加载重：物理+音频+热重载全重来）。
    // 已开→隐藏（瞬间关）；再点→显示（瞬间开，iframe 保持已加载状态）。
    if (_nodes.length) {
      var _n = _nodes[_nodes.length - 1];
      if (_n.el.style.display === 'none') { _n.el.style.display = ''; _mmAttach(_n.el); return _n; }
      _n.el.style.display = 'none';
      _mmSync();
      return null;
    }
    return add();
  }

  window.TreePodNode = {
    add: add, remove: remove, closeAll: closeAll, toggle: toggle,
    nodes: function () { return _nodes.slice(); },
    /* 导航地图开关（供其他模块/控制台调用） */
    minimapOn: function () { return !_mmOff(); },
    setMinimap: function (on) {
      var off = !on;
      _mmSave(off); _mmApply(off); _mmSync();
      return off;
    },
    toggleMinimap: function () { return this.setMinimap(_mmOff()); },
    /* 状态栏开关按钮订阅：状态变化时回调 paint(off) */
    subscribeMinimap: function (fn) { _mmSubscribe(fn); },
  };

  /* ---- 默认开启：页面就绪后自动弹出（新装机即开，位置按出厂默认落位；
         用户可手动关闭，刷新后仍默认开启）---- */
  function _autoOpen(tries) {
    if (_nodes.length) return;
    if (_canvas()) {
      /* 【重启位置丢失·根修】add() 落位读取 tree_pod_pos 依赖 UserSettings，
         而 loadFromServer 是异步的：本文件在 DOMContentLoaded 即触发，
         服务器响应常常未返回 → 读不到保存位置 → 按默认左下角落位，
         数据回来后无人重定位 → "每次重启位置都弹回去"。
         修复：等服务器设置就绪（Promise）再落位，1.2s 超时兜底不卡开启。 */
      var _opened = false;
      var _go = function () {
        if (_opened) return; _opened = true;
        if (!_nodes.length && _canvas()) add();
      };
      try {
        if (window.UserSettings && typeof UserSettings.loadFromServer === 'function') {
          Promise.resolve(UserSettings.loadFromServer()).then(_go, _go);
          setTimeout(_go, 1200);   // 兜底：服务器慢/挂了也要开舱
        } else { _go(); }
      } catch (e) { _go(); }
      // 二次保险：若舱已按兜底默认落位、服务器数据晚到，则重定位一次（仅限用户尚未拖动过的舱）
      window.addEventListener('user-settings-refreshed', function () {
        try {
          var saved = _loadPos();
          if (!saved) return;
          for (var i = 0; i < _nodes.length; i++) {
            var el = _nodes[i].el || _nodes[i];
            if (!el || el._treeUserMoved || el._treeFull) continue;
            el.style.left = saved.x + 'px'; el.style.top = saved.y + 'px';
            el.style.width = saved.w + 'px'; el.style.height = saved.h + 'px';
            el._posX = saved.x; el._posY = saved.y;
          }
        } catch (e2) {}
      });
      return;
    }
    if ((tries || 0) < 40) setTimeout(function () { _autoOpen((tries || 0) + 1); }, 250);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { _autoOpen(0); _mmBoot(0); });
  } else {
    _autoOpen(0); _mmBoot(0);
  }
})();
