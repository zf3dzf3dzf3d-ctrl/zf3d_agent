/* ============================================================
 * i工程 (zf-app-engineering.js) v1.2 —— 节点化任务流程画布
 * 策划案 v3.0 A2 旁挂路线前端 MVP：
 *  - 浮动窗口流程画布（非全屏）：节点卡片(状态色环) + SVG 连线(pass 回流箭头)
 *  - v1.2 新增：① 黑/白双主题（🌓 按钮切换，localStorage 记忆，默认跟随系统）
 *              ② 窗口可拖动（按住标题栏）+ 右下角可调大小 + 位置尺寸记忆
 *  - 拖拽节点(坐标防抖落库) / 框选(Shift 拖动) / 连线模式(按钮切换,点两个节点成边)
 *  - 节点状态点击循环切换 todo→doing→pass→fail（落库 /node/status）
 *  - 双击节点 = 打开该节点对应对话窗口（复用现有 canvas 节点，id 即 cb*）
 *  - 数据源 GET /api/engineering/graph，一次拉全；软删节点不显示
 * API：window.ZFEngineering = { open, close, refresh }
 * 依赖：ZFDock.register（缺席重试）、showToast（缺席静默）
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFEngineering) return;

  var ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="5" rx="1.2"/><rect x="15" y="9" width="6" height="5" rx="1.2"/><rect x="5" y="16" width="6" height="5" rx="1.2"/><path d="M6 8v3a2 2 0 0 0 2 2h7"/><path d="M18 14v0.5a2 2 0 0 1-2 2h-5"/><circle cx="9" cy="18.5" r="0.5" fill="currentColor"/></svg>';

  var STATUS_META = {
    todo:  { label: '待办', color: '#8a93a6' },
    doing: { label: '进行', color: '#3b82f6' },
    pass:  { label: '通过', color: '#22c55e' },
    fail:  { label: '失败', color: '#ef4444' }
  };
  var ORDER = ['todo', 'doing', 'pass', 'fail'];

  /* ---------- 主题（黑/白双风格） ---------- */
  var THEMES = {
    dark: {
      winBg: 'rgba(18,22,32,.97)', headerBg: 'rgba(255,255,255,.05)', border: 'rgba(255,255,255,.1)',
      btnBorder: 'rgba(255,255,255,.15)', btnColor: '#dde', hint: '#8892a6',
      cardBg: 'rgba(22,26,38,.96)', cardBorder: 'rgba(255,255,255,.1)', cardText: '#dde',
      cardBody: '#bbc', shadow: '0 4px 14px rgba(0,0,0,.4)', selboxBorder: '#7c5cff',
      selboxBg: 'rgba(124,92,255,.12)', accent: '#7c5cff', accentOn: '#fff',
      canvasDot: 'rgba(255,255,255,.06)', title: '#dde'
    },
    light: {
      winBg: 'rgba(250,250,252,.98)', headerBg: 'rgba(0,0,0,.04)', border: 'rgba(0,0,0,.12)',
      btnBorder: 'rgba(0,0,0,.18)', btnColor: '#333', hint: '#777',
      cardBg: 'rgba(255,255,255,.97)', cardBorder: 'rgba(0,0,0,.1)', cardText: '#222',
      cardBody: '#444', shadow: '0 4px 14px rgba(0,0,0,.15)', selboxBorder: '#6a48e8',
      selboxBg: 'rgba(124,92,255,.1)', accent: '#6a48e8', accentOn: '#fff',
      canvasDot: 'rgba(0,0,0,.05)', title: '#111'
    }
  };
  /* v2.0：主题跟随宿主整体 UI（html[data-theme]），不再跟随系统外观——与全站黑/白风格统一 */
  function getTheme() {
    try {
      var dt = document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme');
      if (dt === 'light') return 'light';
      if (dt === 'dark') return 'dark';
    } catch (e) {}
    /* 宿主暂无 data-theme 时兜底跟随系统 */
    try { if (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) return 'light'; } catch (e) {}
    return 'dark';
  }
  function T() { return THEMES[getTheme()]; }
  /* 宿主主题切换（data-theme 属性变化）→ 立即重涂；系统外观变化仅作兜底 */
  try {
    if (window.MutationObserver) {
      new MutationObserver(function () { applyTheme(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  } catch (e) {}
  try {
    if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { applyTheme(); });
  } catch (e) {}

  /* ---------- 窗口几何记忆 ---------- */
  var WIN_KEY = 'zf_eng_win_pos';
  function loadWin() {
    try { return JSON.parse(localStorage.getItem(WIN_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveWin() {
    var w = document.getElementById('zfEngWin');
    if (!w) return;
    try {
      localStorage.setItem(WIN_KEY, JSON.stringify({
        x: parseInt(w.style.left, 10), y: parseInt(w.style.top, 10),
        w: parseInt(w.style.width, 10), h: parseInt(w.style.height, 10)
      }));
    } catch (e) {}
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  var S = { open: false, graph: null, linkMode: false, linkFrom: null, drag: null, selBox: null, selected: {}, winDrag: null, winResize: null, view: { k: 1, tx: 0, ty: 0 }, pan: null, undoStack: [] };

  /* ---------- DOM ---------- */
  function ensureDom() {
    if (document.getElementById('zfEngOverlay')) { applyTheme(); return; }
    var ov = document.createElement('div');
    ov.id = 'zfEngOverlay';
    /* v1.2：外壳铺满但透明不拦截点击，真正窗口是内部的 zfEngWin 浮动层 */
    ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:90000;pointer-events:none;';
    var win = loadWin();
    /* 默认：居中 76vw × 78vh，且不小于 560×380 */
    var dw = Math.max(Math.round(window.innerWidth * 0.76), 560);
    var dh = Math.max(Math.round(window.innerHeight * 0.78), 380);
    var dx = win && isFinite(win.x) ? win.x : Math.max(Math.round((window.innerWidth - dw) / 2), 10);
    var dy = win && isFinite(win.y) ? win.y : Math.max(Math.round((window.innerHeight - dh) / 2), 10);
    var ww = win && isFinite(win.w) ? win.w : dw;
    var wh = win && isFinite(win.h) ? win.h : dh;
    ov.innerHTML =
      '<div id="zfEngWin" style="position:absolute;left:' + dx + 'px;top:' + dy + 'px;width:' + ww + 'px;height:' + wh + 'px;display:flex;flex-direction:column;pointer-events:auto;border-radius:12px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35);">' +
      /* v2.1 布局重设计：①标题栏(拖拽区)与工具栏分离 ②操作说明移到画布左下悬浮胶囊(?折叠) ③窗口四边+三角把手均可调大小 */
      '<div id="zfEngHeader" style="flex:0 0 auto;user-select:none;">' +
      '<div id="zfEngDrag" style="height:42px;display:flex;align-items:center;gap:10px;padding:0 14px;cursor:move;">' +
      '<b id="zfEngTitle" style="font-size:14px;cursor:move;">i工程 · 任务流程</b>' +
      '<span id="zfEngVis" style="font-size:11px;opacity:.7;"></span>' +
      '<span style="flex:1"></span>' +
      '<button id="zfEngHelp" title="操作说明" style="width:26px;height:26px;padding:0;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;">?</button>' +
      '<button id="zfEngClose" style="padding:4px 12px;border-radius:8px;cursor:pointer;font-size:12px;">关闭 (Esc)</button>' +
      '</div>' +
      '<div id="zfEngToolbar" style="height:38px;display:flex;align-items:center;gap:8px;padding:0 12px 6px;">' +
      '<button id="zfEngLink" style="padding:4px 10px;border-radius:8px;cursor:pointer;font-size:12px;">连线模式</button>' +
      '<button id="zfEngRefresh" style="padding:4px 10px;border-radius:8px;cursor:pointer;font-size:12px;">刷新</button>' +
      '<button id="zfEngProjects" style="padding:4px 10px;border-radius:8px;cursor:pointer;font-size:12px;">工程 ▾</button>' +
      '<span style="flex:1"></span>' +
      '<button id="zfEngGroup" style="padding:4px 10px;border-radius:8px;cursor:pointer;font-size:12px;display:none;">🏷 建组</button>' +
      '<button id="zfEngCrew" style="padding:4px 10px;border-radius:8px;cursor:pointer;font-size:12px;display:none;">👥 派团队</button>' +
      '</div>' +
      '</div>' +
      '<div id="zfEngCanvas" style="position:relative;flex:1;overflow:hidden;user-select:none;">' +
      '<div id="zfEngWorld" style="position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;"></div>' +
      '<svg id="zfEngEdges" width="100%" height="100%" style="position:absolute;inset:0;pointer-events:none;overflow:visible;"></svg>' +
      '<div id="zfEngSelBox" style="display:none;position:absolute;border:1px dashed;pointer-events:none;z-index:4;"></div>' +
      /* v2.0：右上角小地图（节点分布 + 视口框 + 点击/拖动跳转） */
      '<div id="zfEngMinimap" title="小地图：点击/拖动可跳转视口" style="position:absolute;top:10px;right:10px;width:160px;height:110px;border-radius:8px;cursor:pointer;z-index:6;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.25);">' +
      '<canvas id="zfEngMinimapCv" width="160" height="110" style="display:block;width:100%;height:100%;"></canvas>' +
      '</div>' +
      /* v2.1：操作说明胶囊（画布左下，? 点击展开/收起） */
      '<div id="zfEngHelpBox" style="position:absolute;left:10px;bottom:10px;z-index:6;display:flex;align-items:center;gap:6px;max-width:70%;">' +
      '<button id="zfEngHelpBtn" title="操作说明" style="flex:0 0 auto;width:24px;height:24px;padding:0;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;">?</button>' +
      '<span id="zfEngHint" style="font-size:12px;padding:4px 10px;border-radius:14px;display:none;"></span>' +
      '</div>' +
      /* v2.1：四边 + 三角把手调大小 */
      '<div id="zfEngResize" title="拖拽调整窗口大小" style="position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:5;">' +
      '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M14 6L6 14M14 10L10 14" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".45"/></svg>' +
      '</div>' +
      '<div data-rz="n" style="position:absolute;left:8px;right:8px;top:0;height:5px;cursor:ns-resize;z-index:5;"></div>' +
      '<div data-rz="s" style="position:absolute;left:8px;right:8px;bottom:0;height:5px;cursor:ns-resize;z-index:5;"></div>' +
      '<div data-rz="w" style="position:absolute;top:8px;bottom:8px;left:0;width:5px;cursor:ew-resize;z-index:5;"></div>' +
      '<div data-rz="e" style="position:absolute;top:8px;bottom:8px;right:0;width:5px;cursor:ew-resize;z-index:5;"></div>' +
      '<div data-rz="nw" style="position:absolute;left:0;top:0;width:12px;height:12px;cursor:nwse-resize;z-index:5;"></div>' +
      '<div data-rz="ne" style="position:absolute;right:0;top:0;width:12px;height:12px;cursor:nesw-resize;z-index:5;"></div>' +
      '<div data-rz="sw" style="position:absolute;left:0;bottom:0;width:12px;height:12px;cursor:nesw-resize;z-index:5;"></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('zfEngClose').onclick = close;
    document.getElementById('zfEngRefresh').onclick = function () { refresh(); };
    document.getElementById('zfEngLink').onclick = toggleLinkMode;
    document.getElementById('zfEngProjects').onclick = promptProjects;
    /* v1.8：选中节点 → 派团队（复用整理模式 ZFCrewPanel） */
    document.getElementById('zfEngCrew').onclick = promptCrewForSelected;
    /* v1.9#2：框选后建组/改组名 */
    document.getElementById('zfEngGroup').onclick = promptGroupForSelected;
    /* v2.1：操作说明胶囊开关（左下 ? 按钮；顶部 ? 同样可开） */
    var helpHint = document.getElementById('zfEngHint');
    helpHint.textContent = '双击空白=创建节点 · 拖空白=框选(Shift加选/Ctrl减选) · 空格+拖/中键拖=平移画布 · 双击节点=打开对话 · Delete=删除选中 · 滚轮=缩放';
    function toggleHelp() {
      var h = document.getElementById('zfEngHint');
      h.style.display = h.style.display === 'none' ? '' : 'none';
    }
    document.getElementById('zfEngHelpBtn').onclick = toggleHelp;
    document.getElementById('zfEngHelp').onclick = toggleHelp;

    var cv = document.getElementById('zfEngCanvas');
    cv.addEventListener('mousedown', onCanvasDown);
    /* v2.1：空格键平移模式（keydown/keyup 记录状态，pan 结束恢复 cursor） */
    document.addEventListener('keydown', function (e) { if (e.code === 'Space' && S.open && e.target === document.body) { S.spaceDown = true; document.getElementById('zfEngCanvas').style.cursor = 'grab'; e.preventDefault(); } });
    document.addEventListener('keyup', function (e) { if (e.code === 'Space') { S.spaceDown = false; var c = document.getElementById('zfEngCanvas'); if (c) c.style.cursor = ''; } });
    /* v1.5：滚轮缩放（锚点=鼠标位置，0.25~3 倍） */
    cv.addEventListener('wheel', onWheel, { passive: false });
    /* v1.7：抑制中键默认行为（自动滚动） */
    cv.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    /* v1.3：双击/右键空白处 → 弹出输入框创建新节点（真链路 App.createChatBox） */
    cv.addEventListener('dblclick', function (e) { if (e.target === cv) promptCreateNode(e.clientX, e.clientY); });
    cv.addEventListener('contextmenu', function (e) { if (e.target === cv) { e.preventDefault(); promptCreateNode(e.clientX, e.clientY); } });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.open) close();
      /* v1.6：Ctrl+Z 撤销最近一次操作（删除/移动/状态切换） */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && S.open) {
        var tgt0 = e.target || {};
        var tag0 = (tgt0.tagName || '').toLowerCase();
        if (tag0 !== 'input' && tag0 !== 'textarea' && tgt0.isContentEditable !== true) { e.preventDefault(); undo(); }
      }
      /* v1.5：Delete 删除框选节点（软删） */
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.open && !S.drag && !S.selBox) {
        var tgt = e.target || {};
        var tag = (tgt.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tgt.isContentEditable !== true) deleteSelected();
      }
    });
    setupWinDrag();
    setupMinimap();
    applyTheme();
  }

  /* ---------- 窗口拖动 / 缩放（v2.1：拖拽仅限标题栏；四边+三角把手调大小） ---------- */
  function setupWinDrag() {
    var dragBar = document.getElementById('zfEngDrag');
    var win = document.getElementById('zfEngWin');
    dragBar.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return; /* 按钮不触发拖动 */
      S.winDrag = { sx: e.clientX, sy: e.clientY, ox: win.offsetLeft, oy: win.offsetTop };
      e.preventDefault();
    });
    /* 旧右下角把手 + 新增四边/三角把手统一处理 */
    var rz0 = document.getElementById('zfEngResize');
    if (rz0) rz0.addEventListener('mousedown', function (e) { startWinResize(e, win, 'se'); });
    Array.prototype.slice.call(win.querySelectorAll('[data-rz]')).forEach(function (h) {
      h.addEventListener('mousedown', function (e) { startWinResize(e, win, h.getAttribute('data-rz')); });
    });
  }
  function startWinResize(e, win, dir) {
    S.winResize = { sx: e.clientX, sy: e.clientY, ow: win.offsetWidth, oh: win.offsetHeight, ol: win.offsetLeft, ot: win.offsetTop, dir: dir };
    e.preventDefault(); e.stopPropagation();
  }

  function applyTheme() {
    var t = T();
    var win = document.getElementById('zfEngWin');
    if (!win) return;
    win.style.background = t.winBg;
    win.style.border = '1px solid ' + t.border;
    win.style.color = t.cardText;
    var header = document.getElementById('zfEngHeader');
    header.style.background = t.headerBg;
    header.style.borderBottom = '1px solid ' + t.border;
    document.getElementById('zfEngTitle').style.color = t.title;
    /* v2.1：工具栏按钮主题（新布局） */
    ['zfEngLink', 'zfEngRefresh', 'zfEngClose', 'zfEngProjects', 'zfEngCrew', 'zfEngGroup', 'zfEngHelp', 'zfEngHelpBtn'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.style.border = '1px solid ' + t.btnBorder;
      b.style.background = 'none';
      b.style.color = t.btnColor;
    });
    /* 连线模式激活态高亮 */
    var lb = document.getElementById('zfEngLink');
    if (lb && S.linkMode) { lb.style.background = t.accent; lb.style.color = t.accentOn; lb.style.border = '1px solid ' + t.accent; }
    var hint = document.getElementById('zfEngHint');
    hint.style.color = t.cardText;
    hint.style.background = t.headerBg;
    hint.style.border = '1px solid ' + t.border;
    var hb1 = document.getElementById('zfEngHelpBtn'), hb2 = document.getElementById('zfEngHelp');
    [hb1, hb2].forEach(function (b) {
      if (!b) return;
      b.style.border = '1px solid ' + t.btnBorder;
      b.style.background = 'none';
      b.style.color = t.btnColor;
    });
    var rz = document.getElementById('zfEngResize');
    rz.style.color = t.btnColor;
    var sb = document.getElementById('zfEngSelBox');
    sb.style.borderColor = t.selboxBorder;
    sb.style.background = t.selboxBg;
    /* 重绘节点与连线（颜色随主题） */
    if (S.graph) render();
  }


  /* ---------- 数据 ---------- */
  function api(path, body, cb) {
    var opt = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    fetch('/api/engineering/' + path, opt).then(function (r) { return r.json(); }).then(function (j) { cb && cb(j); }).catch(function () {});
  }

  function refresh() {
    api('graph', null, function (j) {
      if (!j || !j.ok) { window.showToast && showToast('i工程：图数据加载失败', 'warn'); return; }
      S.graph = j;
      render();
    });
  }

  /* ---------- 渲染 ---------- */
  function nodeEl(id) { return document.querySelector('[data-eng="' + id + '"]'); }

  function render() {
    var cv = document.getElementById('zfEngCanvas');
    var world = document.getElementById('zfEngWorld');
    if (!cv || !world || !S.graph) return;
    /* 清旧卡片（保留 svg/selbox/resize） */
    Array.prototype.slice.call(world.querySelectorAll('[data-eng]')).forEach(function (n) { n.remove(); });
    var curProj = engCurProject();
    var nodes = (S.graph.nodes || []).filter(function (n) {
      if (n.deleted) return false;
      /* v1.9#8：src 隔离——i工程只显示由 i工程 创建的节点（src=eng），
         无限画布创建的节点（src≠eng）不进入 i工程，双向隔离方便用户管理 */
      if ((n.src || '') !== 'eng') return false;
      /* v1.9#6：子对话不进 i工程 画布（ZFChildRel.isSub 单一真源判定，
         经 window.App.chatBoxes 找 box；box.el 即聊天窗 DOM） */
      try {
        var boxes = (window.App && App.chatBoxes) || [];
        var box = boxes.find(function (b) { return b && String(b.id) === String(n.id); });
        if (box && window.ZFChildRel && ZFChildRel.isSub && ZFChildRel.isSub(box.el || box)) return false;
      } catch (eSub) {}
      /* v1.6：载入工程后按 boardId 过滤渲染（未分配节点只在全部视图显示） */
      if (curProj) return (n.boardId || '') === curProj.name;
      return true;
    });
    /* v1.5：挂到 world 变换层 */
    nodes.forEach(function (n) { world.appendChild(buildCard(n)); });
    /* v1.5：视口裁剪——1000 节点只渲染视口内的卡片，其余 display:none（DOM 留存不重建） */
    cullCards();
    applyView();
    drawEdges();
    drawMinimap();
  }

  /* ---------- v1.5 视图变换：滚轮缩放(锚点=鼠标) + 拖空白平移 + 视口裁剪 ---------- */
  function applyView() {
    var world = document.getElementById('zfEngWorld');
    var svg = document.getElementById('zfEngEdges');
    var v = S.view;
    if (world) world.style.transform = 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.k + ')';
    if (svg) svg.style.transform = 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.k + ')';
    updateZoomBadge();
    drawMinimap();
  }
  /* 屏幕坐标 → 世界坐标 */
  function toWorld(cx, cy) {
    var cv = document.getElementById('zfEngCanvas');
    var r = cv.getBoundingClientRect();
    return { x: (cx - r.left - S.view.tx) / S.view.k, y: (cy - r.top - S.view.ty) / S.view.k };
  }
  function onWheel(e) {
    e.preventDefault();
    var v = S.view;
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    var nk = Math.max(0.25, Math.min(3, v.k * factor));
    if (nk === v.k) return;
    var cv = document.getElementById('zfEngCanvas');
    var r = cv.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    /* 锚点=鼠标：缩放前后鼠标下的世界点不动 */
    v.tx = mx - (mx - v.tx) * (nk / v.k);
    v.ty = my - (my - v.ty) * (nk / v.k);
    v.k = nk;
    applyView();
    cullCards();
  }
  /* 视口裁剪：仅渲染可见区（含 100px 余量）内的卡片，视口外 display:none */
  function cullCards() {
    var cv = document.getElementById('zfEngCanvas');
    var world = document.getElementById('zfEngWorld');
    if (!cv || !world) return;
    var r = cv.getBoundingClientRect();
    var v = S.view, M = 100;
    var vx1 = -v.tx / v.k - M, vy1 = -v.ty / v.k - M;
    var vx2 = (r.width - v.tx) / v.k + M, vy2 = (r.height - v.ty) / v.k + M;
    var cards = world.querySelectorAll('[data-eng]');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var x = el.offsetLeft, y = el.offsetTop;
      var vis = x + el.offsetWidth >= vx1 && x <= vx2 && y + el.offsetHeight >= vy1 && y <= vy2;
      el.style.display = vis ? '' : 'none';
    }
    updateVisBadge(cards.length);
  }
  function updateVisBadge(total) {
    var b = document.getElementById('zfEngVis');
    if (b && typeof total === 'number') {
      var world = document.getElementById('zfEngWorld');
      var shown = world ? world.querySelectorAll('[data-eng]:not([style*="display: none"])').length : 0;
      b.textContent = '节点 ' + shown + '/' + total + ' · ' + Math.round(S.view.k * 100) + '%';
    }
  }
  function updateZoomBadge() { updateVisBadge(); }

  /* ---------- v2.0 小地图：节点分布 + 视口框 + 点击/拖动跳转 ---------- */
  var MM = { dragging: false };
  function minimapNodes() {
    var world = document.getElementById('zfEngWorld');
    if (!world) return [];
    var out = [];
    var cards = world.querySelectorAll('[data-eng]');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var id = el.getAttribute('data-eng');
      var g = graphNode(id);
      if (!g) continue;
      var sm = STATUS_META[g.status] || STATUS_META.todo;
      out.push({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, color: sm.color });
    }
    return out;
  }
  function drawMinimap() {
    var cvm = document.getElementById('zfEngMinimapCv');
    if (!cvm) return;
    var ctx = cvm.getContext('2d');
    var W = cvm.width, H = cvm.height, PAD = 8;
    var t = T();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = t.winBg;
    ctx.fillRect(0, 0, W, H);
    var nodes = minimapNodes();
    var cv = document.getElementById('zfEngCanvas');
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    /* 世界包围盒（含视口） */
    var v = S.view;
    var vx1 = -v.tx / v.k, vy1 = -v.ty / v.k, vx2 = (r.width - v.tx) / v.k, vy2 = (r.height - v.ty) / v.k;
    var bx1 = vx1, by1 = vy1, bx2 = vx2, by2 = vy2;
    nodes.forEach(function (n) {
      if (n.x < bx1) bx1 = n.x; if (n.y < by1) by1 = n.y;
      if (n.x + n.w > bx2) bx2 = n.x + n.w; if (n.y + n.h > by2) by2 = n.y + n.h;
    });
    var bw = Math.max(bx2 - bx1, 1), bh = Math.max(by2 - by1, 1);
    var sc = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
    var ox = (W - bw * sc) / 2 - bx1 * sc, oy = (H - bh * sc) / 2 - by1 * sc;
    /* 世界坐标 → 小地图坐标 */
    MM.m2w = { bx1: bx1, by1: by1, bw: bw, bh: bh, sc: sc, ox: ox, oy: oy };
    function mm(x, y) { return { x: x * sc + ox, y: y * sc + oy }; }
    /* 节点色点 */
    nodes.forEach(function (n) {
      var p = mm(n.x + n.w / 2, n.y + n.h / 2);
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, 6.3);
      ctx.fill();
    });
    /* 视口框 */
    var p1 = mm(vx1, vy1), p2 = mm(vx2, vy2);
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    ctx.fillStyle = t.accent + '22';
    ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  }
  /* 小地图点击/拖动 → 视口中心跳到该世界点 */
  function minimapJump(e) {
    var mmv = MM.m2w; if (!mmv) return;
    var cvm = document.getElementById('zfEngMinimapCv');
    var cv = document.getElementById('zfEngCanvas');
    if (!cvm || !cv) return;
    var mr = cvm.getBoundingClientRect();
    var mx = (e.clientX - mr.left) / mr.width * cvm.width;
    var my = (e.clientY - mr.top) / mr.height * cvm.height;
    var wx = (mx - mmv.ox) / mmv.sc + mmv.bx1;
    var wy = (my - mmv.oy) / mmv.sc + mmv.by1;
    var r = cv.getBoundingClientRect();
    var v = S.view;
    v.tx = r.width / 2 - wx * v.k;
    v.ty = r.height / 2 - wy * v.k;
    applyView();
    cullCards();
    drawMinimap();
  }
  function setupMinimap() {
    var box = document.getElementById('zfEngMinimap');
    if (!box) return;
    box.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      MM.dragging = true;
      minimapJump(e);
    });
    window.addEventListener('mousemove', function (e) { if (MM.dragging) minimapJump(e); });
    window.addEventListener('mouseup', function () { MM.dragging = false; });
  }

  /* v1.6：undo 基础设施——反向补丁栈（上限100步） */
  function pushUndo(op) {
    S.undoStack.push(op);
    if (S.undoStack.length > 100) S.undoStack.shift();
  }
  function undo() {
    var op = S.undoStack.pop();
    if (!op) { window.showToast && showToast('没有可撤销的操作', 'warn'); return; }
    if (op.type === 'move') {
      var el = nodeEl(op.id), g = graphNode(op.id);
      if (el) { el.style.left = op.x + 'px'; el.style.top = op.y + 'px'; }
      if (g) { g.x = op.x; g.y = op.y; }
      if (el) updateEdgePositions(op.id, op.x, op.y, el);
      api('node/upsert', { id: op.id, x: op.x, y: op.y }, null);
      window.showToast && showToast('已撤销移动', 'ok');
    } else if (op.type === 'status') {
      var g2 = graphNode(op.id);
      if (g2) g2.status = op.prev || '';
      api('node/status', { id: op.id, status: op.prev || 'todo' }, function (j) {
        if (j && j.ok) { render(); window.showToast && showToast('已撤销状态切换', 'ok'); }
      });
    } else if (op.type === 'delete') {
      /* 反向补丁：软删恢复（deleted:0 落库后重拉图） */
      var ids = op.ids || [];
      var pend = ids.length;
      ids.forEach(function (id) {
        api('node/upsert', { id: id, deleted: 0 }, function (j) {
          pend--;
          if (pend <= 0 && j && j.ok) { refresh(); window.showToast && showToast('已撤销删除 ' + ids.length + ' 个节点', 'ok'); }
        });
      });
    } else if (op.type === 'edgeAdd') {
      api('edge/delete', { id: op.edgeId }, function (j) { if (j && j.ok) { refresh(); window.showToast && showToast('已撤销连线', 'ok'); } });
    }
  }
  function graphNode(id) {
    return ((S.graph && S.graph.nodes) || []).find(function (n) { return n.id === id; }) || null;
  }

  /* v1.5：Delete 删除所有框选节点（软删落库，v1.6 记 undo） */
  function deleteSelected() {
    var ids = Object.keys(S.selected || {});
    if (!ids.length) return;
    var pend = ids.length;
    ids.forEach(function (id) {
      api('node/upsert', { id: id, deleted: 1 }, function (j) {
        pend--;
        if (j && j.ok) { var el = nodeEl(id); if (el) el.remove(); delete S.selected[id]; }
        if (pend <= 0) { pushUndo({ type: 'delete', ids: ids }); drawEdges(); window.showToast && showToast('已删除 ' + ids.length + ' 个节点（软删，Ctrl+Z 撤销）', 'ok'); }
      });
    });
  }

  /* ---------- v1.4：标签删除（软删，双击删除按钮/右键节点菜单） ---------- */
  function deleteNode(n) {
    if (!n || !n.id) return;
    api('node/upsert', { id: n.id, deleted: 1 }, function (j) {
      if (j && j.ok) {
        var el = nodeEl(n.id);
        if (el) { el.remove(); }
        pushUndo({ type: 'delete', ids: [n.id] });
        drawEdges();
        window.showToast && showToast('节点已删除（Ctrl+Z 撤销）', 'ok');
      } else {
        window.showToast && showToast('删除失败：' + (j && j.err || '未知'), 'err');
      }
    });
  }

  function buildCard(n) {
    var t = T();
    var st = STATUS_META[n.status] || STATUS_META.todo;
    var el = document.createElement('div');
    el.setAttribute('data-eng', n.id);
    /* v1.9：宽高可拖拽并记忆（默认 160×120，落库 w/h） */
    var w = parseInt(n.w, 10) || 160;
    var h = parseInt(n.h, 10) || 120;
    el.style.cssText = 'position:absolute;width:' + w + 'px;height:' + h + 'px;box-sizing:border-box;background:' + t.cardBg + ';' +
      'border:1px solid ' + t.cardBorder + ';border-top:4px solid ' + st.color + ';border-radius:10px;padding:10px;cursor:grab;' +
      'box-shadow:' + t.shadow + ';font-size:12px;color:' + t.cardText + ';display:flex;flex-direction:column;overflow:hidden;';
    el.style.left = (n.x || 100) + 'px';
    el.style.top = (n.y || 100) + 'px';
    var title = String(n.title || n.id);
    var grp = String(n.groupId || '');
    el.innerHTML =
      /* v1.5：4 球状态系统（4 球横排；v1.8 每球单独点击=直接设为该状态） */
      '<div data-sts style="display:flex;gap:8px;align-items:center;flex:0 0 auto;">' +
      ORDER.map(function (sk) {
        var sm = STATUS_META[sk];
        var on = sk === n.status;
        return '<span data-st="' + sk + '" title="' + sm.label + '（点击设为此状态）" style="width:12px;height:12px;border-radius:50%;cursor:pointer;' +
          (on ? 'background:' + sm.color + ';box-shadow:0 0 0 2px ' + sm.color + '44;'
              : 'background:transparent;border:1.5px solid ' + sm.color + '88;') + '"></span>';
      }).join('') +
      (grp ? '<span data-grp title="分组（双击本卡片标题改名）" style="margin-left:auto;font-size:10px;padding:1px 6px;border-radius:8px;background:' + t.accent + '22;color:' + t.accent + ';border:1px solid ' + t.accent + '55;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🏷 ' + _esc(grp.slice(0, 12)) + '</span>' : '') +
      '</div>' +
      '<div data-title title="双击重命名" style="flex:1;overflow:hidden;line-height:1.4;font-weight:bold;margin-top:6px;word-break:break-all;">' + _esc(title.slice(0, 60)) + '</div>' +
      /* v1.9：右下角宽高拖拽手柄 */
      '<div data-rs title="拖拽调整宽高" style="position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;z-index:3;">' +
      '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M12 4L4 12M12 8L8 12" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".4"/></svg></div>';
    /* v1.8：每个状态圈单独点击 → 直接设置该状态（不再循环切换） */
    Array.prototype.forEach.call(el.querySelectorAll('[data-st]'), function (dot) {
      dot.onclick = function (e) { e.stopPropagation(); setStatus(n, dot.getAttribute('data-st')); };
    });
    /* v1.9#4：关闭按钮 hover 才显示（CSS 类 + mouseenter/leave 切换） */
    el.insertAdjacentHTML('beforeend',
      '<span data-del role="button" title="删除该节点" style="position:absolute;top:-8px;right:-8px;width:18px;height:18px;line-height:16px;text-align:center;border-radius:50%;background:#ef4444;color:#fff;font-size:12px;cursor:pointer;font-weight:bold;z-index:3;display:none;">✕</span>');
    var delBtn = el.querySelector('[data-del]');
    el.addEventListener('mouseenter', function () { delBtn.style.display = 'block'; });
    el.addEventListener('mouseleave', function () { delBtn.style.display = 'none'; });
    delBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); e.preventDefault(); });
    delBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteNode(n); });
    /* v1.9#1：双击标题 → 行内重命名（进入工程后仍可改，落库 title） */
    var titleEl = el.querySelector('[data-title]');
    titleEl.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      if (el.querySelector('[data-rename]')) return;
      var inp = document.createElement('input');
      inp.setAttribute('data-rename', '1');
      inp.value = n.title || n.id;
      inp.style.cssText = 'width:100%;box-sizing:border-box;font-size:12px;font-weight:bold;padding:2px 4px;border-radius:4px;outline:none;border:1px solid ' + t.accent + ';background:' + t.winBg + ';color:' + t.cardText + ';';
      titleEl.style.display = 'none';
      titleEl.parentNode.insertBefore(inp, titleEl);
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
      function commit(save) {
        var nv = (inp.value || '').trim();
        if (save && nv && nv !== n.title) {
          n.title = nv;
          titleEl.textContent = nv.slice(0, 60);
          api('node/upsert', { id: n.id, title: nv }, function (j) {
            window.showToast && showToast(j && j.ok ? '已重命名' : '重命名落库失败（前端已更新）', j && j.ok ? 'ok' : 'warn');
          });
        }
        inp.remove(); titleEl.style.display = '';
      }
      inp.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') commit(true);
        else if (ev.key === 'Escape') commit(false);
      });
      inp.addEventListener('blur', function () { commit(true); });
    });
    /* v1.9#3：右下角手柄拖宽高，mouseup 落库 w/h */
    var rs = el.querySelector('[data-rs]');
    rs.addEventListener('mousedown', function (e) {
      e.stopPropagation(); e.preventDefault();
      S.nodeResize = { n: n, el: el, sx: e.clientX, sy: e.clientY, ow: el.offsetWidth, oh: el.offsetHeight };
    });
    el.addEventListener('mousedown', function (e) { startDragNode(e, n, el); });
    el.addEventListener('dblclick', function (e) {
      /* 标题/手柄上的双击不打开对话 */
      if (e.target === titleEl || (e.target.closest && e.target.closest('[data-rs],[data-rename]'))) return;
      openChat(n.id);
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); promptAssignProject(n); });
    if (S.linkMode) {
      el.addEventListener('mousedown', function (e) {
        if (!S.linkMode) return;
        e.stopPropagation(); e.preventDefault();
        if (!S.linkFrom) { S.linkFrom = n.id; el.style.outline = '2px solid ' + T().accent; window.showToast && showToast('已选起点，再点一个节点完成连线', ''); }
        else if (S.linkFrom !== n.id) {
          api('edge/upsert', { src: S.linkFrom, dst: n.id, kind: 'normal' }, function (j) {
            if (j && j.ok) { if (j.edgeId || j.id) pushUndo({ type: 'edgeAdd', edgeId: j.edgeId || j.id }); window.showToast && showToast('连线已保存', 'ok'); refresh(); }
          });
          resetLink();
        }
      }, true);
    } else {
      /* v1.8：单击节点 = 选中/取消（显示派团队按钮） */
      el.addEventListener('click', function (e) {
        if (S.drag && S.drag.moved) return;
        if (e.ctrlKey || e.metaKey) {
          if (S.selected[n.id]) { delete S.selected[n.id]; el.style.outline = ''; }
          else { S.selected[n.id] = el; el.style.outline = '2px solid ' + T().accent; }
        } else {
          Array.prototype.slice.call(document.querySelectorAll('[data-eng]')).forEach(function (x) { x.style.outline = ''; });
          S.selected = {}; S.selected[n.id] = el; el.style.outline = '2px solid ' + T().accent;
        }
        var cb = document.getElementById('zfEngCrew');
        if (cb) cb.style.display = Object.keys(S.selected).length ? 'inline-block' : 'none';
      });
    }
    return el;
  }

  function resetLink() {
    S.linkFrom = null;
    Array.prototype.slice.call(document.querySelectorAll('[data-eng]')).forEach(function (n) { n.style.outline = ''; });
  }

  function toggleLinkMode() {
    S.linkMode = !S.linkMode;
    S.linkFrom = null;
    resetLink();
    applyTheme(); /* 按钮激活态 + 文案统一走主题刷新 */
    var h = document.getElementById('zfEngHint');
    h.textContent = S.linkMode ? '连线模式：依次点两个节点（起点→终点）成边' : '双击节点=打开对话 · 点状态环=切换状态 · Shift+拖空白=框选';
    render(); /* P1 修复：切换后重挂节点连线监听（监听在渲染时按 linkMode 挂载） */
  }

  /* ---------- v1.6：工程管理弹窗（新建/载入/重命名/删除，eng_projects 路由） ---------- */
  function engCurProject() {
    try { return JSON.parse(localStorage.getItem('zfEngCurProject') || 'null'); } catch (e) { return null; }
  }
  function engSetCurProject(p) {
    try { localStorage.setItem('zfEngCurProject', p ? JSON.stringify(p) : ''); } catch (e) {}
    var t = document.getElementById('zfEngTitle');
    if (t) t.textContent = p ? ('i工程 · ' + p.name) : 'i工程 · 任务流程';
  }
  function promptProjects() {
    var t = T();
    var old = document.getElementById('zfEngProjectsPop');
    if (old) { old.remove(); return; }
    var pop = document.createElement('div');
    pop.id = 'zfEngProjectsPop';
    var btn = document.getElementById('zfEngProjects').getBoundingClientRect();
    pop.style.cssText = 'position:fixed;z-index:91000;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);left:' + Math.max(btn.left - 60, 8) + 'px;top:' + (btn.bottom + 6) + 'px;min-width:320px;max-height:60vh;overflow:auto;';
    pop.style.background = t.winBg; pop.style.border = '1px solid ' + t.border; pop.style.color = t.cardText;
    pop.innerHTML =
      '<div style="display:flex;gap:6px;">' +
      '<input id="zfEngProjName" placeholder="新工程名称（回车创建）" style="flex:1;padding:5px 8px;border-radius:6px;font-size:12px;outline:none;border:1px solid ' + t.btnBorder + ';background:transparent;color:' + t.cardText + ';" />' +
      '<button id="zfEngProjCreate" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;border:1px solid ' + t.accent + ';background:' + t.accent + ';color:' + t.accentOn + ';">新建</button>' +
      '</div>' +
      '<div id="zfEngProjList" style="display:flex;flex-direction:column;gap:4px;font-size:12px;">加载中…</div>' +
      '<div style="font-size:11px;opacity:.65;">载入 = 切换到该工程视图（按 boardId=工程名 过滤渲染）；勾选状态存本机。</div>';
    document.body.appendChild(pop);
    setTimeout(function () { document.addEventListener('mousedown', _projPopAway); }, 0);
    function _projPopAway(ev) {
      var p = document.getElementById('zfEngProjectsPop');
      if (p && !p.contains(ev.target) && ev.target.id !== 'zfEngProjects') { p.remove(); document.removeEventListener('mousedown', _projPopAway); }
    }
    function loadList() {
      fetch('/api/engineering/projects').then(function (r) { return r.json(); }).then(function (j) {
        var list = document.getElementById('zfEngProjList');
        if (!list) return;
        if (!j || !j.ok || !Array.isArray(j.projects) || !j.projects.length) { list.innerHTML = '<span style="opacity:.6;">暂无工程，先新建一个</span>'; return; }
        var cur = engCurProject();
        list.innerHTML = '';
        j.projects.forEach(function (p) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:5px 8px;border-radius:6px;border:1px solid ' + t.btnBorder + ';';
          var active = cur && cur.id === p.id;
          if (active) row.style.borderColor = t.accent;
          row.innerHTML =
            '<b style="flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (active ? '▶ ' : '') + _esc(p.name) + '</b>' +
            '<button data-act="load" style="padding:3px 8px;border-radius:6px;cursor:pointer;font-size:11px;">载入</button>' +
            '<button data-act="rename" style="padding:3px 8px;border-radius:6px;cursor:pointer;font-size:11px;">改名</button>' +
            '<button data-act="del" style="padding:3px 8px;border-radius:6px;cursor:pointer;font-size:11px;">删除</button>';
          row.querySelector('[data-act="load"]').onclick = function () {
            engSetCurProject({ id: p.id, name: p.name });
            refresh();
            window.showToast && showToast('已载入工程：' + p.name, 'ok');
            pop.remove(); document.removeEventListener('mousedown', _projPopAway);
          };
          row.querySelector('[data-act="rename"]').onclick = function () {
            var nn = prompt('新名称：', p.name);
            if (!nn || nn === p.name) return;
            fetch('/api/engineering/project/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, name: nn }) })
              .then(function (r) { return r.json(); })
              .then(function (j2) {
                if (j2 && j2.ok) { if (cur && cur.id === p.id) engSetCurProject({ id: p.id, name: nn }); loadList(); window.showToast && showToast('已改名', 'ok'); }
                else window.showToast && showToast('改名失败' + (j2 && j2.err ? '：' + j2.err : ''), 'err');
              });
          };
          row.querySelector('[data-act="del"]').onclick = function () {
            if (!confirm('删除工程「' + p.name + '」？（只删工程记录，不删节点）')) return;
            fetch('/api/engineering/project/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
              .then(function (r) { return r.json(); })
              .then(function (j2) {
                if (j2 && j2.ok) { if (cur && cur.id === p.id) engSetCurProject(null); loadList(); window.showToast && showToast('已删除工程', 'ok'); }
                else window.showToast && showToast('删除失败' + (j2 && j2.err ? '：' + j2.err : ''), 'err');
              });
          };
          list.appendChild(row);
        });
      }).catch(function (e) {
        var list = document.getElementById('zfEngProjList');
        if (list) list.innerHTML = '<span style="color:#f66;">加载失败（后端未重启？）</span>';
      });
    }
    function doCreate() {
      var inp = document.getElementById('zfEngProjName');
      var nm = (inp.value || '').trim();
      if (!nm) return;
      fetch('/api/engineering/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) { inp.value = ''; loadList(); window.showToast && showToast('工程已创建', 'ok'); }
          else window.showToast && showToast('创建失败' + (j && j.err ? '：' + j.err : ''), 'err');
        });
    }
    document.getElementById('zfEngProjCreate').onclick = doCreate;
    document.getElementById('zfEngProjName').addEventListener('keydown', function (e) { if (e.key === 'Enter') doCreate(); });
    loadList();
  }

  /* v1.6：右键节点 → 分配到工程（boardId=工程名 落 ext） */
  function promptAssignProject(n) {
    fetch('/api/engineering/projects').then(function (r) { return r.json(); }).then(function (j) {
      var ps = (j && j.ok && j.projects) || [];
      if (!ps.length) { window.showToast && showToast('还没有工程，先点「工程 ▾」新建', 'warn'); return; }
      var names = ps.map(function (p) { return p.name; }).concat(['— 取消分配 —']);
      var pick = prompt('分配到哪个工程？输入序号：\n' + names.map(function (nm, i) { return (i + 1) + '. ' + nm; }).join('\n'));
      var idx = parseInt(pick, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= names.length) return;
      var board = (idx === names.length - 1) ? '' : names[idx];
      api('node/upsert', { id: n.id, boardId: board }, function (j2) {
        if (j2 && j2.ok) { n.boardId = board; window.showToast && showToast(board ? ('已分配到 ' + board) : '已取消分配', 'ok'); refresh(); }
        else window.showToast && showToast('分配失败', 'err');
      });
    });
  }

  /* v1.8：点状态圈 → 直接设为该状态（局部更新，不整页 render） */
  function setStatus(n, next) {
    if (!STATUS_META[next] || n.status === next) return;
    api('node/status', { id: n.id, status: next }, function (j) {
      if (j && j.ok) {
        pushUndo({ type: 'status', id: n.id, prev: n.status });
        n.status = next;
        var st = STATUS_META[next] || STATUS_META.todo;
        var el = nodeEl(n.id);
        if (el) {
          el.style.borderTop = '4px solid ' + st.color;
          Array.prototype.forEach.call(el.querySelectorAll('[data-st]'), function (dot) {
            var sk = dot.getAttribute('data-st');
            var sm = STATUS_META[sk];
            if (sk === next) dot.style.cssText = 'width:12px;height:12px;border-radius:50%;cursor:pointer;background:' + sm.color + ';box-shadow:0 0 0 2px ' + sm.color + '44;';
            else dot.style.cssText = 'width:12px;height:12px;border-radius:50%;cursor:pointer;background:transparent;border:1.5px solid ' + sm.color + '88;';
          });
        }
      }
    });
  }

  /* ---------- v1.8：双击/右键空白 → 极简创建弹窗（只输入一个标题） ---------- */
  function promptCreateNode(sx, sy) {
    var t = T();
    var old = document.getElementById('zfEngNewNode');
    if (old) old.remove();
    var pop = document.createElement('div');
    pop.id = 'zfEngNewNode';
    pop.style.cssText = 'position:fixed;z-index:91000;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);left:' + (sx - 20) + 'px;top:' + (sy - 16) + 'px;min-width:260px;';
    pop.style.background = t.winBg; pop.style.border = '1px solid ' + t.border; pop.style.color = t.cardText;
    pop.innerHTML =
      '<input id="zfEngNewName" placeholder="输入标题（回车创建，Esc 取消）" style="flex:1;padding:6px 8px;border-radius:6px;font-size:12px;outline:none;border:1px solid ' + t.btnBorder + ';background:transparent;color:' + t.cardText + ';" />';
    document.body.appendChild(pop);
    var inp = document.getElementById('zfEngNewName');
    setTimeout(function () { inp.focus(); }, 0);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var title = (inp.value || '').trim(); pop.remove(); if (title) createNodeAt(sx, sy, title); }
      else if (e.key === 'Escape') pop.remove();
      e.stopPropagation();
    });
    setTimeout(function () {
      document.addEventListener('mousedown', function _off(ev) {
        if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', _off); }
      });
    }, 0);
  }

  /* ---------- v1.9.1 重构：createNodeAt 拆出「建对话+发送」「落库」两个子函数 ---------- */
  /* 建好对话后：标题落库 + DOM 即时改名 + 标题作为首条消息自动发送 */
  function startNodeChat(chat, title) {
    var App = window.App, named = false;
    try {
      if (window.DB && typeof window.DB.saveNode === 'function') {
        /* DB.saveNode(node)：POST /api/db/nodes（标题持久化真链路，db.js:263） */
        window.DB.saveNode({ id: chat.id, title: title });
        named = true;
      } else if (typeof App.saveNode === 'function') { App.saveNode(chat.id, { title: title }); named = true; }
    } catch (e2) {}
    try {
      if (chat.el) {
        var ti = chat.el.querySelector('.chat-title, .cb-title, [data-title]');
        if (ti) ti.textContent = title;
      }
      if (chat.el && chat.el.dataset) chat.el.dataset.title = title;
    } catch (e3) {}
    /* v1.8：把标题作为用户问题填入输入框并立即发送 */
    try {
      var ta = chat.el.querySelector('textarea');
      if (ta) ta.value = title;
      App.addMsg(chat.el, title, 'user', chat.modelId);
      if (App.showQueryPin) App.showQueryPin(chat.el, title);
      if (App.updateChatTitle) App.updateChatTitle(chat.el, title);
      chat.history.push({ role: 'user', content: title });
      App.sendToModel(chat.el, chat);
    } catch (eS) { window.showToast && showToast('自动发送失败：' + eS.message, 'warn'); }
    return named;
  }
  /* 坐标+src=eng 隔离标记落库，重拉图，toast 汇报 */
  function persistEngNode(chat, title, spawnX, spawnY, named) {
    try {
      /* v1.9#8：i工程创建的对话打 src=eng 隔离标记——i工程只显示 eng 节点，无限画布不显示 eng 节点 */
      api('node/upsert', { id: chat.id, x: Math.round(spawnX), y: Math.round(spawnY), src: 'eng' }, null);
    } catch (e4) {}
    refresh(); /* 重拉图，新节点立即出现在 i工程 画布上 */
    window.showToast && showToast('已创建节点「' + _esc(title) + '」(' + _esc(chat.id) + ')' + (named ? '' : ' · 标题未落库，可在画布上改名'), named ? 'ok' : 'warn');
  }

  function createNodeAt(sx, sy, title) {
    try {
      var App = window.App;
      if (!App || typeof App.createChatBox !== 'function') { window.showToast && showToast('创建接口不可用（App.createChatBox）', 'err'); return; }
      /* 定位规则（2026-11）：新对话必须挨着「最后一个主对话」（排除策划师/审核员/施工队等子对话，
         用 ZFChildRel.isSub 单一真源判定）的右侧创建，而不是按鼠标点击处——鼠标在 i工程 画布任意空白处
         双击/右键时，旧逻辑把屏幕坐标当 trustedSpawn 逻辑坐标直接落窗，导致新对话乱飞、与主对话分家。
         找不到任何主对话时才回退到鼠标位置换算的画布逻辑坐标。 */
      var spawnX = null, spawnY = null;
      try {
        var boxes = (App.chatBoxes || []).filter(function (b) { return b && b.el; });
        var lastMain = null;
        for (var i = boxes.length - 1; i >= 0; i--) {
          var el = boxes[i].el;
          var isSub = !!(window.ZFChildRel && ZFChildRel.isSub && ZFChildRel.isSub(el));
          if (!isSub) { lastMain = boxes[i]; break; }
        }
        if (lastMain && lastMain.el) {
          spawnX = (parseFloat(lastMain.el.style.left) || 0) + 420; /* 主对话右侧 420px（窗口默认宽 380 + 40 间距） */
          spawnY = parseFloat(lastMain.el.style.top) || 0;
        }
      } catch (eL) {}
      if (spawnX == null) { var _wp = toWorld(sx, sy); spawnX = Math.round(_wp.x); spawnY = Math.round(_wp.y); }
      /* trustedSpawn=true：上面已算好画布逻辑坐标，createChatBox 内部会原样使用（不做视口换算/钳制） */
      var chat = App.createChatBox(spawnX, spawnY, undefined, true);
      if (chat && chat.id) {
        persistEngNode(chat, title, spawnX, spawnY, startNodeChat(chat, title));
      } else {
        window.showToast && showToast('创建节点失败', 'err');
      }
    } catch (e) { window.showToast && showToast('创建节点异常：' + e.message, 'err'); }
  }

  function openChat(id) {
    /* 复用现有画布对话窗口：节点 id 即 cb*，用 App.chatBoxes + App.activate 真链路 */
    try {
      var App = window.App;
      if (App && Array.isArray(App.chatBoxes)) {
        var c = App.chatBoxes.find(function (x) { return x && x.id === String(id) && x.el; });
        if (c) {
          if (typeof App.activate === 'function') App.activate(c.el);
          if (typeof App._focusCameraOn === 'function') App._focusCameraOn(c.el);
          else if (typeof App._focusChatBox === 'function') App._focusChatBox(c);
          return;
        }
        /* 窗口未在画布上（可能被关闭但节点永久保留）：提示并给相机导航兜底 */
        window.showToast && showToast('对话窗口 cb 未打开；节点 ' + id + ' 数据已永久保存', 'warn');
        return;
      }
      window.showToast && showToast('对话接口不可用；节点 ' + id + ' 已永久保存，可在无限画布直接查看', 'warn');
    } catch (e) {}
  }

  /* ---------- 连线绘制 ---------- */
  /* P2 性能：缓存边元素引用，拖拽时只平移相关连线，不全量重建 */
  var EDGE_REFS = [];

  function edgeColor(kind) { return kind === 'pass' ? '#22c55e' : (kind === 'verify' ? '#f59e0b' : (getTheme() === 'light' ? '#999fb0' : '#5b6478')); }

  function drawEdges() {
    var svg = document.getElementById('zfEngEdges');
    if (!svg) return;
    svg.innerHTML = '';
    EDGE_REFS = [];
    (S.graph.edges || []).forEach(function (e) {
      var a = nodeEl(e.src), b = nodeEl(e.dst);
      if (!a || !b) return;
      var ax = a.offsetLeft + a.offsetWidth / 2, ay = a.offsetTop + a.offsetHeight / 2;
      var bx = b.offsetLeft + b.offsetWidth / 2, by = b.offsetTop + b.offsetHeight / 2;
      /* v1.5：贝兹曲线（水平控制点，水平距离的 0.45 倍，最小 40px） */
      var d = Math.max(40, Math.abs(bx - ax) * 0.45);
      var pathD = 'M' + ax + ' ' + ay + ' C' + (ax + d) + ' ' + ay + ',' + (bx - d) + ' ' + by + ',' + bx + ' ' + by;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', pathD);
      line.setAttribute('data-ax', ax); line.setAttribute('data-ay', ay);
      line.setAttribute('data-bx', bx); line.setAttribute('data-by', by);
      line.setAttribute('fill', 'none');
      var color = edgeColor(e.kind);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', e.kind === 'pass' ? '2.5' : '1.5');
      if (e.kind === 'pass') line.setAttribute('stroke-dasharray', '6,4');
      line.setAttribute('marker-end', 'url(#zfEngArrow' + (e.kind === 'pass' ? 'Pass' : '') + ')');
      svg.appendChild(line);
      /* 双击连线=删除 */
      var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', pathD);
      hit.setAttribute('fill', 'none');
      hit.style.pointerEvents = 'stroke'; hit.style.cursor = 'pointer';
      hit.addEventListener('dblclick', function () {
        api('edge/delete', { id: e.id }, function (j) { if (j && j.ok) refresh(); });
      });
      svg.appendChild(hit);
      EDGE_REFS.push({ e: e, line: line, hit: hit });
    });
    /* 箭头 marker */
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML =
      '<marker id="zfEngArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' + edgeColor('normal') + '"/></marker>' +
      '<marker id="zfEngArrowPass" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#22c55e"/></marker>';
    svg.appendChild(defs);
  }

  /* ---------- 拖拽 / 框选 ---------- */
  function startDragNode(e, n, el) {
    if (S.linkMode) return;
    if (e.button !== 0) return;
    S.drag = { n: n, el: el, sx: e.clientX, sy: e.clientY, ox: el.offsetLeft, oy: el.offsetTop, moved: false };
    el.style.cursor = 'grabbing';
    e.stopPropagation();
  }

  function onCanvasDown(e) {
    /* v1.7：中键(button=1)也可拖空白平移 */
    var isMid = e.button === 1;
    if (e.button !== 0 && !isMid) return;
    if (!isMid && S.linkMode) { resetLink(); return; }
    var cv = document.getElementById('zfEngCanvas');
    var r = cv.getBoundingClientRect();
    if (isMid) {
      /* v1.5：中键拖空白 = 平移画布 */
      S.pan = { sx: e.clientX, sy: e.clientY, tx: S.view.tx, ty: S.view.ty };
      cv.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    /* v2.1：空格 + 左键拖空白 = 平移画布（Mac/触控板友好，不只靠中键） */
    if (S.spaceDown) {
      S.pan = { sx: e.clientX, sy: e.clientY, tx: S.view.tx, ty: S.view.ty };
      cv.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    /* v1.9#2 修复框选不好使：原判定 e.target === cv 过严——空白处 mousedown 的 target
       常是 zfEngWorld 或 svg（被 pointer-events 穿透），改为「target 不是节点卡片即框选」 */
    var onCard = e.target.closest && e.target.closest('[data-eng]');
    if (!onCard) {
      /* v1.8：拖空白直接框选——shift=加选，ctrl=减选，无修饰=替换选区 */
      S.selBoxMod = e.shiftKey ? 'add' : (e.ctrlKey ? 'sub' : 'replace');
      S.selBox = { sx: e.clientX, sy: e.clientY };
      var box = document.getElementById('zfEngSelBox');
      box.style.display = 'block';
      box.style.left = e.clientX - r.left + 'px';
      box.style.top = e.clientY - r.top + 'px';
      box.style.width = '0px'; box.style.height = '0px';
      e.preventDefault();
    }
  }

  /* P2 性能：拖拽中只平移与被拖节点相连的贝兹曲线端点，不重建 SVG（v1.5 改 path d） */
  function updateEdgePositions(nodeId, x, y, el) {
    /* F2 修复：用元素真实尺寸求中心，替代写死 130/32 */
    var cx = x + (el ? el.offsetWidth / 2 : 130);
    var cy = y + (el ? el.offsetHeight / 2 : 32);
    EDGE_REFS.forEach(function (r) {
      var isSrc = r.e.src === nodeId, isDst = r.e.dst === nodeId;
      if (!isSrc && !isDst) return;
      /* 端点更新后重算整条贝兹（另一端坐标存 data-ax/ay） */
      var ax2 = parseFloat(r.line.getAttribute('data-ax')), ay2 = parseFloat(r.line.getAttribute('data-ay'));
      var bx2 = parseFloat(r.line.getAttribute('data-bx')), by2 = parseFloat(r.line.getAttribute('data-by'));
      if (isSrc) { ax2 = cx; ay2 = cy; } else { bx2 = cx; by2 = cy; }
      r.line.setAttribute('data-ax', ax2); r.line.setAttribute('data-ay', ay2);
      r.line.setAttribute('data-bx', bx2); r.line.setAttribute('data-by', by2);
      var dd = Math.max(40, Math.abs(bx2 - ax2) * 0.45);
      var pd = 'M' + ax2 + ' ' + ay2 + ' C' + (ax2 + dd) + ' ' + ay2 + ',' + (bx2 - dd) + ' ' + by2 + ',' + bx2 + ' ' + by2;
      r.line.setAttribute('d', pd);
      r.hit.setAttribute('d', pd);
    });
  }

  function onMouseMove(e) {
    if (S.winDrag) {
      var win = document.getElementById('zfEngWin');
      var nx = S.winDrag.ox + e.clientX - S.winDrag.sx;
      var ny = S.winDrag.oy + e.clientY - S.winDrag.sy;
      /* 防拖丢：标题栏留在视口内 */
      win.style.left = Math.max(-win.offsetWidth + 80, Math.min(nx, window.innerWidth - 80)) + 'px';
      win.style.top = Math.max(0, Math.min(ny, window.innerHeight - 40)) + 'px';
    } else if (S.winResize) {
      /* v2.1：多方向调大小（se/n/s/e/w/ne/nw/sw），反向拖动同时改 left/top */
      var wr = S.winResize;
      var win2 = document.getElementById('zfEngWin');
      var dx = e.clientX - wr.sx, dy = e.clientY - wr.sy;
      var MINW = 480, MINH = 320;
      var d = wr.dir || 'se';
      if (d.indexOf('e') >= 0) win2.style.width = Math.max(MINW, wr.ow + dx) + 'px';
      if (d.indexOf('s') >= 0) win2.style.height = Math.max(MINH, wr.oh + dy) + 'px';
      if (d.indexOf('w') >= 0) {
        var nw = Math.max(MINW, wr.ow - dx);
        win2.style.width = nw + 'px';
        win2.style.left = (wr.ol + wr.ow - nw) + 'px';
      }
      if (d.charAt(0) === 'n') {
        var nh = Math.max(MINH, wr.oh - dy);
        win2.style.height = nh + 'px';
        win2.style.top = (wr.ot + wr.oh - nh) + 'px';
      }
    } else if (S.pan) {
      /* v1.5：画布平移 */
      S.view.tx = S.pan.tx + e.clientX - S.pan.sx;
      S.view.ty = S.pan.ty + e.clientY - S.pan.sy;
      applyView();
    } else if (S.drag) {
      var d = S.drag;
      d.el.style.left = (d.ox + (e.clientX - d.sx) / S.view.k) + 'px';
      d.el.style.top = (d.oy + (e.clientY - d.sy) / S.view.k) + 'px';
      d.moved = true;
      updateEdgePositions(d.n.id, d.el.offsetLeft, d.el.offsetTop, d.el);
    } else if (S.selBox) {
      var cv = document.getElementById('zfEngCanvas');
      var r = cv.getBoundingClientRect();
      var box = document.getElementById('zfEngSelBox');
      var x = Math.min(S.selBox.sx, e.clientX) - r.left, y = Math.min(S.selBox.sy, e.clientY) - r.top;
      box.style.left = x + 'px'; box.style.top = y + 'px';
      box.style.width = Math.abs(e.clientX - S.selBox.sx) + 'px';
      box.style.height = Math.abs(e.clientY - S.selBox.sy) + 'px';
    } else if (S.nodeResize) {
      /* v1.9：节点宽高拖拽 */
      var nr = S.nodeResize;
      nr.el.style.width = Math.max(120, nr.ow + e.clientX - nr.sx) + 'px';
      nr.el.style.height = Math.max(80, nr.oh + e.clientY - nr.sy) + 'px';
      updateEdgePositions(nr.n.id, nr.el.offsetLeft, nr.el.offsetTop, nr.el);
    }
  }

  /* ---------- v1.9.1 重构：onMouseUp 只做分发，四个互斥收尾各拆独立函数 ---------- */
  function finishNodeDrag() {
    var d = S.drag;
    d.el.style.cursor = 'grab';
    if (d.moved) {
      /* 坐标落库（后端 node/upsert 已支持 x/y 落 canvas_nodes）+ v1.6 记 undo */
      pushUndo({ type: 'move', id: d.n.id, x: d.ox, y: d.oy, prevX: d.n.x, prevY: d.n.y });
      d.n.x = d.el.offsetLeft; d.n.y = d.el.offsetTop;
      api('node/upsert', { id: d.n.id, x: d.n.x, y: d.n.y }, null);
      /* F2 修复：落库后按真值重绘一次，消除拖拽期间近似坐标残留 */
      drawEdges();
      drawMinimap();
    }
    S.drag = null;
  }
  function finishBoxSelect() {
    var box = document.getElementById('zfEngSelBox');
    /* v1.5：框选命中改世界坐标（支持缩放平移下框选） */
    var p1 = toWorld(box.offsetLeft, box.offsetTop);
    var p2 = toWorld(box.offsetLeft + box.offsetWidth, box.offsetTop + box.offsetHeight);
    var vx1 = Math.min(p1.x, p2.x), vy1 = Math.min(p1.y, p2.y);
    var vx2 = Math.max(p1.x, p2.x), vy2 = Math.max(p1.y, p2.y);
    /* v1.8：增减框选——shift=追加，ctrl=剔除；无修饰=替换选区 */
    var mode = S.selBoxMod || 'replace';
    if (mode === 'add' || mode === 'sub') {
      /* 保留原选区 */
    } else { S.selected = {}; }
    Array.prototype.slice.call(document.querySelectorAll('[data-eng]')).forEach(function (el) {
      var id = el.getAttribute('data-eng');
      var x = el.offsetLeft, y = el.offsetTop;
      var hit = x + el.offsetWidth >= vx1 && x <= vx2 && y + el.offsetHeight >= vy1 && y <= vy2;
      if (mode === 'sub') {
        if (hit) { delete S.selected[id]; }
      } else if (hit) { S.selected[id] = el; }
    });
    Array.prototype.slice.call(document.querySelectorAll('[data-eng]')).forEach(function (el) {
      var id = el.getAttribute('data-eng');
      if (S.selected[id]) el.style.outline = '2px solid ' + T().accent;
      else el.style.outline = '';
    });
    box.style.display = 'none';
    S.selBox = null; S.selBoxMod = null;
    var cnt = Object.keys(S.selected).length;
    if (cnt) window.showToast && showToast('已框选 ' + cnt + ' 个节点', '');
    /* v1.8：有选中节点时显示「派团队」按钮 */
    var cb = document.getElementById('zfEngCrew');
    if (cb) cb.style.display = cnt ? 'inline-block' : 'none';
    /* v1.9#2：有选中节点时显示「建组」按钮 */
    var gb = document.getElementById('zfEngGroup');
    if (gb) gb.style.display = cnt ? 'inline-block' : 'none';
  }
  function onMouseUp() {
    if (S.winDrag) {
      S.winDrag = null;
      saveWin();
    }
    if (S.winResize) {
      S.winResize = null;
      saveWin();
      drawEdges();
    }
    if (S.nodeResize) {
      /* v1.9：宽高落库并记忆 */
      var nr = S.nodeResize;
      S.nodeResize = null;
      nr.n.w = nr.el.offsetWidth; nr.n.h = nr.el.offsetHeight;
      api('node/upsert', { id: nr.n.id, w: nr.n.w, h: nr.n.h }, null);
      drawEdges();
      window.showToast && showToast('宽高已记忆 ' + nr.n.w + '×' + nr.n.h, '');
    }
    if (S.pan) { S.pan = null; document.getElementById('zfEngCanvas').style.cursor = ''; }
    if (S.drag) finishNodeDrag();
    if (S.selBox) finishBoxSelect();
  }

  /* ---------- v1.9#2：框选建组/改组名（groupId 落库，卡片显示组名标签） ---------- */
  function promptGroupForSelected() {
    var ids = Object.keys(S.selected || {});
    if (!ids.length) { window.showToast && showToast('请先左键框选节点', 'warn'); return; }
    var t = T();
    var gb = document.getElementById('zfEngGroup');
    var rect = gb ? gb.getBoundingClientRect() : { right: window.innerWidth - 12, bottom: 120 };
    var old = document.getElementById('zfEngGroupPop');
    if (old) old.remove();
    var pop = document.createElement('div');
    pop.id = 'zfEngGroupPop';
    pop.style.cssText = 'position:fixed;z-index:91001;right:12px;top:' + Math.max(rect.bottom + 6, 60) + 'px;padding:12px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);min-width:260px;font-size:12px;';
    pop.style.background = t.winBg; pop.style.border = '1px solid ' + t.border; pop.style.color = t.cardText;
    pop.innerHTML =
      '<div style="font-weight:bold;margin-bottom:8px;">为 ' + ids.length + ' 个选中节点设置分组</div>' +
      '<input id="zfEngGroupName" placeholder="输入分组名（留空=取消分组）" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid ' + t.border + ';background:' + t.cardBg + ';color:' + t.cardText + ';outline:none;" />' +
      '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;">' +
      '<button id="zfEngGroupCancel" style="padding:4px 10px;border-radius:6px;border:1px solid ' + t.border + ';background:transparent;color:' + t.cardText + ';cursor:pointer;">取消</button>' +
      '<button id="zfEngGroupOk" style="padding:4px 10px;border-radius:6px;border:none;background:' + t.accent + ';color:#fff;cursor:pointer;">确定</button></div>';
    document.body.appendChild(pop);
    var inp = document.getElementById('zfEngGroupName');
    setTimeout(function () { inp.focus(); }, 0);
    document.getElementById('zfEngGroupCancel').onclick = function () { pop.remove(); };
    document.getElementById('zfEngGroupOk').onclick = function () {
      var g = (inp.value || '').trim();
      ids.forEach(function (id) {
        var n = ((S.graph && S.graph.nodes) || []).find(function (x) { return String(x.id) === String(id); });
        if (n) {
          n.groupId = g;
          api('node/upsert', { id: id, groupId: g }, function (j) {
            if (!(j && j.ok)) window.showToast && showToast('分组落库失败', 'warn');
          });
        }
      });
      render();
      pop.remove();
      window.showToast && showToast(g ? '已建组「' + g + '」（' + ids.length + ' 个节点）' : '已取消分组', 'ok');
    };
    inp.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') document.getElementById('zfEngGroupOk').click();
      else if (ev.key === 'Escape') pop.remove();
    });
    setTimeout(function () {
      document.addEventListener('mousedown', function _off(ev) {
        var p = document.getElementById('zfEngGroupPop');
        if (p && !p.contains(ev.target) && ev.target.id !== 'zfEngGroup') { p.remove(); document.removeEventListener('mousedown', _off); }
      });
    }, 0);
  }

  /* ---------- v1.8：给选中节点派团队（复用整理模式 ZFCrewPanel） ---------- */
  function promptCrewForSelected() {
    var ids = Object.keys(S.selected || {});
    if (!ids.length) { window.showToast && showToast('请先框选节点', 'warn'); return; }
    var t = T();
    var old = document.getElementById('zfEngCrewPop');
    if (old) old.remove();
    var pop = document.createElement('div');
    pop.id = 'zfEngCrewPop';
    var btn = document.getElementById('zfEngCrew').getBoundingClientRect();
    pop.style.cssText = 'position:fixed;z-index:91000;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);right:12px;top:' + Math.max(btn.bottom + 6, 60) + 'px;min-width:300px;max-height:70vh;overflow:auto;';
    pop.style.background = t.winBg; pop.style.border = '1px solid ' + t.border; pop.style.color = t.cardText;
    pop.innerHTML =
      '<div style="font-size:12px;font-weight:bold;">为 ' + ids.length + ' 个选中节点添加团队</div>' +
      '<div id="zfEngCrewMount" style="min-height:60px;font-size:12px;">加载中…</div>' +
      '<div style="font-size:11px;opacity:.65;">选择团队后会对每个选中节点的对话窗口派发施工队。</div>';
    document.body.appendChild(pop);
    setTimeout(function () {
      document.addEventListener('mousedown', function _off(ev) {
        var p = document.getElementById('zfEngCrewPop');
        if (p && !p.contains(ev.target) && ev.target.id !== 'zfEngCrew') { p.remove(); document.removeEventListener('mousedown', _off); }
      });
    }, 0);
    var mount = document.getElementById('zfEngCrewMount');
    /* 复用整理模式团队面板（window.ZFCrewPanel.mountTo，缺席时提示） */
    if (window.ZFCrewPanel && typeof window.ZFCrewPanel.mountTo === 'function') {
      try {
        window.ZFCrewPanel.mountTo(mount, {
          /* 用户点面板内派发时，逐个节点对应对话派团队 */
          onDispatch: function (crew) {
            var App = window.App;
            var done = 0, fail = 0;
            ids.forEach(function (id) {
              var c = App && App.chatBoxes && App.chatBoxes.find(function (x) { return x && x.id === String(id) && x.el; });
              if (c && window.ZFCrew && typeof window.ZFCrew.dispatchCrew === 'function') {
                try { window.ZFCrew.dispatchCrew(c.el, crew); done++; } catch (e) { fail++; }
              } else fail++;
            });
            window.showToast && showToast('已为 ' + done + ' 个节点派团队' + (fail ? '，' + fail + ' 个失败（对话窗口需打开）' : ''), fail ? 'warn' : 'ok');
            pop.remove();
          }
        });
      } catch (e) { mount.textContent = '团队面板挂载失败：' + e.message; }
    } else {
      mount.innerHTML = '<span style="opacity:.7;">整理模式团队组件（ZFCrewPanel）未加载，请先在整理模式使用过一次团队功能。</span>';
    }
  }

  /* ---------- 开关 ---------- */
  function open() { ensureDom(); S.open = true; document.getElementById('zfEngOverlay').style.display = 'block'; refresh(); }
  function close() { S.open = false; var ov = document.getElementById('zfEngOverlay'); if (ov) ov.style.display = 'none'; }

  window.ZFEngineering = { open: open, close: close, refresh: refresh };

  /* ---------- Dock 注册（缺席重试） ---------- */
  function register() {
    if (!window.ZFDock || typeof window.ZFDock.register !== 'function') return false;
    ZFDock.register({ id: 'zf-sys-engineering', name: 'i工程', icon: ICON, onClick: open });
    return true;
  }
  if (!register()) {
    var tries = 0;
    (function retry() {
      tries++;
      if (register()) return;
      if (tries < 20) setTimeout(retry, 500);
    })();
  }
})();
