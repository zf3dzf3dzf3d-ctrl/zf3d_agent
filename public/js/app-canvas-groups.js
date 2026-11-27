/* =====================================================================
 * app-canvas-groups.js  v1 【i整理·框选分组】
 * 依赖：app-canvas-overview.js 的总览选中集 window.ZFCanvasOverview.selected()
 *       与总览开关事件 'wb-canvas-change' {detail:{on}}。
 * 能力：
 *   1) 总览态框选/点选若干对话后，点工具栏「建分组」或按 G 键成组；
 *   2) 展开态：成员外围画美观分组框（渐变描边+毛玻璃标签头，含折叠/解散按钮）；
 *   3) 折叠态：整组缩为一张卡片，成员真实 display:none 隐藏（主画布同样生效），
 *      提升渲染与交互速度；点卡片展开恢复。
 *   4) 分组持久化 localStorage('zf_ov_groups')，折叠态跨总览/刷新保持。
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFCanvasGroups) return;

  var LS_KEY = 'zf_ov_groups';
  var on = false;
  var groups = load();
  var layer = null;      // 分组层：挂在 #canvasContent 内，随画布平移缩放
  var toolbar = null;

  /* ---------- 存取 ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(groups)); } catch (e) {}
  }
  function boxes() { return (window.App && window.App.chatBoxes) || []; }
  function elOf(id) {
    var a = boxes();
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id && a[i].el) return a[i].el;
    return null;
  }
  function idOfEl(el) {
    var a = boxes();
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].el === el) return a[i].id;
    return null;
  }
  function titleOf(id) {
    var a = boxes();
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return (a[i].title || a[i].name || ('对话 ' + id));
    return '对话 ' + id;
  }

  /* 【字号缩放补偿】画布缩放比 = rect宽/offset宽；组名按 1/k 反向补偿，
     缩小整理模式缩到多小，组名/折叠卡文字屏幕上始终保持基准大字可读 */
  function scaleComp() {
    var host = document.getElementById('canvasContent');
    if (!host) return 1;
    var r = host.getBoundingClientRect();
    var k = (host.offsetWidth > 0 && r.width > 0) ? r.width / host.offsetWidth : 1;
    return 1 / Math.max(k, 0.05);
  }
  /* 定时把组名/折叠卡文字字号刷新为 基准×补偿，随滚轮缩放实时跟随 */
  setInterval(function () {
    if (!layer || !document.body.contains(layer)) return;
    var comp = scaleComp();
    layer.querySelectorAll('[data-zf-base]').forEach(function (n) {
      var base = parseFloat(n.dataset.zfBase) || 14;
      var fs = Math.round(base * comp);
      if (fs > 0 && fs < 800) n.style.fontSize = fs + 'px';
    });
    /* 【用户令 20261122·折叠卡瘦身】卡片只比文字大一圈：小 padding+小 minWidth，随缩放补偿屏幕上恒定 */
    layer.querySelectorAll('.zf-grp-card').forEach(function (c) {
      c.style.minWidth = Math.round(120 * comp) + 'px';
      c.style.padding = Math.round(10 * comp) + 'px ' + Math.round(14 * comp) + 'px';
    });
  }, 400);

  /* ---------- 建组 ---------- */
  function createGroupFromSelection() {
    if (!window.ZFCanvasOverview) { if (window.Toast) Toast.show('总览模块未就绪'); return; }
    var sel = window.ZFCanvasOverview.selected() || [];
    var ids = [];
    sel.forEach(function (el) {
      if (!el.classList.contains('chatbox')) return;
      var id = idOfEl(el);
      if (id != null && ids.indexOf(id) === -1) ids.push(id);
    });
    if (ids.length < 1) { if (window.Toast) Toast.show('请先框选/点选要分组的对话'); return; }
    // 从旧组中移除这些成员（一对话只属一组）
    groups = groups.filter(function (g) {
      g.ids = (g.ids || []).filter(function (id) { return ids.indexOf(id) === -1; });
      return g.ids.length > 0;
    });
    var g = { id: 'g' + Date.now().toString(36), name: '分组 ' + (groups.length + 1), ids: ids, collapsed: false };
    groups.push(g);
    save();
    render();
    if (window.ZFCanvasOverview.clear) window.ZFCanvasOverview.clear();
    if (window.Toast) Toast.show('已创建分组（' + ids.length + ' 个对话）· 点标签头「▾」折叠');
  }

  /* ---------- 渲染 ---------- */
  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    var host = document.getElementById('canvasContent');
    if (!host) return null;
    layer = document.createElement('div');
    layer.id = 'zfGroupsLayer';
    layer.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:5;';
    host.appendChild(layer);
    return layer;
  }

  function memberRect(ids) {
    var L = 1e9, T = 1e9, R = -1e9, B = -1e9, n = 0;
    ids.forEach(function (id) {
      var el = elOf(id);
      if (!el || el.style.display === 'none') return;
      n++;
      L = Math.min(L, el.offsetLeft); T = Math.min(T, el.offsetTop);
      R = Math.max(R, el.offsetLeft + el.offsetWidth);
      B = Math.max(B, el.offsetTop + el.offsetHeight);
    });
    return n ? { x: L, y: T, w: R - L, h: B - T } : null;
  }

  function render() {
    var ly = ensureLayer();
    if (!ly) return;
    ly.innerHTML = '';
    // 清理陈旧：成员全没了的组自动删除
    groups = groups.filter(function (g) {
      g.ids = (g.ids || []).filter(function (id) { return elOf(id); });
      return g.ids.length > 0;
    });
    groups.forEach(function (g) { g.collapsed ? renderCollapsed(g, ly) : renderExpanded(g, ly); });
    startFrameFollow();
  }

  /* 【用户令 20261121·组框动态跟随】组框必须自动跟随组内对话的位置/尺寸实时重绘。
     实现：requestAnimationFrame 循环（节流至约30fps），每帧只原位更新展开态框的
     left/top/width/height（包络未变化时跳过，避免无谓重排），不重建 DOM，速度快。 */
  var _followRAF = 0, _lastTick = 0;
  var _lastEnv = ''; /* 上一帧各组包络签名，未变则跳过 */
  function frameFollowTick(ts) {
    _followRAF = 0;
    if (!on || !layer || !document.body.contains(layer)) { _lastEnv = ''; return; }
    /* 节流：~33ms 一次（约30fps），拖拽跟手且开销低 */
    if (ts - _lastTick < 33) { _followRAF = requestAnimationFrame(frameFollowTick); return; }
    _lastTick = ts;
    var changed = false;
    var sig = [];
    groups.forEach(function (g) {
      if (g.collapsed) return;
      var box = layer.querySelector('.zf-grp-frame[data-gid="' + g.id + '"]');
      if (!box) return;
      var r = memberRect(g.ids);
      if (!r) return;
      sig.push(g.id + ':' + r.x + ',' + r.y + ',' + r.w + ',' + r.h);
      var pad = (box.dataset.grpPad || '140,150').split(',');
      var pl = parseFloat(pad[0]) || 140, pt = parseFloat(pad[1]) || 150;
      var nl = Math.round(r.x - pl), nt = Math.round(r.y - pt);
      var nw = Math.round(r.w + pl * 2), nh = Math.round(r.h + pt + 90);
      if (box.style.left !== nl + 'px' || box.style.top !== nt + 'px' ||
          box.style.width !== nw + 'px' || box.style.height !== nh + 'px') {
        box.style.left = nl + 'px'; box.style.top = nt + 'px';
        box.style.width = nw + 'px'; box.style.height = nh + 'px';
        changed = true;
      }
    });
    var cur = sig.join('|');
    if (changed || cur !== _lastEnv) _lastEnv = cur;
    _followRAF = requestAnimationFrame(frameFollowTick);
  }
  function startFrameFollow() {
    if (_followRAF) return;
    _lastEnv = '';
    _followRAF = requestAnimationFrame(frameFollowTick);
  }

  /* 展开态：围框 + 标签头（折叠钮/解散钮） */
  function renderExpanded(g, ly) {
    // 展开态成员必须可见（防上次折叠残留）
    g.ids.forEach(function (id) { var el = elOf(id); if (el && el.dataset.zfGrpHidden === '1') { el.style.display = ''; delete el.dataset.zfGrpHidden; } });
    var r = memberRect(g.ids);
    if (!r) return;
    var box = document.createElement('div');
    box.className = 'zf-grp-frame';
    box.dataset.gid = g.id;
    box.dataset.grpPad = '140,150';
    box.style.cssText = 'position:absolute;left:' + (r.x - 140) + 'px;top:' + (r.y - 150) + 'px;width:' + (r.w + 280) + 'px;height:' + (r.h + 300) + 'px;pointer-events:none;' /* 【用户令v3】留白50→140/150 大量留白防缩小后与对话重叠 */ + /* 【用户令v2】padding 14/30→50px 足够大 */
      'border:1.5px solid rgba(94,148,255,.55);border-radius:14px;' +
      'background:linear-gradient(135deg,rgba(94,148,255,.38),rgba(150,110,255,.30));' + /* 【用户令v2】alpha .07/.05→.38/.30 背景色可见 */
      'box-shadow:0 0 0 1px rgba(94,148,255,.12),0 8px 28px rgba(40,60,140,.18);';
    var head = document.createElement('div');
    head.className = 'zf-grp-head';
    /* 【用户令 20261122·组名调小】组头回归常规 UI 尺寸：基准14px×缩放补偿，屏幕上与对话正文同量级 */
    head.style.cssText = 'position:absolute;left:10px;top:-24px;pointer-events:auto;display:flex;align-items:center;gap:8px;' +
      'padding:3px 8px 3px 12px;border-radius:8px;font-size:14px;color:#dfe6f5;user-select:none;cursor:grab;white-space:nowrap;' +
      'background:linear-gradient(135deg,rgba(52,66,110,.92),rgba(66,52,110,.88));' +
      'border:1px solid rgba(130,160,230,.35);backdrop-filter:blur(6px);box-shadow:0 3px 12px rgba(20,30,70,.35);';
    head.dataset.zfBase = '14';
    /* 【用户令v2·展开态组拖拽】拖组头 → 整组成员同帧平移，带动各自子树，落库 */
    head.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var els = g.ids.map(function (id) { var el = elOf(id); return el && el.style.display !== 'none' ? el : null; }).filter(Boolean);
      if (!els.length) return;
      var k = 1;
      var host = document.getElementById('canvasContent');
      if (host) { var hr = host.getBoundingClientRect(); k = host.offsetWidth > 0 ? hr.width / host.offsetWidth : 1; }
      var sx = e.clientX, sy = e.clientY, st = els.map(function (el) { return { el: el, l: el.offsetLeft, t: el.offsetTop }; }), moved = false;
      /* 【用户令v2·跟手】拖拽中组框实时随成员平移，不再等松手才重算包络 */
      var frames = [];
      var fl = document.querySelectorAll('.zf-grp-frame');
      for (var fi = 0; fi < fl.length; fi++) frames.push({ el: fl[fi], l: fl[fi].offsetLeft, t: fl[fi].offsetTop });
      function mv(ev) {
        var dx = (ev.clientX - sx) / (k || 1), dy = (ev.clientY - sy) / (k || 1);
        if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
        moved = true;
        st.forEach(function (s) { s.el.style.left = Math.round(s.l + dx) + 'px'; s.el.style.top = Math.round(s.t + dy) + 'px'; });
        frames.forEach(function (f) { f.el.style.left = Math.round(f.l + dx) + 'px'; f.el.style.top = Math.round(f.t + dy) + 'px'; });
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (!moved) return;
        try { if (window.ZFRelativeRestore && ZFRelativeRestore.beginMigration) ZFRelativeRestore.beginMigration(); } catch (err) {}
        var boxes = (window.App && window.App.chatBoxes) || [];
        /* 【策划案 20261123·三种模式积累性修复 #2】同一后代整轮只跟随一次。
           背景：mv 已带全部组成员平移，这里再对「每个成员的整棵子树」按增量叠加 →
           ① 后代本身是组成员：位移 2 倍；② 成员 C 的父 P 也在组里：P 的循环和 C 的循环各挪孙辈一次，位移 2 倍。
           均随即落库，错位是永久的。与 app-canvas-overview.js 卡片拖拽同口径：已在拖动集内的不重复移。 */
        var _followed = {};
        els.forEach(function (el) {
          // 网格吸附 + 各成员子树跟随（与 overview 拖拽语义一致）
          el.style.left = (Math.round(el.offsetLeft / 20) * 20) + 'px';
          el.style.top = (Math.round(el.offsetTop / 20) * 20) + 'px';
          var chat = null;
          for (var i = 0; i < boxes.length; i++) if (boxes[i] && boxes[i].el === el) { chat = boxes[i]; break; }
          if (!chat || !chat.id) return;
          try {
            if (window.ZFGroupFollow && ZFGroupFollow.collectSubtree) {
              (ZFGroupFollow.collectSubtree(chat.id) || []).forEach(function (c) {
                var cid = c.id || c, mel = null;
                if (_followed[cid]) return; // 已随更外层成员挪过一次
                for (var b = 0; b < boxes.length; b++) if (boxes[b] && boxes[b].id === cid) { mel = boxes[b].el; break; }
                if (!mel) return;
                if (els.indexOf(mel) >= 0) return; // 本组成员：mv 已带它平移，留给它自己的循环处理其后代
                _followed[cid] = true;
                mel.style.left = (parseFloat(mel.style.left) || mel.offsetLeft) + (el.offsetLeft - chat.x) + 'px';
                mel.style.top = (parseFloat(mel.style.top) || mel.offsetTop) + (el.offsetTop - chat.y) + 'px';
                for (var b2 = 0; b2 < boxes.length; b2++) if (boxes[b2] && boxes[b2].el === mel) { boxes[b2].x = mel.offsetLeft; boxes[b2].y = mel.offsetTop; try { if (window.Store && Store.saveChatBox) Store.saveChatBox(boxes[b2]); } catch (e2) {} break; }
              });
            }
          } catch (err2) {}
          chat.x = el.offsetLeft; chat.y = el.offsetTop;
          try { if (window.Store && Store.saveChatBox) Store.saveChatBox(chat); } catch (err3) {}
        });
        try { if (window.ZFRelativeRestore && ZFRelativeRestore.endMigration) ZFRelativeRestore.endMigration(); } catch (err4) {}
        save(); render();
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    var name = document.createElement('span');
    name.textContent = '📁 ' + g.name + ' · ' + g.ids.length;
    name.style.cssText = 'overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-all;line-height:1.25;font-size:14px;font-weight:700;color:#ffffff;text-shadow:0 1px 3px rgba(6,12,32,.9);'; /* 【用户令 20261122】组名基准 26→14px，与对话正文同量级不再过大 */
    name.dataset.zfBase = '14'; /* 基准14px×缩放补偿：任何缩放级别屏幕上恒定常规大小 */
    name.title = g.ids.map(titleOf).join('、');
    name.addEventListener('dblclick', function (ev) {
      ev.stopPropagation();
      var nn = window.prompt ? null : null;
      // 用轻量内联改名：替换为 input
      var inp = document.createElement('input');
      inp.value = g.name;
      /* 【用户令 20261122】重命名输入框与调小后的组名同尺寸：基准14px+缩放补偿 */
      inp.style.cssText = 'width:240px;font-size:14px;background:rgba(20,26,44,.92);color:#fff;border:1px solid rgba(130,160,230,.6);border-radius:8px;padding:4px 10px;font-weight:700;';
      name.replaceWith(inp);
      inp.dataset.zfBase = '14'; /* 与组名同走缩放补偿 */
      inp.focus(); inp.select();
      function done() { g.name = inp.value.trim() || g.name; save(); render(); }
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', function (e2) { if (e2.key === 'Enter') done(); e2.stopPropagation(); });
    });
    head.appendChild(name);
    function mkBtn(txt, title, fn) {
      var b = document.createElement('span');
      b.textContent = txt; b.title = title;
      /* 【用户令 20261122】折叠/删除按钮与组头同走缩放补偿，基准 24→14px 常规尺寸 */
      b.style.cssText = 'cursor:pointer;padding:2px 8px;border-radius:6px;font-size:14px;color:#cdd6ee;line-height:1;';
      b.dataset.zfBase = '14';
      b.addEventListener('mouseenter', function () { b.style.background = 'rgba(255,255,255,.14)'; });
      b.addEventListener('mouseleave', function () { b.style.background = ''; });
      b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
      return b;
    }
    head.appendChild(mkBtn('▾', '折叠为卡片', function () { g.collapsed = true; collapseGroup(g); save(); render(); }));
    head.appendChild(mkBtn('✕', '解散分组（对话保留）', function () {
      g.ids.forEach(function (id) { var el = elOf(id); if (el && el.dataset.zfGrpHidden === '1') { el.style.display = ''; delete el.dataset.zfGrpHidden; } });
      groups = groups.filter(function (x) { return x !== g; });
      save(); render();
      if (window.Toast) Toast.show('分组已解散');
    }));
    box.appendChild(head);
    // 折叠落点：记录标签头位置，折叠卡片出现在这里
    box.dataset.gid = g.id;
    ly.appendChild(box);
  }

  /* 折叠：成员真实隐藏 + 生成卡片 */
  function collapseGroup(g) {
    var r = memberRect(g.ids);
    /* 【用户令 2026-11-27】折叠卡落点=分组左上角（原为中心点，用户要求隐藏后卡片出现在左上角带标题） */
    if (r) { g.cx = Math.round(r.x); g.cy = Math.round(r.y); }
    g.ids.forEach(function (id) {
      var el = elOf(id);
      if (!el) return;
      el.dataset.zfGrpHidden = '1';
      el.style.display = 'none';
    });
  }
  function expandGroup(g) {
    g.collapsed = false;
    g.ids.forEach(function (id) {
      var el = elOf(id);
      if (el && el.dataset.zfGrpHidden === '1') { el.style.display = ''; delete el.dataset.zfGrpHidden; }
    });
    save(); render();
    /* 【标题丢失修复】折叠期间成员被 display:none，总览进入时未给它们创建 .ov-panel-title 装饰；
       展开后立即触发总览重新装饰，恢复对话标题显示 */
    if (window.ZFCanvasOverview && ZFCanvasOverview.refreshDecor) setTimeout(ZFCanvasOverview.refreshDecor, 60);
  }

  /* 折叠态卡片：真实卡片放画布层，可拖动 */
  function renderCollapsed(g, ly) {
    // 双保险：确保隐藏
    g.ids.forEach(function (id) { var el = elOf(id); if (el && el.style.display !== 'none') { el.dataset.zfGrpHidden = '1'; el.style.display = 'none'; } });
    var card = document.createElement('div');
    card.className = 'zf-grp-card';
    /* 【用户令 20261122·折叠卡瘦身】卡片只比文字大一圈：minWidth 420→120、padding 90→10/14，宽高由文字内容撑起 */
    card.style.cssText = 'position:absolute;pointer-events:auto;cursor:grab;user-select:none;min-width:120px;' +
      'padding:10px 14px;border-radius:10px;color:#e6ecf9;box-sizing:border-box;' +
      'background:linear-gradient(145deg,rgba(48,58,102,.96),rgba(60,48,102,.94));' +
      'border:1px solid rgba(140,160,240,.4);box-shadow:0 6px 20px rgba(20,30,70,.4);backdrop-filter:blur(8px);z-index:9001;'; /* 9001：高于卡片层(5)、与banner持平、低于工具栏9002，不盖工具栏按钮 */
    var t = document.createElement('div');
    t.textContent = '📁 ' + g.name;
    t.style.cssText = 'font-weight:700;color:#ffffff;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-all;line-height:1.25;font-size:16px;letter-spacing:.02em;text-shadow:0 2px 6px rgba(6,12,32,.9);';
    t.dataset.zfBase = '16'; /* 折叠卡组名同步缩放补偿，基准 44→16px 常规尺寸 */
    var s = document.createElement('div');
    s.textContent = '📦 ' + g.ids.length + ' 个对话 · 点击展开';
    s.style.cssText = 'margin-top:4px;color:#c3d0ee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;';
    s.dataset.zfBase = '12';
    s.title = g.ids.map(titleOf).join('、');
    card.appendChild(t); card.appendChild(s);
    card.addEventListener('click', function () { expandGroup(g); });
    // 拖动卡片
    card.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, gx = g.cx || 0, gy = g.cy || 0, moved = false;
      function toWorld(dx, dy) {
        // 屏幕位移 → 世界位移：除以画布缩放
        var k = 1;
        var host = document.getElementById('canvasContent');
        if (host) { var r = host.getBoundingClientRect(); k = host.offsetWidth > 0 ? r.width / host.offsetWidth : 1; }
        return { dx: dx / (k || 1), dy: dy / (k || 1) };
      }
      function mv(ev) {
        var d = toWorld(ev.clientX - sx, ev.clientY - sy);
        if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
        moved = true;
        g.cx = Math.round(gx + d.dx); g.cy = Math.round(gy + d.dy);
        card.style.left = g.cx + 'px'; card.style.top = g.cy + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (moved) { save(); }
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
    if (g.cx != null) { card.style.left = g.cx + 'px'; card.style.top = g.cy + 'px'; }
    ly.appendChild(card);
  }

  /* ---------- 总览工具栏 ---------- */
  /* 【用户令 2026-11-21】图标工具栏取消，两个操作并入底部 dock（mo-canvas-dock）纯文字按钮，
     统一排在最下一排（建分组 / 展开全部）。show/hideToolbar 保留为空壳维持旧调用点兼容。 */
  function showToolbar() { /* no-op：并入底部 dock */ }
  function hideToolbar() { /* no-op：并入底部 dock */ }

  /* ---------- 总览开关联动 ---------- */
  window.addEventListener('wb-canvas-change', function (e) {
    on = !!(e.detail && e.detail.on);
    if (on) { showToolbar(); render(); }
    else { hideToolbar(); if (layer) { layer.remove(); layer = null; } }
  });
  // 节点被总览 Delete 关闭后清理组内死成员
  /* 【策划案 20261123·三种模式积累性修复 #20】600ms 后执行时再判一次 on：期间已退出总览的话图层刚被移除，
     无条件 render() 会在普通模式下重新建出一层分组框，直到下次进出总览才消失。 */
  window.addEventListener('wb-canvas-change', function () { if (on) setTimeout(function () { if (on) render(); }, 600); });

  /* ---------- G 键建组 ---------- */
  document.addEventListener('keydown', function (e) {
    if (!on) return;
    if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      var ae = document.activeElement;
      if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;
      e.preventDefault();
      createGroupFromSelection();
    }
  });

  window.ZFCanvasGroups = {
    groups: function () { return groups.slice(); },
    create: createGroupFromSelection,
    render: render,
    expandAll: function () { groups.forEach(function (g) { if (g.collapsed) expandGroup(g); }); }
  };
})();
