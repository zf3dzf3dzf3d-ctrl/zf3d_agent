/* 漫画柜内容模块（v3 策划案 M2 柜子UI + M3 阅读器 + M4 进度记忆）
 * 挂载点：#zfMangaBody（由 zf-app-dock.js 创建的 Dock 窗口）
 * 视图：书架(封面墙) ⇄ 阅读器(拖拽翻页/条漫竖滚/右开横翻)
 * 进度：/api/comics/progress 复合键 source:mangaId，3秒节流上报，续读角标
 * 依赖：window.ZFManga.onOpen(body) 由 dock 在 openManga 时调用
 */
(function () {
  'use strict';
  if (window.ZFManga && window.ZFManga._ready) return;

  /* ---------- 加载占位（简约墨点 spinner，深浅色自适应 currentColor） ---------- */
  var ZFM_LOADING_HTML =
    '<div class="zfm-tip zfm-loading"><span class="zfm-spin"></span></div>';

  /* ========== P0-A1 图标常量表（24px 线性 SVG，stroke=currentColor）
   * 漫画面板统一消费此表，禁止 emoji/字符图标（验收 grep 门禁：本文件代码中字符图标清零）
   * 预留：后续上收为全项目公共图标表（见课题池「全项目图标体系分裂」）
   * ========== */
  var ZFM_ICONS = {
    book:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    download:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    moon:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    play:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>',
    back:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    chevL:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    chevR:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    /* P0-B2 三视图切换图标 */
    wall:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7.5" height="10" rx="1"/><rect x="13.5" y="3" width="7.5" height="10" rx="1"/><rect x="3" y="16" width="7.5" height="5" rx="1"/><rect x="13.5" y="16" width="7.5" height="5" rx="1"/></svg>',
    listV:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>',
    gridV:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/></svg>',
    star:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
    expand:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    compress:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
    zoomIn:  /* 引导性预留（当前零引用勿删）：配套挂账「触屏唤出与阅读引导」private/记忆/挂账-i漫画阅读器触屏唤出与遗留项-20261109.md */ '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    hand:    /* 引导性预留（当前零引用勿删）：配套挂账「触屏唤出与阅读引导」private/记忆/挂账-i漫画阅读器触屏唤出与遗留项-20261109.md */ '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34L3.6 17.2a2 2 0 0 1 2.83-2.82L8 16"/></svg>',
    /* 20261112 图标升级：下载三态 spinner + 收藏实心态 */
    loader:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="zfm-spin"><path d="M12 3a9 9 0 1 1-9 9"/></svg>',
    starFill:'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
    check:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="15.5" x2="12" y2="16"/></svg>',
    sort:    /* 20261112 章节排序切换图标 */ '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16"/><polyline points="4 7 7 4 10 7"/><path d="M17 20V4"/><polyline points="14 17 17 20 20 17"/></svg>'
  };

  /* ========== P0-A1 localStorage 键集中常量（防键名碎片化） ==========
   * 本文件当前零 localStorage 直读（进度走 /api/comics/progress 后端存储）；
   * 此表为后续模块（P0-B 视图记忆 zfmShelfView、P0-C 阅读偏好等）预留统一命名空间，
   * 新增键一律登记在此，禁止裸字符串散写。 */
  var ZFM_LS_KEYS = {
    SHELF_VIEW:    'zfmShelfView',    // P0-B 书架视图模式（wall/list/grid）
    READER_PREF:   'zfmReaderPref'    // P0-C 阅读偏好（画质档/亮度/色温/双页开关）
    ,
    LAST_READ:     'zfmLastRead'      // M4 重启续读：最后阅读 {src,id,title,chapterId,page,mode}
  };

  var state = {
    body: null,
    view: 'shelf',            // shelf | reader
    src: 'local',
    kw: '',
    items: [],
    /* P0-B2/B3 书架视图/排序/筛选（视图与排序记忆 localStorage，筛选不记忆） */
    shelfView: 'wall',        // wall=封面墙 | list=列表 | grid=紧凑网格
    sortBy: 'recent',         // recent=最近阅读 | title=标题 | fav=收藏
    filter: 'all',            // all | reading | fav | downloaded
    favs: {},                 // key source:id -> true（收藏走 localStorage）
    progress: {},             // key source:id -> {chapterId,page,totalPages,ratio}
    reader: null,             // {src,id,title,chapterId,pages[],page,mode:'v'|'h'}
    /* P0-C 观看偏好（localStorage 记忆，READER_PREF 键） */
    rw: 100,                  // 阅读宽度 40~100（%）
    fit: 'w',                 // w=适应宽 | h=适应高 | o=原始尺寸（纯 CSS 显示档，不改流量）
    spread: false,            // h 模式双页对开
    bright: 100,              // 亮度 30~100
    sepia: 0,                 // 色温 0~40
    oled: false,              // OLED 纯黑背景
    reportTimer: null
  };

  /* ---------- API 工具 ---------- */
  function api(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- M4 重启续读：记录最后阅读位置（localStorage，跨重启） ---------- */
  function saveLastRead() {
    var r = state.reader;
    if (!r || !r.id) return;
    try {
      localStorage.setItem(ZFM_LS_KEYS.LAST_READ, JSON.stringify(
        { src: r.src, id: r.id, title: r.title, chapterId: r.chapterId, page: r.page, mode: r.mode }));
    } catch (e) {}
  }
  function loadLastRead() {
    try { return JSON.parse(localStorage.getItem(ZFM_LS_KEYS.LAST_READ) || 'null'); } catch (e) { return null; }
  }
  function clearLastRead() {
    try { localStorage.removeItem(ZFM_LS_KEYS.LAST_READ); } catch (e) {}
  }

  /* ---------- 进度上报（3秒节流 + 关闭/切页立即flush） ---------- */
  function reportProgress(immediate) {
    var r = state.reader;
    if (!r) return;
    var payload = JSON.stringify({
      source: r.src, mangaId: r.id, chapterId: r.chapterId,
      page: r.page, totalPages: r.pages.length,
      ratio: r.pages.length ? r.page / r.pages.length : 0
    });
    saveLastRead();   // 同步记录最后阅读位置（重启后 onOpen 直达续读）
    var doSend = function () {
      fetch('/api/comics/progress', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: payload
      }).catch(function () {});
    };
    clearTimeout(state.reportTimer);
    if (immediate) { doSend(); }
    else { state.reportTimer = setTimeout(doSend, 3000); }
  }

  /* ---------- P0-B 书架偏好（视图/排序/收藏，统一走 ZFM_LS_KEYS） ---------- */
  function loadPrefs() {
    try {
      var v = JSON.parse(localStorage.getItem(ZFM_LS_KEYS.SHELF_VIEW) || '{}');
      if (v.view) state.shelfView = v.view;
      if (v.sort) state.sortBy = v.sort;
      if (v.favs) state.favs = v.favs;
    } catch (e) {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(ZFM_LS_KEYS.SHELF_VIEW, JSON.stringify(
        { view: state.shelfView, sort: state.sortBy, favs: state.favs }));
    } catch (e) {}
  }
  /* ---------- P0-C 观看偏好（fit/spread/bright/sepia/oled） ---------- */
  function loadReaderPref() {
    try {
      var v = JSON.parse(localStorage.getItem(ZFM_LS_KEYS.READER_PREF) || '{}');
      if (v.fit) state.fit = v.fit;
      if (v.spread != null) state.spread = !!v.spread;
      if (v.bright != null) state.bright = Math.min(100, Math.max(30, v.bright));
      if (v.sepia != null) state.sepia = Math.min(40, Math.max(0, v.sepia));
      if (v.oled != null) state.oled = !!v.oled;
      if (v.rw != null) state.rw = Math.min(100, Math.max(40, v.rw));
    } catch (e) {}
  }
  function saveReaderPref() {
    try {
      localStorage.setItem(ZFM_LS_KEYS.READER_PREF, JSON.stringify(
        { fit: state.fit, spread: state.spread, bright: state.bright, sepia: state.sepia, oled: state.oled, rw: state.rw }));
    } catch (e) {}
  }
  /* ---------- P0-C 预载双限 LRU（条目≤60 且 估算位图≤MB_BUDGET，超限 revoke） ---------- */
  var _pre = { order: [], size: {}, blobUrls: {}, budget: 0 };
  var PRE_MAX = 60, MB_BUDGET = 192 * 1024 * 1024;   // spike 实测定稿：1600x2400 页解码约 14.6MB，192MB≈13 页余量（256MB 仅容 ~17 页且与条目 60 失衡）
  function prefetchAround(pages, idx) {
    for (var k = 1; k <= 4; k++) {
      [idx + k, idx - k].forEach(function (i) {
        var u = pages[i];
        if (!u || _pre.blobUrls[u]) return;
        fetch(u).then(function (res) { return res.blob(); }).then(function (blob) {
          if (_pre.blobUrls[u]) return;
          var url = URL.createObjectURL(blob);
          var img = new Image();
          img.onload = function () {   // 用真实解码尺寸修正估算
            var est = img.naturalWidth * img.naturalHeight * 4;
            _pre.size[u] = est;
            _pre.budget += est;
            enforceBudget();
          };
          img.src = url;
          _pre.blobUrls[u] = url;
          _pre.order.push(u);
          enforceCount();
        }).catch(function () {});
      });
    }
  }
  function revokeOne(u) {
    var url = _pre.blobUrls[u];
    if (!url) return;
    URL.revokeObjectURL(url);
    delete _pre.blobUrls[u];
    _pre.budget -= _pre.size[u] || 0;
    delete _pre.size[u];
  }
  function enforceCount() {
    while (_pre.order.length > PRE_MAX) revokeOne(_pre.order.shift());
  }
  function enforceBudget() {
    while (_pre.budget > MB_BUDGET && _pre.order.length) revokeOne(_pre.order.shift());
  }
  function blobUrl(u) { return _pre.blobUrls[u] || u; }   // 命中预载则换 blob URL（免重复请求）
  function clearPreload() { _pre.order.slice().forEach(revokeOne); }
  /* ---------- P0-B4 封面渐显懒加载（IntersectionObserver） ---------- */
  var _coverIO = null;
  function observeCovers(root) {
    if (!('IntersectionObserver' in window)) return;
    if (_coverIO) _coverIO.disconnect();
    _coverIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('zfm-cin');
        _coverIO.unobserve(en.target);
      });
    }, { root: null, rootMargin: '80px' });
    root.querySelectorAll('.zfm-card').forEach(function (c) { _coverIO.observe(c); });
  }

  /* ---------- 书架视图 ---------- */
  function loadProgress() {
    return api('/api/comics/progress').then(function (d) {
      state.progress = (d && d.progress) || {};
    }).catch(function () {});
  }

  function renderShelf() {
    state.view = 'shelf';
    state.reader = null;
    var b = state.body;
    if (!b) return;
    loadPrefs();
    b.innerHTML =
      '<div class="zfm-toolbar">' +
      '  <input id="zfmSearch" placeholder="搜索漫画…" value="' + esc(state.kw) + '">' +
      '  <select id="zfmSrc"></select>' +
      '</div>' +
      '<div class="zfm-subbar">' +
      '  <div class="zfm-chips" id="zfmFilter">' +
      '    <button data-f="all"' + (state.filter === 'all' ? ' class="zfm-on"' : '') + '>全部</button>' +
      '    <button data-f="reading"' + (state.filter === 'reading' ? ' class="zfm-on"' : '') + '>在读</button>' +
      '    <button data-f="fav"' + (state.filter === 'fav' ? ' class="zfm-on"' : '') + '>收藏</button>' +
      '    <button data-f="downloaded"' + (state.filter === 'downloaded' ? ' class="zfm-on"' : '') + '>已下载</button>' +
      '  </div>' +
      '  <select id="zfmSort">' +
      '    <option value="recent">最近阅读</option>' +
      '    <option value="title">按标题</option>' +
      '    <option value="fav">收藏优先</option>' +
      '  </select>' +
      '  <div class="zfm-views" id="zfmViews">' +
      '    <button data-v="wall" title="封面墙"' + (state.shelfView === 'wall' ? ' class="zfm-on"' : '') + '>' + ZFM_ICONS.wall + '</button>' +
      '    <button data-v="list" title="列表"' + (state.shelfView === 'list' ? ' class="zfm-on"' : '') + '>' + ZFM_ICONS.listV + '</button>' +
      '    <button data-v="grid" title="紧凑网格"' + (state.shelfView === 'grid' ? ' class="zfm-on"' : '') + '>' + ZFM_ICONS.gridV + '</button>' +
      '  </div>' +
      '</div>' +
      '<div id="zfmDlBar" class="zfm-dlbar" style="display:none"></div>' +
      '<div class="zfm-grid zfm-' + state.shelfView + '" id="zfmGrid">' + ZFM_LOADING_HTML + '</div>';
    pollDl();

    var sel = b.querySelector('#zfmSrc');
    api('/api/comics/sources').then(function (d) {
      ((d && d.sources) || []).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        sel.appendChild(o);
      });
      sel.value = state.src;
    });
    sel.addEventListener('change', function () {
      state.src = sel.value; loadItems();
    });
    var inp = b.querySelector('#zfmSearch');
    var t = null;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { state.kw = inp.value.trim(); loadItems(); }, 300);
    });

    /* P0-B2/B3 子工具条交互 */
    b.querySelector('#zfmSort').value = state.sortBy;
    b.querySelector('#zfmSort').addEventListener('change', function () {
      state.sortBy = this.value; savePrefs(); loadItems();
    });
    b.querySelector('#zfmFilter').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-f]');
      if (!btn) return;
      state.filter = btn.dataset.f;
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('zfm-on', x === btn); });
      loadItems();
    });
    b.querySelector('#zfmViews').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-v]');
      if (!btn) return;
      state.shelfView = btn.dataset.v; savePrefs();
      var grid = b.querySelector('#zfmGrid');
      grid.className = 'zfm-grid zfm-' + state.shelfView;
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('zfm-on', x === btn); });
      loadItems();
    });

    loadItems();
  }

  /* ---------- 下载状态条（书架内轮询） ---------- */
  function pollDl() {
    var bar = state.body && state.body.querySelector('#zfmDlBar');
    if (!bar) return;
    api('/api/comics/download/status').then(function (d) {
      var ts = (d && d.tasks) || [];
      var active = ts.filter(function (t) { return t.status === 'downloading' || t.status === 'pending'; });
      if (!active.length) {
        bar.style.display = 'none';
        setTimeout(pollDl, 5000);
        return;
      }
      bar.style.display = '';
      bar.innerHTML = active.map(function (t) {
        var pct = t.total ? Math.round(t.done * 100 / t.total) : 0;
        return '<div class="zfm-dlitem"><span>' + esc(t.title) + ' · ' + esc(t.chapterTitle) + '</span>' +
          '<div class="zfm-dltrack"><div class="zfm-dlfill" style="width:' + pct + '%"></div></div>' +
          '<em>' + t.done + '/' + t.total + ' 页</em></div>';
      }).join('');
      if (state.view === 'shelf') setTimeout(pollDl, 1500);
    }).catch(function () { setTimeout(pollDl, 5000); });
  }

  function loadItems() {
    var grid = state.body.querySelector('#zfmGrid');
    if (!grid) return;
    grid.className = 'zfm-grid zfm-' + state.shelfView;
    grid.innerHTML = ZFM_LOADING_HTML;
    api('/api/comics/list?src=' + encodeURIComponent(state.src) +
        '&kw=' + encodeURIComponent(state.kw)).then(function (d) {
      if (!state.body.querySelector('#zfmGrid')) return;  // 已切到阅读器
      var items = (d && d.items) || [];
      /* P0-B3 排序：recent=进度 ratio 降序（无进度靠后） | title | fav 优先 */
      var key = state.src;
      items.sort(function (a, b2) {
        var pa = state.progress[key + ':' + a.id] || {}, pb = state.progress[key + ':' + b2.id] || {};
        var fa = state.favs[key + ':' + a.id] ? 1 : 0, fb = state.favs[key + ':' + b2.id] ? 1 : 0;
        if (state.sortBy === 'title') return String(a.title).localeCompare(String(b2.title), 'zh');
        if (state.sortBy === 'fav') return (fb - fa) || ((pb.ratio || 0) - (pa.ratio || 0));
        return (pb.ratio || 0) - (pa.ratio || 0);   // recent
      });
      /* P0-B3 筛选 */
      items = items.filter(function (it) {
        var k = key + ':' + it.id, p = state.progress[k];
        if (state.filter === 'reading') return !!(p && p.ratio > 0 && p.ratio < 1);
        if (state.filter === 'fav') return !!state.favs[k];
        if (state.filter === 'downloaded') return it.source === 'local' || it.downloaded;
        return true;
      });
      state.items = items;
      if (!items.length) {
        grid.innerHTML = '<div class="zfm-tip">' +
          (state.filter !== 'all' ? '当前筛选条件下暂无漫画。' : '暂无漫画。' +
          (state.src === 'local'
            ? '把漫画文件夹放到 <b>public/canvas/漫画柜/本地库/&lt;漫画名&gt;/</b> 即可入柜。'
            : '该源暂无结果或不可达。')) + '</div>';
        return;
      }
      grid.innerHTML = items.map(function (it, i) {
        var k = key + ':' + it.id;
        var p = state.progress[k];
        var fav = !!state.favs[k];
        var badge = p ? '<span class="zfm-badge" title="继续读：第' + (p.page + 1) + '页">' +
          ZFM_ICONS.play + ' ' + Math.round(p.ratio * 100) + '%</span>' : '';
        var favBtn = '<button class="zfm-fav' + (fav ? ' zfm-on' : '') +
          '" data-fav="' + i + '" title="' + (fav ? '取消收藏' : '收藏') + '">' + ZFM_ICONS.star + '</button>';
        var cover = it.cover
          ? '<img loading="lazy" src="' + esc(it.cover) + '">'
          : '<div class="zfm-cover-ph">' + ZFM_ICONS.book + '</div>';
        if (state.shelfView === 'list') {
          return '<div class="zfm-card" data-i="' + i + '">' + favBtn +
            '<div class="zfm-lcover">' + cover + badge + '</div>' +
            '<div class="zfm-lmeta"><div class="zfm-title">' + esc(it.title) + '</div>' +
            '<div class="zfm-lsub">' + (p ? '在读 ' + Math.round(p.ratio * 100) + '%' : '未读') + '</div></div></div>';
        }
        return '<div class="zfm-card" data-i="' + i + '">' + favBtn +
          '<div class="zfm-cover">' + cover + badge + '</div>' +
          '<div class="zfm-title">' + esc(it.title) + '</div></div>';
      }).join('');
      observeCovers(grid);   // P0-B4 渐显
      grid.querySelectorAll('.zfm-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('.zfm-fav')) return;   // 收藏按钮不触发打开
          openDetail(state.items[+card.dataset.i]);
        });
      });
      grid.querySelectorAll('.zfm-fav').forEach(function (fb) {
        fb.addEventListener('click', function () {
          var k = key + ':' + state.items[+fb.dataset.fav].id;
          if (state.favs[k]) delete state.favs[k]; else state.favs[k] = true;
          savePrefs();
          fb.classList.toggle('zfm-on', !!state.favs[k]);
          fb.title = state.favs[k] ? '取消收藏' : '收藏';
        });
      });
    }).catch(function () {
      grid.innerHTML = '<div class="zfm-tip">加载失败</div>';
    });
  }

  /* ---------- 阅读器视图 ---------- */
  /* P1-D 详情页：封面+章节列表+继续阅读，选章后才进阅读器 */
  function openDetail(item) {
    var src = item.source || state.src;
    var qs = 'src=' + encodeURIComponent(src) + '&id=' + encodeURIComponent(item.id);
    var b = state.body;
    var p = state.progress[src + ':' + item.id];
    b.innerHTML =
      '<div class="zfm-detail">' +
      '  <div class="zfm-dhead">' +
      '    <button class="zfm-btn" data-act="dback">' + ZFM_ICONS.back + ' 书架</button>' +
      '    <img class="zfm-dcover" loading="lazy" src="' + esc(item.cover || '') + '">' +
      '    <div class="zfm-dmeta"><div class="zfm-dtitle">' + esc(item.title) + '</div>' +
      '    <div class="zfm-dsub">' + esc(src) + (p ? ' · 读到 ' + esc(String(p.chapterId || '')).slice(0, 18) + ' P' + (p.page || 0) : '') + '</div>' +
      '    <button class="zfm-btn zfm-continue" data-act="continue">' + ZFM_ICONS.play + (p && p.chapterId ? ' 继续阅读' : ' 开始阅读') + '</button>' +
      '    <button class="zfm-btn" data-act="dfav" title="收藏">' + (state.favs[src + ':' + item.id] ? ZFM_ICONS.starFill : ZFM_ICONS.star) + ' 收藏</button>' +
      '  </div></div>' +
      '  <div class="zfm-chhead"><span id="zfmChCount" class="zfm-chcount">章节加载中…</span>' +
      '    <div class="zfm-chsort"><button id="zfmSortBtn" data-act="chsort" title="切换正/倒序">' + ZFM_ICONS.sort + ' <span id="zfmSortLab">正序</span></button></div>' +
      '  </div>' +
      '  <div class="zfm-chlist" id="zfmChList">' + ZFM_LOADING_HTML + '</div>' +
      '</div>';
    b.querySelector('[data-act="dback"]').addEventListener('click', function () { renderShelf(); loadItems(); });
    b.querySelector('[data-act="continue"]').addEventListener('click', function () { openReader(item); });
    b.querySelector('[data-act="dfav"]').addEventListener('click', function () {
      var k = src + ':' + item.id;
      if (state.favs[k]) delete state.favs[k]; else state.favs[k] = 1;
      savePrefs();
      this.classList.toggle('zfm-on', !!state.favs[k]);
      this.innerHTML = (state.favs[k] ? ZFM_ICONS.starFill : ZFM_ICONS.star) + ' 收藏';
    });
    api('/api/comics/chapters?' + qs).then(function (d) {
      var chs = (d && d.chapters) || [];
      if (!chs.length) { b.querySelector('#zfmChList').innerHTML = '<div class="zfm-tip">暂无章节</div>'; b.querySelector('#zfmChCount').textContent = '共 0 章'; return; }
      /* 章节排序（正序/倒序切换，默认正序=按源顺序） */
      var desc = false;
      function renderChs() {
        var list = desc ? chs.slice().reverse() : chs;
        b.querySelector('#zfmSortLab').textContent = desc ? '倒序' : '正序';
        b.querySelector('#zfmChCount').textContent = '共 ' + chs.length + ' 章' + (p ? ' · 读到第 ' + (chs.findIndex(function (c) { return c.id === p.chapterId; }) + 1 || '-') + ' 章' : '');
        b.querySelector('#zfmChList').innerHTML = list.map(function (c) {
          var i = chs.indexOf(c);
          var reading = p && String(p.chapterId) === String(c.id);
          return '<button class="zfm-ch' + (reading ? ' zfm-cur' : '') + '" data-ch="' + esc(c.id) + '" data-i="' + i + '">' +
                 '<i class="zfm-chno">' + (i + 1) + '</i><span class="zfm-cht">' + esc(c.title || ('第' + (i + 1) + '话')) + '</span>' + (reading ? '<em class="zfm-chtag">在读</em>' : '') + '</button>';
        }).join('');
        var cur = b.querySelector('#zfmChList .zfm-cur');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
      }
      renderChs();
      b.querySelector('[data-act="chsort"]').addEventListener('click', function () { desc = !desc; renderChs(); });
      b.querySelector('#zfmChList').addEventListener('click', function (e) {
        var btn = e.target.closest('.zfm-ch');
        if (!btn) return;
        openReader(item, btn.getAttribute('data-ch'));
      });
    }).catch(function () { b.querySelector('#zfmChList').innerHTML = '<div class="zfm-tip">章节载入失败</div>'; });
  }

  function openReader(item, forceChapterId) {
    var qs = 'src=' + encodeURIComponent(item.source || state.src) + '&id=' + encodeURIComponent(item.id);
    state.body.innerHTML = '<div class="zfm-tip">载入章节…</div>';
    api('/api/comics/chapters?' + qs).then(function (d) {
      var chs = (d && d.chapters) || [];
      var ch = chs[0] || { id: '', title: '' };
      let p = state.progress[(item.source || state.src) + ':' + item.id];
      // 指定章节（详情页点选）优先，其次续读进度；p 提前取出供页码恢复共用
      if (forceChapterId) {
        var f = chs.filter(function (c) { return c.id === forceChapterId; });
        if (f.length) ch = f[0];
      } else {
        if (p && p.chapterId) {
          var found = chs.filter(function (c) { return c.id === p.chapterId; });
          if (found.length) ch = found[0];
        }
      }
      return api('/api/comics/pages?' + qs + '&ch=' + encodeURIComponent(ch.id)).then(function (d2) {
        var pages = (d2 && d2.pages) || [];
        if (!pages.length) {
          state.body.innerHTML = '<div class="zfm-tip">该漫画暂无可读页面</div>';
          return;
        }
        var r = {
          src: item.source || state.src, id: item.id, title: item.title,
          chapterId: ch.id, pages: pages,
          page: (p && p.chapterId === ch.id) ? (p.page || 0) : 0,
          mode: item.mode || 'v',   // v=条漫竖滚 | h=横翻（重启续读时沿用上次模式）
          _chs: chs                 // 章节列表缓存：看完一章自动续下一章
        };
        renderReader(r);
      });
    }).catch(function () {
      state.body.innerHTML = '<div class="zfm-tip">载入失败</div>';
    });
  }

  /* ---------- 下载按钮三态 + 进度条（20261112 图标升级） ---------- */
  function setBtnState(btn, icon, label, cls) {
    btn.innerHTML = icon + (label ? ' ' + esc(label) : '');
    btn.className = 'zfm-btn' + (cls ? ' ' + cls : '');
  }
  /* rbar 底部 2px 细进度条：轮询 /api/comics/download/status（done/total），无任务时隐藏 */
  var _dlTimer = null;
  function startDlProgress(bar) {
    if (_dlTimer) clearInterval(_dlTimer);
    var tick = function () {
      fetch('/api/comics/download/status', { credentials: 'same-origin' })
        .then(function (r2) { return r2.json(); })
        .then(function (d) {
          var t = d && (d.task || d.tasks && d.tasks[0]);
          var total = t && t.total || 0, done = t && t.done || 0;
          var st = t && t.status || '';
          if (!total || st === 'done' || st === 'completed') {
            bar.style.width = total ? '100%' : '0';
            setTimeout(function () { bar.style.width = '0'; }, 600);
            clearInterval(_dlTimer); _dlTimer = null;
            return;
          }
          if (st === 'failed' || st === 'interrupted') {
            bar.style.background = '#e05a5a';
            bar.style.width = '30%';
          } else {
            bar.style.background = '';
            bar.style.width = Math.round(done / total * 100) + '%';
          }
        }).catch(function () {});
    };
    bar.style.background = '';
    tick();
    _dlTimer = setInterval(tick, 1000);
  }
  function enqueueDownload(payload, onProgress) {
    return fetch('/api/comics/download/add', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); })
      .then(function (d) { if (onProgress) onProgress(d); return d; });
  }
  function renderReader(r) {
    /* 【2026-11-23 泄漏修复】重入（换翻页模式/连读换章/重开）先摘除旧 keydown 监听再挂新的，防 document 监听器堆积 */
    if (r._keyHandler) document.removeEventListener('keydown', r._keyHandler);
    /* 换对象重入（如 Esc 回目录后再开另一章）：摘除上一个 reader 残留的监听 */
    if (state.reader && state.reader !== r && state.reader._keyHandler) document.removeEventListener('keydown', state.reader._keyHandler);
    state.reader = r;
    state.view = 'reader';
    loadReaderPref();
    var b = state.body;
    b.innerHTML =
      '<div class="zfm-rbar">' +
      '  <button class="zfm-btn" data-act="back">' + ZFM_ICONS.back + ' 目录</button>' +
      '  <span class="zfm-rtitle">' + esc(r.title) + '</span>' +
      '  <span class="zfm-rpage" id="zfmPageNo"></span>' +
      '  <button class="zfm-btn" data-act="dl" title="下载本章到本地库">' + ZFM_ICONS.download + ' 下载</button>' +
      '  <button class="zfm-btn" data-act="viewset" title="观看设置：画质显示档/双页/亮度/色温/OLED">' + ZFM_ICONS.moon + '</button>' +
      '  <select id="zfmMode"><option value="v">条漫·竖滚</option><option value="h">页漫·横翻</option></select>' +
      '  <button class="zfm-btn" data-act="full" title="全屏阅读（Esc 退出 / F 切换）">' + ZFM_ICONS.expand + '</button>' +
      '</div>' +
      '<div class="zfm-dlbar" id="zfmDlBar"><div class="zfm-dlbar-fill" id="zfmDlBarFill" style="width:0"></div></div>' +
      '<div class="zfm-viewbar" id="zfmViewBar" style="display:none">' +
      '  <label>画质档 <select id="zfmFit">' +
      '    <option value="w">适应宽</option><option value="h">适应高</option><option value="o">原始尺寸</option></select></label>' +
      '  <label class="zfm-wlab">阅读宽 <input type="range" id="zfmWidth" min="40" max="100" step="5"><em id="zfmWidthVal" style="font-style:normal;color:#5ad1a0;min-width:32px"></em></label>' +
      '  <label><input type="checkbox" id="zfmSpread"> 双页对开</label>' +
      '  <label>亮度 <input type="range" id="zfmBright" min="30" max="100" step="5"></label>' +
      '  <label>色温 <input type="range" id="zfmSepia" min="0" max="40" step="5"></label>' +
      '  <label><input type="checkbox" id="zfmOled"> OLED纯黑</label>' +
      '</div>' +
      '<div class="zfm-reader" id="zfmReader"></div>' +
      '<div class="zfm-hint" id="zfmHint" title="点击或鼠标移到顶部显示工具条">☰ 顶部工具条 · 右键缩放 ｜ 竖滚: W/S·↑/↓ 翻页 ｜ 横翻: ←/→/空格 ｜ F 全屏 · Esc 退出(清除续读)</div>';
    b.querySelector('[data-act="back"]').addEventListener('click', function () {
      if (r._keyHandler) document.removeEventListener('keydown', r._keyHandler);
      clearPreload();
      reportProgress(true);   // 用户主动退出：保留续读标记（2026-11-09 用户拍板：Esc/书架退出也续读）
      /* 20261112 用户需求：返回应回到本书章节目录，而非全部书目 */
      openDetail({ source: r.src, id: r.id, title: r.title });
    });
    /* P0-C 观看设置面板（替代旧夜间滤镜：亮度/色温为CSS变量调整，与暗色窗体天然互斥，无 filter 叠加） */
    b.querySelector('[data-act="viewset"]').addEventListener('click', function () {
      var bar = b.querySelector('#zfmViewBar');
      bar.style.display = bar.style.display === 'none' ? '' : 'none';
      this.classList.toggle('zfm-on', bar.style.display !== 'none');
    });
    var fitSel = b.querySelector('#zfmFit');
    fitSel.value = state.fit;
    fitSel.addEventListener('change', function () { state.fit = fitSel.value; saveReaderPref(); applyViewStyles(); });
    var spreadChk = b.querySelector('#zfmSpread');
    spreadChk.checked = state.spread;
    spreadChk.addEventListener('change', function () {
      state.spread = spreadChk.checked; saveReaderPref();
      if (r.mode === 'h') { renderHPage(state.body.querySelector('#zfmReader'), r); }
    });
    var brightR = b.querySelector('#zfmBright'), sepiaR = b.querySelector('#zfmSepia');
    brightR.value = state.bright; sepiaR.value = state.sepia;
    brightR.addEventListener('input', function () { state.bright = +brightR.value; saveReaderPref(); applyViewStyles(); });
    sepiaR.addEventListener('input', function () { state.sepia = +sepiaR.value; saveReaderPref(); applyViewStyles(); });
    var oledChk = b.querySelector('#zfmOled');
    oledChk.checked = state.oled;
    oledChk.addEventListener('change', function () { state.oled = oledChk.checked; saveReaderPref(); applyViewStyles(); });
    /* P2 阅读宽度滑块：40%~100%，v/h 通用（reader 容器宽度约束） */
    var widthR = b.querySelector('#zfmWidth');
    var widthVal = b.querySelector('#zfmWidthVal');
    widthR.value = state.rw;
    function syncWidthVal() { if (widthVal) widthVal.textContent = state.rw + '%'; }
    syncWidthVal();
    widthR.addEventListener('input', function () { state.rw = +widthR.value; saveReaderPref(); applyViewStyles(); syncWidthVal(); });
    b.querySelector('[data-act="dl"]').addEventListener('click', function () {
      var btn = this;
      setBtnState(btn, ZFM_ICONS.loader, '下载中…', 'zfm-loading'); btn.disabled = true;
      var bar = b.querySelector('#zfmDlBarFill');
      if (bar) startDlProgress(bar);
      enqueueDownload({ source: r.src, mangaId: r.id, title: r.title,
        chapterId: r.chapterId, chapterTitle: r.chapterId, pages: r.pages })
        .then(function (d) {
          if (d && d.ok) {
            setBtnState(btn, ZFM_ICONS.check, '已入队', 'zfm-ok');
            setTimeout(function () { setBtnState(btn, ZFM_ICONS.download, '下载'); btn.disabled = false; }, 1500);
          } else {
            setBtnState(btn, ZFM_ICONS.alert, '失败', 'zfm-err');
            setTimeout(function () { setBtnState(btn, ZFM_ICONS.download, '下载'); btn.disabled = false; }, 1500);
          }
          if (window.ZFDock && window.ZFDock.dlPanel) window.ZFDock.dlPanel();
        }).catch(function () {
          setBtnState(btn, ZFM_ICONS.alert, '失败', 'zfm-err');
          setTimeout(function () { setBtnState(btn, ZFM_ICONS.download, '下载'); btn.disabled = false; }, 1500);
        });
    });
    /* 20261112：dlall「全章下载」按钮已移除——触底自动连读已吸收全章心智（裁决见调查黑板） */
    var modeSel = b.querySelector('#zfmMode');
    modeSel.value = r.mode;
    modeSel.addEventListener('change', function () {
      r.mode = modeSel.value; renderReader(r);
    });
    /* 键盘翻页：左右方向键与空格（横翻模式）；Esc 退全屏/回书架；F 切全屏；输入框聚焦时不抢 */
    var keyHandler = function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      var win = document.getElementById('zfMangaWin');
      if (e.key === 'Escape') {
        if (win && win.classList.contains('zfm-full')) { toggleFullscreen(false); return; }
      }
      if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return; }
      var prev = b.querySelector('.zfm-prev'), next = b.querySelector('.zfm-next');
      var isNext = e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'w' || e.key === 'W';
      var isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 's' || e.key === 'S';
      if (isNext || isPrev) {
        if (r.mode === 'h') {
          // 横翻：W/S/↓/↑ 与左右键/空格等效翻页
          var t = isNext ? next : prev;
          if (t) t.click();
        } else {
          // 竖滚（条漫）：按阅读区约 90% 高度滚动，模拟漫画 App 上下键体验
          var rd = b.querySelector('#zfmReader');
          if (rd) {
            rd.scrollTop += (isNext ? 1 : -1) * Math.max(200, rd.clientHeight * 0.9);
            rd.dispatchEvent(new Event('scroll'));
          }
        }
        e.preventDefault();
      }
      else if (e.key === 'Escape') { reportProgress(true); openDetail({ source: r.src, id: r.id, title: r.title }); }
    };
    document.addEventListener('keydown', keyHandler);
    r._keyHandler = keyHandler;   // 退出阅读器时移除

    /* P2 全屏切换（F 键 / 工具条按钮；Esc 退出已并入 keyHandler） */
    b.querySelector('[data-act="full"]').addEventListener('click', function () { toggleFullscreen(); });

    var reader = b.querySelector('#zfmReader');
    if (r.mode === 'v') {
      // 条漫：全页竖排懒加载 + 画质档 + 滚动记录页码 + 预载
      reader.className = 'zfm-reader zfm-v zfm-fit-' + state.fit;
      reader.innerHTML = r.pages.map(function (u, i) {
        return '<div class="zfm-vpage" data-p="' + i + '"><img loading="lazy" data-src="' + esc(u) + '"></div>';
      }).join('');
      lazyLoad(reader);
      applyViewStyles();
      prefetchAround(r.pages, r.page);
      // 滚动节流记录当前页 + 拖拽滚动 + 触底时预载下一批
      var sTick = null;
      reader.addEventListener('scroll', function () {
        if (sTick) return;
        sTick = setTimeout(function () {
          sTick = null;
          var vp = reader.querySelectorAll('.zfm-vpage');
          for (var i = 0; i < vp.length; i++) {
            var rc = vp[i].getBoundingClientRect();
            var rr = reader.getBoundingClientRect();
            if (rc.bottom > rr.top + rr.height / 2) { r.page = i; break; }
            if (i === vp.length - 1) r.page = i;
          }
          prefetchAround(r.pages, r.page);
          updatePageNo();
          reportProgress();
          /* 连读：竖滚触底（距底 < 40px）连续 2 次滚动事件 → 自动进下一章 */
          if (reader.scrollHeight - reader.scrollTop - reader.clientHeight < 40) {
            r._botHits = (r._botHits || 0) + 1;
            if (r._botHits >= 2) { r._botHits = 0; gotoNextChapter(r); }
          } else { r._botHits = 0; }
        }, 400);
      });
      /* 左键按住拖拽上下滚动（模拟滚轮/触屏） */
      bindDragScroll(reader);
      // 续读定位
      if (r.page > 0) {
        requestAnimationFrame(function () {
          var vp = reader.querySelectorAll('.zfm-vpage')[r.page];
          if (vp) reader.scrollTop = vp.offsetTop;
        });
      }
    } else {
      // 页漫：单页/双页大图 + 左右拖拽/滚轮翻页 + 双击缩放
      reader.className = 'zfm-reader zfm-h';
      renderHPage(reader, r);
      bindSwipe(reader, r);
      bindWheelFlip(reader, r);
      bindDblZoom(reader);
      bindRZoom(reader);
      prefetchAround(r.pages, r.page);
    }
    applyViewStyles();
    updatePageNo();
  }

  /* P0-C 观看样式应用：画质档/亮度/色温/OLED（CSS变量 + fit class，纯显示层） */
  function applyViewStyles() {
    var rd = state.body && state.body.querySelector('#zfmReader');
    if (!rd) return;
    rd.classList.remove('zfm-fit-w', 'zfm-fit-h', 'zfm-fit-o');
    rd.classList.add('zfm-fit-' + state.fit);
    rd.style.setProperty('--zfm-bright', state.bright / 100);
    rd.style.setProperty('--zfm-sepia', state.sepia / 100);
    rd.classList.toggle('zfm-oled', state.oled);
    /* P2 阅读宽度滑块（40%~100%，100% 时不约束） */
    rd.style.width = state.rw >= 100 ? '' : state.rw + '%';
    rd.style.margin = state.rw >= 100 ? '' : '0 auto';
  }

  /* P2 全屏切换：zfMangaWin 加 zfm-full class（Esc/F 退出后触发 resize 校准页码） */
  function toggleFullscreen(force) {
    var win = document.getElementById('zfMangaWin');
    if (!win) return;
    var want = (force == null) ? !win.classList.contains('zfm-full') : !!force;
    win.classList.toggle('zfm-full', want);
    /* 全屏两态图标切换：expand(进入)↔compress(退出) */
    var fbtn = win.querySelector('[data-act="full"]');
    if (fbtn) fbtn.innerHTML = want ? ZFM_ICONS.compress : ZFM_ICONS.expand;
    /* 尺寸变化后校准：v 模式滚动位置换算 / h 模式重渲染 */
    if (window.ZFManga && window.ZFManga.onResize) window.ZFManga.onResize();
  }

  /* P0-C 滚轮翻页（h 模式；v 模式保留原生竖滚） */
  function bindWheelFlip(reader, r) {
    reader.addEventListener('wheel', function (e) {
      var d = e.deltaY || e.deltaX;
      if (!d) return;
      e.preventDefault();
      flipPage(r, d > 0 ? 1 : -1);
    }, { passive: false });
  }

  /* P0-C 双击缩放（1x ↔ 2x，transform 中心放大，再双击还原） */
  function bindDblZoom(reader) {
    var zoomed = false;
    reader.addEventListener('dblclick', function (e) {
      zoomed = !zoomed;
      var img = reader.querySelector('.zfm-himg') || reader.querySelector('.zfm-spread img');
      if (img) img.style.transform = zoomed ? 'scale(2)' : '';
      reader.style.overflow = zoomed ? 'auto' : '';
      if (zoomed && img) {
        img.style.transformOrigin = 'center';
        var rect = img.getBoundingClientRect();
        img.style.transformOrigin = ((e.clientX - rect.left) / rect.width * 100) + '% ' +
                                    ((e.clientY - rect.top) / rect.height * 100) + '%';
      }
    });
  }

  /* P2 右键缩放：contextmenu 阻止菜单，滚轮或点按切换 1x↔2x（与双击缩放同通道） */
  function bindRZoom(reader) {
    var zoomed = false;
    var setZoom = function (on, cx, cy) {
      zoomed = on;
      var img = reader.querySelector('.zfm-himg') || reader.querySelector('.zfm-spread img');
      if (img) img.style.transform = zoomed ? 'scale(2)' : '';
      reader.style.overflow = zoomed ? 'auto' : '';
      if (zoomed && img && cx != null) {
        img.style.transformOrigin = 'center';
        var rect = img.getBoundingClientRect();
        img.style.transformOrigin = ((cx - rect.left) / rect.width * 100) + '% ' +
                                    ((cy - rect.top) / rect.height * 100) + '%';
      }
    };
    reader.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      setZoom(!zoomed, e.clientX, e.clientY);
    });
    reader._rzoomSet = setZoom;   // 供双击缩放共用状态
  }

  function renderHPage(reader, r) {
    if (state.spread && r.page + 1 < r.pages.length) {
      // P0-C 双页对开（未到末页时两页并排）
      reader.innerHTML =
        '<div class="zfm-spread">' +
        '<img class="zfm-himg" src="' + esc(blobUrl(r.pages[r.page])) + '" draggable="false">' +
        '<img class="zfm-himg" src="' + esc(blobUrl(r.pages[r.page + 1])) + '" draggable="false">' +
        '</div>' +
        '<div class="zfm-nav zfm-prev" title="上一页">' + ZFM_ICONS.chevL + '</div>' +
        '<div class="zfm-nav zfm-next" title="下一页">' + ZFM_ICONS.chevR + '</div>';
    } else {
      reader.innerHTML =
        '<img class="zfm-himg" src="' + esc(blobUrl(r.pages[r.page])) + '" draggable="false">' +
        '<div class="zfm-nav zfm-prev" title="上一页">' + ZFM_ICONS.chevL + '</div>' +
        '<div class="zfm-nav zfm-next" title="下一页">' + ZFM_ICONS.chevR + '</div>';
    }
    reader.querySelector('.zfm-prev').addEventListener('click', function () { flipPage(r, state.spread ? -2 : -1); });
    reader.querySelector('.zfm-next').addEventListener('click', function () { flipPage(r, state.spread ? 2 : 1); });
  }

  /* 连读下一章：看完一章自动进入下一章（无需返回书架重选）；已是最后一章则回书架 */
  function gotoNextChapter(r) {
    if (r._nextLoading) return;
    r._nextLoading = true;
    var chs = r._chs || [];
    var idx = -1;
    chs.forEach(function (c, i) { if (String(c.id) === String(r.chapterId)) idx = i; });
    if (idx < 0 || idx + 1 >= chs.length) {
      reportProgress(true); clearPreload(); renderShelf();   // 已是最后一章
      return;
    }
    var nxt = chs[idx + 1];
    var rd = state.body.querySelector('#zfmReader');
    if (rd) rd.innerHTML = '<div class="zfm-tip zfm-loading"><span class="zfm-spin"></span>本章完 · 载入下一章…</div>';
    var qs = 'src=' + encodeURIComponent(r.src) + '&id=' + encodeURIComponent(r.id);
    api('/api/comics/pages?' + qs + '&ch=' + encodeURIComponent(nxt.id)).then(function (d2) {
      var pages = (d2 && d2.pages) || [];
      if (!pages.length) { reportProgress(true); clearPreload(); renderShelf(); return; }
      reportProgress(true); clearPreload();
      if (r._keyHandler) document.removeEventListener('keydown', r._keyHandler);
      renderReader({ src: r.src, id: r.id, title: r.title,
        chapterId: nxt.id, pages: pages, page: 0, mode: r.mode, _chs: chs });
    }).catch(function () { reportProgress(true); clearPreload(); renderShelf(); });
  }

  /* 左键按住拖拽上下滚动（模拟滚轮）：竖滚阅读区内按住左键上下移动即滚动 */
  function bindDragScroll(reader) {
    var dragging = false, startY = 0, startTop = 0;
    reader.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragging = true; startY = e.clientY; startTop = reader.scrollTop;
    });
    reader.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.preventDefault();
      reader.scrollTop = startTop - (e.clientY - startY);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      reader.addEventListener(ev, function () { dragging = false; });
    });
    reader.style.cursor = 'grab';
  }

  function flipPage(r, d) {
    var n = r.page + d;
    if (n < 0) n = 0;
    if (n >= r.pages.length) { gotoNextChapter(r); return; }   // 末页再往后翻 = 自动进下一章
    if (n === r.page) return;
    r.page = n;
    prefetchAround(r.pages, r.page);
    renderHPage(state.body.querySelector('#zfmReader'), r);
    updatePageNo();
    reportProgress();
  }

  /* pointer 统一手势：水平拖拽超过 40px 判定翻页（阅读区内，与窗口拖拽互不干扰） */
  function bindSwipe(reader, r) {
    var sx = null, moved = false;
    reader.addEventListener('pointerdown', function (e) { sx = e.clientX; moved = false; });
    reader.addEventListener('pointermove', function (e) {
      if (sx == null) return;
      if (Math.abs(e.clientX - sx) > 10) moved = true;
    });
    reader.addEventListener('pointerup', function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx;
      sx = null;
      if (!moved || Math.abs(dx) < 40) return;
      flipPage(r, dx < 0 ? 1 : -1);   // 左滑=下一页，右滑=上一页
    });
  }

  function lazyLoad(container) {
    var imgs = container.querySelectorAll('img[data-src]');
    if (!('IntersectionObserver' in window)) {
      imgs.forEach(function (im) { im.src = im.dataset.src; });
      return;
    }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.src = blobUrl(en.target.dataset.src);   // 命中预载用 blob 免重复请求
          io.unobserve(en.target);
        }
      });
    }, { root: container, rootMargin: '600px' });
    imgs.forEach(function (im) { io.observe(im); });
  }

  function updatePageNo() {
    var el = state.body.querySelector('#zfmPageNo');
    if (el && state.reader) el.textContent = (state.reader.page + 1) + ' / ' + state.reader.pages.length;
  }

  /* ---------- 对外接口：dock 打开窗口时挂载 ---------- */
  window.ZFManga = {
    _ready: true,
    onOpen: function (body) {
      state.body = body;
      /* 会话内记忆：关窗前若在阅读器页面，重开恢复到上次阅读页；
         重启后：读 localStorage LAST_READ 直达上次漫画/章节/页码（无记录则回书架） */
      if (state.view === 'reader' && state.reader) {
        loadProgress().then(function () { renderReader(state.reader); });
      } else {
        loadProgress().then(function () {
          var last = loadLastRead();
          if (last && last.id) {
            openReader({ source: last.src, id: last.id, title: last.title, mode: last.mode }, last.chapterId);   // openReader 内部会用 progress.page 精确续读
          } else {
            renderShelf();
          }
        });
      }
    },
    onClose: function () {
      /* 【2026-11-23 泄漏修复】关窗时摘除当前阅读器的 keydown 监听，防关窗后按键仍触发翻页 */
      if (state.reader && state.reader._keyHandler) document.removeEventListener('keydown', state.reader._keyHandler);
      reportProgress(true);   // 关窗立即落盘进度
      clearTimeout(state.reportTimer);
    },
    onResize: function () {
      // 全屏/还原尺寸变化后：竖滚模式触发一次滚动校准当前页码。
      // 「真省流 resize」课题已归档为伪需求（2026-11-09 spike 收口）：
      // 画质档为纯 CSS 显示档，随容器自适应无需重算；预载按页码队列与窗口尺寸解耦；
      // 真正的按视口重编码需后端多分辨率源，超前端零改动边界，挂入服务端课题池。
      var r = state.reader;
      var reader = state.body && state.body.querySelector('#zfmReader');
      if (r && reader && r.mode === 'v') reader.dispatchEvent(new Event('scroll'));
    },
    /* M-W2：对话→漫画指令（由 ZFDock.mangaCmd 调用） */
    search: function (kw) {
      state.kw = kw;
      if (state.view !== 'shelf') renderShelf();
      var inp = state.body.querySelector('#zfmSearch');
      if (inp) inp.value = kw;
      loadItems();
      return { ok: true, kw: kw };
    },
    setSrc: function (src) {
      state.src = src;
      if (state.view !== 'shelf') renderShelf();
      loadItems();
      return { ok: true, src: src };
    },
    dlStatus: function () {
      return api('/api/comics/download/status');
    }
  };
})();
