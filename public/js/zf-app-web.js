/* zf-app-web.js —— i网页（S1+S2 垂直切片，2026-11-11）
   书签导航 + proxy 阅读视图（三级渲染分派：可嵌站前端直开 iframe / 拒嵌站走 /api/webpage/fetch 净化阅读）
   契约：window.ZFWeb = { onOpen(body), onClose() }；Esc 不自绑，交 dock 通用兜底。
   安全：抓取一律走后端白名单接口，前端不直接出站。 */
(function () {
  'use strict';
  if (window.ZFWeb) return;

  var EMBED_WHITELIST = [ // S0 实测头部放行站：前端直开 iframe（零服务器成本增强）
    'wikipedia.org', 'example.com'
    /* 【2026-11-17 b 移除 bing】bing 搜索结果链接多为 target=_blank，跨域 iframe 无 allow-popups 时点击被静默拦截=「点了没反应」。
       改走 proxy srcdoc 路径，navHook 能拦截点击 → go() 内部导航+回填地址栏 */
  ];
  /* 【2026-11-XX 多搜索引擎】地址栏左侧可选引擎：纯文字搜索按所选引擎跳转 */
  var SEARCH_ENGINES = {
    bing:   { name: '必应', url: 'https://www.bing.com/search?q=' },
    baidu:  { name: '百度', url: 'https://www.baidu.com/s?wd=' },
    google: { name: '谷歌', url: 'https://www.google.com/search?q=' },
    yandex: { name: 'Yandex(俄罗斯)', url: 'https://yandex.com/search/?text=' },
    duckduckgo: { name: 'DuckDuckGo(乌克兰)', url: 'https://duckduckgo.com/?q=' },
    yahoojp: { name: 'Yahoo Japan(日本)', url: 'https://search.yahoo.co.jp/search?p=' },
    naver: { name: 'Naver(韩国)', url: 'https://search.naver.com/search.naver?query=' },
    parsijoo: { name: 'Parsijoo(伊朗)', url: 'https://parsijoo.ir/web?q=' },
    ecosia: { name: 'Ecosia(德国)', url: 'https://www.ecosia.org/search?q=' },
    qwant: { name: 'Qwant(法国)', url: 'https://www.qwant.com/?q=' }
  };
  var activeNav = null; /* 指向最新一次 render 的 {input, go}，message listener 只绑一次但始终用最新实例 */
  var state = { marks: [], current: null, mode: 'raw', lastData: null, tabs: [], active: -1, engine: 'bing' };

  function el(tag, cls, htmlText) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (htmlText != null) e.innerHTML = htmlText;
    return e;
  }

  function isEmbeddable(url) {
    try {
      var host = new URL(url).hostname;
      return EMBED_WHITELIST.some(function (d) { return host === d || host.endsWith('.' + d); });
    } catch (e) { return false; }
  }

  function render(body) {
    body.innerHTML = '';
    body.style.cssText += 'flex-direction:column;';

    /* 工具栏：地址栏 + 打开按钮 */
    var bar = el('div', 'zfw-bar');
    bar.style.cssText = 'display:flex;gap:6px;padding:8px;border-bottom:1px solid rgba(255,255,255,.08);align-items:center;';
    var input = el('input');
    input.placeholder = '输入网址，或直接输入文字搜索…';
    input.style.cssText = 'flex:1;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:#1f2027;color:#e8e8ee;font-size:13px;outline:none;';
    /* 【多搜索引擎】引擎选择下拉：必应/百度/谷歌/Yandex(俄罗斯)/DuckDuckGo(乌克兰) */
    var engSel = el('select');
    engSel.title = '选择搜索引擎（输入文字回车即用该引擎搜索）';
    engSel.style.cssText = 'flex:none;padding:6px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:#1f2027;color:#e8e8ee;font-size:13px;outline:none;cursor:pointer;max-width:120px;';
    Object.keys(SEARCH_ENGINES).forEach(function (k) {
      var o = el('option', '', SEARCH_ENGINES[k].name);
      o.value = k;
      if (k === state.engine) o.selected = true;
      engSel.appendChild(o);
    });
    engSel.onchange = function () { state.engine = engSel.value; };
    var goBtn = el('button', '', '打开');
    goBtn.style.cssText = 'padding:6px 14px;border-radius:8px;border:none;background:#4a7dff;color:#fff;cursor:pointer;font-size:13px;';
    goBtn.onclick = function () { go(input.value.trim()); };
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.stopPropagation(); go(input.value.trim()); } });
    /* 阅读模式切换：📖 精排阅读 / 🌐 原样网页 */
    var readBtn = el('button', '', '📖');
    var rawBtn = el('button', '', '🌐');
    function paintModeBtns() {
      readBtn.style.cssText = 'padding:6px 10px;border-radius:8px;border:none;cursor:pointer;font-size:13px;' +
        (state.mode === 'read' ? 'background:#4a7dff;color:#fff;' : 'background:rgba(255,255,255,.08);color:#c8c8d2;');
      readBtn.title = '阅读模式（净化精排版）';
      rawBtn.style.cssText = 'padding:6px 10px;border-radius:8px;border:none;cursor:pointer;font-size:13px;' +
        (state.mode === 'raw' ? 'background:#4a7dff;color:#fff;' : 'background:rgba(255,255,255,.08);color:#c8c8d2;');
      rawBtn.title = '网页模式（原样渲染）';
    }
    readBtn.onclick = function () { state.mode = 'read'; paintModeBtns(); rerender(); };
    rawBtn.onclick = function () { state.mode = 'raw'; paintModeBtns(); rerender(); };
    paintModeBtns();
    bar.appendChild(engSel); bar.appendChild(input); bar.appendChild(readBtn); bar.appendChild(rawBtn); bar.appendChild(goBtn);

    /* 书签条 */
    var marks = el('div', 'zfw-marks');
    marks.style.cssText = 'display:flex;gap:6px;padding:6px 8px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,.08);';

    /* 阅读区 */
    var view = el('div', 'zfw-view');
    view.style.cssText = 'flex:1;overflow:auto;padding:0;';

    body.appendChild(bar); body.appendChild(marks); body.appendChild(view);

    /* 【2026-11-17d 多标签】标签栏：每标签独立 URL；切换=恢复该标签最后页面；"+"新建；"✕"关闭 */
    var tabBar = el('div', 'zfw-tabs');
    tabBar.style.cssText = 'display:flex;gap:4px;padding:6px 8px 0;border-bottom:1px solid rgba(255,255,255,.08);align-items:center;overflow-x:auto;';
    var tabPlus = el('button', '', '＋');
    tabPlus.title = '新建标签页';
    tabPlus.style.cssText = 'flex:none;padding:4px 10px;border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,.12);border-bottom:none;background:rgba(255,255,255,.05);color:#c8c8d2;cursor:pointer;font-size:13px;line-height:1;';
    tabPlus.onclick = function () { newTab(null); };
    function tabName(t) {
      if (!t.url) return '新标签页';
      try {
        var u = new URL(t.url);
        /* 【多搜索引擎】各引擎搜索页标签显示 🔍 关键词 */
        var engHosts = { 'www.bing.com': 'q', 'www.baidu.com': 'wd', 'www.google.com': 'q', 'yandex.com': 'text', 'duckduckgo.com': 'q', 'search.yahoo.co.jp': 'p', 'search.naver.com': 'query', 'parsijoo.ir': 'q', 'www.ecosia.org': 'q', 'www.qwant.com': 'q' };
        if (engHosts[u.hostname] && u.searchParams.get(engHosts[u.hostname])) return '🔍 ' + u.searchParams.get(engHosts[u.hostname]).slice(0, 16);
        return u.hostname.replace(/^www\./, '');
      } catch (e) { return '新标签页'; }
    }
    function renderTabs() {
      tabBar.querySelectorAll('.zfw-tab').forEach(function (n) { n.remove(); });
      state.tabs.forEach(function (t, i) {
        var tb = el('button', 'zfw-tab', esc(tabName(t)) + ' <span style="opacity:.5;font-size:11px;">✕</span>');
        tb.title = t.url || '新标签页';
        tb.style.cssText = 'flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 10px;border-radius:8px 8px 0 0;border:1px solid ' +
          (i === state.active ? 'rgba(74,125,255,.6)' : 'rgba(255,255,255,.12)') + ';border-bottom:none;background:' +
          (i === state.active ? 'rgba(74,125,255,.18)' : 'rgba(255,255,255,.05)') + ';color:' +
          (i === state.active ? '#fff' : '#c8c8d2') + ';cursor:pointer;font-size:12px;line-height:1;';
        tb.querySelector('span').onclick = function (ev) { ev.stopPropagation(); closeTab(i); };
        tb.onclick = function () { switchTab(i); };
        tabBar.insertBefore(tb, tabPlus);
      });
    }
    function newTab(url) {
      /* 同 URL 已有标签 → 直接切过去，不重复开 */
      if (url) {
        var found = -1;
        state.tabs.forEach(function (t, i) { if (t.url === url) found = i; });
        if (found >= 0) return switchTab(found);
      }
      if (state.tabs.length >= 12) { view.innerHTML = '<div style="padding:24px;color:#e0b080;font-size:13px;">标签已达上限（12 个），请先关闭部分标签。</div>'; return; }
      state.tabs.push({ url: url || null });
      state.active = state.tabs.length - 1;
      renderTabs();
      if (url) go(url); else { input.value = ''; startPage(); }
    }
    function switchTab(i) {
      if (i === state.active) return;
      state.active = i;
      renderTabs();
      var t = state.tabs[i];
      if (t.url) { input.value = t.url; go(t.url); }
      else { input.value = ''; startPage(); }
    }
    function closeTab(i) {
      state.tabs.splice(i, 1);
      if (!state.tabs.length) { state.active = -1; renderTabs(); newTab(null); return; }
      var nb = Math.min(i, state.tabs.length - 1); /* 关谁就切到它右邻（没有则左邻） */
      state.active = -1; /* 强制走恢复流程 */
      renderTabs();
      var t = state.tabs[nb];
      state.active = nb;
      if (t.url) { input.value = t.url; go(t.url); }
      else { input.value = ''; startPage(); }
    }
    tabBar.appendChild(tabPlus);
    body.insertBefore(tabBar, marks);
    state.tabs.push({ url: null });
    state.active = 0;
    renderTabs();

    function renderMarks() {
      marks.innerHTML = '';
      state.marks.forEach(function (m) {
        var b = el('button', '', m.name);
        b.title = m.url;
        b.style.cssText = 'padding:4px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#c8c8d2;cursor:pointer;font-size:12px;';
        b.onclick = function () { input.value = m.url; go(m.url); };
        marks.appendChild(b);
      });
    }

    function esc(s) {
      return String(s || '').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    /* 模板残留检测：Vue/Angular 花括号、Jinja/lnjia 块出现在渲染文本中 = 源站 JS 未跑成功 */
    function hasTemplateResidue(text) {
      if (!text) return false;
      return /\{\{\s*[\w$.[\]]+\s*\}\}/.test(text) || /\{%\s*(if|for|block)/.test(text);
    }

    /* 阅读模式渲染：用后端提取的纯文本做精排版（暗色卡片、标黄残留警告） */
    function renderReadMode(d, url) {
      var residue = hasTemplateResidue(d.text) && !d.html;
      var inner = '<div style="max-width:760px;margin:0 auto;padding:28px 20px 48px;color:#d8dae2;font-size:15px;line-height:1.85;letter-spacing:.2px;">' +
        '<h2 style="font-size:20px;margin:0 0 6px;color:#fff;line-height:1.4;">' + esc(d.title || '(无标题)') + '</h2>' +
        '<div style="color:#8a90a0;font-size:12px;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.1);">' +
        esc(url) + ' · ' + (d.chars || 0) + ' 字符' + (d.cached ? ' · 缓存' : '') + '</div>';
      if (residue) {
        inner += '<div style="background:rgba(224,160,80,.12);border:1px solid rgba(224,160,80,.35);border-radius:10px;padding:10px 14px;margin-bottom:18px;font-size:13px;color:#e0b080;">' +
          '⚠ 该页面由前端脚本动态生成，代理抓不到渲染后的内容（含模板占位符）。建议 🌐 网页模式查看，或直接新标签页打开。</div>';
      }
      var paras = String(d.text || '').split('\n\n');
      inner += paras.map(function (p) {
        var t = esc(p.trim());
        if (!t) return '';
        if (/^#{1,3}\s/.test(p.trim())) return '<h3 style="font-size:16px;color:#e8e8ee;margin:22px 0 8px;">' + t.replace(/^#{1,3}\s/, '') + '</h3>';
        if (/^[-•*]\s/m.test(p) && p.trim().split('\n').length > 1) return '<ul style="margin:8px 0 8px 18px;padding:0;">' + p.trim().split('\n').map(function (li) { return '<li style="margin:4px 0;">' + esc(li.replace(/^[-•*]\s*/, '')) + '</li>'; }).join('') + '</ul>';
        return '<p style="margin:0 0 14px;">' + t.replace(/\n/g, '<br>') + '</p>';
      }).join('');
      inner += '</div>';
      view.innerHTML = '<div style="overflow:auto;height:100%;background:#1a1b22;">' + inner + '</div>';
    }

    /* 模式切换重渲染：阅读模式不需重新抓取，直接复用上次数据 */
    function rerender() {
      if (!state.current || !state.lastData) return;
      if (state.mode === 'read') renderReadMode(state.lastData, state.current);
      else go(state.current);
    }

    /* 原样渲染后检测模板残留 → 顶部提示条建议切阅读模式 */
    function residueBanner(url) {
      var b = document.createElement('div');
      b.style.cssText = 'position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;padding:8px 14px;background:rgba(224,160,80,.14);border-bottom:1px solid rgba(224,160,80,.3);color:#e0b080;font-size:12px;';
      b.innerHTML = '<span>⚠ 页面含未渲染的模板占位符（站点脚本在沙箱内未执行成功）</span>' +
        '<button style="padding:3px 10px;border-radius:6px;border:none;background:#4a7dff;color:#fff;cursor:pointer;font-size:12px;">📖 切阅读模式</button>' +
        '<span style="flex:1;"></span><span style="cursor:pointer;color:#9aa0b0;">✕</span>';
      b.querySelector('button').onclick = function () { b.remove(); state.mode = 'read'; paintModeBtns(); if (state.lastData) renderReadMode(state.lastData, url); };
      b.querySelector('span:last-child').onclick = function () { b.remove(); };
      view.insertBefore(b, view.firstChild);
    }

    function go(url) {
      if (!url) return;
      /* 纯文字搜索：不像 URL（无点号/空格含中文等）→ 按所选搜索引擎跳转（多引擎，2026-11-XX） */
      var looksUrl = /^https?:\/\//.test(url) || /^[\w-]+(\.[\w-]+)+(\/|$|\?|:)/.test(url) || /^localhost(:\d+)?/.test(url);
      if (!looksUrl) {
        var eng = SEARCH_ENGINES[state.engine] || SEARCH_ENGINES.bing;
        url = eng.url + encodeURIComponent(url);
      }
      else if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      input.value = url;
      state.current = url;
      /* 【2026-11-17d 多标签】导航同步记录到当前活动标签，切走再切回能恢复 */
      if (state.tabs[state.active]) state.tabs[state.active].url = url;
      /* 【2026-11-17c 前端页面缓存】同会话内访问过的 proxy 页面秒开，不重复抓取 */
      if (!isEmbeddable(url) && state.pageCache && state.pageCache[url] && state.mode !== 'read') {
        paintFetch(state.pageCache[url], url, true);
        return;
      }
      /* 三级分派①：白名单可嵌站 → iframe 直开（零成本增强） */
      if (isEmbeddable(url)) {
        view.innerHTML = '<div style="padding:24px;color:#9aa0b0;font-size:13px;">⏳ 正在加载站点…</div>';
        var fr = el('iframe');
        fr.src = url;
        /* 【2026-11-17 内部跳转】白名单 iframe 同样禁弹外部：sandbox 不含 allow-popups，
           target=_blank / window.open 被拦截，普通链接在 iframe 内部跳转（仍显示在 i网页里） */
        fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
        fr.style.cssText = 'width:100%;height:100%;border:none;background:#fff;display:none;';
        fr.setAttribute('referrerpolicy', 'no-referrer');
        var loaded = false; /* 修复闪烁：bing 等站重定向会触发多次 onload，仅首次处理，避免反复清空重建视图 */
        fr.onload = function () {
          if (loaded) return;
          loaded = true;
          fr.style.display = 'block';
          var ph = view.querySelector('div');
          if (ph && ph !== fr) ph.remove();
        };
        view.appendChild(fr);
        return;
      }
      /* 【2026-11-19 初始提速】网页模式不再等 /api/webpage/fetch 全量抓完才渲染——
         直接挂 /api/webproxy 流式 iframe，浏览器边收边画（省去双重抓取的白等时间）。
         阅读模式仍走全量抓取（需要正文提取）。 */
      if (state.mode !== 'read') {
        paintProxy(url, true);
        return;
      }
      view.innerHTML = '';
      var pbar = el('div');
      pbar.style.cssText = 'position:absolute;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#4a7dff,#8a5cff);border-radius:0 2px 2px 0;transition:width .25s ease;z-index:9;box-shadow:0 0 6px rgba(74,125,255,.5);';
      var tip = el('div', '', '<span style="position:absolute;top:8px;left:12px;font-size:11px;color:#6b7180;">加载中…</span>');
      tip.style.cssText = 'position:relative;flex:0;height:0;';
      view.style.position = 'relative';
      view.appendChild(pbar);
      view.appendChild(tip);
      var t0 = Date.now();
      var pct = 0;
      var elapsedTimer = setInterval(function () {
        /* 渐进式假进度：前段快后段慢，最大 92%，真实完成由 done() 置 100 */
        var elapsed = (Date.now() - t0) / 1000;
        pct = Math.min(92, pct + (pct < 30 ? 6 : pct < 70 ? 3 : 1) * Math.max(.3, 1 - elapsed / 15));
        pbar.style.width = pct + '%';
        tip.firstChild.textContent = '加载中… ' + elapsed.toFixed(1) + 's';
      }, 150);
      var done = function (ok) {
        clearInterval(elapsedTimer);
        pbar.style.width = '100%';
        setTimeout(function () { pbar.remove(); tip.remove(); }, ok ? 300 : 0);
      };
      fetch('/api/webpage/fetch?url=' + encodeURIComponent(url))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          done(!!d.ok);
          /* 【2026-11-17c】若等待期间用户已跳到别的页面，丢弃过期结果防闪烁 */
          if (state.current !== url) return;
          if (!d.ok) {
            var hint = (String(d.err || '').indexOf('SSL') >= 0 || String(d.err || '').indexOf('handshake') >= 0)
              ? '<br><span style="font-size:12px;color:#9aa0b0;">该站点 HTTPS 握手失败（网络环境限制），建议新标签页直开。</span>' : '';
            view.innerHTML = '<div style="padding:24px;color:#e07b7b;font-size:13px;">❌ 抓取失败：' + esc(d.err) + hint +
              '<br><a href="' + esc(url) + '" target="_blank" style="color:#4a7dff;">↗ 在新标签页打开</a></div>';
            return;
          }
          paintFetch(d, url, false);
        })
        .catch(function () {
          done(false);
          view.innerHTML = '<div style="padding:24px;color:#e07b7b;font-size:13px;">❌ 网络错误，<a href="' + esc(url) + '" target="_blank" style="color:#4a7dff;">↗ 新标签页打开</a></div>';
        });
    }

    /* 【2026-11-19 初始提速】流式代理 iframe：跳过全量抓取，浏览器原生边收边画。
       progress=true 时带顶部细进度条（onload 后移除）。返回 paint 句柄供缓存命中复用。 */
    function paintProxy(url, withProgress) {
      view.innerHTML = '';
      var fr = el('iframe');
      fr.src = '/api/webproxy?url=' + encodeURIComponent(url);
      fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
      fr.setAttribute('referrerpolicy', 'no-referrer');
      fr.style.cssText = 'width:100%;height:100%;border:none;background:#fff;';
      view.appendChild(fr);
      if (!withProgress) return;
      var pbar = el('div');
      pbar.style.cssText = 'position:absolute;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#4a7dff,#8a5cff);border-radius:0 2px 2px 0;transition:width .25s ease;z-index:9;box-shadow:0 0 6px rgba(74,125,255,.5);';
      view.style.position = 'relative';
      view.appendChild(pbar);
      var t0 = Date.now(), pct = 0;
      var timer = setInterval(function () {
        var s = (Date.now() - t0) / 1000;
        pct = Math.min(92, pct + (pct < 30 ? 6 : pct < 70 ? 3 : 1) * Math.max(.3, 1 - s / 15));
        pbar.style.width = pct + '%';
      }, 150);
      fr.onload = function () { clearInterval(timer); pbar.style.width = '100%'; setTimeout(function () { pbar.remove(); }, 300); };
    }

    /* 【2026-11-17c 抽取】抓取成功后的渲染逻辑（原 go() 内联），供缓存命中/预取复用 */
    function paintFetch(d, url, fromCache) {
      state.lastData = d;
      if (!state.pageCache) state.pageCache = {};
      if (d.html && d.html.length < 3000000) state.pageCache[url] = d; /* 上限约 3MB/页，防爆内存 */
      if (state.mode === 'read') { renderReadMode(d, url); return; }
      /* 【2026-11-18 流式加载】网页模式改为 iframe src 直连 /api/webproxy 代理：
         浏览器原生流式渲染——HTML 到一点画一点、CSS/JS 并行加载，不再等全量抓取
         结束才显示；代理回传完整文档，style/script 正常解析，不再裸露样式源码。
         页内链接已被后端 _rewrite_html 改写为代理路径，点击自然在 iframe 内部跳转。
         d.html 仍缓存供阅读模式秒切。 */
      view.innerHTML = '';
      var fr = el('iframe');
      fr.src = '/api/webproxy?url=' + encodeURIComponent(url);
      fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
      fr.setAttribute('referrerpolicy', 'no-referrer');
      fr.style.cssText = 'width:100%;height:100%;border:none;background:#fff;display:none;';
      var loaded = false;
      /* 【2026-11-18 空白兜底】部分站（如必应）自身 JS 在沙箱内跳转/清空文档 → iframe 空白。
         双保险：① 8s 未 onload → 降级阅读模式；② onload 后检测文档可见文本过短 → 同样降级。 */
      var fallback = function () {
        if (loaded) return; loaded = true;
        clearTimeout(guard);
        if (state.current !== url) return;
        /* 强制切阅读模式（更新按钮态），有缓存秒渲，无缓存重新抓取正文 */
        state.mode = 'read';
        if (typeof paintModeBtns === 'function') paintModeBtns();
        if (state.lastData && state.lastData.url === url) renderReadMode(state.lastData, url);
        else fetch('/api/webpage/fetch?url=' + encodeURIComponent(url))
          .then(function (r) { return r.json(); })
          .then(function (d) { if (state.current === url && d.ok) paintFetch(d, url, false); });
      };
      var guard = setTimeout(fallback, 8000);
      fr.onerror = fallback;
      fr.onload = function () {
        if (loaded) return;
        try {
          var doc = fr.contentDocument;
          var txt = doc && doc.body ? (doc.body.innerText || '').trim() : '';
          if (txt.length < 30) { setTimeout(fallback, 600); return; } /* 稍等 JS 渲染再判 */
        } catch (e) { /* 跨域不可读则视为正常渲染 */ }
        clearTimeout(guard);
        loaded = true;
        fr.style.display = 'block';
        if (state.current === url) input.value = url;
      };
      view.appendChild(fr);
    }

    function loadMarks() {
      fetch('/api/webmarks').then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { state.marks = d.list || []; renderMarks(); }
      }).catch(function () {});
    }

    function addPrompt() {
      var url = prompt('书签 URL：');
      if (!url) return;
      var name = prompt('书签名称：', url.replace(/^https?:\/\//, '').split('/')[0]);
      if (!name) return;
      fetch('/api/webmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: name, url: url })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { state.marks = d.list || []; renderMarks(); }
      });
    }

    var addBtn = el('button', '', '＋ 添加书签');
    addBtn.style.cssText = 'padding:4px 10px;border-radius:14px;border:1px dashed rgba(255,255,255,.25);background:transparent;color:#9aa0b0;cursor:pointer;font-size:12px;';
    addBtn.onclick = addPrompt;
    marks.appendChild(addBtn);

    /* 先用内置默认书签渲染骨架，秒开不等 API；API 回来后若不同再刷新 */
    if (!state.marks.length) {
      state.marks = [
        { id: 'baidu', name: '百度搜索', url: 'https://www.baidu.com' },
        { id: 'google', name: '谷歌搜索', url: 'https://www.google.com' },
        { id: 'bing', name: '必应搜索', url: 'https://www.bing.com' },
        { id: 'yandex', name: '俄罗斯搜索(Yandex)', url: 'https://yandex.com' },
        { id: 'ukr', name: '乌克兰搜索(meta.ua)', url: 'https://meta.ua/' },
        { id: 'yahoojp', name: '日本搜索(Yahoo Japan)', url: 'https://www.yahoo.co.jp/' },
        { id: 'naver', name: '韩国搜索(Naver)', url: 'https://www.naver.com/' },
        { id: 'parsijoo', name: '伊朗搜索(Parsijoo)', url: 'https://parsijoo.ir/' },
        { id: 'ecosia', name: '德国搜索(Ecosia)', url: 'https://www.ecosia.org/' },
        { id: 'qwant', name: '法国搜索(Qwant)', url: 'https://www.qwant.com/' },
        { id: 'gh-trending', name: 'GitHub Trending', url: 'https://github.com/trending' },
        { id: 'wiki', name: '维基百科', url: 'https://zh.wikipedia.org/wiki/Wikipedia:%E9%A6%96%E9%A1%B5' }
      ];
      renderMarks();
    }
    loadMarks();
    /* 【2026-11-17 b 内部跳转+地址栏回填】接收沙箱 iframe 内的链接点击 → 回填地址栏 → go() 内部导航。
       listener 只绑一次（防多次 render 重复绑定导致一个点击触发多次 go()），但通过 activeNav 始终路由到最新实例 */
    activeNav = { input: input, go: go };
    if (!window.__zfwNavBound) {
      window.__zfwNavBound = true;
      window.addEventListener('message', function (ev) {
        if (ev.origin !== location.origin) return; /* 【安全】只接受同源消息，防跨源 iframe 伪造导航指令 */
        var d = ev.data;
        if (d && d.zfwNav && typeof d.zfwNav === 'string' && activeNav) {
          activeNav.input.value = d.zfwNav; /* 地址栏同步显示当前页面 URL */
          activeNav.go(d.zfwNav);
        }
      });
    }
    /* 【2026-11-17c 初始秒开】打开窗口先渲染瞬时起始页（书签大按钮，0 网络等待），
       不再阻塞等首个外站书签抓取（GitHub 直抓 3~4s）。用户点书签/搜索才真正出网；
       同时后台静默预取首个书签，等用户点它时已走前端缓存秒开 */
    function startPage() {
      view.innerHTML = '';
      var wrap = el('div', '', '');
      wrap.style.cssText = 'max-width:640px;margin:48px auto;padding:0 20px;';
      var h = el('div', '', '🚀 i网页');
      h.style.cssText = 'font-size:22px;color:#fff;margin-bottom:6px;';
      var tip = el('div', '', '输入网址或直接输入文字搜索，也可点击下方书签快速打开');
      tip.style.cssText = 'color:#8a90a0;font-size:13px;margin-bottom:24px;';
      wrap.appendChild(h); wrap.appendChild(tip);
      var grid = el('div', '', '');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;';
      state.marks.forEach(function (m) {
        var b = el('button', '', m.name);
        b.style.cssText = 'padding:12px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#d8dae2;cursor:pointer;font-size:14px;';
        b.onmouseenter = function () { b.style.background = 'rgba(74,125,255,.2)'; };
        b.onmouseleave = function () { b.style.background = 'rgba(255,255,255,.05)'; };
        b.onclick = function () { input.value = m.url; go(m.url); };
        grid.appendChild(b);
      });
      wrap.appendChild(grid);
      view.appendChild(wrap);
    }
    startPage();
    /* 【2026-11-19 去重】loadMarks 已在上方(396行)调用过，此处重复调用会双请求 API，已移除 */
  }

  window.ZFWeb = {
    onOpen: function (body) { render(body); },
    onClose: function () { /* 阅读态无需清理；iframe 随窗口隐藏 */ }
  };
})();
