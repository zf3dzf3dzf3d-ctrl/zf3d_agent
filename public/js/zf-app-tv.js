/* =====================================
   i电视 v2 — 免费IPTV直播（iptv-org 中文频道源）
   v2 新增（2026-11-11 收口）：收藏/最近观看、死链灰显（/api/tv/status）、
   版权提示条、window.ZFTV.playByName AI 一句话换台
   播放链路：hls.js 本地化 + /api/tvproxy 跨域代理（v1 收口已建）
   ===================================== */
(function () {
  'use strict';
  var LS_KEY = 'zfTvLastCh';
  var LS_FAV = 'zfTvFavs';
  var LS_HIST = 'zfTvHist';
  var M3U_PATH = '/data/iptv-cn.m3u';
  var HLS_CDN = '/js/hls.min.js'; /* 本地化：CSP script-src 'self' 不放行外链 CDN（2026-11-11 收口） */
  var state = { chans: [], cur: null, hls: null, filter: '', mounted: false, dead: {} };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* 频道名归类：央视 / 卫视 / 其他 */
  function catOf(name) {
    if (/^CCTV/i.test(name)) return '央视';
    if (/Satellite TV|卫视/i.test(name)) return '卫视';
    return '其他';
  }

  function loadHls(cb) {
    if (window.Hls && window.Hls.isSupported()) return cb();
    var s = document.createElement('script');
    s.src = HLS_CDN;
    s.onload = cb;
    s.onerror = function () {
      /* v2.1：本地 hls.min.js 也加载失败（异常部署/文件缺失），给出明确提示后降级 */
      var tip = document.getElementById('zfTvTip');
      if (tip) tip.textContent = '播放器组件加载失败，部分频道可能无法播放';
      cb();
    };
    document.head.appendChild(s);
  }

  /* —— 收藏 / 最近观看（localStorage） —— */
  function getFavs() { try { return JSON.parse(localStorage.getItem(LS_FAV) || '[]'); } catch (e) { return []; } }
  function isFav(url) { return getFavs().indexOf(url) >= 0; }
  function toggleFav(url) {
    var f = getFavs();
    var i = f.indexOf(url);
    if (i >= 0) f.splice(i, 1); else f.unshift(url);
    try { localStorage.setItem(LS_FAV, JSON.stringify(f.slice(0, 50))); } catch (e) { }
    renderList();
  }
  function pushHist(ch) {
    var h = [];
    try { h = JSON.parse(localStorage.getItem(LS_HIST) || '[]'); } catch (e) { }
    h = h.filter(function (x) { return x.url !== ch.url; });
    h.unshift({ name: ch.name, url: ch.url, t: Date.now() });
    try { localStorage.setItem(LS_HIST, JSON.stringify(h.slice(0, 20))); } catch (e) { }
  }
  function histChans() {
    var h = [];
    try { h = JSON.parse(localStorage.getItem(LS_HIST) || '[]'); } catch (e) { }
    return h.map(function (x) {
      var c = state.chans.filter(function (y) { return y.url === x.url; })[0];
      return c || { name: x.name, url: x.url, cat: '其他' };
    });
  }
  function favChans() {
    return getFavs().map(function (u) {
      return state.chans.filter(function (y) { return y.url === u; })[0];
    }).filter(Boolean);
  }

  /* v3：失败自动换源 —— 同频道 urls 依次尝试，全部失败才提示换台 */
  function play(ch, tryIdx) {
    var v = document.getElementById('zfTvVideo');
    var tip = document.getElementById('zfTvTip');
    if (!v || !ch) return;
    var idx = tryIdx || 0;
    var url = ch.urls ? ch.urls[idx] : ch.url;
    if (!url) return;
    state.cur = ch;
    try { localStorage.setItem(LS_KEY, url); } catch (e) { }
    pushHist(ch);
    renderActive();
    if (tip) tip.textContent = (idx > 0 ? '源 ' + (idx + 1) + '/' + ch.urls.length + ' 正在连接：' : '正在连接：') + ch.name;
    if (state.hls) { try { state.hls.destroy(); } catch (e) { } state.hls = null; }
    v.pause();
    var canNative = v.canPlayType('application/vnd.apple.mpegurl');

    function tryNextSource() {  /* 当前源不可用 → 自动尝试同频道下一源 */
      if (ch.urls && idx + 1 < ch.urls.length) {
        play(ch, idx + 1);
      } else {
        if (tip) tip.textContent = '该频道所有源均不可用（公开免费源不稳定），请换台';
      }
    }

    function playViaProxy() {
      v.src = '/api/tvproxy?u=' + encodeURIComponent(url);
      v.play().then(function () { if (tip) tip.textContent = ''; })
        .catch(function () { tryNextSource(); });
    }

    if (canNative) {
      playViaProxy();
      /* 原生 HLS 无逐事件回调：靠 error 事件兜底换源 */
      v.onerror = function () { v.onerror = null; tryNextSource(); };
      return;
    }
    loadHls(function () {
      if (window.Hls && window.Hls.isSupported()) {
        var hls = new Hls({ maxBufferLength: 30 });
        state.hls = hls;
        var switched = false;
        hls.loadSource('/api/tvproxy?u=' + encodeURIComponent(url));
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          if (tip) tip.textContent = '';
          v.play().catch(function () { });
        });
        hls.on(Hls.Events.ERROR, function (_e, data) {
          if (data && data.fatal && !switched) {
            switched = true;
            try { hls.destroy(); } catch (e2) { } state.hls = null;
            tryNextSource();
          }
        });
      } else {
        playViaProxy();
      }
    });
  }

  function renderList() {
    var box = document.getElementById('zfTvList');
    if (!box) return;
    var kw = (state.filter || '').toLowerCase();
    var html = '';
    /* 死链灰显 + 版权提示条（S5/S2） */
    html += '<div class="zfTv-legal">ℹ️ 频道来自公开免费 IPTV 源（iptv-org），仅供学习测试，不保证可用与版权合规</div>';
    var groups = [];
    var favs = favChans();
    var hist = histChans();
    if (favs.length) groups.push(['★ 收藏', favs]);
    if (!kw && hist.length) groups.push(['🕘 最近观看', hist.slice(0, 8)]);
    var cats = { '央视': [], '卫视': [], '其他': [] };
    state.chans.forEach(function (c) {
      if (kw && c.name.toLowerCase().indexOf(kw) < 0) return;
      (cats[c.cat] || cats['其他']).push(c);
    });
    Object.keys(cats).forEach(function (cat) {
      if (cats[cat].length) groups.push([cat + '（' + cats[cat].length + '）', cats[cat]]);
    });
    groups.forEach(function (g) {
      html += '<div class="zfTv-cat">' + esc(g[0]) + '</div>';
      g[1].forEach(function (c) {
        var on = state.cur && state.cur.url === c.url;
        var dead = state.dead[c.url] === 0;
        var fav = isFav(c.url);
        html += '<div class="zfTv-ch' + (on ? ' on' : '') + (dead ? ' dead' : '') + '" data-u="' + esc(c.url) + '">' +
          '<span class="zfTv-fav' + (fav ? ' on' : '') + '" data-f="' + esc(c.url) + '">' + (fav ? '★' : '☆') + '</span> ' +
          esc(c.name) + (dead ? ' <span class="zfTv-deadtag">✕</span>' : '') + '</div>';
      });
    });
    if (!html.replace(/<div class="zfTv-legal">[\s\S]*?<\/div>/, '')) html += '<div style="padding:14px;color:#8a8f9c;font-size:12px;">没有匹配的频道，换个关键词试试</div>';
    box.innerHTML = html;
  }
  /* v2.1：事件委托——列表容器只绑一次（mount 时），替代 renderList 每次全量重绑 */
  function bindListEvents(box) {
    box.addEventListener('click', function (ev) {
      var favEl = ev.target.closest('.zfTv-fav');
      if (favEl) { toggleFav(favEl.getAttribute('data-f')); return; }
      var chEl = ev.target.closest('.zfTv-ch');
      if (chEl) {
        var u = chEl.getAttribute('data-u');
        var c = state.chans.filter(function (x) { return x.url === u; })[0];
        if (c) play(c);
      }
    });
  }
  function renderActive() { renderList(); }

  function parseM3U(text) {
    var lines = text.split(/\r?\n/);
    var out = [], name = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('#EXTINF') === 0) {
        name = (l.split(',').slice(1).join(',') || '未知频道').trim();
      } else if (l && l.charAt(0) !== '#') {
        out.push({ name: name, url: l.trim(), cat: catOf(name) });
        name = '';
      }
    }
    return out;
  }

  /* v3 去重：同名频道只显示一个，其余 URL 作为备用源（播放失败自动切换） */
  function dedupe(list) {
    var map = {};   /* normName -> {name, cat, urls:[]} */
    var order = [];
    list.forEach(function (c) {
      var k = c.name.toLowerCase().replace(/[\s\-_（）()：:]/g, '');
      if (!k) return;
      if (!map[k]) { map[k] = { name: c.name, url: c.url, cat: c.cat, urls: [c.url], idx: 0 }; order.push(map[k]); }
      else if (map[k].urls.indexOf(c.url) < 0) map[k].urls.push(c.url);
    });
    return order;
  }

  function mount(body) {
    body.innerHTML =
      '<div id="zfTvWrap">' +
      '<div id="zfTvSide">' +
      '<input id="zfTvSearch" type="text" placeholder="搜频道：CCTV / 卫视 …" />' +
      '<div id="zfTvList" class="zfTv-list"></div>' +
      '</div>' +
      '<div id="zfTvMain">' +
      '<video id="zfTvVideo" controls autoplay muted playsinline></video>' +
      '<div id="zfTvTip"></div>' +
      '</div>' +
      '</div>' +
      '<style>' +
      '#zfTvWrap{flex:1;display:flex;overflow:hidden;background:#101116;}' +
      '#zfTvSide{width:230px;min-width:180px;border-right:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;}' +
      '#zfTvSearch{margin:8px;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e8e8ee;font-size:12px;outline:none;}' +
      '.zfTv-list{flex:1;overflow-y:auto;padding:0 6px 10px;}' +
      '.zfTv-legal{color:#7a7f8c;font-size:10.5px;padding:6px 8px;line-height:1.4;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px;}' +
      '.zfTv-cat{color:#9aa0ae;font-size:11px;padding:10px 6px 4px;}' +
      '.zfTv-ch{padding:7px 10px;border-radius:8px;font-size:12.5px;color:#dcdde2;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.zfTv-ch:hover{background:rgba(255,255,255,.08);}' +
      '.zfTv-ch.on{background:rgba(124,92,255,.28);color:#fff;}' +
      '.zfTv-ch.dead{opacity:.42;}' +
      '.zfTv-deadtag{color:#e06c6c;font-size:10px;}' +
      '.zfTv-fav{cursor:pointer;opacity:.55;}' +
      '.zfTv-fav.on{opacity:1;color:#f5c542;}' +
      '#zfTvMain{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;position:relative;}' +
      '#zfTvVideo{width:100%;height:100%;object-fit:contain;background:#000;}' +
      '#zfTvTip{position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;padding:5px 10px;border-radius:8px;max-width:80%;}' +
      '</style>';
    state.mounted = true;
    var search = document.getElementById('zfTvSearch');
    search.addEventListener('input', function () { clearTimeout(state._deb); state._deb = setTimeout(function () { state.filter = search.value.trim(); renderList(); }, 250); }); /* v2.2：250ms 防抖——1619 频道下每击键全量重建列表卡顿（代码师S1收口） */
    /* v2.1：事件委托只绑一次 */
    bindListEvents(document.getElementById('zfTvList'));
    var tip = document.getElementById('zfTvTip');
    tip.textContent = '频道列表加载中…';

    /* 死链状态异步拉取（不阻塞主列表） */
    fetch('/api/tv/status').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { state.dead = j.status || {}; renderList(); }
    }).catch(function () { });

    fetch(M3U_PATH).then(function (r) { return r.text(); }).then(function (t) {
      state.chans = dedupe(parseM3U(t));
      if (!state.chans.length) { tip.textContent = '频道列表为空'; return; }
      renderList();
      /* 恢复上次频道 */
      var last = '';
      try { last = localStorage.getItem(LS_KEY) || ''; } catch (e) { }
      var c = last && state.chans.filter(function (x) { return x.url === last; })[0];
      if (!c) {
        /* 默认优先 CCTV 综合 */
        c = state.chans.filter(function (x) { return /^CCTV-?1|CCTV 1/i.test(x.name); })[0]
          || state.chans.filter(function (x) { return x.cat === '央视'; })[0] || state.chans[0];
      }
      play(c);
    }).catch(function () {
      tip.textContent = '频道列表加载失败：' + M3U_PATH;
    });
  }

  /* AI 一句话换台（S6）：按频道名模糊匹配并播放 */
  function playByName(kw) {
    kw = String(kw || '').trim();
    if (!kw) return { ok: false, msg: '缺频道名' };
    if (!state.chans.length) return { ok: false, msg: '频道列表未加载' };
    var hit = state.chans.filter(function (x) { return x.name.toLowerCase().indexOf(kw.toLowerCase()) >= 0; })[0];
    if (!hit) return { ok: false, msg: '没找到含「' + kw + '」的频道，试试 CCTV / 卫视名' };
    if (!document.getElementById('zfTvVideo')) {
      /* 窗口未开：让 dock 打开（ZFDock.openTv 已导出），开窗后自动按上次频道；此处退而求其次直接记忆频道 */
      try { localStorage.setItem(LS_KEY, hit.url); } catch (e) { }
      if (window.ZFDock && window.ZFDock.openTv) { window.ZFDock.openTv(); return { ok: true, ch: hit.name, msg: '已打开i电视并定位：' + hit.name }; }
      return { ok: false, msg: 'i电视窗口未打开且无法自动打开' };
    }
    play(hit);
    return { ok: true, ch: hit.name, msg: '正在播放：' + hit.name };
  }

  window.ZFTV = {
    onOpen: function (body) { mount(body); },
    onClose: function () {
      if (state.hls) { try { state.hls.destroy(); } catch (e) { } state.hls = null; }
      var v = document.getElementById('zfTvVideo');
      if (v) { try { v.pause(); } catch (e) { } }
    },
    playByName: playByName
  };
})();
