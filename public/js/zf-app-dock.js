/* zf-app-dock.js —— 底部中央「桌面图标栏」(macOS 风格)
   - 底部居中悬浮一条桌面图标栏，鼠标悬停图标放大、离开缩小（相邻图标波及放大）。
   - 面向未来无限 App 扩展：ZF_APPS 注册表，超过 MAX_VISIBLE 个自动收纳进
     「更多」面板（网格弹出面板）。当前第一个 App：i漫画。
   - 图标注册即用：window.ZFDock.register({id, name, icon(SVG/html), onClick})
   内容(i漫画界面)留空骨架，后续可自由设计。 */
(function () {
  'use strict';
  if (window.ZFDock) return;

  /* ---------- App 注册表 ---------- */
  var APPS = [];
  var MAX_VISIBLE = 10;          // 默认显示 10 个，其余进「i无限」面板（需求4）
  var ORDER_KEY = 'zfDockAppOrder';
  var HIDDEN_KEY = 'zfDockHiddenApps';   // 被拖进「i无限」面板的 App id 列表（隐藏）
  var absorbedPanelBtns = [];    /* 【2026-11-13】收编进「i无限」面板的功能按钮（i整理/i挂件/i科技树/i导航/i对话/i专注） */
  /* 【2026-11-14 图标修复】i无限面板统一线型图标表（stroke=currentColor 随主题变色，杜绝抄按钮抄到空/白图标） */
  function _lico(body) {
    return '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }
  var PANEL_ICONS = {
    organizeDockBtn: _lico('<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>'),
    kiteToggleBtn: _lico('<path d="M12 2 L20 9 L12 15 L4 9 Z"/><path d="M12 2 L12 15"/><path d="M4 9 L20 9"/><path d="M12 15 C11 18 13 19 11 22"/>'),
    emergeTreeBtn: _lico('<circle cx="12" cy="4" r="1.8"/><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/><circle cx="8" cy="20" r="1.8"/><circle cx="16" cy="20" r="1.8"/><line x1="12" y1="5.8" x2="5" y2="10.2"/><line x1="12" y1="5.8" x2="12" y2="10.2"/><line x1="12" y1="5.8" x2="19" y2="10.2"/><line x1="5" y1="13.8" x2="8" y2="18.2"/><line x1="12" y1="13.8" x2="8" y2="18.2"/><line x1="12" y1="13.8" x2="16" y2="18.2"/><line x1="19" y1="13.8" x2="16" y2="18.2"/>'),
    minimapToggleBtn: _lico('<circle cx="12" cy="12" r="8"/><path d="M15.5 8.5 13.6 13.6 8.5 15.5 10.4 10.4Z"/>'),
    /* 【2026-11-17 图标去重】原与 Dock「i聊天」同一个气泡图形（完全撞款）→ 改为「状态列表」图形，语义=对话状态面板 */
    chatStatusBtn: _lico('<circle cx="5" cy="6" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="18" r="1.6"/><path d="M9.5 6h10.5M9.5 12h10.5M9.5 18h10.5"/>'),
    topbarFocusBtn: _lico('<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>'),
  };
  /* 【2026-11-16 名字定义表】收编按钮的面板显示名统一在此定义（兜底 btn.title 丢失/时序问题导致 undefined） */
  var PANEL_NAMES = {
    organizeDockBtn: 'i整理',
    kiteToggleBtn: 'i挂件',
    emergeTreeBtn: 'i科技树',
    minimapToggleBtn: 'i导航',
    chatStatusBtn: 'i对话',
    topbarFocusBtn: 'i专注',
    canvasMenuBtn: 'i文件',
  };
  /* 【2026-11-14 顶栏收编】i文件 / i账号 分区数据（在 absorbFloatButtons 里填充；i功能 分区惰性读 window.CanvasMoreMenu.items） */
  var panelFileEntries = [];
  var panelAccountEntries = [];

  /* 顺序持久化：拖拽排序后记住，刷新保留；另同步到 server（dock_state.json）防清缓存丢失 */
  function loadOrder() {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch (e) { return []; }
  }
  function saveOrder() {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(APPS.map(function (a) { return a.id; }))); } catch (e) {}
    _syncDockState();
  }
  /* 【2026-11-16】i桌面状态上云：POST /api/dock/state-save 落盘 server/data/dock_state.json */
  function _syncDockState() {
    if (!dockStateReady) return;   /* 【2026-12 修复重启丢失】回填完成前禁止把默认名单 POST 到 server（会覆盖真源 dock_state.json） */
    try {
      fetch('/api/dock/state-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appOrder: loadOrder(), hiddenApps: loadHidden(), panelOrder: loadPanelOrder(), desktopApps: loadDesktop() })
      }).catch(function () {});
    } catch (e) {}
  }
  function applyOrder() {
    var order = loadOrder();
    if (!order.length) return;
    APPS.sort(function (a, b) {
      var ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia < 0) ia = 999; if (ib < 0) ib = 999;
      return ia - ib;
    });
  }

  /* 【2026-11-12 需求4】隐藏/显示 App：拖进「无限」= 隐藏，从面板拖出 = 显示 */
  function loadHidden() {
    try { return JSON.parse(localStorage.getItem(HIDDEN_KEY)) || []; } catch (e) { return []; }
  }
  function saveHidden(list) {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(list)); } catch (e) {}
    _syncDockState();
  }
  function visibleApps() {
    var hid = loadHidden();
    return APPS.filter(function (a) { return hid.indexOf(a.id) < 0; });
  }
  /* 【2026-12 桌面区固定名单】桌面区不再"取前10可见"动态补位，而是固定名单：
     拖走一个就 9 个，不会自动补一个上来。首次无存档时播种默认前 MAX_VISIBLE 个。 */
  var DESKTOP_KEY = 'zfDockDesktopApps';
  function saveDesktop(list) {
    if (!dockStateReady) {   /* 启动播种期：不写本地不同步 server，防默认名单冲掉服务器真源 */
      try { console.log('[i桌面] 启动临时播种（未落盘），等待 server 状态回填'); } catch (e) {}
      _tempDesktopSeed = list;
      return;
    }
    try { localStorage.setItem(DESKTOP_KEY, JSON.stringify(list)); } catch (e) {}
    _syncDockState();
  }
  var _tempDesktopSeed = null;
  function loadDesktop() {
    try { return JSON.parse(localStorage.getItem(DESKTOP_KEY)) || _tempDesktopSeed || []; } catch (e) { return _tempDesktopSeed || []; }
  }
  function deskApps() {
    var d = loadDesktop();
    if (!d.length) {   /* 首次播种：默认前 MAX_VISIBLE(10) 个可见 App 固定进桌面区 */
      d = visibleApps().slice(0, MAX_VISIBLE).map(function (a) { return a.id; });
      saveDesktop(d);
    }
    /* /* 【2026-11-20 用户需求】i桌面最多 10 个图标：不做自动补新加塞——
       新注册的 i程序一律先进「无限 ∞」面板，用户手动拖出才上桌面；
       历史超编名单（>10）一次性裁回 10 个，多余项回面板 */
    if (d.length > MAX_VISIBLE) { d = d.slice(0, MAX_VISIBLE); if (dockStateReady) saveDesktop(d); }
    var map = {}; APPS.forEach(function (a) { map[a.id] = a; });
    return d.map(function (id) { return map[id]; }).filter(Boolean);
  }
  var DESK_DISMISS_KEY = 'zfDockDeskDismissed';
  function deskAdd(id) {
    var d = loadDesktop();
    if (d.indexOf(id) < 0) { d.push(id); saveDesktop(d); }
    /* 从桌面补回 = 取消移出记录 */
    try {
      var dis = JSON.parse(localStorage.getItem(DESK_DISMISS_KEY)) || [];
      var i2 = dis.indexOf(id);
      if (i2 >= 0) { dis.splice(i2, 1); localStorage.setItem(DESK_DISMISS_KEY, JSON.stringify(dis)); }
    } catch (e) {}
  }
  function deskRemove(id) {
    var d = loadDesktop();
    var i = d.indexOf(id);
    if (i >= 0) { d.splice(i, 1); saveDesktop(d); }
    /* 记入移出名单：不再自动补位（尊重用户主动移出的决定） */
    try {
      var dis = JSON.parse(localStorage.getItem(DESK_DISMISS_KEY)) || [];
      if (dis.indexOf(id) < 0) { dis.push(id); localStorage.setItem(DESK_DISMISS_KEY, JSON.stringify(dis)); }
    } catch (e) {}
  }

  function hideApp(id) {
    var hid = loadHidden();
    if (hid.indexOf(id) < 0) { hid.push(id); saveHidden(hid); }
  }
  function showApp(id) {
    var hid = loadHidden();
    var i = hid.indexOf(id);
    if (i >= 0) { hid.splice(i, 1); saveHidden(hid); }
  }

  /* 「无限 ∞」面板 · 2026-11 重设计版：
     1) 全部图标（i桌面功能/i文件/i账号/i功能/溢出/隐藏 i程序）平铺成一张大网格，不再分组；
     2) 网格内任意图标可拖拽换序（mousedown 拖动 → 目标位实时高亮 → 松手落位）；
     3) 顺序持久化 localStorage（PANEL_ORDER_KEY），刷新保留；
     4) 交互全程可见：悬停高亮 + tooltip、拖拽幽灵跟随、落点位置深色提示、松手缩放回弹。 */
  var PANEL_ORDER_KEY = 'zfDockPanelOrder';
  function loadPanelOrder() {
    try { return JSON.parse(localStorage.getItem(PANEL_ORDER_KEY)) || []; } catch (e) { return []; }
  }
  function savePanelOrder(ids) {
    try { localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(ids)); } catch (e) {}
    _syncDockState();
  }
  /* 【2026-11-16】启动时从 server 回填本地缺失的状态（server 为真源，本地有则不覆盖） */
  var dockStateReady = false;   /* 【2026-12 修复重启丢失】server 状态回填完成前置 false：期间 deskApps 播种只临时渲染、不写 localStorage、不同步 server，防止"默认名单覆盖服务器真源" */
  function _restoreDockState() {
    try {
      fetch('/api/dock/state').then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.state) return;
        var st = j.state;
        try {
          if (st.appOrder && st.appOrder.length && !localStorage.getItem(ORDER_KEY)) localStorage.setItem(ORDER_KEY, JSON.stringify(st.appOrder));
          if (st.hiddenApps && st.hiddenApps.length && !localStorage.getItem(HIDDEN_KEY)) localStorage.setItem(HIDDEN_KEY, JSON.stringify(st.hiddenApps));
          if (st.panelOrder && st.panelOrder.length && !localStorage.getItem(PANEL_ORDER_KEY)) localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(st.panelOrder));
          if (st.desktopApps && st.desktopApps.length) {
            /* 【2026-12 修复重启丢失】server 真源优先：无条件覆盖本地（尤其本地被启动播种污染时），再清理临时播种 */
            localStorage.setItem(DESKTOP_KEY, JSON.stringify(st.desktopApps));
            _tempDesktopSeed = null;
          } else if (!localStorage.getItem(DESKTOP_KEY) && _tempDesktopSeed) {
            /* server 无桌面名单且本地也无 → 首次启动：采纳临时播种为正式名单 */
            localStorage.setItem(DESKTOP_KEY, JSON.stringify(_tempDesktopSeed));
            _tempDesktopSeed = null;
          }
          /* 【2026-11-17】i无限面板宽高位置回填（本地无存档才回填，server 为真源） */
          if (st.panelGeom && st.panelGeom.w && !localStorage.getItem('zf_more_panel_geom_v1')) {
            localStorage.setItem('zf_more_panel_geom_v1', JSON.stringify(st.panelGeom));
            try { if (morePanel) applyPanelGeom(); } catch (e) {}
          }
        } catch (e) {}
        dockStateReady = true;   /* 回填完成：此后 saveDesktop/savePanelOrder 等写操作才允许落盘与同步 server */
        applyOrder(); renderDock();
      }).catch(function () { dockStateReady = true; });   /* 【2026-12】server 不可达也要放行写操作，否则拖拽永远存不上 */
    } catch (e) { dockStateReady = true; }
  }
  /* 按持久化顺序重排条目（未记录的条目按收集顺序排后面） */
  function sortPanelEntries(list) {
    var order = loadPanelOrder();
    if (!order.length) return list;
    return list.slice().sort(function (a, b) {
      var ia = order.indexOf(a.pid), ib = order.indexOf(b.pid);
      if (ia < 0) ia = 9999; if (ib < 0) ib = 9999;
      return ia - ib;
    });
  }
  function buildOverflowPanel(extraOverflow, instant) {
    morePanel.innerHTML = '';
    /* 【2026-11-16 重设计】标题栏：渐变字「i无限」，兼作拖拽手柄 */
    var ttl = document.createElement('div');
    ttl.className = 'zf-more-panel-title';
    ttl.innerHTML = '<span class="zfp-txt">i无限</span><span class="zfp-draghint">⠿ 拖动标题移动 · 右下角缩放</span><button class="zfp-close" title="关闭面板" aria-label="关闭面板">×</button>';
    /* 【2026-11-20 用户要求】右上角关闭按钮：点 × 关闭面板（阻止冒泡避免触发标题拖拽） */
    var closeBtn = ttl.querySelector('.zfp-close');
    if (closeBtn) closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      morePanel.classList.remove('open');
    });
    morePanel.appendChild(ttl);
    /* 【2026-12 用户要求】i无限面板顶部搜索框：输入即时过滤条目（按名字/提示匹配，不区分大小写） */
    var searchWrap = document.createElement('div');
    searchWrap.className = 'zf-panel-search-wrap';
    searchWrap.innerHTML = '<svg class="zf-panel-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20 20"/></svg><input type="text" class="zf-panel-search" placeholder="搜索 i程序…" aria-label="搜索 i程序">';
    var searchInput = searchWrap.querySelector('.zf-panel-search');
    morePanel.appendChild(searchWrap);
    /* 【2026-11-16 拖动提示淡出】首次打开展示 5 秒后淡出并永久隐藏（localStorage 防重播；已见过的直接不渲染） */
    try {
      var hint = ttl.querySelector('.zfp-draghint');
      if (hint) {
        if (!localStorage.getItem('zf_more_draghint_seen')) {
          setTimeout(function () {
            hint.classList.add('zfp-fade');
            try { localStorage.setItem('zf_more_draghint_seen', '1'); } catch (e) {}
          }, 5000);
        } else {
          hint.style.display = 'none';
        }
      }
    } catch (e) {}
    var body = document.createElement('div');
    body.className = 'zf-panel-body';
    morePanel.appendChild(body);
    var hid = loadHidden();
    /* ---------- 收集全部条目 → 统一平铺网格 ---------- */
    var entries = [];
    /* ① i桌面功能（收编按钮） */
    absorbedPanelBtns.forEach(function (btn) {
      var svg = btn.querySelector('svg');
      var key = PANEL_ICONS[btn.id] || null;
      entries.push({
        pid: 'btn:' + btn.id,
        icon: key ? key : (svg ? svg.outerHTML : (btn.textContent || '?').trim().charAt(0)),
        name: (PANEL_NAMES[btn.id] || btn.title || btn.id).replace(/（.*）/, ''),
        tip: btn.title || btn.id,
        run: function () { btn.click(); }
      });
    });
    /* ② i文件 / ③ i账号 */
    panelFileEntries.forEach(function (en) {
      entries.push({ pid: 'file:' + en.name, icon: en.icon, name: en.name, tip: en.title || en.name,
        onContextMenu: en.onContextMenu || null,
        run: function () { try { en.onClick(); } catch (e) { console.error('[i无限面板]', en.name, e); } } });
    });
    panelAccountEntries.forEach(function (en) {
      entries.push({ pid: 'acct:' + en.name, icon: en.icon, name: en.name, tip: en.title || en.name,
        run: function () { try { en.onClick(); } catch (e) { console.error('[i无限面板]', en.name, e); } } });
    });
    /* ④ i功能（更多菜单 ITEMS） */
    try {
      if (window.CanvasMoreMenu && window.CanvasMoreMenu.items) {
        window.CanvasMoreMenu.items.filter(function (it) { return !it.sep && it.click !== 'ttsToggle' && !it.sysReg; }).forEach(function (it) {
          var iconHtml = (it.icon || '?').indexOf('<svg') === 0 ? it.icon : '<span style="font-size:24px">' + (it.icon || '?') + '</span>';
          entries.push({
            pid: 'fn:' + (it.label || '?'),
            icon: iconHtml,
            name: it.label || '?',
            tip: it.title || it.label,
            run: function () {
              if (it.click) {
                var el = document.getElementById(it.click);
                if (it.click === 'languageToggle' && window.CanvasMoreMenu && window.CanvasMoreMenu.pickLang) {
                  window.CanvasMoreMenu.pickLang(document.getElementById('zfAppDockInfinity')); return;
                }
                if (it.click === 'ttsToggle' && window.TTS && TTS.toggle) { TTS.toggle(); return; }
                if (el) { el.click(); return; }
              }
              if (it.run) it.run();
            }
          });
        });
      }
    } catch (e) {}
    /* ⑤ 溢出/隐藏 i程序 */
    /* 【2026-11-18 i无限面板去重】跳过名字与 i功能分区(④CanvasMoreMenu)重复的 Dock 注册副本：
       ui.sysapps 插件把同一批顶栏功能（i朱峰社区/i指挥台/i界面/i语言/i等级/i管家/i专注…）
       又注册成 zf-sys-* 程序，溢出进本分区后与 ④ 的同名条目成对/三份重复（截图实锤）。
       去重口径：本分区条目若名字与前面 entries 已有条目相同 → 跳过。 */
    var _dupeNames = {};
    entries.forEach(function (en) { _dupeNames[en.name] = true; });
    var visSet = deskApps();   /* 【2026-12 固定名单】桌面区=固定名单（拖走减员不补位），不再取前10可见动态计算 */
    var all = APPS.filter(function (a) {
      /* 【2026-11-21 桌面区】全部 i程序都进面板，Dock 前台进桌面区、其余进面板区 */
      return true;
    }).filter(function (a) {
      /* 同名 Dock 注册已由上面分区渲染过 → 跳过（i专注等收编按钮/④功能条目优先保留原实现）；
         【分区内部去重】④被 sysReg 源头过滤后，本分区内部同名注册（如多个 i管家副本）也只留第一个 */
      if (_dupeNames[a.name]) return false;
      _dupeNames[a.name] = true;
      return true;
    });
    all.forEach(function (app) {
      var isHid = hid.indexOf(app.id) >= 0;
      var onDesk = visSet.indexOf(app) >= 0;   /* 【2026-12 固定名单】在桌面名单 → 桌面区；不在 → 面板区（不再看 hidden/前10） */
      entries.push({
        pid: 'app:' + app.id,
        zone: onDesk ? 'desktop' : 'panel',
        icon: app.icon,
        name: app.name,
        tip: onDesk ? '拖到 🧩i无限面板区 = 收进面板（后台）' : '拖到 🖥i无限桌面区 = 显示到前台 Dock',
        hidden: isHid,
        run: function () {
          if (isHid) { showApp(app.id); renderDock(); return; }
          app.onClick && app.onClick();
        }
      });
    });
    /* ⑥ 溢出栏目项（任务/长任务/记忆/历史等） */
    (window.ZFDockOverflowItems || []).forEach(function (it) {
      entries.push({ pid: 'ovf:' + it.name, icon: '<em style="font-size:26px;font-style:normal">📋</em>', name: it.name, tip: it.name,
        run: function () { it.onClick && it.onClick(); } });
    });
    /* 【2026-11-15 用户要求撤下】急速模式面板入口已移除（改由文件菜单内开关） */
    /* ⑦ i进化已移除（2026-11-17 用户拍板：可手动派师替代，引擎保留，git 可恢复） */
    /* ⑧ i科技树兜底条目（2026-11-16 补真实兜底）：若 dom-status.js 注入的 #emergeTreeBtn 按钮缺失
       （未被收编进 entries），面板强制渲染一条，确保 i科技树入口永远可见。
       点击降级链：原按钮 click → TreePodNode.toggle → 直开 pod.html（2026-11-22 死链修复：viewer.html 已收敛删除）。 */
    var _hasTree = false;
    for (var _i = 0; _i < entries.length; _i++) { if (entries[_i].pid === 'btn:emergeTreeBtn') { _hasTree = true; break; } }
    if (!_hasTree) {
      entries.push({
        pid: 'btn:emergeTreeBtn',
        icon: PANEL_ICONS.emergeTreeBtn || '<span style="font-size:24px">🌳</span>',
        name: PANEL_NAMES.emergeTreeBtn || 'i科技树',
        tip: 'i科技树',
        run: function () {
          var b = document.getElementById('emergeTreeBtn');
          if (b) { b.click(); return; }
          if (window.TreePodNode && TreePodNode.toggle) { TreePodNode.toggle(); return; }
          location.href = 'canvas/进化树/pod.html';
        }
      });
    }
    /* 【2026-11-21 新增】i进化三抽兜底条目：肉鸽三抽发卡页（canvas/i进化三抽/index.html），确保入口永远可见 */
    /* 【2026-12 顺序丢失修复】兜底 push 必须在 sortPanelEntries 之前：原来排在排序之后 = 每次渲染都强制插到队尾，
       用户把它拖到中间保存的 panelOrder 里 pid 存在 → 下次排序生效，但 order 未含新条目时会被挤回尾部，看起来"顺序变回去" */
    var _hasEvolve3 = false;
    for (var _j = 0; _j < entries.length; _j++) { if (entries[_j].pid === 'btn:evolve3Entry') { _hasEvolve3 = true; break; } }
    if (!_hasEvolve3) {
      entries.push({
        pid: 'btn:evolve3Entry',
        icon: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="12" height="16" rx="2"/><path d="M8.5 2.5h10a2 2 0 0 1 2 2v13"/><path d="M7 10l2.2 3.4L13.5 8.5"/></svg>',
        name: 'i进化',
        tip: 'i进化（AI发牌员，你当策划）',
        run: function () { openEvolve3(); }
      });
    }
    entries = sortPanelEntries(entries);
    if (!entries.length) {
      var empty = document.createElement('div');
      empty.className = 'zf-more-group-title';
      empty.textContent = '暂无可展示的 i程序';
      morePanel.appendChild(empty);
      return;
    }
    /* ---------- 平铺网格渲染 · 【2026-11-21】双区版 ---------- */
    function mkZone(label) {
      var sec = document.createElement('div');
      sec.className = 'zf-panel-zone';
      var t = document.createElement('div');
      t.className = 'zf-panel-zone-title';
      t.textContent = label;
      sec.appendChild(t);
      var g = document.createElement('div');
      g.className = 'zf-panel-flat-grid';
      sec.appendChild(g);
      body.appendChild(sec);
      return g;
    }
    var deskGrid = mkZone('🖥 i无限桌面区');
    var grid = mkZone('🧩 i无限面板区');
    /* 【2026-12 搜索过滤】输入即时按名字/提示过滤条目；清空恢复。命中时隐藏分区标题/空区 */
    function applyPanelFilter(q) {
      try {
        var kw = (q || '').trim().toLowerCase();
        var zones = body.querySelectorAll('.zf-panel-zone');
        zones.forEach(function (sec) {
          var g = sec.querySelector('.zf-panel-flat-grid');
          var visible = 0;
          if (g) g.querySelectorAll('.zf-panel-flat-item').forEach(function (ib) {
            var hit = !kw || (ib.textContent || '').toLowerCase().indexOf(kw) >= 0 || (ib.title || '').toLowerCase().indexOf(kw) >= 0;
            ib.style.display = hit ? '' : 'none';
            if (hit) visible++;
          });
          var tt = sec.querySelector('.zf-panel-zone-title');
          sec.style.display = (visible || !kw) ? '' : 'none';
          if (kw && tt && visible) tt.textContent = tt.textContent.replace(/（\d+）$/, '') + '（' + visible + '）';
        });
      } catch (e) {}
    }
    if (searchInput) {
      searchInput.addEventListener('input', function () { applyPanelFilter(searchInput.value); });
      /* 每次重建面板时（buildOverflowPanel 重跑）输入框是新的，无需额外清理 */
    }
    entries.forEach(function (en) {
      var ib = document.createElement('button');
      ib.className = 'zf-dock-more-item zf-panel-flat-item' + (en.hidden ? ' zf-more-hidden' : '');
      ib.dataset.pid = en.pid;
      ib.innerHTML = (en.icon || '<span style="font-size:24px">📦</span>') + '<em>' + en.name + '</em>';
      ib.title = en.tip + '（可拖拽调序）';
      /* 【2026-11-19】条目右键回调（i录音/i录像：右键选设备/区域） */
      if (en.onContextMenu) {
        ib.addEventListener('contextmenu', function (ev) { try { en.onContextMenu(ev); } catch (e) {} });
      }
      var isv = ib.querySelector('svg');
      if (isv) { isv.style.width = '30px'; isv.style.height = '30px'; isv.style.marginBottom = '4px'; }
      ib.addEventListener('click', function () {
        if (ib._dragMoved) return;   /* 拖拽后松手不触发点击 */
        morePanel.classList.remove('open');
        /* 【i挂件菜单打不开修复】收编按钮（i挂件/i整理等会弹菜单的按钮）延迟一拍触发：
           若同步调用 btn.click()，本次点击继续冒泡到 document 的「点击外部收起」监听
           （sw 不含面板按钮、btn 也不含），会把刚 toggle('open') 弹出的菜单立刻 remove('open')，
           菜单瞬开瞬关=用户看不到列表。setTimeout 0 让冒泡先结束再弹菜单。 */
        if (en.pid && en.pid.indexOf('btn:') === 0) {
          setTimeout(function () { try { en.run(); } catch (e) { console.error('[i无限面板]', en.name, e); } }, 0);
        } else {
          try { en.run(); } catch (e) { console.error('[i无限面板]', en.name, e); }
        }
      });
      /* 【2026-11-15 动态化】逐个错峰弹入；【2026-11-22】错峰上限 0.36s（条目多不再久等），
         拖拽跨区迁移/拖出触发的重建（instant）直接免动画：松手瞬间整屏重播弹入=闪动 */
      if (instant) { ib.style.animation = 'none'; }
      else { ib.style.animationDelay = Math.min((deskGrid.children.length + grid.children.length) * 0.02, 0.36) + 's'; }
      /* 网格内拖拽换序 + 跨容器拖出（mousedown + document 监听，全程可见反馈）。
         【2026-11-22 拖拽稳定性重构】修「迟钝 / 来回串 / 闪动」三症：
         1) 预填充：mousedown 即预建 ghost + 占位格（display:none 不参与布局）并缓存几何，
            越过 6px 阈值瞬间上岗，起拖首帧零卡顿；
         2) rAF 节流：mousemove 只记坐标，每帧统一处理一次，不再逐事件 elementFromPoint+强制重排；
         3) 定向中点守卫：目标在占位格前 → 指针越过其中心才前移；目标在占位格后 → 越过中心才后移。
            想反向必须真的跨回中心 → 结构上杜绝"让位后被移回"的来回串位；
            悬停占位格自身空出的格子 = 命中为空 → 保持不动，不再误跳首/末位；
         4) WAAPI FLIP：让位动画用 Web Animations 播放，位移按 offsetLeft/offsetTop 布局差测量
            （不含 transform，在途动画不污染测量），不再内联反复改写 transition → 消除闪动；
         5) 命中测试改用缓存布局矩形（网格坐标），滚动/重排后自动失效重建。 */
      ib.addEventListener('mousedown', function (ev) {
        if (ev.button !== 0) return;
        var startX = ev.clientX, startY = ev.clientY;
        var activated = false, raf = 0, lastX = startX, lastY = startY;
        var ghost = null, ph = null, over = null, outReady = false;
        var cacheMap = null;   /* grid → [{el,x,y,w,h}]（相对网格的布局坐标，transform 免疫） */
        var canZone = en.pid && en.pid.indexOf('app:') === 0;
        ib._dragMoved = false;

        /* ---------- 预填充：起拖前就把 ghost/占位格建好 ---------- */
        (function prefill() {
          var r = ib.getBoundingClientRect();   /* mousedown 时真身仍可见，矩形有效 */
          ghost = document.createElement('div');
          ghost.className = 'zf-panel-ghost';
          ghost.style.display = 'none';
          ghost.innerHTML = en.icon;
          var sv = ghost.querySelector('svg'); if (sv) { sv.style.width = '34px'; sv.style.height = '34px'; }
          document.body.appendChild(ghost);
          ph = document.createElement('div');
          ph.className = 'zf-panel-ph';
          ph.style.width = r.width + 'px';
          ph.style.height = r.height + 'px';
          ph.style.boxSizing = 'border-box';
          ph.style.border = '2px dashed rgba(120,200,255,.55)';
          ph.style.borderRadius = '12px';
          ph.style.background = 'rgba(120,200,255,.08)';
          ph.style.pointerEvents = 'none';   /* 占位格不参与命中：否则命中自身 → 让位判定错乱 */
          ph.style.display = 'none';
        })();

        /* ---------- 布局位测量：offsetLeft/Top 不含 transform，动画在途也不污染 ---------- */
        function relXY(el, g) {
          if (el.offsetParent === g) return { x: el.offsetLeft, y: el.offsetTop };
          return { x: el.offsetLeft - g.offsetLeft, y: el.offsetTop - g.offsetTop };
        }
        function cacheFor(g) {
          var c = cacheMap.get(g);
          if (c) return c;
          c = [];
          [].forEach.call(g.querySelectorAll('.zf-panel-flat-item'), function (el) {
            if (el === ib || el === ph) return;
            var r = relXY(el, g);
            c.push({ el: el, x: r.x, y: r.y, w: el.offsetWidth, h: el.offsetHeight });
          });
          cacheMap.set(g, c);
          return c;
        }
        function refreshCache(g) { if (cacheMap) cacheMap.delete(g); }
        function hitTest(cache, g, x, y) {
          var gr = g.getBoundingClientRect();
          var lx = x - gr.left, ly = y - gr.top;
          for (var i = cache.length - 1; i >= 0; i--) {
            var e2 = cache[i];
            if (e2.w > 0 && lx >= e2.x && lx < e2.x + e2.w && ly >= e2.y && ly < e2.y + e2.h) return e2;
          }
          return null;
        }
        /* 指针在目标中心哪一侧（主轴定向，多行网格同样适用） */
        function beforeCenter(tgt, g, x, y) {
          var cache = cacheFor(g), e2 = null;
          for (var i = 0; i < cache.length; i++) if (cache[i].el === tgt) { e2 = cache[i]; break; }
          if (!e2) return true;
          var gr = g.getBoundingClientRect();
          var dx = x - (gr.left + e2.x + e2.w / 2), dy = y - (gr.top + e2.y + e2.h / 2);
          return Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
        }

        /* ---------- WAAPI FLIP：DOM 迁移前后按布局位差播放让位动画 ---------- */
        function playFlip(el, dx, dy) {
          if (!el.animate || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return;
          if (el._zfFlip) { try { el._zfFlip.cancel(); } catch (e3) {} }
          el._zfFlip = el.animate(
            [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
            { duration: 200, easing: 'cubic-bezier(.34,1.3,.64,1)' });
          el._zfFlip.onfinish = function () { el._zfFlip = null; };
        }
        function snapGrid(g) {
          var gr = g.getBoundingClientRect();
          var items = [];
          [].forEach.call(g.querySelectorAll('.zf-panel-flat-item'), function (el) {
            if (el === ib) return;
            var r = relXY(el, g);
            items.push({ el: el, ax: gr.left + r.x, ay: gr.top + r.y });
          });
          return items;
        }
        function playGrid(g, snap) {
          var gr = g.getBoundingClientRect();
          [].forEach.call(g.querySelectorAll('.zf-panel-flat-item'), function (el) {
            if (el === ib) return;
            for (var i = 0; i < snap.length; i++) {
              if (snap[i].el === el) {
                var nr = relXY(el, g);
                playFlip(el, snap[i].ax - (gr.left + nr.x), snap[i].ay - (gr.top + nr.y));
                break;
              }
            }
          });
        }
        function phAbs() {
          var gp = ph.parentNode.getBoundingClientRect();
          var r = relXY(ph, ph.parentNode);
          return { x: gp.left + r.x, y: gp.top + r.y };
        }
        /* 占位格迁移（同区换位 / 跨区整格飞迁）+ 周边图标 FLIP 让位 */
        function movePh(g, tgt, x, y) {
          var before = beforeCenter(tgt, g, x, y);
          var ref;
          if (g === ph.parentNode) {
            /* 【定向守卫】tgt 在占位格前：指针未越过其中心(!before)不前移；
               tgt 在占位格后：指针未越过其中心(before)不后移 → 反向必须真的跨回中心，杜绝来回串 */
            var tgtBefore = !!(tgt.compareDocumentPosition(ph) & 4 /* DOCUMENT_POSITION_FOLLOWING */);
            if (tgtBefore && !before) return;
            if (!tgtBefore && before) return;
            ref = before ? tgt : tgt.nextSibling;
            if (ref === ph.nextSibling) return;   /* 已就位 */
          } else {
            ref = before ? tgt : tgt.nextSibling;
          }
          var g1 = ph.parentNode, cross = g1 !== g;
          var s1 = snapGrid(g1), s2 = cross ? snapGrid(g) : null;
          var p0 = cross ? phAbs() : null;
          g.insertBefore(ph, ref);
          if (cross) { var p1 = phAbs(); playFlip(ph, p0.x - p1.x, p0.y - p1.y); }
          playGrid(g1, s1);
          if (cross && s2) playGrid(g, s2);
          refreshCache(g1);
          if (cross) refreshCache(g);
        }

        /* ---------- 高亮/提示 ---------- */
        function setOver(el) {
          if (over === el) return;
          if (over) over.classList.remove('zf-panel-drop-hint');
          over = el;
          if (over) over.classList.add('zf-panel-drop-hint');
        }
        /* 拖出面板到 Dock 时的可见提示：Dock 描边发光 + 「i无限」图标高亮 */
        function setOut(on) {
          if (outReady === on) return;
          outReady = on;
          var ob = document.getElementById('zfDockOverflowBtn');
          if (ob) ob.classList.toggle('zf-panel-out-hint', on);
          dock.classList.toggle('zf-dock-out-target', on);
        }
        function setZoneHints(hg) {
          var cur = ph ? ph.parentNode : ib.parentNode;
          deskGrid.classList.toggle('zf-panel-zone-hint', hg === deskGrid && cur !== deskGrid);
          grid.classList.toggle('zf-panel-zone-hint', hg === grid && cur !== grid);
        }
        function zoneRect(g) {
          var z = g.closest ? (g.closest('.zf-panel-zone') || g) : g;
          return z.getBoundingClientRect();
        }
        function overDock(x, y) {
          /* 【2026-11-20 跨拖修复】Dock 平时 translateY(110%) 滑出屏幕，矩形 y 全在屏幕外
             → 面板拖出时永远判定不到落点。改为：Dock 可见用真实矩形；不可见时按屏幕底部
             80px 热带判定（Dock 显示时会滑回该区域），x 仍以 Dock 真实宽度为参照居中扩展。 */
          var r = dock.getBoundingClientRect();
          if (dock.classList.contains('zf-dock-show')) {
            return x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12;
          }
          return y >= window.innerHeight - 80 &&
                 x >= r.left - 60 && x <= r.right + 60;
        }

        /* ---------- 起拖激活：预填充件瞬间上岗 ---------- */
        function activate(x, y) {
          ib._dragMoved = true;
          ph.style.display = '';
          ib.parentNode.insertBefore(ph, ib);
          ib.style.display = 'none';
          ghost.style.display = 'flex';
          ghost.style.transform = 'translate3d(' + (x - 26) + 'px,' + (y - 26) + 'px,0)';
          document.body.classList.add('zf-panel-dragging');
          cacheMap = new Map();
        }

        /* ---------- 每帧统一处理（rAF 节流） ---------- */
        function process(x, y) {
          /* ghost 以鼠标为正中心，transform 直更（合成器层，不触发重排，跟手零迟滞） */
          ghost.style.transform = 'translate3d(' + (x - 26) + 'px,' + (y - 26) + 'px,0)';
          var isOut = overDock(x, y);
          setOut(isOut);
          /* 拖到落点区时 Dock 实时滑入显示（预演落点），拖回面板则收回 */
          dock.classList.toggle('zf-dock-show', isOut);
          if (isOut) { setOver(null); setZoneHints(null); return; }
          /* 分区命中（容器矩形外扩 16px，含标题/空白行） */
          var rg = zoneRect(grid), rd = zoneRect(deskGrid);
          var inPanel = x >= rg.left - 16 && x <= rg.right + 16 && y >= rg.top - 16 && y <= rg.bottom + 16;
          var inDesk = x >= rd.left - 16 && x <= rd.right + 16 && y >= rd.top - 16 && y <= rd.bottom + 16;
          var hg = inDesk ? deskGrid : (inPanel ? grid : null);
          setZoneHints(canZone ? hg : null);
          if (!hg) { setOver(null); return; }
          if (hg !== ph.parentNode && !canZone) { setOver(null); return; }
          var hit = hitTest(cacheFor(hg), hg, x, y);
          /* 悬停占位格自身空位/网格空白：保持不动（旧逻辑此处会误跳首/末位=乱串） */
          if (!hit || hit.el === ib) { setOver(null); return; }
          setOver(hit.el);
          movePh(hg, hit.el, x, y);
        }
        function onMv(e) {
          lastX = e.clientX; lastY = e.clientY;
          if (!activated) {
            if (Math.abs(lastX - startX) <= 6 && Math.abs(lastY - startY) <= 6) return;
            activated = true;
            activate(lastX, lastY);
          }
          if (!raf) raf = requestAnimationFrame(function () { raf = 0; process(lastX, lastY); });
        }

        /* ---------- 收尾：真身插回占位格位置（零跳变） ---------- */
        function cleanup() {
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          document.removeEventListener('mousemove', onMv);
          document.removeEventListener('mouseup', onUp);
          if (ghost) { ghost.remove(); ghost = null; }
          if (ph) {   /* 真身插到占位格位置再撤占位，位置零跳变（未起拖时占位格未入 DOM） */
            if (ph.parentNode) ph.parentNode.insertBefore(ib, ph);
            ph.remove(); ph = null;
          }
          ib.style.display = '';
          setOver(null);
          setOut(false);
          try { deskGrid.classList.remove('zf-panel-zone-hint'); grid.classList.remove('zf-panel-zone-hint'); } catch (e2) {}
          dock.classList.remove('zf-dock-show');
          document.body.classList.remove('zf-panel-dragging');   /* 【跨拖】结束恢复 Dock 原可见状态（热区接管） */
          setTimeout(function () { ib._dragMoved = false; }, 0);
        }
        function onUp(e) {
          cleanup();
          if (!ib._dragMoved) return;
          /* 拖出 → 放回 i桌面：app: 类条目 showApp + 重渲染 Dock，面板收起 */
          if (outReady) {
            if (en.pid && en.pid.indexOf('app:') === 0) {
              showApp(en.pid.slice(4));
              deskAdd(en.pid.slice(4));   /* 【2026-12 固定名单】拖出放回桌面也进固定名单，面板减员不回补 */
              suppressClick = true;
              setTimeout(function () { suppressClick = false; }, 0);
              /* 【2026-12 顺序丢失修复】拖出到 Dock 也按当前 DOM 顺序持久化，防止重开面板回弹到旧顺序 */
              savePanelOrder([].map.call(morePanel.querySelectorAll('.zf-panel-flat-item'), function (el2) { return el2.dataset.pid; }));
              morePanel.classList.remove('open');
              renderDock();
            }
            return;
          }
          /* 【2026-11-21 双区迁移】拖入 🖥桌面区 = 显示回 Dock；拖入 🧩面板区 = 收进面板。松手即迁移并原地重建面板（保持打开，免弹入动画）。
             【2026-11-22 修复】迁移判定改用条目数据区属 en.zone，不再比较占位格所在网格：
             占位格在拖拽中会提前飞迁预演（悬停目标区图标时 ph 已在目标区），旧条件"dropGrid!==目标区"
             此时恒为假 → 松手不落区。en.zone 是本次面板构建时的真实区属，同区松手仍走底部就地落位。 */
          if (en.pid && en.pid.indexOf('app:') === 0) {
            var fromDesk = en.zone === 'desktop';
            function _hit(el3) {
              if (!el3) return false;
              /* 【2026-12 拖拽命中修复】用整个分区容器（.zf-panel-zone，含标题+空白行）矩形并外扩 16px，
                 而非仅图标网格自身矩形——否则拖到桌面区空白处判定不到，图标拖不上去 */
              var zone = el3.closest ? el3.closest('.zf-panel-zone') : null;
              var r3 = (zone || el3).getBoundingClientRect();
              var PAD = 16;
              return e.clientX >= r3.left - PAD && e.clientX <= r3.right + PAD && e.clientY >= r3.top - PAD && e.clientY <= r3.bottom + PAD;
            }
            if (_hit(deskGrid) && !fromDesk) {
              showApp(en.pid.slice(4));
              deskAdd(en.pid.slice(4));   /* 【2026-12 固定名单】进桌面区 = 加入固定名单（Dock 补显，面板减员不回补） */
              suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
              /* 【2026-12 顺序丢失修复】跨区迁移落位：先按当前 DOM 顺序持久化再重建面板，否则用户放的位置丢失、重开回弹旧顺序 */
              savePanelOrder([].map.call(morePanel.querySelectorAll('.zf-panel-flat-item'), function (el2) { return el2.dataset.pid; }));
              renderDock(); buildOverflowPanel(extraOverflow, true);
              return;
            }
            if (_hit(grid) && fromDesk) {
              hideApp(en.pid.slice(4));
              deskRemove(en.pid.slice(4));   /* 【2026-12 固定名单】离开桌面区 = 移出名单，桌面区直接减员不补位 */
              suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
              savePanelOrder([].map.call(morePanel.querySelectorAll('.zf-panel-flat-item'), function (el2) { return el2.dataset.pid; }));   /* 【2026-12 顺序丢失修复】同上 */
              renderDock(); buildOverflowPanel(extraOverflow, true);
              return;
            }
          }
          /* 面板内落位（真身已由 cleanup 落进占位格位置）：持久化两区合并 DOM 顺序 + 落位回弹动画 */
          savePanelOrder([].map.call(morePanel.querySelectorAll('.zf-panel-flat-item'), function (el2) { return el2.dataset.pid; }));
          ib.classList.add('zf-panel-landed');
          setTimeout(function () { ib.classList.remove('zf-panel-landed'); }, 350);
        }
        document.addEventListener('mousemove', onMv);
        document.addEventListener('mouseup', onUp);
        ev.preventDefault();
      });
      ((en.zone === 'desktop') ? deskGrid : grid).appendChild(ib);
    });
    /* 【2026-11-16】右下角缩放手柄 + 恢复记忆的位置/尺寸 + 标题栏拖拽 */
    mountPanelResizeHandles(morePanel);
    applyPanelGeom();
    bindPanelDrag(ttl);
  }
  /* ---------- 面板位置/尺寸持久化（localStorage） ---------- */
  var PANEL_GEOM_KEY = 'zf_more_panel_geom_v1';
  function loadPanelGeom() {
    try { return JSON.parse(localStorage.getItem(PANEL_GEOM_KEY) || 'null'); } catch (e) { return null; }
  }
  function savePanelGeom(g) {
    try { localStorage.setItem(PANEL_GEOM_KEY, JSON.stringify(g)); } catch (e) {}
    /* 【2026-11-17 几何上云】随 dock_state.json 落盘，防清缓存/换浏览器后丢失 */
    try {
      fetch('/api/dock/state-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelGeom: g })
      }).catch(function () {});
    } catch (e) {}
  }
  function applyPanelGeom() {
    var g = loadPanelGeom();
    if (!g) return;
    if (typeof g.w === 'number') morePanel.style.width = Math.max(420, g.w) + 'px';
    if (typeof g.h === 'number') morePanel.style.height = Math.max(230, g.h) + 'px';
    if (typeof g.x === 'number' && typeof g.y === 'number') {
      /* 恢复时同样做完整越界校验（窗口缩小后面板不至被压出边缘） */
      var w = morePanel.offsetWidth || 420, h = morePanel.offsetHeight || 230;
      var x = Math.min(Math.max(g.x, -(w - 120)), window.innerWidth - 120);
      var y = Math.min(Math.max(g.y, 0), window.innerHeight - Math.min(60, h));
      morePanel.style.left = x + 'px';
      morePanel.style.bottom = 'auto';
      morePanel.style.top = y + 'px';
    }
  }
  /* 【2026-11-20 修复】拖拽移动/缩放面板时误关面板：拖拽中松手在面板外会补发 click（target 在面板外），
     命中下方「点击外部收起」监听 → 面板被关。加 panelBusy 标记，拖拽/缩放期间的 click 不收起。 */
  var panelBusy = false;
  function bindPanelDrag(handle) {
    if (handle._zfDragBound) return;
    handle._zfDragBound = true;
    handle.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      /* 白名单：标题栏内的按钮/输入框等控件不触发拖拽 */
      if (ev.target.closest && ev.target.closest('button,input,select,textarea,.zfp-no-drag')) return;
      var r = morePanel.getBoundingClientRect();
      var ox = ev.clientX - r.left, oy = ev.clientY - r.top;
      morePanel.style.bottom = 'auto';
      function clampPos(x, y) {
        /* 完整越界校验：至少保留 120x60 可见，且不允许超出右/下边界 */
        var w = morePanel.offsetWidth, h = morePanel.offsetHeight;
        x = Math.min(Math.max(x, -(w - 120)), window.innerWidth - 120);
        y = Math.min(Math.max(y, 0), window.innerHeight - Math.min(60, h));
        return [x, y];
      }
      function onMv(e) {
        var p = clampPos(e.clientX - ox, e.clientY - oy);
        morePanel.style.left = p[0] + 'px';
        morePanel.style.top = p[1] + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMv);
        document.removeEventListener('mouseup', onUp);
        var r2 = morePanel.getBoundingClientRect();
        savePanelGeom(Object.assign(loadPanelGeom() || {}, { x: r2.left, y: r2.top }));
        /* 松手后抑制紧跟的 click，防拖拽移动误关面板 */
        panelBusy = true;
        setTimeout(function () { panelBusy = false; }, 0);
      }
      document.addEventListener('mousemove', onMv);
      document.addEventListener('mouseup', onUp);
      ev.preventDefault();
    });
  }
  function bindPanelResize(h) {
    if (h._zfRzBound) return;
    h._zfRzBound = true;
    var MIN_W = 420, MIN_H = 230;
    h.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      var r = morePanel.getBoundingClientRect();
      /* dir: e/w 拉宽，n/s 拉高，ne/nw/se/sw 组合 */
      var dir = (h.dataset.dir || 'se');
      function onMv(e) {
        /* 拉宽：e 用右缘跟随鼠标，w 用「右缘固定、左缘跟随」改 left+width */
        if (dir.indexOf('e') >= 0) {
          var w = Math.max(MIN_W, Math.min(e.clientX - r.left, window.innerWidth - 20));
          morePanel.style.width = w + 'px';
        }
        if (dir.indexOf('w') >= 0) {
          var right = r.right;
          var w2 = Math.max(MIN_W, Math.min(right - e.clientX, window.innerWidth - 20));
          morePanel.style.width = w2 + 'px';
          morePanel.style.left = (right - w2) + 'px';
          morePanel.style.bottom = 'auto';
        }
        /* 拉高：s 下缘跟随；n 上缘跟随、底缘固定 */
        if (dir.indexOf('s') >= 0) {
          var hh = Math.max(MIN_H, Math.min(e.clientY - r.top, window.innerHeight - 20));
          morePanel.style.height = hh + 'px';
        }
        if (dir.indexOf('n') >= 0) {
          var bottom = r.bottom;
          var hh2 = Math.max(MIN_H, Math.min(bottom - e.clientY, window.innerHeight - 20));
          morePanel.style.height = hh2 + 'px';
          morePanel.style.top = (bottom - hh2) + 'px';
          morePanel.style.bottom = 'auto';
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMv);
        document.removeEventListener('mouseup', onUp);
        var r2 = morePanel.getBoundingClientRect();
        savePanelGeom(Object.assign(loadPanelGeom() || {}, { w: r2.width, h: r2.height, x: r2.left, y: r2.top }));
        /* 松手后抑制紧跟的 click，防拖拽缩放误关面板 */
        panelBusy = true;
        setTimeout(function () { panelBusy = false; }, 0);
      }
      document.addEventListener('mousemove', onMv);
      document.addEventListener('mouseup', onUp);
      ev.preventDefault();
    });
  }
  /* 【2026-11-20】挂 8 向缩放手柄（四边+四角），挂在面板打开时逐个 bind */
  function mountPanelResizeHandles(panel) {
    ['n','s','e','w','ne','nw','se','sw'].forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'zf-panel-rz-' + d;
      el.dataset.dir = d;
      el.title = '拖拽调整面板大小';
      panel.appendChild(el);
      bindPanelResize(el);
    });
    /* 保留原右下角三角手柄（dir=se） */
    var rz = panel.querySelector('.zf-panel-resize');
    if (rz) { rz.dataset.dir = 'se'; bindPanelResize(rz); }
  }
  function saveOrderIds(ids) {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch (e) {}
  }

  function register(app) {
    if (!app || !app.id) return;
    var i = APPS.findIndex(function (a) { return a.id === app.id; });
    if (i >= 0) APPS[i] = app; else APPS.push(app);
    applyOrder();
    renderDock();
  }

  /* ---------- 样式 ---------- */
  var css = [
    '#zfAppDock{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);',
    'z-index:9500;display:flex;align-items:flex-end;gap:18px;padding:4px 8px;',
    '/* 默认隐藏：上移淡出，鼠标靠近底部热区时滑入 */',
    'opacity:0;transform:translateX(-50%) translateY(110%);pointer-events:none;',
    'transition:opacity .28s ease,transform .3s cubic-bezier(.34,1.3,.64,1);}',
    '#zfAppDock.zf-dock-show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto;}',
    '#zfDockHotzone{position:fixed;left:0;right:0;bottom:0;height:32px;z-index:899;pointer-events:auto;background:transparent;}',
    '#zfAppDock.zf-dock-hidden{display:none}',
    '.zf-dock-item.zf-dock-dragging,#zfAppDock > .zf-dock-btn.zf-dock-dragging{cursor:grabbing;filter:drop-shadow(0 0 10px rgba(255,255,255,.7));z-index:2;position:relative;}',
    /* 拖拽目标高亮：左侧竖线指示插入位置 */
    '.zf-dock-drop-hint{box-shadow:-3px 0 0 0 rgba(124,92,255,.9) !important;}',
    /* 【2026-11-12 需求2/3】拖出占位虚线空位（更直观的落点预览） */
    '.zf-dock-drop-slot{border:2px dashed rgba(124,92,255,.75);border-radius:12px;',
    'background:rgba(124,92,255,.12);animation:zfSlotIn .18s ease;flex:0 0 auto;}',
    '@keyframes zfSlotIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}',
    '.zf-dock-item{width:46px;height:46px;border:none;background:transparent;padding:0;',
    'display:flex;align-items:center;justify-content:center;cursor:pointer;',
    'border-radius:12px;transition:transform .18s cubic-bezier(.34,1.56,.64,1);',
    'transform-origin:bottom center;will-change:transform;position:relative;}',
    '.zf-dock-item:hover{background:rgba(255,255,255,.10)}',
    '.zf-dock-item svg,.zf-dock-item img,.zf-dock-item span.zf-dock-emoji{width:34px;height:34px;',
    'font-size:30px;line-height:34px;pointer-events:none;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));}',
    '.zf-dock-tip{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%) scale(.85);',
    'background:rgba(15,16,20,.92);color:#e8e8ee;font-size:10px;padding:3px 7px;border-radius:6px;',
    'white-space:nowrap;opacity:0;pointer-events:none;transition:.15s;border:1px solid rgba(255,255,255,.12);}',
    '.zf-dock-item:hover .zf-dock-tip{opacity:1;transform:translateX(-50%) scale(1)}',
    /* 更多面板 · 2026-11 重设计：平铺大网格（6列自适应），支持拖拽调序 */
    '#zfDockMorePanel{position:fixed;left:50%;bottom:78px;transform:none;',
    'z-index:9501;display:none;grid-template-columns:1fr;gap:0;padding:0;min-width:420px;min-height:230px;',
    'max-height:none;overflow:hidden;background:rgba(23,24,29,.92);backdrop-filter:blur(18px);',
    'border:1px solid rgba(255,255,255,.10);',
    'border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.55);scrollbar-width:thin;}',
    /* 【2026-11-16 用户要求】面板只保留一个默认背景色，去掉跟随鼠标的光斑渐变 */
    '#zfDockMorePanel.open{display:grid;animation:zfPanelIn .38s cubic-bezier(.34,1.4,.64,1);}',
    '@keyframes zfPanelIn{0%{opacity:0;transform:translateY(18px) scale(.9)}100%{opacity:1;transform:translateY(0) scale(1)}}',
    /* 平铺网格容器：横跨整行 */
    '.zf-panel-flat-grid{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:14px;}',
    '.zf-panel-flat-item{width:100%;max-width:88px;height:88px;border-radius:14px;user-select:none;}',
    /* 【2026-11-16】图标悬停背景色默认隐藏，鼠标滑过才浮现（更动感） */
    '.zf-panel-flat-item{background:transparent;transition:background .22s ease,box-shadow .22s ease,transform .22s;}',
    /* 【2026-11-16 用户要求】面板图标 hover 与主 i桌面 Dock 图标一致：纯色 rgba(255,255,255,.10)，去掉渐变色块 */
    '.zf-panel-flat-item:hover{background:rgba(255,255,255,.10);}',
    '.zf-panel-flat-item:hover em{color:#fff;}',
    /* 面板标题：居中 i无限 */
    '.zf-panel-flat-item:active{cursor:grabbing;}',
    /* 拖拽目标高亮：深色填充+主色描边，落点一目了然 */
    '.zf-panel-flat-item.zf-panel-drop-hint{background:rgba(64,132,255,.28);box-shadow:0 0 0 2px #4a8cff inset;}',
    'body.zf-panel-dragging{cursor:grabbing;}',
    'body.zf-panel-dragging .zf-panel-flat-item{transition:none;}',
    'body.zf-panel-dragging .zf-panel-flat-item:hover{background:transparent;}',
    /* 【2026-11-22 拖拽稳定】拖拽中冻结一切悬停位移/缩放/入场动画：
       hover 的 translateY+scale 与让位 FLIP 同抢 transform 会互相覆盖 → 图标闪动抽搐 */
    'body.zf-panel-dragging .zf-dock-more-item,body.zf-panel-dragging .zf-dock-more-item:hover{transform:none !important;transition:none !important;}',
    'body.zf-panel-dragging .zf-dock-more-item:hover svg,body.zf-panel-dragging .zf-dock-more-item:hover img,body.zf-panel-dragging .zf-dock-more-item:hover span.zf-dock-emoji{transform:none !important;transition:none !important;}',
    'body.zf-panel-dragging .zf-panel-flat-grid .zf-dock-more-item{animation:none !important;}',
    /* 拖拽幽灵跟随鼠标（left/top 归零，位置全走 transform：合成器直更不触发重排，跟手零迟滞） */
    '.zf-panel-ghost{position:fixed;left:0;top:0;z-index:10050;pointer-events:none;opacity:.92;width:52px;height:52px;',
    'display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 8px 18px rgba(0,0,0,.55));will-change:transform;}',
    /* 落位回弹动画 */
    '.zf-panel-flat-item.zf-panel-landed{animation:zfPanelLand .35s ease;}',
    '@keyframes zfPanelLand{0%{transform:scale(1.18);background:rgba(74,140,255,.35)}100%{transform:scale(1);}}',
    /* 【2026-11-14 跨拖】i桌面↔i无限 双向拖拽可见反馈 */
    '#zfDock.zf-dock-out-target{outline:2px dashed #4a8cff;outline-offset:4px;border-radius:14px;background:rgba(74,140,255,.08)}',
    '#zfDockOverflowBtn.zf-panel-out-hint svg{filter:drop-shadow(0 0 8px #4a8cff);transform:scale(1.2)}',
    '#zfDockMorePanel.zf-panel-in-hint{outline:2px dashed #4a8cff;outline-offset:-4px;background:rgba(74,140,255,.14)}',
    /* 【2026-11-21 双区】🖥桌面区 / 🧩面板区 分区样式 */
    '.zf-panel-zone{grid-column:1/-1;display:flex;flex-direction:column;gap:12px;border-radius:14px;padding:4px;transition:background .18s ease,outline-color .18s;}',
    '.zf-panel-zone-title{font-size:11px;font-weight:700;letter-spacing:2px;color:#8a90a8;border-bottom:1px dashed rgba(255,255,255,.08);padding-bottom:8px;}',
    '.zf-panel-zone.zf-panel-zone-hint{outline:2px dashed #4a8cff;outline-offset:2px;background:rgba(74,140,255,.10);}',
    /* i小说窗口层级高于导航缩略图(--z-minimap:100000)，缩略图沉在窗口之下 */
    '#zfNovelWin{z-index:100001 !important;}',
    /* 【2026-11-13 需求】i视频(电影)/i电视等媒体窗口同 i小说惯例提层高于导航缩略图，缩略图沉在窗口之下 */
    '#zfVideoWin{z-index:100001 !important;}',
    '#zfTvWin{z-index:100001 !important;}',
    /* 【2026-11-16 用户要求】标题「i无限程序」：不要任何背景色/渐变/发光动画，纯色直接可见 */
    /* 【2026-11-16 重设计】标题栏：i无限 + ∞ 徽标，同时是拖拽手柄 */
    '.zf-more-panel-title{position:relative;grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:10px;user-select:none;cursor:move;',
    'padding:12px 16px 10px;margin:0;border-bottom:1px solid rgba(255,255,255,.08);background:none !important;color:#e8e8ee !important;text-shadow:none;animation:none;}',
    '.zf-more-panel-title .zfp-badge{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;',
    'background:linear-gradient(135deg,#4a8cff,#7c5cff);box-shadow:0 2px 8px rgba(74,140,255,.4);flex:0 0 auto;}',
    '.zf-more-panel-title .zfp-badge svg{width:14px;height:14px}',
    '.zf-more-panel-title .zfp-txt{font-size:13px;font-weight:700;letter-spacing:4px;background:linear-gradient(90deg,#eef2ff,#aab8ff);',
    '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}',
    '.zf-more-panel-title .zfp-draghint{margin-left:10px;font-size:9px;color:#5a5f72;letter-spacing:1px;transition:opacity 1s ease;}',
    '.zf-more-panel-title .zfp-draghint.zfp-fade{opacity:0;pointer-events:none;}',
    /* 【2026-11-20】右上角关闭按钮：绝对定位右缘，不挤标题居中布局 */
    '.zf-more-panel-title .zfp-close{position:absolute;right:8px;top:6px;transform:none;width:26px;height:26px;',
    'border:none;background:transparent;color:#a8a8b2;font-size:16px;line-height:1;border-radius:7px;cursor:pointer;padding:0;',
    'display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;user-select:none;}',
    '.zf-more-panel-title .zfp-close:hover{background:rgba(255,255,255,.12);color:#fff;}',
    /* 【2026-12 搜索框】i无限面板顶部搜索条 */
    '#zfDockMorePanel .zf-panel-search-wrap{grid-column:1/-1;padding:0 22px;margin-top:0;display:flex;align-items:center;gap:8px;}',
    '#zfDockMorePanel .zf-panel-search-ico{width:15px;height:15px;flex:none;color:#8a8a96;pointer-events:none;}',
    '#zfDockMorePanel .zf-panel-search-wrap:focus-within .zf-panel-search-ico{color:#b9c6e0;}',
    '#zfDockMorePanel .zf-panel-search{flex:1;width:100%;box-sizing:border-box;padding:7px 12px;border-radius:10px;',
    'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e8e8f0;font-size:12px;outline:none;',
    'transition:border-color .15s,background .15s;}',
    '#zfDockMorePanel .zf-panel-search::placeholder{color:#8a8a96;}',
    '#zfDockMorePanel .zf-panel-search:focus{border-color:rgba(120,180,255,.6);background:rgba(255,255,255,.10);}',
    /* 面板内滚动区 + 右下角 resize 手柄（手柄锚定面板本体，不随内容滚动） */
    '#zfDockMorePanel .zf-panel-body{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:14px;padding:16px 22px 22px;overflow:auto;}',
    '#zfDockMorePanel .zf-panel-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;opacity:.45;z-index:2;}',
    /* 【2026-11-20 四边+四角缩放手柄】左右可拉宽、上下可拉高，边缘热区稍宽易命中 */
    '#zfDockMorePanel .zf-panel-rz-e,#zfDockMorePanel .zf-panel-rz-w{position:absolute;top:10px;bottom:10px;width:8px;z-index:3;cursor:ew-resize;}',
    '#zfDockMorePanel .zf-panel-rz-e{right:-4px;}#zfDockMorePanel .zf-panel-rz-w{left:-4px;}',
    '#zfDockMorePanel .zf-panel-rz-n,#zfDockMorePanel .zf-panel-rz-s{position:absolute;left:10px;right:10px;height:8px;z-index:3;cursor:ns-resize;}',
    '#zfDockMorePanel .zf-panel-rz-n{top:-4px;}#zfDockMorePanel .zf-panel-rz-s{bottom:-4px;}',
    '#zfDockMorePanel .zf-panel-rz-ne,#zfDockMorePanel .zf-panel-rz-nw,#zfDockMorePanel .zf-panel-rz-se,#zfDockMorePanel .zf-panel-rz-sw{position:absolute;width:14px;height:14px;z-index:4;}',
    '#zfDockMorePanel .zf-panel-rz-ne{top:-4px;right:-4px;cursor:nesw-resize;}',
    '#zfDockMorePanel .zf-panel-rz-nw{top:-4px;left:-4px;cursor:nwse-resize;}',
    '#zfDockMorePanel .zf-panel-rz-se{bottom:-4px;right:-4px;cursor:nwse-resize;}',
    '#zfDockMorePanel .zf-panel-rz-sw{bottom:-4px;left:-4px;cursor:nesw-resize;}',
    '#zfDockMorePanel .zf-panel-resize::before{content:"";position:absolute;right:3px;bottom:3px;width:9px;height:9px;',
    'border-right:2px solid #9aa3b8;border-bottom:2px solid #9aa3b8;border-radius:1px;}',
    '#zfDockMorePanel .zf-panel-resize:hover{opacity:1;}',
    /* 【2026-11-15 动态化】图标逐个弹入：面板打开时按序淡入上浮 */
    '.zf-panel-flat-grid .zf-dock-more-item{animation:zfIconPop .4s cubic-bezier(.34,1.5,.64,1) backwards;}',
    '@keyframes zfIconPop{0%{opacity:0;transform:translateY(14px) scale(.6)}100%{opacity:1;transform:translateY(0) scale(1)}}',
    /* 【2026-11-15 酷布局+悬停增强】图标悬停：主色渐变底+发光+上浮+图标放大，变化明显 */
    '.zf-dock-more-item{transition:transform .18s cubic-bezier(.34,1.4,.64,1),background .18s,box-shadow .18s;}',
    '.zf-dock-more-item svg,.zf-dock-more-item img,.zf-dock-more-item span.zf-dock-emoji{transition:transform .18s cubic-bezier(.34,1.4,.64,1),filter .18s;}',
    '.zf-dock-more-item{background:transparent;box-shadow:none;}',
    '.zf-dock-more-item:hover{background:rgba(255,255,255,.10);box-shadow:none;transform:translateY(-4px) scale(1.08);}',
    '.zf-dock-more-item:hover svg,.zf-dock-more-item:hover img,.zf-dock-more-item:hover span.zf-dock-emoji{transform:scale(1.22);filter:none;}',
    '.zf-dock-more-item:hover em{color:#fff;}',
    '.zf-dock-more-item{width:82px;height:82px;border:none;background:transparent;border-radius:14px;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;}',
    '.zf-dock-more-item svg,.zf-dock-more-item img,.zf-dock-more-item span.zf-dock-emoji{width:34px;height:34px;font-size:30px;line-height:34px;}',
    '.zf-dock-more-item em{font-style:normal;font-size:11px;color:#c8c8d2;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.zf-more-group-title{grid-column:1/-1;font-size:10px;color:#8a8a96;padding:4px 2px 0;border-top:1px solid rgba(255,255,255,.08);letter-spacing:1px}',
    /* ---------- 通用 App 窗口基类（v4 修复：此前 zfChatWin/zfNewsWin/zfVideoWin/zfMusicWin
       无任何 CSS 定位 → 以 static div 追加到 body 末尾（表现为"打开后下面多出来一个框"），
       拖拽 left/top 无效、最大化挤开页面盖住右上角关闭钮。统一由类提供 fixed 居中/层级/显隐。） */
    '.zf-appwin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);width:min(860px,92vw);height:min(600px,80vh);z-index:9600;display:none;flex-direction:column;background:#17181d;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.6);opacity:0;transition:transform .22s cubic-bezier(.34,1.4,.64,1),opacity .2s;}',
    '.zf-appwin.open{display:flex;opacity:1;transform:translate(-50%,-50%) scale(1)}',
    /* ---------- i漫画窗口 ---------- */
    '#zfCalcWin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);width:min(360px,94vw);height:min(560px,92vh);z-index:9600;display:none;flex-direction:column;}',
    '#zfMangaWin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);z-index:9600;display:none;flex-direction:column;background:#17181d;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.6);opacity:0;transition:transform .22s cubic-bezier(.34,1.4,.64,1),opacity .2s;width:min(960px,94vw);height:min(900px,92vh);}#zfChatWin,#zfHardwareWin,#zfCalcWin{width:min(860px,92vw);height:min(600px,80vh);z-index:9600;display:none;flex-direction:column;',
    'background:#17181d;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;',
    'box-shadow:0 24px 70px rgba(0,0,0,.6);opacity:0;transition:transform .22s cubic-bezier(.34,1.4,.64,1),opacity .2s;}',
    '#zfMangaWin.open,#zfChatWin.open,#zfHardwareWin.open,#zfCalcWin.open,#zfNotesWin.open{display:flex;opacity:1;transform:translate(-50%,-50%) scale(1)}',
    '#zfNotesWin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);width:min(620px,92vw);height:min(560px,80vh);z-index:9600;display:none;flex-direction:column;background:#17181d;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.6);opacity:0;transition:transform .22s cubic-bezier(.34,1.4,.64,1),opacity .2s;}',
    '.zf-appwin-head{display:flex;align-items:center;gap:8px;padding:6px 10px;flex:0 0 auto;',
    'background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.06);cursor:move;}',
    '.zf-appwin-head h3{margin:0;font-size:13px;color:#e8e8ee;font-weight:600;flex:1;display:flex;align-items:center;gap:7px}',
    '.zf-appwin-head h3 svg{width:16px;height:16px}',
    '.zf-appwin-btn{border:none;background:transparent;color:#a8a8b2;width:26px;height:26px;padding:0;display:flex;align-items:center;justify-content:center;',
    'border-radius:6px;cursor:pointer;}',
    '.zf-appwin-btn:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.zf-manga-body{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;color:#8a8a94;}',
    /* ---------- i小镇（仿 i漫画 原生窗口风格，深浅色自适应） ---------- */
    '.zf-town-body{flex:1;overflow:auto;position:relative;display:flex;flex-direction:column;align-items:center;color:var(--text,#e8e8ee);}',
    '.zt-title{margin:14px 18px 0 0;align-self:flex-end;font-size:14px;letter-spacing:2px;color:var(--accent,#ffcd75);}',
    '.zt-hud{align-self:flex-start;margin:0 0 8px 14px;padding:6px 12px;font-size:12px;background:var(--bg-card,rgba(255,255,255,.07));border:1px solid var(--border,rgba(255,255,255,.12));border-radius:8px;color:var(--text2,#8a8a94);}',
    '.zt-hud b{color:var(--accent,#ffcd75)}',
    '.zt-town{position:relative;width:100%;min-height:300px;flex:0 0 auto;}',
    '.zt-ground{position:absolute;bottom:0;left:0;right:0;height:34%;background:var(--bg-card,rgba(255,255,255,.06));border-top:3px solid var(--accent,#ffcd75);border-radius:6px 6px 0 0;}',
    '.zt-bld{position:absolute;width:120px;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:6px;overflow:hidden;font-size:11px;line-height:1.5;transition:opacity .4s;}',
    '.zt-bld .zt-roof{height:12px;background:var(--accent,#ef7d57);opacity:.85;}',
    '.zt-bld .zt-wall{padding:8px;background:var(--bg-card,rgba(255,255,255,.08));color:var(--text,#e8e8ee);}',
    '.zt-bld .zt-wall b{color:var(--accent,#ffcd75)}',
    '.zt-bld.off{opacity:.35}',
    '.zt-ranks{position:absolute;left:14px;bottom:14px;width:210px;max-height:32vh;overflow:auto;padding:8px;font-size:11px;background:var(--bg-card,rgba(255,255,255,.07));border:1px solid var(--border,rgba(255,255,255,.14));border-radius:8px;color:var(--accent,#ffcd75);}',
    '.zt-rk{padding:2px 0;color:var(--text,#e8e8ee);word-break:break-all;}',
    '.zt-evlist{position:absolute;right:14px;bottom:14px;width:280px;max-height:32vh;overflow:auto;padding:8px;font-size:11px;background:var(--bg-card,rgba(255,255,255,.07));border:1px solid var(--border,rgba(255,255,255,.14));border-radius:8px;color:var(--text2,#8a8a94);}',
    '.zt-ev{border-bottom:1px dashed var(--border,rgba(255,255,255,.18));padding:3px 0;color:var(--text,#e8e8ee);word-break:break-all;}',
    /* ---------- i漫画 初始等待动画（简约墨点，深浅色随 data-theme 自适应） ---------- */
    '.zfm-boot{flex:1;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:var(--text2,#8a8a94);}',
    '.zfm-boot p{margin:0;font-size:12px;letter-spacing:2px;opacity:.75}',
    '.zfm-spin{display:inline-block;width:22px;height:22px;border-radius:50%;border:2px solid transparent;',
    'border-top-color:currentColor;border-right-color:currentColor;opacity:.55;animation:zfmSpin .8s linear infinite;}',
    '@keyframes zfmSpin{to{transform:rotate(360deg)}}',
    '.zfm-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:120px;}',
    /* ---------- i漫画内容（zf-app-manga.js）简约墨黑/纸白 双色适配 ---------- */
    '.zfm-toolbar{display:flex;gap:8px;width:100%;margin-bottom:12px;flex:0 0 auto}',
    '.zfm-toolbar input{flex:1;background:var(--bg-card,rgba(255,255,255,.07));border:1px solid var(--border,rgba(255,255,255,.12));border-radius:10px;padding:8px 12px;color:var(--text,#e8e8ee);font-size:13px;outline:none;transition:border-color .15s}',
    '.zfm-toolbar input:focus{border-color:var(--accent,#8a8a94)}',
    '.zfm-toolbar select{background:var(--bg-card,rgba(255,255,255,.07));border:1px solid var(--border,rgba(255,255,255,.12));border-radius:10px;padding:8px 10px;color:var(--text,#e8e8ee);font-size:13px;outline:none}',
    '.zfm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:14px;width:100%}',
    '.zfm-tip{grid-column:1/-1;text-align:center;font-size:13px;color:var(--text2,#8a8a94);padding:24px 0;line-height:1.8}',
    '.zfm-card{cursor:pointer;border-radius:12px;overflow:hidden;background:var(--bg-card,rgba(255,255,255,.05));transition:transform .18s,box-shadow .18s;position:relative}',
    '.zfm-card:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(0,0,0,.22)}',
    '.zfm-cover{position:relative;width:100%;aspect-ratio:3/4;background:var(--hover,rgba(255,255,255,.06));display:flex;align-items:center;justify-content:center}',
    '.zfm-cover img{width:100%;height:100%;object-fit:cover;display:block}',
    '.zfm-cover-ph{font-size:34px;opacity:.4}',
    '.zfm-badge{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.68);color:#ffd479;font-size:11px;padding:2px 6px;border-radius:6px}',
    '.zfm-title{padding:8px 9px;font-size:12px;color:var(--text,#d8d8e0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* P0-B 书架子工具条（筛选chips/排序/三视图切换） */
    '.zfm-subbar{display:flex;align-items:center;gap:8px;width:100%;flex:0 0 auto;margin-bottom:10px}',
    '.zfm-chips{display:flex;gap:4px;flex:1}',
    '.zfm-chips button{border:none;background:transparent;color:#8a8a94;font-size:12px;padding:4px 10px;border-radius:14px;cursor:pointer}',
    '.zfm-chips button:hover{color:#d8d8e0}',
    '.zfm-chips button.zfm-on{background:rgba(124,92,255,.22);color:#b39dff}',
    '.zfm-subbar select{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:5px 8px;color:#e8e8ee;font-size:12px}',
    '.zfm-views{display:flex;gap:2px;background:rgba(255,255,255,.06);border-radius:8px;padding:2px}',
    '.zfm-views button{border:none;background:transparent;color:#8a8a94;padding:4px 7px;border-radius:6px;cursor:pointer;display:flex;align-items:center}',
    '.zfm-views button.zfm-on{background:rgba(124,92,255,.3);color:#fff}',
    /* P0-B 三视图布局 */
    '.zfm-grid.zfm-wall{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}',
    '.zfm-grid.zfm-list{grid-template-columns:1fr;gap:6px}',
    '.zfm-grid.zfm-list .zfm-card{display:flex;align-items:center;gap:10px;padding:6px 10px}',
    '.zfm-grid.zfm-list .zfm-lcover{position:relative;width:42px;height:56px;flex:0 0 auto;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center}',
    '.zfm-grid.zfm-list .zfm-lcover img{width:100%;height:100%;object-fit:cover}',
    '.zfm-grid.zfm-list .zfm-lmeta{flex:1;min-width:0}',
    '.zfm-grid.zfm-list .zfm-lsub{font-size:11px;color:#8a8a94}',
    '.zfm-grid.zfm-list .zfm-title{padding:0}',
    '.zfm-grid.zfm-gridv{grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px}',
    '.zfm-grid.zfm-gridv .zfm-title{padding:5px 6px;font-size:11px}',
    /* P0-B4 封面渐显 */
    '.zfm-card{opacity:.25}',
    '.zfm-card.zfm-cin{opacity:1;transition:opacity .35s ease}',
    '.zfm-card:hover{opacity:1}',
    /* P0-B 收藏星标 */
    '.zfm-fav{position:absolute;left:5px;top:5px;z-index:2;border:none;background:rgba(0,0,0,.45);color:rgba(255,255,255,.45);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity .15s}',
    '.zfm-card:hover .zfm-fav{opacity:1}',
    '.zfm-fav.zfm-on{color:#ffd479;opacity:1}',
    '.zfm-grid.zfm-list .zfm-fav{position:static;flex:0 0 auto;opacity:1}',
    /* 阅读器 */
    '.zfm-rbar{display:flex;align-items:center;gap:8px;width:100%;flex:0 0 auto;margin-bottom:8px}',
    '.zfm-btn{border:none;background:rgba(255,255,255,.07);color:#c8c8d2;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;line-height:1}',
    '.zfm-btn svg{width:16px;height:16px;display:block;flex-shrink:0}',
    '.zfm-btn:hover{background:rgba(255,255,255,.14);color:#fff}',
    /* 20261112 图标升级：spinner 动画 + 下载三态色 + rbar 底部细进度条 */
    '@keyframes zfm-spin{to{transform:rotate(360deg)}}',
    '.zfm-btn svg.zfm-spin{animation:zfm-spin 1s linear infinite}',
    '.zfm-btn.zfm-loading{background:rgba(255,212,121,.15);color:#ffd479;pointer-events:none}',
    '.zfm-btn.zfm-ok{background:rgba(90,209,160,.25);color:#5ad1a0}',
    '.zfm-btn.zfm-err{background:rgba(224,90,90,.25);color:#e05a5a}',
    '.zfm-dlbar{position:absolute;left:0;right:0;bottom:0;height:2px;z-index:31;pointer-events:none;overflow:hidden}',
    '.zfm-dlbar-fill{height:100%;width:0;background:linear-gradient(90deg,#5ad1a0,#ffd479);transition:width .5s}',
    '.zfm-rtitle{flex:1;font-size:13px;color:#e8e8ee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.zfm-rpage{font-size:12px;color:#8a8a94;flex:0 0 auto}',
    '.zfm-rbar select{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;color:#e8e8ee;font-size:12px}',
    '#zfmReader{width:100%;flex:1;overflow:auto;border-radius:10px;background:rgba(0,0,0,.35)}',
    '.zfm-v{display:flex;flex-direction:column;align-items:center}',
    '.zfm-vpage{width:100%}.zfm-vpage img{width:100%;display:block}',
    '.zfm-h{position:relative;display:flex;align-items:center;justify-content:center;user-select:none;touch-action:pan-y}',
    '.zfm-himg{max-width:100%;max-height:100%;object-fit:contain;pointer-events:none}',
    '.zfm-nav{position:absolute;top:0;bottom:0;width:18%;display:flex;align-items:center;justify-content:center;font-size:34px;color:rgba(255,255,255,.35);cursor:pointer}',
    '.zfm-nav:hover{color:rgba(255,255,255,.8);background:rgba(255,255,255,.05)}',
    '.zfm-next{right:0}.zfm-prev{left:0}',
    '.zfm-dlbar{width:100%;flex:0 0 auto;margin-bottom:10px;display:flex;flex-direction:column;gap:6px}',
    '.zfm-dlitem{display:flex;align-items:center;gap:8px;font-size:12px;color:#c8c8d2}',
    '.zfm-dlitem em{font-style:normal;color:#8a8a94;font-size:11px;flex:0 0 auto}',
    '.zfm-dlitem span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}',
    '.zfm-dltrack{flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}',
    '.zfm-dlfill{height:100%;background:linear-gradient(90deg,#5ad1a0,#ffd479);transition:width .4s}',
    '.zfm-btn.zfm-on{background:rgba(90,209,160,.25);color:#5ad1a0}',
    /* P0-C 观看升级：画质档/亮度色温变量/OLED纯黑/双页对开/观看设置栏 */
    '.zfm-viewbar{display:flex;align-items:center;gap:12px;width:100%;flex:0 0 auto;padding:8px 10px;margin-bottom:8px;',
    'background:rgba(255,255,255,.05);border-radius:10px;font-size:12px;color:#c8c8d2;flex-wrap:wrap}',
    '.zfm-viewbar label{display:flex;align-items:center;gap:6px}',
    '.zfm-viewbar select,.zfm-viewbar input[type=range]{accent-color:#7c5cff}',
    '.zfm-viewbar select{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 10px;color:#e8e8ee;font-size:12px}',
    '.zfm-viewbar input[type=checkbox]{accent-color:#7c5cff}',
    '#zfmReader.zfm-fit-w{--zfm-fit-w:1}#zfmReader.zfm-fit-h{--zfm-fit-h:1}#zfmReader.zfm-fit-o{--zfm-fit-o:1}',
    '#zfmReader{filter:brightness(var(--zfm-bright,1)) sepia(var(--zfm-sepia,0))}',
    '#zfmReader.zfm-oled{background:#000}',
    '.zfm-v.zfm-fit-w .zfm-vpage img{width:100%}',
    '.zfm-v.zfm-fit-h .zfm-vpage img{width:auto;max-height:92vh;max-width:100%;margin:0 auto;display:block}',
    '.zfm-v.zfm-fit-o .zfm-vpage img{max-width:none}',
    '.zfm-spread{display:flex;align-items:center;justify-content:center;gap:4px;height:100%;width:100%}',
    '.zfm-spread .zfm-himg{max-width:calc(50% - 2px);max-height:100%}',
    '.zfm-h.zfm-fit-o .zfm-himg{max-width:none;max-height:none}',
    /* P2 沉浸阅读：工具条/设置条悬浮自动隐藏（hover 才显示）+ 全屏模式 + 宽度滑块 */
    '#zfMangaBody{position:relative}',
    '.zfm-rbar{position:absolute;top:0;left:0;right:0;z-index:30;margin:0;padding:8px 10px;border-radius:10px;background:rgba(12,12,18,.88);box-shadow:0 4px 14px rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .18s}',
    '#zfMangaBody:hover .zfm-rbar,#zfMangaBody:focus-within .zfm-rbar{opacity:1;pointer-events:auto}',
    '.zfm-viewbar{position:absolute;top:var(--zfm-rbar-h,46px);left:0;right:0;z-index:29;margin:0;opacity:0;pointer-events:none;transition:opacity .18s;background:rgba(12,12,18,.92)}',
    '#zfMangaBody:hover .zfm-viewbar,#zfMangaBody:focus-within .zfm-viewbar{opacity:1;pointer-events:auto}',
    /* 2.5s 无操作自动淡出悬浮条（鼠标移回立即恢复） */
    '#zfMangaBody.zfm-idle .zfm-rbar,#zfMangaBody.zfm-idle .zfm-viewbar{opacity:0 !important;pointer-events:none !important}',
    '.zfm-handle{position:absolute;top:0;left:0;right:0;height:5px;z-index:31;background:linear-gradient(180deg,rgba(124,92,255,.55),rgba(124,92,255,0));opacity:.7;transition:opacity .18s}',
    '#zfMangaBody:hover .zfm-handle{opacity:.7}',
    '#zfMangaBody:not(.zfm-idle) .zfm-handle{opacity:0}',
    '.zfm-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:28;padding:6px 14px;border-radius:14px;background:rgba(12,12,18,.72);color:#a9a9c0;font-size:12px;white-space:nowrap;pointer-events:none;transition:opacity .4s}',
    '.zfm-hint.zfm-hint-off{opacity:0}',
    '.zfm-wlab{display:flex;align-items:center;gap:4px;font-size:12px;color:#8a8a94;flex:0 0 auto}',
    '.zfm-wlab input{accent-color:#7c5cff;width:90px}',
    '#zfMangaWin.zfm-full{width:100vw !important;height:100vh !important;left:0 !important;top:0 !important;transform:none !important;border-radius:0 !important}',
    /* P2 窗口 resize 手柄：右缘/下缘/右下角，半透明热区 */
    '.zf-rz{position:absolute;z-index:60}.zf-rz-e{right:-3px;top:0;bottom:0;width:7px;cursor:ew-resize}.zf-rz-s{bottom:-3px;left:0;right:0;height:7px;cursor:ns-resize}.zf-rz-se{right:-3px;bottom:-3px;width:14px;height:14px;cursor:nwse-resize}',
    /* P1-D 详情页 */
    '.zfm-detail{display:flex;flex-direction:column;height:100%;overflow:auto}',
    '.zfm-dhead{display:flex;align-items:flex-start;gap:14px;padding:14px}',
    '.zfm-dcover{width:110px;border-radius:10px;flex:0 0 auto;box-shadow:0 4px 18px rgba(0,0,0,.45)}',
    '.zfm-dtitle{font-size:17px;font-weight:600;color:#f0f0f5;margin-bottom:6px}',
    '.zfm-dsub{font-size:12px;color:#9a9aa8;margin-bottom:10px}',
    '.zfm-chlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;padding:0 14px 14px;align-content:start}',
    '.zfm-chhead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 14px 8px}',
    '.zfm-chcount{font-size:12px;color:#8a8a94}',
    '.zfm-chsort button{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#b8b8c4;font-size:12px;padding:4px 10px;border-radius:14px;cursor:pointer;transition:background .15s,color .15s}',
    '.zfm-chsort button:hover{background:rgba(124,92,255,.25);color:#e8e8f0}',
    '.zfm-ch{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:8px;',
    'padding:6px 9px;font-size:12px;color:#d0d0da;cursor:pointer;overflow:hidden;transition:background .15s,border-color .15s}',
    '.zfm-ch .zfm-chno{font-style:normal;font-size:10px;color:#7a7a86;background:rgba(255,255,255,.08);border-radius:4px;padding:1px 5px;flex:0 0 auto;min-width:20px;text-align:center}',
    '.zfm-ch span,.zfm-ch{white-space:nowrap;text-overflow:ellipsis}',
    '.zfm-ch .zfm-cht{flex:1;min-width:0;overflow:hidden}',
    '.zfm-ch .zfm-chtag{font-style:normal;font-size:10px;color:#5ad1a0;flex:0 0 auto;margin-left:auto}',
    '.zfm-ch:hover{background:rgba(124,92,255,.22);border-color:rgba(124,92,255,.45);color:#ececf4}',
    '.zfm-ch.zfm-cur{background:rgba(90,209,160,.2);border-color:rgba(90,209,160,.55);color:#5ad1a0;box-shadow:0 0 0 1px rgba(90,209,160,.25) inset}',
    '.zfm-ch.zfm-cur .zfm-chno{background:rgba(90,209,160,.3);color:#5ad1a0}',
    /* P1-E 边缘贴靠预览条 */
    '.zf-snap-hint{position:fixed;top:8px;bottom:8px;width:calc(50% - 4px);z-index:9999;',
    'background:rgba(124,92,255,.18);border:2px dashed rgba(124,92,255,.55);border-radius:12px;',
    'pointer-events:none;transition:left .12s;display:none}',
    /* i硬件内容（zf-app-hardware.js） */
    '#zfHardwareWin{width:520px;height:600px}',
    '.hw-wrap{display:flex;flex-direction:column;gap:10px;color:#d8d8e0;font-size:13px}',
    '.hw-info{display:flex;flex-direction:column;gap:10px}',
    '.hw-card{background:rgba(255,255,255,.05);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}',
    '.hw-card>b{font-size:12px;color:#8a8a94;font-weight:600}',
    '.hw-row{display:flex;align-items:center;gap:8px;font-size:12px}',
    '.hw-row span:first-child{flex:0 0 70px;color:#e8e8ee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hw-bar{flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}',
    '.hw-bar i{display:block;height:100%;background:linear-gradient(90deg,#5ad1a0,#ffd479)}',
    '.hw-dim{color:#8a8a94;font-size:11px}',
    '.hw-grade{font-size:20px;font-weight:700;color:#5ad1a0}',
    '.hw-note{font-size:12px;color:#c8c8d2;margin-top:-6px}',
    '.hw-btn{border:none;background:rgba(90,209,160,.2);color:#5ad1a0;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}',
    '.hw-btn:hover{background:rgba(90,209,160,.32)}',
    '.hw-btn-ghost{background:rgba(255,255,255,.08);color:#c8c8d2}',
    '.hw-live-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:2px 0}',
    '.hw-live-row span{flex:0 0 70px}',
    '.hw-live-row b{color:#e8e8ee}',
    '.hw-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999}',
    '.hw-modal{background:#1e1f26;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:16px;max-width:420px;max-height:70vh;overflow:auto}',
    '.hw-modal h4{margin:0 0 10px;font-size:14px;color:#e8e8ee}',
    '.hw-prev{background:rgba(0,0,0,.3);border-radius:8px;padding:8px 10px;margin-bottom:10px}',
    '.hw-prev-item{font-size:11px;color:#c8c8d2;line-height:1.8}',
    '@media (max-width:640px){',
    '  .zf-dock-item{width:40px;height:40px}.zf-dock-item svg,.zf-dock-item span.zf-dock-emoji{width:28px;height:28px;font-size:24px}}'
  ].join('\n');

  /* ---------- 图标 ---------- */
  /* 图标统一为白色线状（fill:none / stroke:#fff），背景透明 */
  var ICON_MORE = '<svg viewBox="1 1 22 22" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round">' +
    '<path d="M7 8.5c-2 0-3.5 1.6-3.5 3.5S5 15.5 7 15.5c1.6 0 2.6-1 3.9-2.6L12 11.6l1.1-1.3C14.4 8.7 15.4 8.5 17 8.5c2 0 3.5 1.6 3.5 3.5S19 15.5 17 15.5c-1.6 0-2.6-1-3.9-2.6L12 11.6l-1.1-1.3C9.6 8.7 8.6 8.5 7 8.5z"/></svg>';

  /* ---------- Dock DOM ---------- */
  var dock, morePanel;
  var els = [];
  var absorbedEls = [];   /* 收编按钮（整理/风筝/科技树/导航/对话）也参与 macOS 波及放大 */

  function buildOnce() {
    if (dock) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    dock = document.createElement('div');
    dock.id = 'zfAppDock';
    document.body.appendChild(dock);
    dock.addEventListener('mousemove', function (e) { if (!dragActive) applyScales(e.clientX); });
    dock.addEventListener('mouseleave', function () { applyScales(null); });

    /* 底部热区：鼠标移入附近显示 Dock；鼠标离开热区且不在 Dock 上时隐藏（带滑入/滑出动画） */
    var hotzone = document.createElement('div');
    hotzone.id = 'zfDockHotzone';
    document.body.appendChild(hotzone);
    /* 【z-index 兜底】statusbar 必须压过透明挂件 iframe（z≈9401），否则其透明区域吞掉按钮点击。
       此处用 JS 内联样式强制提层：即使浏览器缓存了旧 CSS（z=900）也能生效。 */
    try {
      var _sb = document.querySelector('.statusbar');
      if (_sb) _sb.style.zIndex = '9800';   /* 9800 > 挂件 z 上限 9550（两处上限均已统一，见 app-canvas-tree-node.js L314/L416） */
    } catch (e) { }

    /* 【点击兜底转发】statusbar 左侧按钮被任何高 z 层（挂件 iframe/风筝装饰/透明遮罩）盖住时，
       用户点不动且 hover 无提示。此捕获阶段监听在事件到达目标前拦截：
       若点击坐标命中 statusbar 内某按钮矩形、但 elementFromPoint 未命中该按钮，
       视为被遮挡 → 阻止原始事件并直接转发 click 给按钮。 */
    document.addEventListener('click', function (e) {
      try {
        if (e.__zfFwd) return; /* 转发事件直接放行，防递归 */
        var btns = document.querySelectorAll('.statusbar button');
        for (var i = 0; i < btns.length; i++) {
          var r = btns[i].getBoundingClientRect();
          if (r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            var hitEl = document.elementFromPoint(e.clientX, e.clientY);
            if (hitEl && !btns[i].contains(hitEl)) {
              /* 被别的层吃掉了点击：转发给按钮（带标记防递归） */
              e.preventDefault(); e.stopPropagation();
              var fwd = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY });
              fwd.__zfFwd = true;
              btns[i].dispatchEvent(fwd);
            }
            break;
          }
        }
      } catch (err) { }
    }, true);

    hotzone.addEventListener('mouseenter', function () { dock.classList.add('zf-dock-show'); });
    /* 【修复】原来只监听 dock mouseleave，导致鼠标离开热区（但未经过 dock）时 Dock 不消失。
       改为 document 级 mousemove 统一判断：不在热区且不在 Dock 上 → 隐藏。 */
    function dockVisibleCheck(e) {
      var overHot = e.clientY >= window.innerHeight - 32;
      var overDock = dock.contains(e.target);
      if (overHot || overDock) dock.classList.add('zf-dock-show');
      else dock.classList.remove('zf-dock-show');
    }
    document.addEventListener('mousemove', dockVisibleCheck);

    morePanel = document.createElement('div');
    morePanel.id = 'zfDockMorePanel';
    document.body.appendChild(morePanel);
    morePanel.addEventListener('click', function (e) {
      if (e.target === morePanel) morePanel.classList.remove('open');
    });

  }

  function makeItem(app) {
    var b = document.createElement('button');
    b.className = 'zf-dock-item';
    b.innerHTML = app.icon;
    b.dataset.appId = app.id;
    var tip = document.createElement('span');
    tip.className = 'zf-dock-tip';
    tip.textContent = app.name;
    b.appendChild(tip);
    b.addEventListener('click', function () {
      if (suppressClick) return;
      morePanel.classList.remove('open');
      app.onClick && app.onClick();
    });
    enableDrag(b);
    return b;
  }

  /* 拖拽结束后抑制误触发 click */
  var suppressClick = false;

  /* ---------- 图标拖拽排序（v2 动画版）----------
     覆盖两类图标：.zf-dock-item（App 图标）+ 收编进 Dock 的 .zf-dock-btn（整理/风筝/科技树/缩略图/对话）。
     拖拽中图标跟随鼠标浮动（缩放放大+发光），目标位置高亮竖线指示，松手后其他图标平滑让位（FLIP 动画）。
     收编按钮不参与 APPS 排序持久化（顺序由 DOM 决定），仅可拖到任意位置触发其他图标让位+自身落位。 */
  var dragActive = false;   /* 【2026-11-20 闪烁修复】拖拽期间悬停放大与让位预览共用 transform 会互相覆盖 → 抽搐；拖拽中暂停 applyScales */
  function enableDrag(el) {
    var startX, startY, moved, target, ghost = null;
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; moved = false; target = null;
      function clearHint() {
        if (target) target.classList.remove('zf-dock-drop-hint');
      }
      /* 【2026-11-12 需求3】拖拽实时空位预览：其他图标按插入点提前让位（transform 过渡，更顺滑）
         原理：拖起时记录各图标基准中点(baseMap)；mousemove 时按鼠标 x 算出插入序号，
         位于原位与新位之间的图标用 translateX 预先让出一个槽位（宽+gap）。 */
      var PREVIEW_GAP = 18;   /* 与 #zfAppDock 的 gap 保持一致 */
      var baseMap = null, startIdx = 0, slotW = 0;
      function isMovable(c) {
        return c.classList.contains('zf-dock-item') || c.classList.contains('zf-dock-btn');
      }
      function initBase() {
        baseMap = new Map();
        var list = Array.prototype.filter.call(dock.children, isMovable);
        startIdx = list.indexOf(el);
        var er = el.getBoundingClientRect();
        slotW = er.width + PREVIEW_GAP;
        list.forEach(function (c) {
          if (c === el) return;
          var r = c.getBoundingClientRect();
          baseMap.set(c, r.left + r.width / 2);
          c.style.transition = 'transform .2s cubic-bezier(.34,1.3,.64,1)';
        });
      }
      function clearPreview() {
        baseMap = null;
        Array.prototype.forEach.call(dock.children, function (c) {
          if (c !== el && isMovable(c)) { c.style.transform = ''; c.style.transition = ''; }
        });
      }
      function previewGap(ev) {
        if (!baseMap) initBase();
        var sibs = Array.prototype.filter.call(dock.children, function (c) {
          return c !== el && baseMap.has(c);
        });
        var insertIdx = 0;
        sibs.forEach(function (c) { if (ev.clientX > baseMap.get(c)) insertIdx++; });
        sibs.forEach(function (c, selfIdx) {
          var dx = 0;
          if (insertIdx > startIdx && selfIdx >= startIdx && selfIdx < insertIdx) dx = -slotW;
          else if (insertIdx < startIdx && selfIdx >= insertIdx && selfIdx < startIdx) dx = slotW;
          c.style.transform = dx ? 'translateX(' + dx + 'px)' : '';
        });
      }
      /* FLIP：记录 dock 内所有可动图标当前位置，DOM 变更后加 transform 过渡回原位 */
      function flipSiblings(exclude) {
        var items = Array.prototype.filter.call(dock.children, function (c) {
          return c !== exclude && (c.classList.contains('zf-dock-item') || c.classList.contains('zf-dock-btn'));
        });
        var first = new Map();
        items.forEach(function (c) { var r = c.getBoundingClientRect(); first.set(c, r.left); });
        return {
          items: items,
          play: function () {
            items.forEach(function (c) {
              var now = c.getBoundingClientRect().left;
              var dx = first.get(c) - now;
              if (Math.abs(dx) < 1) return;
              c.style.transition = 'none';
              c.style.transform = 'translateX(' + dx + 'px)';
              /* 强制 reflow 后开启动画回弹 */
              void c.offsetWidth;
              c.style.transition = 'transform .28s cubic-bezier(.34,1.3,.64,1)';
              c.style.transform = '';
              setTimeout(function () { c.style.transition = ''; }, 300);
            });
          }
        };
      }
      function ensureGhost(ev) {
        if (ghost) return;
        var r = el.getBoundingClientRect();
        ghost = document.createElement('div');
        ghost.className = 'zf-dock-drag-ghost';
        ghost.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;width:' + r.width + 'px;height:' + r.height + 'px;left:' + r.left + 'px;top:' + r.top + 'px;transform:scale(1.25);transition:transform .18s cubic-bezier(.34,1.56,.64,1);filter:drop-shadow(0 6px 16px rgba(0,0,0,.55));display:flex;align-items:center;justify-content:center;will-change:left,top;';
        ghost.innerHTML = el.querySelector('svg,img,span.zf-dock-emoji') ? (el.querySelector('svg,img,span.zf-dock-emoji').outerHTML) : '';
        var svg = ghost.querySelector('svg,img,span.zf-dock-emoji');
        if (svg) { svg.style.width = '34px'; svg.style.height = '34px'; svg.style.transform = 'none'; svg.style.filter = 'none'; }
        document.body.appendChild(ghost);
        el.style.opacity = '0.35';  /* 原位半透明占位 */
      }
      function moveGhost(ev) {
        if (!ghost) return;
        /* 【顺滑优化】缓存尺寸，避免每帧强制布局；hover 尺寸可能变化，仅拖起首帧取一次 */
        if (moveGhost._w == null) {
          var r0 = el.getBoundingClientRect();
          moveGhost._w = r0.width; moveGhost._h = r0.height;
        }
        ghost.style.left = (ev.clientX - moveGhost._w / 2) + 'px';
        ghost.style.top = (ev.clientY - moveGhost._h - 14) + 'px';   /* 悬浮在鼠标上方，仿 macOS */
      }
      var hoverTimer = null;
      function clearHoverTimer() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } }
      function onMove(ev) {
        if (!moved && Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 6) return;
        if (!moved) { moved = true; ensureGhost(ev); el.classList.add('zf-dock-dragging'); dragActive = true; }
        moveGhost(ev);
        /* 【2026-11-20 需求3】桌面图标 → i无限面板：悬停「∞」按钮 400ms 自动打开面板（实时动画预演落点） */
        var overInfinite = el.dataset && el.dataset.appId && target && target.id === 'zfDockOverflowBtn';
        if (overInfinite && !morePanel.classList.contains('open')) {
          if (!hoverTimer) hoverTimer = setTimeout(function () {
            var ob = document.getElementById('zfDockOverflowBtn');
            if (ob && moved) { ob.click(); morePanel.classList.add('zf-panel-in-hint'); }
            hoverTimer = null;
          }, 400);
        } else { clearHoverTimer(); }
        /* 【2026-11-14 跨拖】拖到已打开的 i无限面板上 = 收进面板：面板描边高亮提示可放 */
        var overPanel = morePanel.classList.contains('open') &&
          (function () { var r = morePanel.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; })();
        morePanel.classList.toggle('zf-panel-in-hint', overPanel && el.dataset && el.dataset.appId);
        if (overPanel) { clearHint(); clearPreview(); return; }
        var t = document.elementFromPoint(ev.clientX, ev.clientY);
        var item = t && t.closest ? t.closest('.zf-dock-item[data-app-id],#zfAppDock > .zf-dock-btn') : null;
        if (item !== target) {
          clearHint();
          target = (item && item !== el) ? item : null;
          if (target) target.classList.add('zf-dock-drop-hint');
        }
        /* 【2026-11-12 需求3】实时空位预览：拖过谁旁边，谁就让位出空隙 */
        previewGap(ev);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        clearHoverTimer();   /* 【需求3】清掉悬停开面板定时器 */
        el.classList.remove('zf-dock-dragging');
        dragActive = false;   /* 【闪烁修复】恢复悬停放大 */
        Array.prototype.forEach.call(dock.children, function (c) { if (isMovable(c)) c.style.transform = ''; });
        if (ghost) { ghost.remove(); ghost = null; }
        el.style.opacity = '';
        clearHint();
        clearPreview();   /* 清掉预览位移，落位交由 FLIP/重渲染 */
        /* 【2026-11-14 跨拖】拖到已打开的 i无限面板上 = 收进面板（隐藏进面板 + 刷新面板网格） */
        morePanel.classList.remove('zf-panel-in-hint');
        if (moved && morePanel.classList.contains('open') && el.dataset && el.dataset.appId) {
          var r = morePanel.getBoundingClientRect();
          if (arguments.length && arguments[0]) {
            var up = arguments[0];
            if (up.clientX >= r.left && up.clientX <= r.right && up.clientY >= r.top && up.clientY <= r.bottom) {
              hideApp(el.dataset.appId);
              suppressClick = true;
              setTimeout(function () { suppressClick = false; }, 0);
              var extraNow = APPS.filter(function (a) { return visibleApps().indexOf(a) < 0; });
              buildOverflowPanel(extraNow, true);   /* 面板开着 → 实时刷新网格让新图标出现（免弹入动画防闪动） */
              renderDock();
              return;
            }
          }
        }
        /* 【2026-11-12 需求4】拖到「无限 ∞」图标上 = 隐藏进面板 */
        if (moved && target && target.id === 'zfDockOverflowBtn' && el.dataset && el.dataset.appId) {
          hideApp(el.dataset.appId);
          suppressClick = true;
          setTimeout(function () { suppressClick = false; }, 0);
          renderDock();
          return;
        }
        if (moved && target) {
          var isApp = el.dataset && el.dataset.appId;
          var tgtIsApp = target.dataset && target.dataset.appId;
          if (isApp && tgtIsApp) {
            /* App 图标 ↔ App 图标：注册表排序 + 持久化 */
            var from = APPS.findIndex(function (a) { return a.id === el.dataset.appId; });
            var to = APPS.findIndex(function (a) { return a.id === target.dataset.appId; });
            if (from >= 0 && to >= 0 && from !== to) {
              var flip = flipSiblings(el);
              var m = APPS.splice(from, 1)[0];
              /* 【边界修复】先删后插时，from<to 需 to-1 修正（否则拖到末位/靠后位置错一格） */
              if (from < to) to -= 1;
              APPS.splice(to, 0, m);
              saveOrder();
              renderDock();
              flip.play();
            }
          } else if (isApp && !tgtIsApp) {
            /* 【边界修复】App 图标拖到 Dock 首位/末位空白处（无 target 或目标为非 App 元素）：
               按鼠标 x 计算落在收编按钮序列中的插入点，DOM 级插入 + FLIP，不再静默失败 */
            var flip3 = flipSiblings(el);
            var ref2 = target;
            if (ref2) {
              var rect2 = ref2.getBoundingClientRect();
              var after2 = el.getBoundingClientRect();
              var before = after2.left < rect2.left;
              dock.insertBefore(el, before ? ref2 : ref2.nextSibling);
            } else {
              /* 无具体目标：按鼠标 x 与各可动图标中点比较，决定插到最前还是最后 */
              var mouseL = el.getBoundingClientRect().left;
              var sibs = Array.prototype.filter.call(dock.children, function (c) {
                return c !== el && (c.classList.contains('zf-dock-item') || c.classList.contains('zf-dock-btn'));
              });
              if (!sibs.length) dock.appendChild(el);
              else {
                var mids = sibs.map(function (c) { return c.getBoundingClientRect().left + c.offsetWidth / 2; });
                if (mouseL < Math.min.apply(null, mids)) dock.insertBefore(el, sibs[0]);
                else dock.insertBefore(el, sibs[sibs.length - 1].nextSibling);
              }
            }
            flip3.play();
          } else {
            /* 通用（含收编按钮）：DOM 级顺序调整 + FLIP 让位动画 */
            var flip2 = flipSiblings(el);
            var ref = target;
            var rect = ref.getBoundingClientRect();
            var after = el.getBoundingClientRect();
            var insertBefore = after.left < rect.left;   /* 向左拖 → 插到目标前；向右拖 → 插到目标后 */
            dock.insertBefore(el, insertBefore ? ref : ref.nextSibling);
            flip2.play();
          }
        }
        if (moved) {
          suppressClick = true;
          setTimeout(function () { suppressClick = false; }, 0);
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();   /* 防止拖拽时选中文字/触发原生拖放 */
    });
  }

  function renderDock() {
    buildOnce();
    /* 【保留收编按钮】只移除 App 图标项（.zf-dock-item），保留 absorbFloatButtons 搬进来的
       底部浮动按钮（整理模式/风筝/科技树/导航缩略图/对话/更多），否则第一次 register 就被清空 */
    Array.prototype.slice.call(dock.children).forEach(function (c) {
      if (c.classList && c.classList.contains('zf-dock-item')) dock.removeChild(c);
    });
    els = [];
    /* 【2026-12 修复】Dock 直接渲染桌面区固定名单 deskApps()（拖走减员不补位），
       不再 visibleApps().slice(0,10) 动态补位——否则 i无限面板拖走后 Dock 又自动补回10个 */
    var desk = deskApps();
    var deskIds = desk.map(function (a) { return a.id; });
    var vis = desk;
    var extra = APPS.filter(function (a) { return deskIds.indexOf(a.id) < 0; });
    vis.forEach(function (app) {
      var b = makeItem(app);
      dock.appendChild(b);
      els.push({ el: b });
    });
    /* 【2026-11-12 需求3+4】末尾「无限 ∞」图标常驻：装所有 i程序（含隐藏的）+ 原溢出栏目项。
       默认只显示 HIDDEN_KEY 之外的前 MAX_VISIBLE(=10) 个，其余收纳进面板；
       用户拖拽 App 图标到「无限」图标上 = 隐藏进面板，从面板拖出(实现见 onUp) = 显示回 Dock。 */
    var overflowBtn = document.createElement('button');
    overflowBtn.className = 'zf-dock-item';
    overflowBtn.innerHTML = ICON_MORE;
    overflowBtn.id = 'zfDockOverflowBtn';
    overflowBtn.dataset.appId = '__overflow__';   /* 作为拖拽目标识别 */
    var tipO = document.createElement('span');
    tipO.className = 'zf-dock-tip';
    tipO.textContent = 'i无限';
    overflowBtn.appendChild(tipO);
    overflowBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      buildOverflowPanel(extra);
      morePanel.classList.toggle('open');
      /* 【2026-11-17 位置记忆修复】只在无位置存档时才按 Dock 图标定位；
         有存档时 buildOverflowPanel 末尾的 applyPanelGeom 已恢复位置，不得覆盖 */
      if (morePanel.classList.contains('open') && !loadPanelGeom()) {
        var r = overflowBtn.getBoundingClientRect();
        morePanel.style.left = Math.min(window.innerWidth - 20, Math.max(20,
          r.left + r.width / 2 - morePanel.offsetWidth / 2)) + 'px';
      }
    });
    dock.appendChild(overflowBtn);
    els.push({ el: overflowBtn });
    /* 原「更多」栏目项已并入 buildOverflowPanel（与隐藏的 i程序 同一面板） */
    /* 【收编底部浮动按钮】放在 renderDock 末尾：此时 dock 已由 buildOnce 创建。
       absorbFloatButtons 有 dataset.absorbed 防重入；且上方清理只删 .zf-dock-item，
       不会误删收编进来的底部按钮。 */
    absorbFloatButtons();
    applyScales(null);
  }

  /* 【2026-11-16】启动时从 server 回填 i桌面状态（清缓存/换浏览器后不丢图标顺序）
     注意：须等 DOM 就绪后调用（renderDock 内部 buildOnce 依赖 #zfDock 容器）。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _restoreDockState);
  } else {
    _restoreDockState();
  }

  /* macOS 波及放大：以鼠标 x 为中心，距离越近放大越大 */
  function applyScales(mx) {
    var all = els.concat(absorbedEls);
    all.forEach(function (o) {
      if (!o.el || !o.el.isConnected) return;
      var s = 1;
      if (mx != null) {
        var r = o.el.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var d = Math.abs(mx - cx);
        var range = 110;
        if (d < range) s = 1 + 0.55 * Math.cos((d / range) * Math.PI / 2);
      }
      o.el.style.transform = 'scale(' + s.toFixed(3) + ')';
    });
  }

  document.addEventListener('click', function (e) {
    if (panelBusy) return;   /* 拖拽/缩放面板期间补发的 click 不收起面板 */
    if (morePanel && !morePanel.contains(e.target)) morePanel.classList.remove('open');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      morePanel && morePanel.classList.remove('open');
      /* Esc 统一关闭所有已打开的 App 窗口（i漫画/i聊天/i硬件） */
      document.querySelectorAll('.zf-appwin.open').forEach(function (win) {
        /* 【T1-R1-2 第二波】开窗函数已随插件迁出，Esc 关窗改经 ZFDock 契约读取（插件启用时回挂） */
        if (win.id === 'zfMangaWin') { if (window.ZFDock && window.ZFDock.closeManga) window.ZFDock.closeManga(); return; }
        if (win.id === 'zfCalcWin') { if (window.ZFDock && window.ZFDock.closeCalc) window.ZFDock.closeCalc(); return; }
        var btn = win.querySelector('[data-act="close"]');
        if (btn) btn.click();
      });
    }
  });

  /* 最小化窗口被再次打开时自动清除 zf-min 标记（统一观测，覆盖所有 App 窗口） */
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      var w = m.target;
      if (w.classList.contains('open') && w.classList.contains('zf-min')) {
        w.classList.remove('zf-min');
        if (w.dataset.zfFs === '1') {   /* 最小化前是最大化态：恢复最大化 */
          var fb = w.querySelector('[data-act="fs"]');
          if (fb && fb.innerHTML !== '') { w.dataset.zfFs = ''; fb.click(); }
        }
      }
    });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

  /* 头部拖拽移动窗口（带边界约束 + 位置/尺寸记忆，按当前对话分开记，无对话回退全局） */
  var WIN_POS_KEY = 'zfAppWinPos';
  /* App js 动态挂载缓存号：优先取 server 注入的 ZF_ASSET_VER 映射（mtime，内容变自动失效），
     未注入（如本地直开/旧缓存）回退固定 'zfd6' 命中缓存，绝不回退 Date.now() 击穿缓存 */
  var ZF_FALLBACK_VER = 'zfd13';
  function zfVerSrc(path) {
    try {
      var m = window.ZF_ASSET_VER && window.ZF_ASSET_VER[path.split('/').pop()];
      return path + '?v=' + (m || ZF_FALLBACK_VER);
    } catch (e) { return path + '?v=' + ZF_FALLBACK_VER; }
  }
  /* 【轻App秒开】空闲预取：把轻量 App 的 js 提前拉进浏览器缓存，点击时命中缓存秒开 */
  function prefetchAppJs(paths) {
    function go() {
      paths.forEach(function (p2) {
        try {
          var l = document.createElement('link');
          l.rel = 'prefetch'; l.as = 'script'; l.href = zfVerSrc(p2);
          document.head.appendChild(l);
        } catch (e) {}
      });
    }
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 5000 });
    else setTimeout(go, 3000);
  }
  function winScopeId() {
    try {
      var cid = (window.Tools && Tools.currentChatId) || '';
      return cid ? WIN_POS_KEY + ':' + cid : WIN_POS_KEY;   /* 每个对话框独立一份位置记忆 */
    } catch (e) { return WIN_POS_KEY; }
  }
  function loadWinPos(id) {
    /* 优先读当前对话的记忆，读不到回退全局旧记忆（兼容升级前数据） */
    try {
      var scoped = JSON.parse(localStorage.getItem(winScopeId()) || '{}')[id];
      if (scoped) return scoped;
      return JSON.parse(localStorage.getItem(WIN_POS_KEY) || '{}')[id] || null;
    } catch (e) { return null; }
  }
  function saveWinPos(win) {
    if (win.dataset.zfFs === '1' || win.classList.contains('zfm-full')) return;   // 全屏状态不记（含 i漫画 zfm-full，防把 100vw/vh 存进记忆）
    try {
      var all = JSON.parse(localStorage.getItem(winScopeId()) || '{}');
      var gl = parseInt(win.style.left); var gt = parseInt(win.style.top);
      var gw = parseInt(win.style.width); var gh = parseInt(win.style.height);
      all[win.id] = { l: isNaN(gl) ? null : gl, t: isNaN(gt) ? null : gt,
                      w: isNaN(gw) ? null : gw, h: isNaN(gh) ? null : gh };
      localStorage.setItem(winScopeId(), JSON.stringify(all));
      /* 同步写全局 key：换对话/重启后新对话作用域无记忆时，loadWinPos 回退全局仍能恢复位置尺寸
         （否则每个新对话都是独立 key，用户感知为"窗口大小不记忆、重启丢失"） */
      localStorage.setItem(WIN_POS_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function clampPos(win, l, t) {
    var r = win.getBoundingClientRect();
    /* display:none（窗口未 open）时 rect 为 0×0，回退 CSS 默认尺寸参与边界约束 */
    var fw = r.width || 860, fh = r.height || 600;
    /* v3 修复：窗口整体夹紧到视口内（完整可见），不再只留 60px 头部——
       旧逻辑允许 top 停在屏幕最底端，整个窗口+关闭按钮被推出屏幕外 */
    var maxL = Math.max(8, window.innerWidth - fw);
    var maxT = Math.max(8, window.innerHeight - fh);
    l = Math.max(8, Math.min(l, maxL));
    t = Math.max(8, Math.min(t, maxT));
    return [l, t];
  }
  function applyWinPos(win) {
    var p = loadWinPos(win.id);
    if (!p) return;
    /* P1 修复 v2：恢复记忆尺寸时，超过视口 95% 视为历史脏数据（全屏态误存），直接丢弃回退 CSS 默认尺寸，
       仅 clamp 到 95% 不够——存的是全屏尺寸时 clamp 后仍铺满界面 */
    var vw = window.innerWidth, vh = window.innerHeight;
    if (p.w && p.h && p.w <= vw * 0.95 && p.h <= vh * 0.95) {
      win.style.width = p.w + 'px'; win.style.height = p.h + 'px';
    }
    if (p.l != null && p.t != null) {
      var c = clampPos(win, p.l, p.t);
      win.style.transform = 'none';
      win.style.left = c[0] + 'px'; win.style.top = c[1] + 'px';
    }
  }
  function dragWindow(win, handle) {
    var sx, sy, ol, ot, dragging = false, snapHint = null;
    /* 浏览器整体窗口最大化/还原修复：视口尺寸变化时重新夹紧所有已开窗口位置，
       否则像素记忆坐标在新视口下越界（跑出屏幕外→用户感知为"位置全丢"） */
    window.addEventListener('resize', function () {
      document.querySelectorAll('.zf-appwin.open').forEach(function (win) {
        if (win.dataset.zfFs === '1' || win.classList.contains('zfm-full')) return;  /* 全屏态铺满视口，无需夹紧 */
        var l = parseInt(win.style.left), t = parseInt(win.style.top);
        if (isNaN(l) || isNaN(t)) return;  /* 未拖动过的 CSS 居中窗口自适应视口，不动 */
        var c = clampPos(win, l, t);
        win.style.left = c[0] + 'px';
        win.style.top = c[1] + 'px';
        saveWinPos(win);
      });
      if (window.ZFManga && window.ZFManga.onResize) window.ZFManga.onResize();
    });
    /* P1-E 边缘贴靠：拖至视口左/右缘 24px 内显示半屏预览，松手吸附 */
    function showSnap(side) {
      if (!snapHint) {
        snapHint = document.createElement('div');
        snapHint.className = 'zf-snap-hint';
        document.body.appendChild(snapHint);
      }
      snapHint.style.display = 'block';
      snapHint.style.left = side === 'left' ? '8px' : 'calc(50% - 4px)';
    }
    function hideSnap() { if (snapHint) snapHint.style.display = 'none'; }
    function snapApply() {
      var vw = window.innerWidth, vh = window.innerHeight;
      var r = win.getBoundingClientRect();
      win.style.width = (vw / 2 - 12) + 'px';
      win.style.height = (vh - 20) + 'px';
      win.style.left = (snapHint.dataset.side === 'left' ? 8 : vw / 2 + 4) + 'px';
      win.style.top = '10px';
      if (window.ZFManga && window.ZFManga.onResize) window.ZFManga.onResize();
    }
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      dragging = true;
      var r = win.getBoundingClientRect();
      win.style.transform = 'none';
      win.style.left = r.left + 'px';
      win.style.top = r.top + 'px';
      win.style.transition = 'none';
      sx = e.clientX; sy = e.clientY; ol = r.left; ot = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var c = clampPos(win, ol + e.clientX - sx, ot + e.clientY - sy);
      win.style.left = c[0] + 'px';
      win.style.top = c[1] + 'px';
      var EDGE = 24;
      if (e.clientX <= EDGE) { snapHint || showSnap('left'); snapHint.dataset.side = 'left'; showSnap('left'); }
      else if (e.clientX >= window.innerWidth - EDGE) { snapHint || showSnap('right'); snapHint.dataset.side = 'right'; showSnap('right'); }
      else hideSnap();
    });
    document.addEventListener('mouseup', function () {
      if (dragging) {
        dragging = false;
        if (snapHint && snapHint.style.display === 'block') { hideSnap(); snapApply(); }
        saveWinPos(win);
      }
    });
  }

  /* ---------- App 窗口工厂：i漫画 / i聊天 共用构建逻辑 ---------- */
  // opts: {id, title, icon, bodyHtml, onClose(win)}（右上角固定为 最大化/还原+关闭 两个线形按钮）
  function createAppWindow(opts) {
    var w = document.createElement('div');
    w.id = opts.id;
    /* AI 感知埋点：开窗即上报（app 取 opts.app 或窗 id），只存App名+标题，无进度细节 */
    try {
      fetch('/api/iapp/event', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: opts.app || (opts.id || '').replace(/^zf/, '').replace(/Win$/, ''), action: 'open', title: opts.title || '' })
      }).catch(function () {});
    } catch (e) {}
    w.className = 'zf-appwin';   /* v4：通用定位/层级/显隐基类（见 CSS 顶部说明） */
    /* 线性 SVG 按钮（右上角固定三枚：最小化 + 最大化/还原 + 关闭，全部线形绘制无图标图片） */
    var ICO_MIN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    var ICO_MAX = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
    var ICO_RESTORE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/></svg>';
    var ICO_CLOSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    var btns = '';
    btns += '<button class="zf-appwin-btn" data-act="min" title="最小化">' + ICO_MIN + '</button>';
    btns += '<button class="zf-appwin-btn" data-act="fs" title="最大化/还原">' + ICO_MAX + '</button>';
    btns += '<button class="zf-appwin-btn" data-act="close" title="关闭">' + ICO_CLOSE + '</button>';
    w.innerHTML =
      '<div class="zf-appwin-head">' +
      '  <h3>' + opts.icon + '<span>' + opts.title + '</span></h3>' + btns +
      '</div>' + opts.bodyHtml;
    var fsBtn = w.querySelector('[data-act="fs"]');
    var minBtn = w.querySelector('[data-act="min"]');
    if (minBtn) minBtn.addEventListener('click', function () {
      /* 最小化：隐藏窗口（不销毁），记忆最小化前的位置；从 Dock 再次打开即还原 */
      if (w.dataset.zfFs === '1') {
        var fsB = w.querySelector('[data-act="fs"]');
        if (fsB) fsB.click();   /* 最大化状态下先还原，再最小化（记住还原后位置） */
      }
      saveWinPos(w);
      w.classList.remove('open');
      w.classList.add('zf-min');
      if (window.ZFManga && window.ZFManga.onClose && w.id === 'zfMangaWin') window.ZFManga.onClose();
    });
    if (fsBtn) fsBtn.addEventListener('click', function () {
      /* 最大化/还原：铺满视口（非原生全屏），还原回记忆尺寸 */
      var maxed = w.dataset.zfFs === '1';
      if (!maxed) {
        if (!w.dataset.zfPrev) {
          var r = w.getBoundingClientRect();
          w.dataset.zfPrev = JSON.stringify({ l: parseInt(w.style.left) || r.left, t: parseInt(w.style.top) || r.top, w: r.width, h: r.height });
        }
        w.style.transform = 'none';
        w.style.left = '14px'; w.style.top = '14px';
        w.style.width = 'calc(100% - 28px)'; w.style.height = 'calc(100% - 28px)';
        w.style.maxWidth = 'calc(100% - 28px)'; w.style.maxHeight = 'calc(100% - 28px)';
        w.style.borderRadius = '8px';
        w.dataset.zfFs = '1'; fsBtn.innerHTML = ICO_RESTORE;
      } else {
        var p = {};
        try { p = JSON.parse(w.dataset.zfPrev || '{}'); } catch (e) {}
        w.dataset.zfFs = '';
        if (p.w && p.l != null && p.t != null) {
          /* 有完整记忆位置：用像素坐标定位，transform 保持 none */
          w.style.width = p.w + 'px'; w.style.height = p.h + 'px';
          w.style.left = p.l + 'px'; w.style.top = p.t + 'px';
        } else {
          /* 无有效记忆位置：清空内联样式，回归 CSS 居中 transform */
          w.style.cssText = w.style.cssText.replace(/[;]?(transform|left|top|width|maxWidth|maxHeight):[^;]*/g, '');
          w.style.transform = ''; w.style.left = ''; w.style.top = '';
          w.style.width = ''; w.style.height = '';
          w.style.maxWidth = ''; w.style.maxHeight = '';
        }
        w.style.borderRadius = '';
        fsBtn.innerHTML = ICO_MAX;
      }
      if (window.ZFManga && window.ZFManga.onResize) window.ZFManga.onResize();
    });
    /* F11 键切换全屏（v1.1 第4条）：挂 document；用 activeWin 记录最近操作的窗口，
       焦点在窗口外（画布/其他面板/无聚焦元素）时也能对最近窗口生效 */
    if (!createAppWindow._f11Bound) {
      createAppWindow._f11Bound = true;
      createAppWindow.activeWin = null;
      document.addEventListener('pointerdown', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('.zf-appwin') : null;
        if (t) createAppWindow.activeWin = t;
      }, true);
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'F11') return;
        var win = e.target && e.target.closest ? e.target.closest('.zf-appwin') : null;
        if (!win) win = createAppWindow.activeWin && createAppWindow.activeWin.classList.contains('open') ? createAppWindow.activeWin : null;
        if (!win) return;
        var btn = win.querySelector('[data-act="fs"]');
        if (btn) { e.preventDefault(); btn.click(); }
      });
    }
    var closeBtn = w.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      if (opts.onClose) opts.onClose(w); else w.classList.remove('open');
    });
    var head = w.querySelector('.zf-appwin-head');
    if (head) dragWindow(w, head);
    resizeWindow(w);   /* P2 用户需求：窗口边缘/右下角拖拽调宽高（i漫画等 App 窗口通用） */
    applyWinPos(w);
    /* （右上角仅保留 最大化/还原 + 关闭 两个按钮，停靠按钮已按需求移除） */
    return w;
  }

  /* P2 窗口尺寸拖拽：右缘调宽 / 下缘调高 / 右下角双向；尺寸并入 winPos 记忆；全屏/最大化态禁用 */
  function resizeWindow(win) {
    ['e', 's', 'se'].forEach(function (dir) {
      var h = document.createElement('div');
      h.className = 'zf-rz zf-rz-' + dir;
      h.dataset.dir = dir;
      win.appendChild(h);
      var sx, sy, ow, oh, on = false;
      h.addEventListener('mousedown', function (e) {
        if (win.dataset.zfFs === '1' || win.classList.contains('zfm-full')) return;
        on = true;
        var r = win.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ow = r.width; oh = r.height;
        win.style.transform = 'none';
        if (!win.style.left) { win.style.left = r.left + 'px'; win.style.top = r.top + 'px'; }
        e.preventDefault(); e.stopPropagation();
      });
      document.addEventListener('mousemove', function (e) {
        if (!on) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        var dir = h.dataset.dir;
        var minW = 360, minH = 240;
        var vw = window.innerWidth, vh = window.innerHeight;
        var left = parseInt(win.style.left) || 0, top = parseInt(win.style.top) || 0;
        if (dir.indexOf('e') >= 0) win.style.width = Math.max(minW, Math.min(vw - left - 8, ow + dx)) + 'px';
        if (dir.indexOf('s') >= 0) win.style.height = Math.max(minH, Math.min(vh - top - 8, oh + dy)) + 'px';
    });
      document.addEventListener('mouseup', function () {
        if (on) { on = false; saveWinPos(win); if (window.ZFManga && window.ZFManga.onResize) window.ZFManga.onResize(); }
      });
    });
  }

  function ztEsc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); }
  function ztXpOf(card) { var m = (card || '').match(/经验值[：:]\s*(\d+)/); return m ? +m[1] : 0; }
  function ztRenderRanks(states) {
    var el = document.getElementById('ztRk');
    if (!el) return;
    var list = (states || []).map(function (s) {
      return { name: ((s.match(/状态卡 · (.+)/) || [])[1]) || '?', xp: ztXpOf(s) };
    }).sort(function (a, b) { return b.xp - a.xp; }).slice(0, 10);
    el.innerHTML = list.map(function (r, i) {
      return '<div class="zt-rk">' + (i + 1) + '. ' + ztEsc(r.name) + ' — XP ' + r.xp + '</div>';
    }).join('') || '<div class="zt-rk">（暂无村民）</div>';
  }
  var ZT_KIND_CN = { claim: '认领任务', done: '完成汇报', chat: '发言', memory: '写记忆', closed: '收工', dispatch: '派单', system: '系统', roundtable: '圆桌', roundtable_conclusion: '圆桌结论', realm_up: '境界突破' };
  function ztRenderChats(msgs) {
    var el = document.getElementById('ztChats');
    if (!el) return;
    var list = (msgs || []).slice(-30).reverse();
    el.innerHTML = list.map(function (m, i) {
      var k = m.kind || 'chat';
      return '<div class="zt-ev"><b style="color:#ffcd75">' + ztEsc(m.from) + '</b> <span style="color:#8ab4f8;font-size:10px">[' + ztEsc(ZT_KIND_CN[k] || k) + ']</span>' +
        ' <a href="javascript:void(0)" data-ztcopy="' + i + '" style="color:#8ab4f8;font-size:10px;text-decoration:none;cursor:pointer;margin-left:4px" title="复制这句话">📋复制</a><br>' + ztEsc(m.text) + '</div>';
    }).join('') || '<div class="zt-ev">（还没有聊天·点上方「💬 一键互聊」让村民开聊）</div>';
    /* 复制按钮：按索引取原文复制（不经过转义，保留原文本） */
    el.querySelectorAll('[data-ztcopy]').forEach(function (a) {
      a.onclick = function (ev) {
        ev.stopPropagation();
        var m = list[parseInt(a.getAttribute('data-ztcopy'), 10)];
        var txt = (m ? (ztEsc(m.from) === m.from ? m.from + '：' + (m.text || '') : m.from + '：' + (m.text || '')) : '');
        txt = (m ? (m.from || '?') + '：' + (m.text || '') : '');
        var done = function () {
          var old = a.textContent; a.textContent = '✅已复制';
          setTimeout(function () { a.textContent = old; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(function () { _ztCopyFallback(txt); done(); });
        } else { _ztCopyFallback(txt); done(); }
      };
    });
  }
  function _ztCopyFallback(txt) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) {}
  }
  function ztSocial(btn) {
    var res = document.getElementById('ztRes');
    if (btn) { btn.disabled = true; btn.textContent = '互聊中…'; }
    if (res) { res.style.display = 'block'; res.textContent = '互聊中…（村民正在对话，约几秒）'; }
    fetch('/api/town/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rounds: 3 }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (btn) { btn.disabled = false; btn.textContent = '💬 一键互聊'; }
        if (!j.ok) { if (res) res.textContent = '失败：' + (j.err || '?'); return; }
        var dlg = (j.dialogue || []).map(function (d) { return d.from + '：' + d.text; }).join('\n');
        if (res) res.textContent = '💬 ' + (j.a || '?') + ' 与 ' + (j.b || '?') + ' 互聊完成（' + (j.dialogue || []).length + '句，下方聊天室可见）\n' + dlg;
        ztRefresh();
      }).catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = '💬 一键互聊'; }
        if (res) res.textContent = '请求失败：' + e;
      });
  }
  function ztRoundtable(btn) {
    var res = document.getElementById('ztRes');
    if (btn) { btn.disabled = true; btn.textContent = '圆桌中…'; }
    if (res) { res.style.display = 'block'; res.textContent = '圆桌进行中…（村民正在讨论主项目议题）'; }
    fetch('/api/town/roundtable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (btn) { btn.disabled = false; btn.textContent = '🍵 能力圆桌'; }
        if (!j.ok) { if (res) res.textContent = '失败：' + (j.err || '?'); return; }
        var sp = (j.speeches || []).map(function (s) { return s.from + '：' + s.text; }).join('\n');
        if (res) res.textContent = '🍵 圆桌完成·议题：' + (j.topic || '(默认)') + '\n结论已落成果展廊与调查黑板\n' + sp;
        ztRefresh();
      }).catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = '🍵 能力圆桌'; }
        if (res) res.textContent = '请求失败：' + e;
      });
  }
  function ztRefresh() {
    fetch('/api/town/state').then(function (r) { return r.json(); }).then(function (s) { if (s.ok) ztRenderRanks(s.states); }).catch(function () {});
    fetch('/api/town/events').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      var st = document.getElementById('ztSt'), cnt = document.getElementById('ztCnt'), evs = document.getElementById('ztEvs');
      if (!st || !cnt || !evs) return;
      st.textContent = '在线';
      cnt.textContent = j.events.length;
      evs.innerHTML = j.events.slice(-50).reverse().map(function (e) {
        var p = e.payload || {};
        var who = p.role || p.window_id || p.crew_id || '';
        return '<div class="zt-ev">' + ztEsc((e.ts || '').slice(11, 19)) + ' [' + ztEsc(e.type || '?') + '] ' + ztEsc(who) + '</div>';
      }).join('') || '<div class="zt-ev">（暂无事件·等待派单）</div>';
      var has = j.events.length > 0;
      var blds = document.querySelectorAll('#zfTownBody .zt-bld');
      blds.forEach(function (b, i) { b.classList.toggle('off', !has || i > 0); });
    }).catch(function () {
      var st = document.getElementById('ztSt');
      if (st) st.textContent = '离线（后台未启动）';
    });
    fetch('/api/town/chat').then(function (r) { return r.json(); }).then(function (j) { if (j.ok) ztRenderChats(j.messages || []); }).catch(function () {});
  }


  /* ---------- i进化窗口：内嵌 canvas/i进化三抽 iframe（2026-11-17 改为面板内窗口，不再开独立网页） ---------- */
  var ICON_EVOLVE3 = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17M8 5.5v4M16 5.5v4"/></svg>';
  var evolve3Win = null;
  function openEvolve3() {
    if (!evolve3Win) {
      evolve3Win = createAppWindow({
        id: 'zfEvolve3Win',
        title: 'i进化',
        icon: ICON_EVOLVE3,
        bodyHtml:
          '<div style="flex:1;overflow:hidden;">' +
          '  <iframe src="/canvas/i进化三抽/index.html?v=2" style="width:100%;height:100%;border:none;display:block;"></iframe>' +
          '</div>'
      });
      document.body.appendChild(evolve3Win);
    }
    evolve3Win.classList.add('open');
  }
  function closeEvolve3() {
    evolve3Win && evolve3Win.classList.remove('open');
  }


  /* ---------- 吸收底部浮动按钮进 Dock（整理模式/风筝/科技树/缩略图/对话/更多） ----------
     2026-11-10 用户要求：把左下 #zfLeftFloat（整理模式/风筝/科技树）与右下
     .tp-fab-group（缩略图/对话/更多）的按钮全部搬进 Dock 图标一排，底部不再留浮动栏。
     直接移动 DOM 节点（preserve 已绑事件监听），不重建按钮。 */
  function absorbFloatButtons() {
    var dockEl = dock;
    if (!dockEl || dockEl.dataset.absorbed) return;
    /* 【时序兜底】右下角 dom-fab 按钮可能已整体撤下（2026-11-16 dom-fab.js 移除「对话/导航地图」），
       故守卫改为：左下三按钮与右下按钮【全部】找不到才重试（最多 40 次=10 秒）。
       旧写法只看右下角 → 右下撤下后守卫永不满足 → 左下 #zfLeftFloat 三按钮收编失败残留屏幕。 */
    if (!document.getElementById('organizeDockBtn') && !document.getElementById('kiteToggleBtn') && !document.getElementById('emergeTreeBtn')
        && !document.getElementById('minimapToggleBtn') && !document.getElementById('chatStatusBtn') && !document.getElementById('tpFabMoreBtn')) {
      dockEl.dataset.absorbed = '';
      if ((absorbFloatButtons._t || 0) < 40) { absorbFloatButtons._t = (absorbFloatButtons._t || 0) + 1; setTimeout(absorbFloatButtons, 250); }
      return;
    }
    dockEl.dataset.absorbed = '1';

    /* 【2026-11-21 修复 i导航图标消失】2026-11-16 dom-fab.js 撤下右下角按钮后，
       #minimapToggleBtn/#chatStatusBtn 可能根本不存在于 DOM，下方 mv() 对不存在的按钮静默跳过
       → i无限面板永远没有 i导航/i对话 条目。此处兜底重建空壳按钮：
       dom-status.js 的点击监听是 document 级委托、paint() 按 getElementById 填 .tk-label 图标，
       重建后自动生效。 */
    ['minimapToggleBtn', 'chatStatusBtn'].forEach(function (id) {
      if (document.getElementById(id)) return;
      var b = document.createElement('button');
      b.id = id;
      b.className = 'dog-guard-btn zf-dock-btn';
      b.title = PANEL_NAMES[id] || id;
      b.innerHTML = '<span class="tk-label"></span>';
      document.body.appendChild(b);
    });

    /* 【2026-11-13 i桌面统一命名】收编按钮改为 i系列 名称，并收进「无限」面板（改「i无限」）：
       按钮保留 DOM（display:none，getElementById 引用与监听全部保活），
       面板里渲染同款图标条目，点击即触发原按钮 click。 */
    function mv(id, opts) {
      opts = opts || {};
      var el = document.getElementById(id);
      if (!el) return;
      if (opts.title) el.title = opts.title;
      el.style.display = 'none';           /* 从 Dock 撤下，改由 i无限 面板承载 */
      /* 【2026-11-16 修复】必须把按钮挪回 body 挂载：若留在 #zfLeftFloat 里随后被 lf.remove() 摘除，
         按钮脱离文档树后 getElementById 再也找不到，后绑定监听的脚本（app-minimap-organize 等）
         会拿到 null → i整理/i挂件/i科技树/i导航 面板点击全部失效。 */
      document.body.appendChild(el);
      absorbedPanelBtns.push(el);
      enableDrag(el);
    }
    // 左下三按钮（#zfLeftFloat 容器整体移除）
    mv('organizeDockBtn', { title: 'i整理' });
    mv('kiteToggleBtn', { title: 'i挂件' });
    mv('emergeTreeBtn', { title: 'i科技树' });
    var lf = document.getElementById('zfLeftFloat');
    if (lf) lf.remove();
    // 右下：i导航 / i对话 同样收进 i无限 面板；「更多」栏目取消 —— 原菜单项并入 i无限 面板
    mv('minimapToggleBtn', { title: 'i导航' });
    mv('chatStatusBtn', { title: 'i对话' });
    var moreB = document.getElementById('tpFabMoreBtn');
    if (moreB) moreB.remove();
    var menu = document.getElementById('tpFabMoreMenu');
    if (menu) menu.remove();

    /* ---------- 【2026-11-14 顶栏收编】文件菜单/专注模式/登录入口/顶栏「更多」→ i无限面板 ----------
       手法与 i整理 等一致：按钮 DOM 保留（display:none 保活监听），面板渲染同款图标，点击触发原按钮 click。 */
    function hideKeep(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      el.style.display = 'none';
      return el;
    }
    /* ① i文件：左上角文件菜单按钮（canvasMenuBtn，由 app-undo.js 注入）——点击直接展开原下拉菜单（改定位到面板图标旁） */
    (function () {
      var btn = document.getElementById('canvasMenuBtn');
      /* 【2026-11-15 修复 i文件不显示根因】按钮由 app-undo.js 延迟注入；此前时序未到时本兜底只做"稍后隐藏"，
         从不补推 panelFileEntries → 面板里永远没有「文件菜单」。现改为：稍后按钮出现时补推条目并触发面板重建。 */
      if (!btn) {
        var tries = 0;
        var t = setInterval(function () {
          var b = document.getElementById('canvasMenuBtn');
          if (!b) { if (++tries > 40) clearInterval(t); return; }
          clearInterval(t);
          b.style.display = 'none';
          panelFileEntries.push({
            icon: _lico('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
            name: 'i文件',
            title: 'i文件：画布保存 / 打开 / 撤销 / 重做 / 快照 / 急速 / 重启后台',
            onClick: function () {
              b.style.visibility = 'hidden'; b.style.display = '';
              try { if (window.App && window.App.canvasUndo && window.App.canvasUndo.toggleMenu) window.App.canvasUndo.toggleMenu(); else b.click(); } catch (e) { b.click(); }
              setTimeout(function () { b.style.display = 'none'; b.style.visibility = ''; }, 80);
            }
          });
          try { if (morePanel && typeof buildOverflowPanel === 'function') buildOverflowPanel(); } catch (e) {}
        }, 500);
        return;
      }
      btn.style.display = 'none';
      panelFileEntries.push({
        icon: _lico('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
        name: 'i文件',
        title: 'i文件：画布保存 / 打开 / 撤销 / 重做 / 快照 / 急速 / 重启后台',
        onClick: function () {
          /* toggleMenu 内部用 getBoundingClientRect 定位在原按钮处；按钮隐藏后 rect 为 0 会顶到左上角，
             先临时显示按钮再触发，菜单弹出后再藏回去（下一帧，避免布局闪动） */
          btn.style.visibility = 'hidden';
          btn.style.display = '';
          try { if (window.App && window.App.canvasUndo && window.App.canvasUndo.toggleMenu) window.App.canvasUndo.toggleMenu(); else btn.click(); } catch (e) { btn.click(); }
          setTimeout(function () { btn.style.display = 'none'; btn.style.visibility = ''; }, 80);
        }
      });
    })();

    /* ①.5 【2026-11-19 用户要求】i录音 / i录像：原文件树头部录音/录像按钮移入 i无限面板。
       保存位置锁定为当前活动项目根目录（不再跟随文件树浏览目录）。 */
    panelFileEntries.push({
      /* 【2026-11-21 用户要求】图标本身不带颜色，录制中仅加小圈动画（zf-rec-anim.js） */
      icon: _lico('<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" stroke-width="1.9"/><path d="M19 12a7 7 0 0 1-14 0M12 19v3" stroke-width="1.9"/>'),
      name: 'i录音',
      title: 'i录音：录制系统音频/麦克风到当前项目根目录（在 i无限面板右键选设备/音量）',
      onClick: function () { try { window.App.toggleRecord(); } catch (e) { console.error('[i录音]', e); } },
      onContextMenu: function (ev) {
        try {
          if (window.App && window.App.showRecordMenu) { ev.preventDefault(); window.App.showRecordMenu(ev, 'audio'); }
        } catch (e) {}
      }
    });
    panelFileEntries.push({
      /* 【2026-11-21 用户要求】图标本身不带颜色 */
      icon: _lico('<path d="M23 7l-7 5 7 5V7z" stroke-width="1.9"/><rect x="1" y="5" width="15" height="14" rx="2" stroke-width="1.9"/>'),
      name: 'i录像',
      title: 'i录像：录制屏幕到当前项目根目录（在 i无限面板右键选区域/音频）',
      onClick: function () {
        try { window.App.toggleScreenRecord(); } catch (e) { console.error('[i录像]', e); }
        try { if (window.App && window.App._syncSrStateFromServer) setTimeout(function () { window.App._syncSrStateFromServer(); }, 800); } catch (e) {}
      },
      onContextMenu: function (ev) {
        try {
          if (window.App && window.App.showRecordMenu) { ev.preventDefault(); window.App.showRecordMenu(ev, 'screen'); }
        } catch (e) {}
      }
    });

    /* ② i专注：顶栏专注模式按钮（topbarFocusBtn，dom-topbar.js 注入、app-focus-mode.js bindFocus 绑监听） */
    var focusBtn = hideKeep('topbarFocusBtn');
    if (focusBtn) {
      absorbedPanelBtns.push(focusBtn);   /* 走 i桌面功能 分区，沿用 btn.click() 通用触发 */
      focusBtn.title = 'i专注';
    }
    /* ②b 【2026-11-14 已移除】i团队入口已从 i无限面板撤下——派出团队改在对话内直接弹出面板（chatbox-crew-panel.js）拖拽排序/派出，不再需要独立入口。 */
    /* ③ i账号：登录入口（未登录 zf3dLoginEntry / 已登录 zf3dUserEntry），带头像角标显示登录状态 */
    (function () {
      var loginEl = null; /* 2026-11-13 登录图标已从顶栏删除（入口移入i无限桌面），不再 hideKeep */
      var userEl = hideKeep('zf3dUserEntry');
      if (!loginEl && !userEl) return;
      panelAccountEntries.push({
        name: 'i账号',
        title: '登录 / 用户菜单',
        icon: '<svg id="zfDockAccountIcon" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/></svg>',
        onClick: function () {
          var user = document.getElementById('zf3dUserEntry');
          var target = (user && user.style.display !== 'none' && user.offsetWidth > 0) ? user : null;
          if (!target) { if (window.App && App.zf3dTopbarShowLogin) App.zf3dTopbarShowLogin(); return; } /* 未登录：直接打开登录遮罩（顶栏登录图标已删除，2026-11-13） */
          /* zf3dUserEntry 的 onclick 是内联 App.zf3dTopbarShowUserMenu(event)，需要 event 参数；
             display:none 元素 click() 仍会触发内联 onclick，event 正常派发，无需临时显示 */
          target.click();
        }
      });
      /* 头像角标：定时同步登录态（zf3dTopbarRefreshUI 会切换两个入口的 display） */
      setInterval(function () {
        var ic = document.getElementById('zfDockAccountIcon');
        if (!ic) return;
        var user = document.getElementById('zf3dUserEntry');
        var avatar = document.getElementById('zf3dUserAvatar');
        var logged = user && user.style.display !== 'none';
        var badge = ic.parentNode && ic.parentNode.querySelector('.zf-dock-account-badge');
        if (logged && avatar && avatar.firstChild) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'zf-dock-account-badge';
            badge.style.cssText = 'position:absolute;top:2px;right:10px;width:14px;height:14px;border-radius:50%;overflow:hidden;background:#3a3f4a;border:1px solid #5ee08a;';
            badge.title = '已登录';
            if (ic.parentNode.style.position !== 'absolute' && ic.parentNode.style.position !== 'relative') ic.parentNode.style.position = 'relative';
            ic.parentNode.appendChild(badge);
          }
          /* 克隆头像内容做角标（zf3dUserAvatar 内是背景图/img） */
          if (avatar.style.backgroundImage) badge.style.backgroundImage = avatar.style.backgroundImage;
          badge.style.backgroundSize = 'cover';
          badge.style.display = 'block';
        } else if (badge) { badge.style.display = 'none'; }
      }, 1500);
    })();
    /* ④ i功能：顶栏「⋯更多」按钮隐藏（菜单逻辑 app-canvas-more-menu.js 不动，
       面板 i功能 分区在 buildOverflowPanel 里惰性读 window.CanvasMoreMenu.items 渲染） */
    hideKeep('topbarMoreBtn');
    var moreSep = document.getElementById('topbarMoreSep');
    if (moreSep) moreSep.style.display = 'none';

    /* 【2026-11-13 i桌面统一命名】收编按钮加入 macOS 波及放大（display:none 时 getBoundingClientRect 为 0，不影响）+ 移除多余小灯，只留纯图标 */
    absorbedEls = [];
    ['organizeDockBtn','kiteToggleBtn','emergeTreeBtn','minimapToggleBtn','chatStatusBtn','tpFabMoreBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.style.transform = 'scale(1)'; absorbedEls.push({ el: el }); }
    });
    /* 去掉整理/风筝按钮的状态小灯，只留纯图标 */
    document.querySelectorAll('#organizeDockBtn .tk-dot, #kiteToggleBtn .tk-dot').forEach(function (d) { d.remove(); });

    // 「更多」按钮已移除，原菜单定位逻辑作废（保留注释占位防误改）
    /* 【2026-11-11 溢出收纳】原「更多」栏目项（任务/长任务/长期目标/记忆/历史/模型/广场）
       并入 Dock 末尾「∞」溢出图标：超出 MAX_VISIBLE 的 App 图标 + 这些面板项，
       点击弹出统一面板展示（见 buildOverflowMenu，renderDock 末尾会调用） */

    // 收编按钮视觉：与 dock-item 同尺寸，避免被 dock 内 svg 规则放大
    var css = document.createElement('style');
    css.textContent = [
      '#zfAppDock > #organizeDockBtn,#zfAppDock > #kiteToggleBtn,#zfAppDock > #emergeTreeBtn,',
      '#zfAppDock > #minimapToggleBtn,#zfAppDock > #chatStatusBtn,#zfAppDock > #tpFabMoreBtn{',
      '  width:46px;height:46px;min-width:46px;padding:0;border:none;background:transparent;',
      '  display:flex;align-items:center;justify-content:center;border-radius:12px;position:relative;}',
      '#zfAppDock > .zf-dock-btn svg{width:34px;height:34px;pointer-events:none;}',
      '#zfAppDock > #chatStatusBtn{font-size:30px;line-height:34px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));}',
      '#zfAppDock > #chatStatusBtn .cs-btn-count{position:absolute;top:2px;right:0px;}',
      /* 【2026-11-12 修复】收编按钮 hover 无背景色（原来只有 .zf-dock-item 有 hover 态） */
      '#zfAppDock > .zf-dock-btn:hover{background:rgba(255,255,255,.10) !important;}',
      /* 【2026-11-12】对话徽标数字样式区分：圆底徽标，一眼看出与普通图标不同 */
      /* 【2026-11-12 修复】对话按钮整钮可点：内部子元素不拦截点击（原来只有点数字区域才触发） */
      '#zfAppDock > #chatStatusBtn > *{pointer-events:none;}',
      '#zfAppDock > #chatStatusBtn .cs-btn-count{min-width:16px;height:16px;padding:0 4px;',
      '  border-radius:9px;background:#3a3f4a;color:#d5dae3;font-size:10px;font-weight:700;',
      '  line-height:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.5);}',
      '#zfAppDock > #chatStatusBtn .cs-btn-count:empty,#zfAppDock > #chatStatusBtn .cs-btn-count.zf-count-zero{display:none}',
      '#zfAppDock > #tpFabMoreBtn{font-size:30px;width:34px;height:46px;min-width:34px;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,.5);}'
    ].join('\n');
    document.head.appendChild(css);
  }


  /* ---------- i进化窗口已移除（2026-11-17 用户拍板：引擎文件保留，git 历史可恢复） ---------- */

  function boot() {
    /* ================================================================
     * 【硬编码冻结区 · 2026-11-20 v3.2 R0a】
     * 本 boot() 内的 register() 硬编码注册已被冻结：
     * 禁止在此新增任何 register() 调用！新程序必须走「一切皆插件」
     * 声明式注册通道（ui.sysapps / ui-mounts 模式）。
     * 现存硬编码项将由 R1 register() 声明导出统一收编，迁移完成后本区
     * 逐项清空。纪律来源：裁决-一切皆插件小队收口v3.2-20261120
     * 前车之鉴：i采集(commit 2cae8bae) 曾违反纪律硬编码新增。
     * 【进度 2026-11-23 T1-R1-2 第二波】全量收编完成：余下 16 项 → plugins/ui.dockapps-main/
     * （i漫画含 AppLock 门禁/mangaCmd/懒建适配）；i采集/i授权/i密室 → plugins/ui.dockapps-extra/
     * （原 zf-app-dock-apps.js 静态脚本退役）。本区 register 清零；
     * window.ZFDock 的 open/close/mangaCmd 契约由插件启用时回挂，pollCmds 运行时读取不受影响。
     * 新建对话 → plugins/ui.dockapps-basic/；剩余按批次继续收编。
     * ================================================================ */
    /* 【T1-R1-2 第二波 2026-11-23】冻结区 register 全量清零：16 项已迁出至
     * plugins/ui.dockapps-main/（contest/manga/chat/novel/town/hardware/calc/news/
     * video/image/idol/home/notes/music/game/tv）；本函数只余声明导出上报。 */
    /* ================================================================
     * 【R1-1 声明导出最小实验 · v3.2】
     * boot 末尾把 APPS 清单（id/name）序列化上报：
     * 1) window 事件 2) POST /api/plugin-manager/ui-mounts/report
     * 目的：插件面板无需逐个迁移即可看见全部 Dock 程序（突破师杠杆1）。
     * 红线：fetch 静默失败不影响 Dock 本体；须在全部 register 之后执行。
     * ================================================================ */
    try {
      var decl = APPS.map(function (a) { return { id: a.id, name: a.name }; });
      window.dispatchEvent(new CustomEvent('zfdock-apps-declared', { detail: decl }));
      if (window.fetch) {
        fetch('/api/plugin-manager/ui-mounts/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'zf-app-dock', apps: decl })
        }).catch(function (err) { console.warn('[ZFDock][declare-export] 上报失败（端点未就绪或网络异常）:', err && err.message || err); });
      }
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  /* 【轻App秒开】空闲时预取 i计算器/i记事本/i硬件 的 js */
  /* 【轻App秒开】空闲预取：把轻量 App 的 js 提前拉进浏览器缓存，点击时命中缓存秒开。
     【v4 2026-11-17】补入 zf-app-video.js：i视频此前点开才动态加载脚本+onOpen 后渲染，
     首次打开串行等待明显；预取后点开命中缓存即渲染。 */


  /* ---------- 公开 API ---------- */
  window.ZFDock = {
    register: register,
    /* 【v1.3 2026-11-21】导出 createAppWindow：插件（如 zf-app-script.js i剧本杀）按
       「一切皆插件」契约自建窗口时调用；此前未导出导致插件点击抛 TypeError 窗口弹不出 */
    createAppWindow: createAppWindow,
    /* 【T1-R1-2 第二波 2026-11-23】各 i程序 open/close/mangaCmd 已随插件迁出，
    由 ui.dockapps-basic / ui.dockapps-main / ui.dockapps-extra 启用时回挂本对象；
    pollCmds 每轮运行时读取 window.ZFDock[c.fn]，插件未启用时对应指令安静跳过（typeof 检查已有） */
    /* AI 感知埋点：供各 App 在播放/搜索等关键动作时调用，只存App名+动作+标题 */
    track: function (app, action, title) {
      try {
        fetch('/api/iapp/event', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: app, action: action, title: title || '' })
        }).catch(function () {});
      } catch (e) {}
    },
    apps: function () { return APPS.slice(); },
    /* 【2026-11-17 方案A】Dock 程序显隐管理 API：供设置面板「插件管理」页统一开关
       hiddenApps() 读隐藏清单；setHidden(id, hide) 写清单并即时重渲染 Dock（同 key zfDockHiddenApps，与 i无限面板拖拽互通） */
    hiddenApps: function () { return loadHidden(); },
    setHidden: function (id, hide) {
      if (hide) hideApp(id); else showApp(id);
      renderDock();
    },
    /* ---------- AI 开窗指令消费：前端轮询 /api/iapp/cmds，弹出对应窗口 ---------- */
    pollCmds: function () {
      try {
        fetch('/api/iapp/cmds').then(function (r) { return r.json(); }).then(function (d) {
          if (!d || !d.ok || !d.cmds || !d.cmds.length) return;
          d.cmds.forEach(function (c) {
            try {
              var fn = window.ZFDock[c.fn];
              if (typeof fn !== 'function') return;
              var isSilentPlaylist = c.fn === 'openMusic' && c.app === 'music' && (c.kw || '').indexOf('q:') === 0;
              /* 【v1.6】q: 静默歌单指令：挂载 i音乐 但不弹窗，kw 留给 onOpen 的 pendingKw 消费 */
              if (isSilentPlaylist) fn(c.kw || '', true); else fn(c.kw || '');
              /* 【v1.2 通用带词】开窗后若有 kw，自动尝试调用该 App 的搜索/播放 API：
                 ZFMusic.search / ZFManga.search / ZFTV.playByName / ZFNews / ZFImage / ZFVideo 通用探测 */
              if (c.kw) {
                var apiMap = {
                  music: function () {
                    /* 【v1.5 AI歌单】kw 以 q: 开头 = 批量建队列并直接播放；否则普通搜索 */
                    if (!window.ZFMusic) return null;
                    var k = c.kw || '';
                    /* 【v1.6】q: 指令已由 openMusic silent 挂载 + onOpen pendingKw 消费，这里不再重复触发 */
                    if (k.indexOf('q:') === 0) return true;
                    return ZFMusic.search ? ZFMusic.search(k) : null;
                  },
                  manga: function () { return window.ZFManga && ZFManga.search ? ZFManga.search(c.kw) : null; },
                  tv: function () { return window.ZFTV && ZFTV.playByName ? ZFTV.playByName(c.kw) : null; },
                   video: function () { return window.ZFVideo && ZFVideo.search ? ZFVideo.search(c.kw) : null; },
                   image: function () { return window.ZFImage && ZFImage.search ? ZFImage.search(c.kw) : null; },
                   news: function () { return window.ZFNews && ZFNews.search ? ZFNews.search(c.kw) : null; }
                };
                var doKw = apiMap[c.app];
                /* 【v1.4】apiMap 无匹配的 App（novel/game 等无搜索语义）不进重试，只开窗 */
                if (doKw) {
                var tries = 0;
                (function retry() {
                  var r = null;
                  try { r = doKw(); } catch (e) {}
                  if (!r && tries++ < 5) { setTimeout(retry, 600); }
                })();
                }
              }
              window.ZFDock.track('ai', 'ai-opened-' + c.app, c.kw || '');
            } catch (e) {}
          });
        }).catch(function () {});
      } catch (e) {}
    }
  };
  /* 【2026-11-23 修复 i桌面图标全空】T1 收编改造误删了本桥导出：ui.dockapps-basic/main/extra
     三个插件开头检查 window.ZFDockBridge，桥缺失即全体「未就绪，跳过」→ 桌面区图标一个不渲染。
     桥四成员契约见插件头部注释；zfVerSrc/prefetchAppJs 在本文件 ~1666 行，一并提供。 */
  window.ZFDockBridge = { register: register, createAppWindow: createAppWindow, zfVerSrc: zfVerSrc, prefetchAppJs: prefetchAppJs };
  /* 启动轮询：2 秒一次 */
  setInterval(function () { try { window.ZFDock.pollCmds(); } catch (e) {} }, 2000);
})();
/* 派出团队已收进对话内面板（chatbox-crew-panel.js），i无限面板不再设独立入口（2026-11-14）*/
/* 【2026-11-20】i录音/i录像 动态状态增强（脉冲光晕+跳动+停止绿闪） */
(function(){var s=document.createElement('script');s.src='/js/zf-rec-anim.js?v=20261121b';document.head.appendChild(s);})();