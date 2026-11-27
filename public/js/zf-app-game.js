/* zf-app-game.js —— i游戏 前端（策划案 v2.2 D3-D6）
 * 接口：/api/games/featured | /api/games/free | /api/games/search?kw= | /api/games/detail?appid= | /api/games/list (GET/POST)
 * 红线：只做官方 API 聚合展示 + 官方渠道导流/一键领取，不提供任何盗版下载。
 * Esc 关闭交给 dock 通用兜底，本文件不绑 Esc（dock 约定）。
 */
(function () {
  var state = { tab: 'featured', kw: '', mylist: [], detailAppid: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(path, opts, cb) {
    var x = new XMLHttpRequest();
    x.open(opts && opts.method || 'GET', path, true);
    if (opts && opts.body) x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () {
      try { cb(JSON.parse(x.responseText)); } catch (e) { cb({ ok: false, err: 'bad json' }); }
    };
    x.onerror = function () { cb({ ok: false, err: 'network' }); };
    x.send(opts && opts.body ? JSON.stringify(opts.body) : null);
  }

  function onOpen(root) {
    state.root = root;
    if (!root.dataset.zfgBooted) {
      root.dataset.zfgBooted = '1';
      renderShell(root);
      bindShell(root);
      loadMylist(function () { switchTab(state.tab, true); });
    } else {
      switchTab(state.tab, true);
    }
  }

  function onClose() { /* 保留 DOM 状态，重开恢复 */ }

  /* ---------- 外壳 ---------- */
  function renderShell(root) {
    root.innerHTML =
      '<div style="width:190px;border-right:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;overflow:auto;">' +
      '<div class="zfg-tab" data-tab="featured" style="padding:10px 14px;cursor:pointer;">🔥 榜单精选</div>' +
      '<div class="zfg-tab" data-tab="free" style="padding:10px 14px;cursor:pointer;">🎁 免费游戏</div>' +
      '<div class="zfg-tab" data-tab="mylist" style="padding:10px 14px;cursor:pointer;">🎒 我的游戏</div>' +
      '<div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,.08);">' +
      '<input id="zfgKw" placeholder="搜索 Steam 游戏…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#eee;padding:6px 9px;font-size:12px;outline:none;"/>' +
      '<button id="zfgSearchBtn" style="margin-top:6px;width:100%;background:#3b82f6;border:none;border-radius:8px;color:#fff;padding:6px;font-size:12px;cursor:pointer;">搜索</button>' +
      '</div></div>' +
      '<div id="zfgMain" style="flex:1;overflow:auto;padding:14px;color:#e5e7eb;font-size:13px;"></div>';
    root.querySelector('[data-tab="featured"]').style.background = 'rgba(255,255,255,.08)';
  }

  function bindShell(root) {
    root.querySelectorAll('.zfg-tab').forEach(function (el) {
      el.addEventListener('click', function () { switchTab(el.dataset.tab); });
    });
    var kw = root.querySelector('#zfgKw');
    function doSearch() {
      var v = kw.value.trim();
      if (!v) return;
      state.kw = v;
      switchTab('search');
    }
    root.querySelector('#zfgSearchBtn').addEventListener('click', doSearch);
    kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  }

  function switchTab(tab, silent) {
    state.tab = tab;
    var root = state.root;
    root.querySelectorAll('.zfg-tab').forEach(function (el) {
      el.style.background = el.dataset.tab === tab ? 'rgba(255,255,255,.08)' : '';
    });
    if (tab === 'featured') loadFeatured();
    else if (tab === 'free') loadFree();
    else if (tab === 'search') loadSearch(state.kw);
    else if (tab === 'mylist') renderMylist();
    else if (tab === 'detail') { /* detail 由 openDetail 渲染 */ }
  }

  /* ---------- 榜单 + 折扣 ---------- */
  function loadFeatured() {
    var m = state.root.querySelector('#zfgMain');
    m.innerHTML = '<div style="opacity:.6;">加载中…</div>';
    api('/api/games/featured', null, function (r) {
      if (!r.ok) { m.innerHTML = '<div style="color:#f87171;">榜单获取失败：' + esc(r.err) + '</div>'; return; }
      var h = '<h3 style="margin:4px 0 10px;">🔥 Steam 热销 / 特惠</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
      (r.featured || []).forEach(function (g) { h += cardHtml(g); });
      h += '</div><h3 style="margin:18px 0 10px;">💰 折扣精选（CheapShark，导流官方）</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
      (r.deals || []).forEach(function (d) {
        h += '<div class="zfg-deal" data-appid="' + esc(d.steam_appid) + '" style="background:rgba(255,255,255,.05);border-radius:10px;overflow:hidden;cursor:pointer;">' +
          (d.thumb ? '<img src="' + esc(d.thumb) + '" style="width:100%;display:block;" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
          '<div style="padding:8px 10px;"><div style="font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(d.title) + '</div>' +
          '<div style="font-size:12px;">$' + esc(d.price) + ' <s style="opacity:.5;">$' + esc(d.orig) + '</s> <span style="color:#34d399;">-' + esc(Math.round(d.savings || 0)) + '%</span></div></div></div>';
      });
      h += '</div>';
      m.innerHTML = h;
      bindCards(m);
      m.querySelectorAll('.zfg-deal').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.dataset.appid;
          if (id) openDetail(id); else window.open('https://store.steampowered.com/', '_blank');
        });
      });
    });
  }

  /* ---------- 免费游戏 ---------- */
  function loadFree() {
    var m = state.root.querySelector('#zfgMain');
    m.innerHTML = '<div style="opacity:.6;">加载免费游戏…</div>';
    api('/api/games/free', null, function (r) {
      if (!r.ok) { m.innerHTML = '<div style="color:#f87171;">免费榜获取失败：' + esc(r.err) + '</div>'; return; }
      var h = '<h3 style="margin:4px 0 10px;">🎁 Steam 常驻免费（点卡片可一键安装）</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
      (r.steam || []).forEach(function (g) { h += cardHtml(g); });
      h += '</div><h3 style="margin:18px 0 10px;">💛 Epic 喜加一（限时免费，点卡片去领取）</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
      (r.epic || []).forEach(function (g) {
        h += '<div class="zfg-epic" data-slug="' + esc(g.slug) + '" style="background:rgba(255,255,255,.05);border-radius:10px;overflow:hidden;cursor:pointer;">' +
          (g.header ? '<img src="' + esc(g.header) + '" style="width:100%;display:block;" loading="lazy" onerror="this.onerror=null;this.src=\'data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;230&quot; height=&quot;107&quot;><rect width=&quot;100%&quot; height=&quot;100%&quot; fill=&quot;rgba(255,255,255,.06)&quot;/><text x=&quot;50%&quot; y=&quot;50%&quot; fill=&quot;rgba(255,255,255,.35)&quot; font-size=&quot;12&quot; text-anchor=&quot;middle&quot; dominant-baseline=&quot;middle&quot;>🎮 图片加载失败</text></svg>\';"/>' : '') +
          '<div style="padding:8px 10px;"><div style="font-weight:600;">' + esc(g.name) + '</div>' +
          '<div style="font-size:12px;margin-top:3px;"><s style="opacity:.5;">$' + esc(g.orig || 0) + '</s> <span style="color:#34d399;">现价 ¥0</span></div></div></div>';
      });
      h += '</div><div style="opacity:.5;font-size:11px;margin-top:10px;">数据来自 Steam / Epic 官方公开 API；点击后跳转官方商店一键安装/领取，本应用不提供任何盗版下载。</div>';
      m.innerHTML = h;
      bindCards(m);
      m.querySelectorAll('.zfg-epic').forEach(function (el) {
        el.addEventListener('click', function () {
          var slug = el.dataset.slug;
          window.open('https://store.epicgames.com/p/' + slug, '_blank');
        });
      });
    });
  }

  function cardHtml(g) {
    return '<div class="zfg-card" data-appid="' + esc(g.appid) + '" style="background:rgba(255,255,255,.05);border-radius:10px;overflow:hidden;cursor:pointer;">' +
      (g.header ? '<img src="' + esc(g.header) + '" style="width:100%;display:block;" loading="lazy" onerror="this.onerror=null;this.src=\'data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;230&quot; height=&quot;107&quot;><rect width=&quot;100%&quot; height=&quot;100%&quot; fill=&quot;rgba(255,255,255,.06)&quot;/><text x=&quot;50%&quot; y=&quot;50%&quot; fill=&quot;rgba(255,255,255,.35)&quot; font-size=&quot;12&quot; text-anchor=&quot;middle&quot; dominant-baseline=&quot;middle&quot;>🎮 图片加载失败</text></svg>\';"/>' : '') +
      '<div style="padding:8px 10px;"><div style="font-weight:600;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(g.name) + '</div>' +
      '<div style="font-size:12px;display:flex;justify-content:space-between;align-items:center;">' +
      '<span>' + (g.price === 0 || g.free ? '免费' : (g.price ? '¥' + esc(g.price) : '<span style="opacity:.6;">商店查看</span>')) + '</span>' +
      (g.discount ? '<span style="color:#34d399;">-' + esc(g.discount) + '%</span>' : '') +
      '</div></div></div>';
  }

  function bindCards(scope) {
    scope.querySelectorAll('.zfg-card').forEach(function (el) {
      el.addEventListener('click', function () { openDetail(el.dataset.appid); });
    });
  }

  /* ---------- 搜索 ---------- */
  function loadSearch(kw) {
    var m = state.root.querySelector('#zfgMain');
    m.innerHTML = '<div style="opacity:.6;">搜索「' + esc(kw) + '」中…</div>';
    api('/api/games/search?kw=' + encodeURIComponent(kw), null, function (r) {
      if (!r.ok) { m.innerHTML = '<div style="color:#f87171;">搜索失败：' + esc(r.err) + '</div>'; return; }
      var h = '<h3 style="margin:4px 0 10px;">🔍 「' + esc(kw) + '」的 Steam 搜索结果</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
      (r.items || []).forEach(function (g) { h += cardHtml(g); });
      h += '</div>';
      if (!(r.items || []).length) h += '<div style="opacity:.6;">没有结果</div>';
      m.innerHTML = h;
      bindCards(m);
    });
  }

  /* ---------- 详情 ---------- */
  function openDetail(appid) {
    state.detailAppid = appid;
    switchTab('detail', true);
    var m = state.root.querySelector('#zfgMain');
    m.innerHTML = '<div style="opacity:.6;">加载详情…</div>';
    api('/api/games/detail?appid=' + appid, null, function (r) {
      if (!r.ok) { m.innerHTML = '<div style="color:#f87171;">详情获取失败：' + esc(r.err) + '</div>'; return; }
      var g = r.game;
      var st = myStatus(appid);
      var h = '<div style="max-width:760px;">' +
        '<button id="zfgBack" style="background:rgba(255,255,255,.08);border:none;border-radius:8px;color:#eee;padding:5px 12px;cursor:pointer;margin-bottom:10px;">← 返回</button>' +
        '<h2 style="margin:6px 0;">' + esc(g.name) + '</h2>' +
        (g.header ? '<img src="' + esc(g.header) + '" style="max-width:100%;border-radius:10px;"/>' : '') +
        '<div style="margin:10px 0;opacity:.85;line-height:1.6;">' + esc(g.short) + '</div>' +
        '<div style="font-size:12px;opacity:.75;margin-bottom:8px;">' +
        (g.release ? '发行：' + esc(g.release) + '　' : '') +
        (g.developers && g.developers.length ? '开发商：' + esc(g.developers.join('、')) + '　' : '') +
        '价格：' + (g.price ? '¥' + esc(g.price) + (g.discount ? ' <span style="color:#34d399;">-' + esc(g.discount) + '%</span>' : '') : '免费') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">' +
        ['want|想玩', 'playing|在玩', 'played|玩过'].map(function (p) {
          var kv = p.split('|'), k = kv[0], lab = kv[1];
          var active = st === k;
          return '<button class="zfg-status" data-status="' + k + '" style="background:' + (active ? '#3b82f6' : 'rgba(255,255,255,.08)') + ';border:none;border-radius:8px;color:#fff;padding:6px 14px;cursor:pointer;">' + lab + '</button>';
        }).join('') +
        '<button id="zfgStore" style="background:#16a34a;border:none;border-radius:8px;color:#fff;padding:6px 14px;cursor:pointer;">去 Steam 官方页 ↗</button>' +
        '<button id="zfgInstall" style="background:#2563eb;border:none;border-radius:8px;color:#fff;padding:6px 14px;cursor:pointer;">⬇ 一键安装（唤起 Steam）</button>' +
        '</div>' +
        '<div style="font-size:12px;opacity:.75;margin:8px 0 4px;">其他渠道：</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 12px;">' +
        '<button class="zfg-chan" data-url="https://www.gog.com/en/games?query=' + encodeURIComponent(g.name) + '" style="background:rgba(255,255,255,.08);border:none;border-radius:8px;color:#ddd;padding:5px 12px;cursor:pointer;">GOG 搜同款</button>' +
        '<button class="zfg-chan" data-url="https://itch.io/search?q=' + encodeURIComponent(g.name) + '" style="background:rgba(255,255,255,.08);border:none;border-radius:8px;color:#ddd;padding:5px 12px;cursor:pointer;">itch.io 搜同款</button>' +
        '<button class="zfg-chan" data-url="https://store.epicgames.com/en-US/browse?q=' + encodeURIComponent(g.name) + '" style="background:rgba(255,255,255,.08);border:none;border-radius:8px;color:#ddd;padding:5px 12px;cursor:pointer;">Epic 搜同款</button>' +
        '</div>' +
        ((g.screenshots || []).length ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + g.screenshots.map(function (s) { return '<img src="' + esc(s) + '" style="width:100%;border-radius:8px;" loading="lazy"/>'; }).join('') + '</div>' : '') +
        '<div style="opacity:.5;font-size:11px;margin-top:10px;">信息来自各平台官方公开 API，仅作展示与官方渠道导流/一键安装，本应用不提供任何盗版下载。</div></div>';
      m.innerHTML = h;
      m.querySelector('#zfgBack').addEventListener('click', function () { switchTab(state.kw ? 'search' : 'featured'); });
      m.querySelector('#zfgStore').addEventListener('click', function () { window.open(g.store_url, '_blank'); });
      m.querySelector('#zfgInstall').addEventListener('click', function () {
        window.location.href = 'steam://install/' + appid;
      });
      m.querySelectorAll('.zfg-chan').forEach(function (el) {
        el.addEventListener('click', function () { window.open(el.dataset.url, '_blank'); });
      });
      m.querySelectorAll('.zfg-status').forEach(function (el) {
        el.addEventListener('click', function () { setStatus(appid, g.name, el.dataset.status); });
      });
    });
  }

  /* ---------- 我的列表 ---------- */
  function myStatus(appid) {
    for (var i = 0; i < state.mylist.length; i++) if (state.mylist[i].appid === String(appid)) return state.mylist[i].status;
    return '';
  }

  function loadMylist(cb) {
    api('/api/games/list', null, function (r) {
      state.mylist = (r && r.ok && r.list) ? r.list : [];
      cb && cb();
    });
  }

  function setStatus(appid, name, status) {
    api('/api/games/list', { method: 'POST', body: { action: 'status', appid: String(appid), name: name, status: status } }, function (r) {
      if (!r.ok) { alert('保存失败：' + r.err); return; }
      loadMylist(function () {
        if (state.tab === 'detail') openDetail(appid);
        else renderMylist();
      });
    });
  }

  function renderMylist() {
    var m = state.root.querySelector('#zfgMain');
    var cols = [['want', '🎯 想玩'], ['playing', '🎮 在玩'], ['played', '✅ 玩过']];
    var h = '<h3 style="margin:4px 0 10px;">🎒 我的游戏</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">';
    cols.forEach(function (c) {
      h += '<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:10px;min-height:120px;">' +
        '<div style="font-weight:600;margin-bottom:8px;">' + c[1] + '</div>';
      var items = state.mylist.filter(function (g) { return g.status === c[0]; });
      if (!items.length) h += '<div style="opacity:.4;font-size:12px;">空</div>';
      items.forEach(function (g) {
        h += '<div class="zfg-myitem" data-appid="' + esc(g.appid) + '" style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.05);border-radius:8px;padding:6px 9px;margin-bottom:6px;cursor:pointer;">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(g.name) + '</span>' +
          '<button class="zfg-del" data-appid="' + esc(g.appid) + '" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:14px;" title="移出列表">✕</button>' +
          '</div>';
      });
      h += '</div>';
    });
    h += '</div>';
    m.innerHTML = h;
    m.querySelectorAll('.zfg-myitem').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('zfg-del')) return;
        openDetail(el.dataset.appid);
      });
    });
    m.querySelectorAll('.zfg-del').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        api('/api/games/list', { method: 'POST', body: { action: 'remove', appid: el.dataset.appid } }, function (r) {
          if (r.ok) loadMylist(renderMylist);
        });
      });
    });
  }

  window.ZFGame = { onOpen: onOpen, onClose: onClose };
})();
