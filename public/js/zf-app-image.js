/* zf-app-image.js — i图片 多源聚合图库（M1: 瀑布流+搜索；大图查看器） */
(function () {
  'use strict';
  if (window.ZFImage) return;
  var ICON_IMAGE = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/></svg>';

  var state = { wd: '', page: 1, loading: false, sites: [], cur: null, list: [] };
  var win = null, els = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function proxied(url) { return '/api/iimage/proxy?url=' + encodeURIComponent(url); }

  function api(path, cb) {
    fetch(path).then(function (r) { return r.json(); }).then(cb).catch(function (e) { cb({ ok: false, err: String(e) }); });
  }

  function renderSites() {
    var s = state.sites.filter(function (x) { return x.status === 'verified' && !x.needKey; });
    els.siteSel.innerHTML = '<option value="">全部源</option>' + s.map(function (x) {
      return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
    }).join('');
  }

  function renderGrid() {
    els.grid.innerHTML = state.list.map(function (it, i) {
      return '<div class="zf-img-card" data-i="' + i + '">' +
        '<img loading="lazy" src="' + esc(proxied(it.thumb)) + '" alt="" ' +
        'onerror="var c=this.closest(\'.zf-img-card\');if(c){c.remove();}var g=document.querySelector(\'.zf-img-grid\');if(g&&!g.querySelector(\'.zf-img-card\')){g.innerHTML=\'<div class=zf-img-empty>本页图片加载失败较多，试试下一页或换个关键词</div>\';}">' +
        '<div class="zf-img-cap">' + esc((it.w || '?') + '×' + (it.h || '?')) + ' · ' + esc(it.source) + '</div></div>';
    }).join('') || '<div class="zf-img-empty">无结果，换个关键词试试</div>';
  }

  function search(reset) {
    if (state.loading) return;
    if (reset) { state.page = 1; state.list = []; }
    state.loading = true;
    els.status.textContent = '搜索中…';
    /* 换关键词搜索时立即清空旧图，避免新旧混杂（2026-11-17） */
    if (reset) { els.grid.innerHTML = '<div class="zf-img-empty">🔍 搜索中，请稍候…</div>'; }
    els.pageEl.textContent = '第 ' + state.page + ' 页';
    var site = els.siteSel.value || '';
    api('/api/iimage/search?wd=' + encodeURIComponent(state.wd) + '&page=' + state.page + (site ? '&site=' + site : ''), function (r) {
      state.loading = false;
      if (!r.ok) { els.status.textContent = '搜索失败：' + (r.err || '?'); return; }
      state.list = r.list || [];
      renderGrid();
      els.pageEl.textContent = '第 ' + state.page + ' 页 · 本页 ' + state.list.length + ' 张';
      /* 展示实际使用的英文关键词，便于用户理解中文被翻译成了什么 */
      var wdShown = state.wd || '随机';
      if (r.wd_en && r.wd_en !== state.wd) wdShown += ' → ' + r.wd_en;
      els.status.textContent = '关键词「' + wdShown + '」';
    });
  }

  var vz = { scale: 1, tx: 0, ty: 0 };
  function vzApply() {
    els.viewer.style.transform = 'translate(' + vz.tx + 'px,' + vz.ty + 'px) scale(' + vz.scale + ')';
  }
  function vzReset() { vz.scale = 1; vz.tx = 0; vz.ty = 0; vzApply(); }

  function openViewer(it) {
    state.cur = it;
    els.viewerCap.textContent = '加载中… ' + (it.source || '') + ' · ' + (it.w || '?') + '×' + (it.h || '?');
    els.viewerBox.classList.add('open');
    vzReset();
    els.viewer.classList.add('loading');
    els.viewer.onload = function () {
      els.viewer.classList.remove('loading');
      els.viewerCap.textContent = (it.source || '') + ' · ' + (it.w || '?') + '×' + (it.h || '?') + ' · 滚轮缩放 / 中键拖动平移 / ←→ 翻页 / 点击空白关闭';
    };
    els.viewer.onerror = function () {
      if (els.viewer.dataset.fallback !== it.url && it.thumb) {
        els.viewer.dataset.fallback = it.url;
        els.viewerCap.textContent = '原图加载失败，改用缩略图显示…';
        els.viewer.src = proxied(it.thumb);
        return;
      }
      els.viewer.classList.remove('loading');
      els.viewerCap.textContent = '❌ 图片加载失败';
    };
    els.viewer.src = proxied(it.url);
  }

  /* 大图查看器左右翻页：在当前搜索结果列表内移动 */
  function viewerNav(dir) {
    if (!els.viewerBox.classList.contains('open') || !state.list.length) return;
    var i = state.list.findIndex(function (x) { return x === state.cur; });
    if (i < 0) i = 0;
    var n = i + dir;
    if (n < 0 || n >= state.list.length) return; /* 到头不动 */
    openViewer(state.list[n]);
  }

  function buildWin(container) {
    var inner =
      '<div class="zf-img-toolbar">' +
      '<input id="zfImgWd" placeholder="搜索图片…（支持中文，自动译英文；留空随机壁纸）">' +
      '<select id="zfImgSite"></select>' +
      '<button id="zfImgGo">搜索</button>' +
      '<span id="zfImgStatus"></span></div>' +
      '<div id="zfImgGrid" class="zf-img-grid"></div>' +
      '<div id="zfImgPager" class="zf-img-pager">' +
      '<button id="zfImgPrev">‹ 上一页</button>' +
      '<span id="zfImgPage"></span>' +
      '<button id="zfImgNext">下一页 ›</button></div>' +
      '<div id="zfImgViewer" class="zf-img-viewer"><div id="zfImgViewerBox"><img id="zfImgViewerImg"></div><button id="zfImgVPrev" class="zf-img-vnav" title="上一张 (←)">‹</button><button id="zfImgVNext" class="zf-img-vnav" title="下一张 (→)">›</button><div id="zfImgViewerCap"></div></div>';
    /* 【修复 2026-11-16】dock 的 openImage() 已创建 #zfImageWin 外壳（window.zfCreateAppWindow 不存在，
       旧代码在此自建窗口得到 null → 整窗空白无搜索栏）。现把 UI 挂进 dock 传入的内容容器 */
    win = container || document.getElementById('zfImageBody');
    if (!win) return;
    win.innerHTML = inner;
    els.wd = win.querySelector('#zfImgWd');
    els.siteSel = win.querySelector('#zfImgSite');
    els.grid = win.querySelector('#zfImgGrid');
    els.status = win.querySelector('#zfImgStatus');
    els.viewerBox = win.querySelector('#zfImgViewer');
    els.viewer = win.querySelector('#zfImgViewerImg');
    els.viewerCap = win.querySelector('#zfImgViewerCap');
    els.pageEl = win.querySelector('#zfImgPage');
    win.querySelector('#zfImgPrev').addEventListener('click', function () {
      if (state.loading) return;
      state.page = Math.max(1, state.page - 1); search(false);
      els.grid.scrollTop = 0;
    });
    win.querySelector('#zfImgNext').addEventListener('click', function () {
      if (state.loading) return;
      if (!state.list.length && state.page > 1) return;
      state.page += 1; search(false);
      els.grid.scrollTop = 0;
    });
    var css = document.createElement('style');
    css.textContent = [
      '#zfImageWin .zf-img-toolbar{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);}',
      '#zfImageWin .zf-img-toolbar input{flex:1;min-width:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#fff;padding:6px 10px;font-size:14px;}',
      '#zfImageWin .zf-img-toolbar select,#zfImageWin .zf-img-toolbar button{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:6px 10px;cursor:pointer;}',
      '#zfImageWin .zf-img-toolbar button:hover{background:rgba(255,255,255,.2);}',
      '#zfImageWin #zfImgStatus{color:rgba(255,255,255,.55);font-size:12px;margin-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%;}',
      '#zfImageWin .zf-img-grid{flex:1;overflow-y:auto;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;align-content:start;}',
      /* 缩略图最小高度占位：加载前/失败时不再是一条线 */
      '#zfImageWin .zf-img-card{position:relative;border-radius:8px;overflow:hidden;cursor:pointer;background:rgba(255,255,255,.05);min-height:150px;aspect-ratio:4/3;}',
      '#zfImageWin .zf-img-card img{width:100%;height:100%;min-height:150px;object-fit:cover;display:block;background:rgba(255,255,255,.04);}',
      '#zfImageWin .zf-img-card:hover img{transform:scale(1.04);transition:transform .2s;}',
      '#zfImageWin .zf-img-cap{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;font-size:11px;padding:14px 6px 4px;}',
      '#zfImageWin .zf-img-empty{grid-column:1/-1;text-align:center;color:rgba(255,255,255,.5);padding:40px 0;}',
      '#zfImageWin .zf-img-pager{display:flex;gap:12px;align-items:center;justify-content:center;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);}',
      '#zfImageWin .zf-img-pager button{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:6px 18px;cursor:pointer;}',
      '#zfImageWin .zf-img-pager button:hover{background:rgba(255,255,255,.2);}',
      '#zfImageWin .zf-img-pager span{color:rgba(255,255,255,.7);font-size:12px;white-space:nowrap;}',
      '#zfImageWin .zf-img-viewer{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10001;align-items:center;justify-content:center;flex-direction:column;}',
      '#zfImageWin .zf-img-viewer.open{display:flex;}',
      '#zfImageWin #zfImgViewerBox{width:92%;height:86%;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:zoom-out;}',
      '#zfImageWin #zfImgViewerImg{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;transform-origin:center center;transition:transform .06s linear;user-select:none;}',
      '#zfImageWin #zfImgViewerImg.loading{opacity:0;}',
      '#zfImageWin #zfImgViewerImg.loading+#zfImgLoading::after,',
      '#zfImageWin #zfImgViewerBox.loading::after{content:"加载中…";position:absolute;color:rgba(255,255,255,.7);font-size:14px;}',
      '#zfImageWin #zfImgViewerBox{position:relative;}',
      '#zfImageWin #zfImgViewerCap{color:#fff;margin-top:10px;font-size:13px;}',
      /* 大图查看器左右翻页按钮 */
      '#zfImageWin .zf-img-vnav{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:64px;font-size:32px;line-height:1;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;cursor:pointer;z-index:2;}',
      '#zfImageWin .zf-img-vnav:hover{background:rgba(255,255,255,.28);}',
      '#zfImageWin #zfImgVPrev{left:14px;}',
      '#zfImageWin #zfImgVNext{right:14px;}'
    ].join('\n');
    document.head.appendChild(css);
    els.grid.addEventListener('click', function (e) {
      var card = e.target.closest('.zf-img-card');
      if (card) openViewer(state.list[+card.dataset.i]);
    });
    els.viewerBox.addEventListener('click', function (e) {
      if (e.target === els.viewer || els.viewer.contains(e.target)) return; /* 点图片不关 */
      els.viewerBox.classList.remove('open'); els.viewer.src = ''; els.viewer.onload = null; els.viewer.onerror = null;
    });
    /* 滚轮缩放（跟随鼠标位置） */
    els.viewerBox.addEventListener('wheel', function (e) {
      e.preventDefault(); e.stopPropagation();
      var rect = els.viewerBox.getBoundingClientRect();
      var mx = e.clientX - rect.left - rect.width / 2;
      var my = e.clientY - rect.top - rect.height / 2;
      var old = vz.scale;
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var ns = Math.min(12, Math.max(0.2, vz.scale * factor));
      if (ns === old) return;
      /* 保持鼠标下的图像点不动：新偏移 = 旧偏移 - 鼠标相对中心 * (新倍率-旧倍率)/旧倍率 */
      vz.tx = vz.tx - mx * (ns / old - 1);
      vz.ty = vz.ty - my * (ns / old - 1);
      vz.scale = ns;
      vzApply();
    }, { passive: false });
    /* 中键按住平移 */
    var pan = null;
    els.viewerBox.addEventListener('mousedown', function (e) {
      if (e.button !== 1) return;
      e.preventDefault(); e.stopPropagation();
      pan = { x: e.clientX, y: e.clientY, tx: vz.tx, ty: vz.ty };
      els.viewerBox.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!pan || !els.viewerBox.classList.contains('open')) { pan = null; return; }
      vz.tx = pan.tx + (e.clientX - pan.x);
      vz.ty = pan.ty + (e.clientY - pan.y);
      vzApply();
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 1 && pan) { pan = null; els.viewerBox.style.cursor = 'zoom-out'; }
    });
    els.viewerBox.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    /* 左右翻页按钮（防止冒泡误触关闭） */
    var vPrev = win.querySelector('#zfImgVPrev'), vNext = win.querySelector('#zfImgVNext');
    vPrev.addEventListener('click', function (e) { e.stopPropagation(); viewerNav(-1); });
    vNext.addEventListener('click', function (e) { e.stopPropagation(); viewerNav(1); });
    /* 键盘 ←/→ 翻页，Esc 关闭查看器（capture 拦截，不冒泡到全局快捷键） */
    document.addEventListener('keydown', function (e) {
      if (!els.viewerBox.classList.contains('open')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); viewerNav(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); viewerNav(1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); els.viewerBox.classList.remove('open'); els.viewer.src = ''; els.viewer.onload = null; els.viewer.onerror = null; }
    }, true);
    els.wd.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { state.wd = els.wd.value.trim(); search(true); }
      e.stopPropagation(); /* 不让按键冒泡到全局快捷键 */
    });
    win.querySelector('#zfImgGo').addEventListener('click', function () { state.wd = els.wd.value.trim(); search(true); });
    api('/api/iimage/sites', function (r) {
      if (r.ok) { state.sites = r.sites; renderSites(); }
    });
    /* 首屏：随机壁纸 */
    state.wd = '';
    search(true);
  }

  window.ZFImage = {
    onOpen: function (container) { if (!win) buildWin(container); if (win) win.classList.add('open'); },
    onClose: function () { var w = document.getElementById('zfImageWin'); if (w) w.classList.remove('open'); if (els.viewerBox) els.viewerBox.classList.remove('open'); }
  };
  window.ZFImageIcon = ICON_IMAGE;
})();
