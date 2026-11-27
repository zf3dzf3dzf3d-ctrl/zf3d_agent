/* ============================================================
 * zf-app-video.js v6（2026-11-21 全量重写：照抄v5+五点卡片要求） — i视频 内容模块（M1：搜索+播放）
 * 挂载点：#zfVideoBody（由 zf-app-dock.js openVideo 懒挂载）
 * 契约：window.ZFVideo = { onOpen(body), onClose() }
 * 【接线纪律】新增 ivideo 写接口（POST/PUT/DELETE）必须双处接线：
 *  前端 fetch + server/routes/api_dispatch_post.py 分发表，漏后者必 404
 *  （案例：/api/ivideo/progress 曾因漏 POST 分发运行时 404，见 commit 0106012）
 * 设计裁决（采纳收口）：
 *  - 事件在容器内自管（不抄 i漫画全局 keydown 硬编码）
 *  - 播放走后端 /api/ivideo/proxy（解决 m3u8 跨域）
 *  - 多源结果已由后端聚合，前端一次搜索直接渲染，不重复发全站请求
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFVideo) return;

  var ICON = '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="4" width="20" height="16" rx="4.5" fill="#ff5a76"/><path d="M10 8.6l5.6 3.4-5.6 3.4z" fill="#fff"/></svg>';
  var body, ui = {}, hls = null, curList = [], curWd = '', curPage = 1, PAGE_SIZE = 60;
  var curRawUrl = '';
  /* 【v2 2026-11-11】独立端口流媒体代理（默认 8626）：主服务繁忙时播放不受影响；
     探测失败自动回退主服务代理。进度记忆走 /api/ivideo/progress。 */
  var STREAM_PORT = 8626, streamBase = null, curItem = null, curEpIdx = 0, eps = [];
  var progressTimer = null, lastPos = 0, resumeAt = 0, switching = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectCss() {
    if (document.getElementById('zfvStyle')) return;
    var st = document.createElement('style');
    st.id = 'zfvStyle';
    st.textContent =
      '.zfv-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#141519;color:#d8d8e0;font-size:13px}' +
      '.zfv-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto}' +
      '.zfv-logo{display:flex;align-items:center;gap:6px;font-weight:700;color:#fff;font-size:15px;letter-spacing:.5px}' +
      '.zfv-logo svg{color:#ff5a76}' +
      '.zfv-search{flex:1;background:#1e2026;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#d8d8e0;padding:6px 12px;font-size:13px;outline:none;min-width:60px}' +
      '.zfv-search:focus{border-color:#ff5a76}' +
      '.zfv-btn{background:#ff5a76;border:none;color:#fff;border-radius:6px;padding:6px 16px;font-size:13px;cursor:pointer}' +
      '.zfv-btn:hover{filter:brightness(1.1)}' +
      /* ===== v3 2026-11-21 缩略图卡片重写（按用户手绘稿）===== */
      /* ===== v6.1 2026-11-22 根因修复：网格 flex:1(确定高)+overflow-y:auto(滚动容器) 时，Chromium 把 auto 行"均分容器高度"而非按内容撑高，行塌成~12px 裁掉海报。
         grid-auto-rows:max-content 强制行按内容撑高；卡片在 cardHtml 另内联 height:304px 双保险（几何真源纪律不变）。 ===== */
      '.zfv-grid{flex:1;overflow-y:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,204px);grid-auto-rows:max-content;gap:16px;justify-content:start;align-content:start}' +
      /* ===== v5 2026-11-21 卡片定稿：卡片204(border-box)/海报202x302。几何真源=cardHtml内联，此处CSS仅兜底颜色/阴影；改尺寸务必改内联，改CSS无效 ===== */
      '.zfv-card{box-sizing:border-box;width:204px;background:#1d1f26;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;cursor:pointer;transition:border-color .18s,transform .18s,box-shadow .18s;position:relative;box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
      '.zfv-card:hover{border-color:rgba(255,90,118,.65);transform:translateY(-3px);box-shadow:0 6px 18px rgba(255,90,118,.18)}' +
      /* 海报区：写死 168x240（卡片 border-box 内宽），object-fit:cover 不变形 */
      '.zfv-picwrap{position:relative;box-sizing:border-box;width:202px;height:302px;background:linear-gradient(160deg,#23252e,#1a1c22);overflow:hidden;display:block;margin:0}' +
      '.zfv-pic{position:absolute;left:0;top:0;width:202px;height:302px;object-fit:cover;object-position:center;display:block}' +
      /* 标题绝对定位：叠在海报底部，渐变黑底保证可读 */
      '.zfv-name{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:18px 8px 8px;background:linear-gradient(180deg,rgba(10,11,14,0) 0%,rgba(10,11,14,.85) 45%,rgba(10,11,14,.95) 100%);color:#eceef2;font-size:12.5px;font-weight:600;line-height:1.45;max-height:3.6em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:center;letter-spacing:.3px;box-sizing:border-box}' +
      /* meta 绝对定位在海报左上角，不占文档流 */
      '.zfv-info{display:contents}' +
      '.zfv-meta{position:absolute;left:6px;top:6px;z-index:3;color:#d8d8de;font-size:10.5px;display:flex;gap:5px;flex-wrap:wrap}' +
      '.zfv-tag{background:rgba(255,90,118,.75);color:#fff;border-radius:4px;padding:0 6px;font-size:10px}' +
      '.zfv-play{flex:1;display:none;flex-direction:column;background:#0c0d10}' +
      '.zfv-play.on{display:flex}' +
      '.zfv-vwrap{flex:1;display:flex;align-items:center;justify-content:center;background:#000;min-height:0}' +
      '.zfv-vwrap video{max-width:100%;max-height:100%;width:100%;outline:none}' +
      '.zfv-pbar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid rgba(255,255,255,.08);flex:0 0 auto}' +
      '.zfv-title{color:#eee;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.zfv-back{background:transparent;border:1px solid rgba(255,255,255,.2);color:#a8a8b2;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;margin-right:auto}' +
      '.zfv-back:hover{border-color:#ff5a76;color:#fff}' +
      '.zfv-status{color:#77777f;font-size:12px;text-align:center;padding:40px 0;grid-column:1/-1}' +
      '.zfv-err{color:#ff8fa3;font-size:12px;text-align:center;padding:40px 0;grid-column:1/-1;line-height:1.7}' +
      '.zfv-errbtn{display:inline-block;margin-top:14px;background:#ff5a76;border:none;color:#fff;border-radius:6px;padding:6px 20px;font-size:12px;cursor:pointer}' +
      '.zfv-errbtn:hover{filter:brightness(1.1)}' +
      '.zfv-pager{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 0 14px;flex:0 0 auto}' +
      '.zfv-pager button{background:#1e2026;border:1px solid rgba(255,255,255,.15);color:#d8d8e0;border-radius:6px;padding:5px 16px;font-size:12px;cursor:pointer}' +
      '.zfv-pager button:hover:not(:disabled){border-color:#ff5a76;color:#fff}' +
      '.zfv-pager button:disabled{opacity:.35;cursor:default}' +
      '.zfv-pager .zfv-pageinfo{color:#8a8a94;font-size:12px;min-width:70px;text-align:center}';
    document.head.appendChild(st);
  }

  /* ---------- hls.js 懒加载 ---------- */
  function loadHls(cb) {
    if (window.Hls) return cb();
    var s = document.createElement('script');
    s.src = 'js/hls.min.js';
    s.onload = cb;
    s.onerror = function () { showErr('hls.js 加载失败（网络问题）'); };
    document.head.appendChild(s);
  }

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  }

  /* ---------- 播放 ---------- */
  function probeStreamBase() {
    /* 探测独立端口流媒体代理；2s 内 ping 不通则回退主服务（返回 null） */
    if (streamBase !== null) return Promise.resolve(streamBase);
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      var fin = function (val) { if (!done) { done = true; streamBase = val; resolve(val); } };
      var t = setTimeout(function () { fin(null); }, 2000);
      img.onload = function () { clearTimeout(t); fin('http://127.0.0.1:' + STREAM_PORT); };
      /* 【2026-11-21 修复】onerror=连接失败（含端口未监听被拒），必须回退主服务。
         之前误把 onerror 也当作"端口活"，8626 未监听时所有缩略图发往死端口全部失败 */
      img.onerror = function () { clearTimeout(t); fin(null); };
      img.src = 'http://127.0.0.1:' + STREAM_PORT + '/api/ivideo/proxy?url=x';
    });
  }
  function proxied(url) {
    return streamBase
      ? streamBase + '/api/ivideo/proxy?url=' + encodeURIComponent(url)
      : '/api/ivideo/proxy?url=' + encodeURIComponent(url);
  }

  /* ---------- 播放进度记忆 ---------- */
  function progKey() { return (curItem && curItem.name) || ''; }
  function saveProgress() {
    var v = ui.video;
    if (!v || !progKey() || switching) return;
    fetch('/api/ivideo/progress?get=0&name=' + encodeURIComponent(progKey()) +
      '&site=' + encodeURIComponent((curItem && curItem.site) || '') +
      '&ep=' + encodeURIComponent(curEpIdx) +
      '&pos=' + (v.currentTime || 0) + '&dur=' + (v.duration || 0)).catch(function () {});
  }
  function loadProgress(cb) {
    if (!progKey()) return cb(null);
    fetch('/api/ivideo/progress?name=' + encodeURIComponent(progKey()))
      .then(function (r) { return r.json(); })
      .then(function (d) { cb(d && d.ok ? d.progress : null); })
      .catch(function () { cb(null); });
  }
  function startProgressTimer() {
    stopProgressTimer();
    progressTimer = setInterval(saveProgress, 5000);
  }
  function stopProgressTimer() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  function play(item) {
    curItem = item; curEpIdx = 0; eps = []; resumeAt = 0;
    ui.searchBar.style.display = 'none';
    ui.grid.style.display = 'none';
    ui.play.classList.add('on');
    ui.title.textContent = item.name + ' · ' + (item.siteLabel || item.site || '');
    ui.statusTip.textContent = '取播放地址…';
    /* 8s 超时兜底：详情接口卡死时也能走到 catch 报错+返回按钮 */
    var dlCtl = new AbortController();
    var dlTm = setTimeout(function () { dlCtl.abort(); }, 8000);
    fetch('/api/ivideo/detail?site=' + encodeURIComponent(item.site) + '&id=' + encodeURIComponent(item.id), { signal: dlCtl.signal })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        clearTimeout(dlTm);
        var it = (d && (d.item || d)) || {};
        eps = it.episodes || d.episodes || [];
        if (!d || d.ok === false || !eps.length) throw new Error(d && d.err ? d.err : '无播放地址');
        /* 断点续播：读取上次进度，恢复集数+位置 */
        return new Promise(function (res) {
          loadProgress(function (p) {
            if (p && p.ep !== '' && +p.ep < eps.length) {
              curEpIdx = +p.ep;
              resumeAt = +p.pos || 0;
              ui.statusTip.textContent = '续播第' + (curEpIdx + 1) + '集 ' + fmtT(resumeAt);
            }
            res(eps[curEpIdx]);
          });
        });
      })
      .then(function (ep) {
        var url = typeof ep === 'string' ? ep : (ep && ep.url);
        if (!url) throw new Error('无播放地址');
        probeStreamBase().then(function () {
          ui.statusTip.textContent = '';
          loadHls(function () { startHls(proxied(url)); });
        });
      })
      .catch(function (e) {
        showErr('播放失败：' + (e.message || e));
      });
  }

  function fmtT(s) {
    s = Math.floor(s || 0);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* 自动换源：当前源 fatal 后，在 curList 中找同名片（不同 site）自动续播到上次位置 */
  function autoSwitchSource(reason) {
    if (switching || !curItem) return;
    var alt = null;
    for (var i = 0; i < curList.length; i++) {
      var c = curList[i];
      if (c.site !== curItem.site && (c.name || '').indexOf(curItem.name.slice(0, 4)) === 0) { alt = c; break; }
    }
    if (!alt) {
      /* 当前列表没有其他源 → 后端按片名重新搜一次，找到不同站的同名片再切 */
      fetch('/api/ivideo/search?wd=' + encodeURIComponent(curItem.name) + '&pg=1')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var list = d && d.ok !== false ? (d.list || (d.sites ? d.sites.reduce(function (a, s) { return a.concat(s.list || []); }, []) : [])) : [];
          for (var j = 0; j < list.length; j++) {
            var c = list[j];
            if (c.site !== curItem.site && (c.name || '').indexOf(curItem.name.slice(0, 4)) === 0) { alt = c; curList = list; break; }
          }
          if (!alt) { showErr(reason + '，且没有找到其他同片源'); return; }
          doSwitch(alt, reason);
        })
        .catch(function () { showErr(reason + '，且没有找到其他同片源'); });
      return;
    }
    doSwitch(alt, reason);
  }

  function doSwitch(alt, reason) {
    switching = true;
    loadProgress(function (p) {
      resumeAt = p && +p.pos || 0;
      ui.statusTip.textContent = '源失效，自动切换到「' + (alt.siteLabel || alt.site) + '」…';
      destroyHls();
      var keepItem = curItem;
      var dlCtl = new AbortController();
      var dlTm = setTimeout(function () { dlCtl.abort(); }, 8000);
      fetch('/api/ivideo/detail?site=' + encodeURIComponent(alt.site) + '&id=' + encodeURIComponent(alt.id), { signal: dlCtl.signal })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          clearTimeout(dlTm);
          var it = (d && (d.item || d)) || {};
          var ne = it.episodes || d.episodes || [];
          if (!d || d.ok === false || !ne.length) throw new Error('换源失败');
          curItem = alt; eps = ne;
          curEpIdx = (p && +p.ep < ne.length) ? +p.ep : 0;
          switching = false;
          probeStreamBase().then(function () {
            loadHls(function () { startHls(proxied(typeof ne[curEpIdx] === 'string' ? ne[curEpIdx] : ne[curEpIdx].url)); });
          });
        })
        .catch(function () { switching = false; curItem = keepItem; showErr(reason + '，自动换源失败，请手动返回换资源'); });
    });
  }

  function startHls(url) {
    destroyHls();
    curRawUrl = url; /* 记录原始代理地址供回退重试 */
    var v = ui.video;
    if (window.Hls && Hls.isSupported()) {
      /* 卡顿优化：加大缓冲、放宽分片超时、快速码率启动、自动恢复非致命错误 */
      hls = new Hls({
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        backBufferLength: 30,
        maxBufferSize: 90 * 1000 * 1000,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 6,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 8000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 1500000,
        nudgeMaxRetry: 10
      });
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (resumeAt > 3) {
          var seek = function () {
            try { v.currentTime = resumeAt; } catch (e) {}
            v.removeEventListener('loadedmetadata', seek);
          };
          v.addEventListener('loadedmetadata', seek);
        }
        v.play().catch(function () {});
        startProgressTimer();
      });
      hls.on(Hls.Events.ERROR, function (_, data) {
        if (!data.fatal) return;
        /* 先尝试自动恢复，恢复不回来再报错（报错时保留返回按钮） */
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (data.details === 'manifestLoadError' || data.details === 'manifestParsingError' || data.details === 'manifestIncompatibleCodecsError') {
            /* manifest 死了：独立端口挂了先回退主服务代理重试一次，再不行自动换源 */
            if (streamBase) { streamBase = null; ui.statusTip.textContent = '独立代理不可达，回退主服务…'; hls.loadSource('/api/ivideo/proxy?url=' + encodeURIComponent(curRawUrl || '')); hls.startLoad(); return; }
            autoSwitchSource('播放地址失效');
          } else {
            ui.statusTip.textContent = '网络波动，自动重连中…';
            hls.startLoad();
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          autoSwitchSource('播放出错：' + (data.details || 'unknown'));
        }
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
      if (resumeAt > 3) { v.addEventListener('loadedmetadata', function once() { try { v.currentTime = resumeAt; } catch (e) {} v.removeEventListener('loadedmetadata', once); }); }
      v.play().catch(function () {});
      v.addEventListener('loadedmetadata', function once2() { startProgressTimer(); v.removeEventListener('loadedmetadata', once2); });
      v.onerror = function () { autoSwitchSource('播放出错：视频加载失败'); };
    } else {
      showErr('当前浏览器不支持 HLS 播放');
    }
  }

  function showErr(msg) {
    /* 出错时保持播放界面打开并显示「返回」按钮，不再覆盖搜索网格导致无路可退 */
    ui.play.classList.add('on');
    ui.searchBar.style.display = 'none';
    ui.grid.style.display = 'none';
    ui.statusTip.innerHTML = '<span style="color:#ff8fa3">' + esc(msg) + '</span> ' +
      '<button class="zfv-back" id="zfvErrBack" style="margin-right:0">← 返回列表</button>';
    var eb = document.getElementById('zfvErrBack');
    if (eb) eb.addEventListener('click', backToGrid);
    ui.grid.innerHTML = '<div class="zfv-err">' + esc(msg) +
      '<br><button class="zfv-errbtn" id="zfvErrBtn2">← 返回</button></div>';
    var eb2 = document.getElementById('zfvErrBtn2');
    if (eb2) eb2.addEventListener('click', backToGrid);
  }

  function backToGrid() {
    saveProgress();
    stopProgressTimer();
    destroyHls();
    ui.video.removeAttribute('src');
    ui.video.load && ui.video.load();
    ui.play.classList.remove('on');
    ui.searchBar.style.display = '';
    ui.grid.style.display = '';
    /* 若 grid 内容已被错误提示覆盖，但有上次搜索结果，则重绘恢复列表 */
    if (!ui.grid.querySelector('.zfv-card') && curList.length) renderList();
  }

  function cardHtml(it, i) {
    /* v6.1 2026-11-22 全几何内联写死+卡片height:304(海报302+上下边框2)：网格行高塌陷时也能保住卡片高度 */
    return '<div class="zfv-card" data-i="' + i + '" style="box-sizing:border-box;width:204px;height:304px;position:relative;overflow:hidden;border-radius:12px;background:#1d1f26;border:1px solid rgba(255,255,255,.08);cursor:pointer">' +
      '<div class="zfv-picwrap" style="box-sizing:border-box;position:relative;width:202px;height:302px;margin:0 auto;overflow:hidden;background:linear-gradient(160deg,#23252e,#1a1c22);display:block">' +
      (it.pic ? '<img class="zfv-pic" width="202" height="302" style="width:202px;height:302px;position:absolute;left:0;top:0;object-fit:cover;object-position:center;display:block" loading="lazy" referrerpolicy="no-referrer" src="/api/ivideo/proxy?url=' + encodeURIComponent(it.pic) + '">' : '') +
      '<div class="zfv-name" style="position:absolute;left:0;right:0;bottom:0;z-index:2;padding:18px 8px 8px;background:linear-gradient(180deg,rgba(10,11,14,0) 0%,rgba(10,11,14,.85) 45%,rgba(10,11,14,.95) 100%);color:#eceef2;font-size:12.5px;font-weight:600;line-height:1.45;max-height:3.6em;overflow:hidden;text-align:center;box-sizing:border-box">' + esc(it.name || '（无标题）') + '</div>' +
      '<div class="zfv-meta" style="position:absolute;left:6px;top:6px;z-index:3;color:#d8d8de;font-size:10.5px;display:flex;gap:5px;flex-wrap:wrap"><span class="zfv-tag" style="background:rgba(255,90,118,.75);color:#fff;border-radius:4px;padding:0 6px;font-size:10px">' + esc(it.siteLabel || it.site) + '</span>' +
      (it.remark ? '<span>' + esc(it.remark) + '</span>' : '') +
      (it.year ? '<span>' + esc(it.year) + '</span>' : '') + '</div></div></div>';
  }

  function renderList() {
    ui.grid.innerHTML = curList.map(cardHtml).join('');
    /* 【2026-11-23 安全修复】缩略图 onerror 由内联 JS 串改为事件绑定（防实体解码击穿属性）；
       保留原回退逻辑：代理加载失败时回退原直链一次（onerror=null 语义用 data.fbDone 实现） */
    ui.grid.querySelectorAll('img.zfv-pic').forEach(function (img) {
      img.addEventListener('error', function () {
        if (this.dataset.fbDone) return;
        this.dataset.fbDone = '1';
        var card = this.closest('.zfv-card');
        var it = card ? curList[+card.dataset.i] : null;
        if (it && it.pic) this.src = it.pic;
      });
    });
  }

  /* ---------- 搜索 ---------- */
  function search(page) {
    var wd = (ui.search.value || '').trim();
    if (!wd) return;
    page = page || 1;
    curWd = wd;
    curPage = page;
    ui.grid.innerHTML = '<div class="zfv-status">搜索中…</div>';
    ui.pager.style.display = 'none';
    destroyHls();
    ui.play.classList.remove('on');
    ui.searchBar.style.display = '';
    fetch('/api/ivideo/search?wd=' + encodeURIComponent(wd) + '&pg=' + page)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = d && d.ok !== false ? (d.list || (d.sites ? d.sites.reduce(function (a, s) { return a.concat(s.list || []); }, []) : [])) : [];
        curList = list;
        if (!list.length) { ui.grid.innerHTML = '<div class="zfv-status">没有找到「' + esc(wd) + '」的资源' + (page > 1 ? '（第' + page + '页）' : '') + '</div>'; ui.pager.style.display = ''; renderPager(); return; }
        renderList();
        ui.pager.style.display = '';
        renderPager();
        ui.grid.scrollTop = 0;
        /* 【v4】渲染完成后若搜索框已改字，说明用户在等待期间又输入了新词，自动补一次搜索 */
        if ((ui.search.value || '').trim() !== curWd) search();
      })
      .catch(function (e) {
        ui.grid.innerHTML = '<div class="zfv-err">搜索失败：' + esc(e.message || e) + '</div>';
      });
  }

  function renderPager() {
    ui.prevBtn.disabled = curPage <= 1;
    var last = curList.length < PAGE_SIZE;
    ui.nextBtn.disabled = last;
    ui.nextBtn.textContent = last ? '已是最后一页' : '下一页 →';
    ui.pageInfo.textContent = '第 ' + curPage + ' 页';
  }

  /* ---------- 入口 ---------- */
  function onOpen(el) {
    body = el;
    injectCss();
    warmup();
    if (el.dataset.zfvUi) return;
    el.dataset.zfvUi = '1';
    el.innerHTML =
      '<div class="zfv-wrap">' +
      '  <div class="zfv-bar">' +
      '    <div class="zfv-logo"><span>i视频</span></div>' +
      '    <input class="zfv-search" placeholder="搜索周星驰" />' +
      '    <button class="zfv-btn">搜索</button>' +
      '  </div>' +
      '  <div class="zfv-grid"><div class="zfv-status">输入片名开始搜索（仅自用，资源来自公开采集站）</div></div>' +
      '  <div class="zfv-pager" style="display:none">' +
      '    <button class="zfv-prev">← 上一页</button>' +
      '    <span class="zfv-pageinfo">第 1 页</span>' +
      '    <button class="zfv-next">下一页 →</button>' +
      '  </div>' +
      '  <div class="zfv-play">' +
      '    <div class="zfv-vwrap"><video controls autoplay playsinline webkit-playsinline></video></div>' +
      '    <div class="zfv-pbar"><button class="zfv-back">← 返回</button><span class="zfv-title"></span><span class="zfv-status" style="padding:0"></span></div>' +
      '  </div>' +
      '</div>';
    ui.searchBar = el.querySelector('.zfv-bar');
    ui.search = el.querySelector('.zfv-search');
    ui.grid = el.querySelector('.zfv-grid');
    ui.play = el.querySelector('.zfv-play');
    ui.video = el.querySelector('video');
    ui.title = el.querySelector('.zfv-title');
    ui.statusTip = el.querySelector('.zfv-pbar .zfv-status');
    ui.back = el.querySelector('.zfv-back');
    ui.btn = el.querySelector('.zfv-btn');
    ui.pager = el.querySelector('.zfv-pager');
    ui.prevBtn = el.querySelector('.zfv-prev');
    ui.nextBtn = el.querySelector('.zfv-next');
    ui.pageInfo = el.querySelector('.zfv-pageinfo');

    /* 事件全部容器内自管，不绑全局 keydown */
    ui.btn.addEventListener('click', function () { search(); });
    ui.search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.stopPropagation(); search(); }
    });
    ui.grid.addEventListener('click', function (e) {
      var card = e.target.closest('.zfv-card');
      if (card && curList[+card.dataset.i]) play(curList[+card.dataset.i]);
    });
    ui.back.addEventListener('click', backToGrid);
    ui.prevBtn.addEventListener('click', function () { if (curPage > 1) search(curPage - 1); });
    ui.nextBtn.addEventListener('click', function () { search(curPage + 1); });
  }

  function onClose() {
    saveProgress();
    stopProgressTimer();
    destroyHls();
  }

  /* 【v3 2026-11-17】初始打开预热：并行探测独立代理端口 + 预载 hls.js，
     消除首次播放时串行探测(2s)+脚本下载的等待 */
  function warmup() {
    probeStreamBase();
    if (!window.Hls && !document.getElementById('zfvHlsPre')) {
      var s = document.createElement('script');
      s.id = 'zfvHlsPre';
      s.src = 'js/hls.min.js';
      document.head.appendChild(s);
    }
  }

  window.ZFVideo = { onOpen: onOpen, onClose: onClose, ver: 'v6.1-rowfix-20261122' };
})();
