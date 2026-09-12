/* ============================================================
 * app-canvas-browser-node.js - 无限画布「内置浏览器节点」
 * 零侵入：往画布上挂一个可拖拽的浏览器节点。
 *
 * 显示层：<img> 轮询后端截图（Playwright headless 渲染）；
 * 交互层：点击/输入坐标转发给后端 page.mouse / keyboard。
 * 这样绕开了 iframe 无法嵌第三方网站的限制（X-Frame-Options）。
 *
 * 用法：
 *   1. 画布空白处右键 → 「🖥 浏览器节点」
 *   2. 控制台：BrowserNode.add() / BrowserNode.add('https://example.com')
 *   3. 顶栏按钮：🖥
 * 挂 window.BrowserNode
 * ============================================================ */
(function () {
  'use strict';

  var Z = 9500;
  var _seq = 0;
  var _nodes = [];
  var _pollMs = 800;

  function _canvas() { return document.getElementById('canvasArea'); }
  function toast(msg) {
    try { if (window.App && App._toast) return void App._toast(msg); } catch (e) {}
    try { console.log('[BrowserNode]', msg); } catch (e2) {}
  }
  function api(action, params) {
    return fetch('/api/browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, params || {}))
    }).then(function (r) { return r.json(); });
  }

  function add(url, x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) { toast('画布未就绪'); return null; }
    if (x == null) {
      var r = canvas.getBoundingClientRect();
      x = Math.round(r.width / 2 - 340 + (_seq % 5) * 40 + (canvas.scrollLeft || 0));
      y = Math.round(r.height / 2 - 240 + (_seq % 5) * 34 + (canvas.scrollTop || 0));
    }
    w = w || 680; h = h || 520;

    var id = 'browser-node-' + (++_seq);
    var el = document.createElement('div');
    el.className = 'browser-node';
    el.id = id;
    el.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;' +
      'z-index:' + (Z + _seq) + ';background:#14181f;border:1px solid #3a4150;' +
      'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);' +
      'display:flex;flex-direction:column;overflow:hidden;min-width:380px;min-height:280px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04) inset;';

    /* ---- 顶部加载进度条（Edge 风格细蓝条）---- */
    var progress = document.createElement('div');
    progress.style.cssText = 'position:absolute;top:0;left:0;height:2px;width:0;z-index:20;' +
      'background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:2px;transition:width .3s ease,opacity .3s;opacity:0;';
    el.appendChild(progress);
    var progTimer = 0;
    function startProgress() {
      clearInterval(progTimer);
      var p = 0;
      progress.style.opacity = '1'; progress.style.width = '8%';
      progTimer = setInterval(function () {
        p = Math.min(p + Math.random() * 12, 88);
        progress.style.width = p + '%';
      }, 220);
    }
    function endProgress() {
      clearInterval(progTimer);
      progress.style.width = '100%';
      setTimeout(function () { progress.style.opacity = '0'; setTimeout(function () { progress.style.width = '0'; }, 300); }, 180);
    }

    /* ---- 标题栏 + 工具条 ---- */
    var bar = document.createElement('div');
    bar.style.cssText = 'flex:0 0 auto;display:flex;flex-direction:column;background:linear-gradient(180deg,#262d3a,#20262f);user-select:none;';

    var row1 = document.createElement('div');
    row1.style.cssText = 'height:34px;display:flex;align-items:center;gap:6px;padding:0 8px;color:#c8ceda;font:13px sans-serif;';
    var title = document.createElement('span');
    title.textContent = '🖥 内置浏览器';
    title.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:move;';
    /* 双击标题栏最大化/还原（Edge 窗口行为） */
    var _savedGeom = null;
    title.addEventListener('dblclick', function () {
      if (_savedGeom) {
        el.style.left = _savedGeom.l; el.style.top = _savedGeom.t;
        el.style.width = _savedGeom.w; el.style.height = _savedGeom.h;
        _savedGeom = null;
      } else {
        _savedGeom = { l: el.style.left, t: el.style.top, w: el.style.width, h: el.style.height };
        var cr = _canvas().getBoundingClientRect();
        el.style.left = (cr.scrollLeft || 0) + 'px'; el.style.top = (cr.scrollTop || 0) + 'px';
        el.style.width = cr.width + 'px'; el.style.height = cr.height + 'px';
      }
    });
    var btnStyle = 'border:none;background:transparent;color:#c8ceda;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:5px;opacity:.75;';
    function mkBtn(txt, tip, fn) {
      var b = document.createElement('button');
      b.textContent = txt; b.title = tip; b.style.cssText = btnStyle;
      b.addEventListener('mouseenter', function () { b.style.opacity = '1'; b.style.background = '#2e3542'; });
      b.addEventListener('mouseleave', function () { b.style.opacity = '.75'; b.style.background = 'transparent'; });
      b.addEventListener('click', fn);
      return b;
    }

    /* ---- 地址栏行 ---- */
    var row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;align-items:center;gap:4px;padding:0 8px 6px;';
    var urlBox = document.createElement('input');
    urlBox.placeholder = '输入网址，回车打开';
    var urlWrap = document.createElement('div');
    urlWrap.style.cssText = 'flex:1;display:flex;align-items:center;height:26px;background:#161b22;' +
      'border:1px solid #3a4150;border-radius:13px;overflow:hidden;transition:border-color .15s,box-shadow .15s;';
    urlWrap.addEventListener('mouseenter', function () { urlWrap.style.borderColor = '#4b5568'; });
    urlWrap.addEventListener('mouseleave', function () { urlWrap.style.borderColor = urlBox === document.activeElement ? '#3b82f6' : '#3a4150'; });
    var lock = document.createElement('span');
    lock.textContent = '🔒'; lock.title = '安全连接';
    lock.style.cssText = 'flex:0 0 auto;padding:0 2px 0 9px;font-size:11px;opacity:.8;';
    urlBox.style.cssText = 'flex:1;height:100%;background:transparent;border:none;color:#c8ceda;font:12px sans-serif;padding:0 6px;outline:none;';
    /* 修复：地址栏被画布全局捕获层抢焦点导致无法输入 —— 拦截事件冒泡并强制聚焦 */
    urlBox.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    /* 捕获阶段也拦截，避免画布全局拖拽/置顶逻辑抢焦点 */
    urlWrap.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
    urlBox.addEventListener('keydown', function (e) { e.stopPropagation(); }, true);
    urlBox.addEventListener('focus', function () { urlWrap.style.borderColor = '#3b82f6'; urlWrap.style.boxShadow = '0 0 0 2px rgba(59,130,246,.25)'; });
    urlBox.addEventListener('blur', function () { urlWrap.style.borderColor = '#3a4150'; urlWrap.style.boxShadow = 'none'; });
    urlWrap.appendChild(lock); urlWrap.appendChild(urlBox);

    function smartNav(u) {
      if (!u) return;
      u = u.trim();
      /* Edge 风格：不像网址就当搜索词 */
      var isUrl = /^https?:\/\//i.test(u) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?)/.test(u) || u.startsWith('localhost');
      nav(isUrl ? (/^https?:\/\//i.test(u) ? u : 'https://' + u) : 'https://www.bing.com/search?q=' + encodeURIComponent(u));
    }
    urlBox.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); smartNav(urlBox.value); }
      if (e.key === 'Escape') urlBox.blur();
    });
    var back = mkBtn('←', '后退', function () { api('back').then(function (r) { if (r && r.url) urlBox.value = r.url; refresh(); }); });
    var fwd = mkBtn('→', '前进', function () { api('forward').then(function (r) { if (r && r.url) urlBox.value = r.url; refresh(); }); });
    var rel = mkBtn('⟳', '刷新', function () { api('reload').then(refresh); });
    var go = mkBtn('前往', '打开', function () { smartNav(urlBox.value); });
    var star = mkBtn('☆', '收藏当前页面', function () {
      var u = urlBox.value;
      if (!u) { toast('当前没有页面'); return; }
      api('bookmarks_add', { url: u, title: title.textContent.replace(/^🖥 /, '') })
        .then(function (r) { if (r.ok) { toast(r.duplicate ? '已在收藏中' : '已收藏'); renderBookmarks(); } });
    });
    var home = mkBtn('⌂', '打开主页', function () { nav(_settings.homepage || 'https://www.zf3d.com'); });
    var gear = mkBtn('⚙', '浏览器设置', function () { toggleSettings(); });
    row2.appendChild(back); row2.appendChild(fwd); row2.appendChild(rel);
    row2.appendChild(urlWrap); row2.appendChild(go); row2.appendChild(star);
    row2.appendChild(home); row2.appendChild(gear);

    /* ---- 设置面板（主页等，存后端 data/settings.json，所有节点共享）---- */
    var _settings = { homepage: 'https://www.zf3d.com' };
    api('settings_get').then(function (r) {
      if (r && r.ok && r.settings) _settings = r.settings;
    });
    var setWrap = document.createElement('div');
    setWrap.style.cssText = 'position:relative;flex:0 0 auto;';
    var setMenu = document.createElement('div');
    setMenu.style.cssText = 'display:none;position:absolute;top:100%;right:0;margin-top:4px;width:300px;' +
      'background:#1d232d;border:1px solid #3a4150;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);' +
      'padding:10px;z-index:99999;font:12px sans-serif;color:#c8ceda;';
    setWrap.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
    var setHead = document.createElement('div');
    setHead.textContent = '浏览器设置';
    setHead.style.cssText = 'font-weight:bold;margin-bottom:8px;';
    setMenu.appendChild(setHead);
    var lbl = document.createElement('div');
    lbl.textContent = '主页（打开新节点 / 点 ⌂ 时加载）：';
    lbl.style.cssText = 'margin-bottom:4px;color:#8a94a6;';
    setMenu.appendChild(lbl);
    var homeInput = document.createElement('input');
    homeInput.value = _settings.homepage || '';
    homeInput.style.cssText = 'width:100%;box-sizing:border-box;height:26px;background:#161b22;border:1px solid #3a4150;' +
      'border-radius:5px;color:#c8ceda;font:12px sans-serif;padding:0 8px;outline:none;margin-bottom:8px;';
    homeInput.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    homeInput.addEventListener('keydown', function (e) { e.stopPropagation(); }, true);
    setMenu.appendChild(homeInput);
    var setBtns = document.createElement('div');
    setBtns.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
    setBtns.appendChild(mkBtn('恢复默认', '恢复为朱峰社区主页', function () {
      homeInput.value = 'https://www.zf3d.com';
    }));
    setBtns.appendChild(mkBtn('保存', '保存设置', function () {
      var hp = (homeInput.value || '').trim() || 'https://www.zf3d.com';
      api('settings_set', { settings: { homepage: hp } }).then(function (r) {
        if (r && r.ok) { _settings = r.settings; toast('设置已保存'); toggleSettings(false); }
        else toast('保存失败');
      });
    }));
    setMenu.appendChild(setBtns);
    setWrap.appendChild(setMenu);
    function toggleSettings(force) {
      var show = force != null ? force : setMenu.style.display === 'none';
      if (show) homeInput.value = _settings.homepage || '';
      setMenu.style.display = show ? 'block' : 'none';
    }
    document.addEventListener('pointerdown', function (e) {
      if (!setWrap.contains(e.target)) setMenu.style.display = 'none';
    });
    row2.appendChild(setWrap);

    /* ---- 收藏（下拉对话框，不再平铺）---- */
    var bmWrap = document.createElement('div');
    bmWrap.style.cssText = 'position:relative;flex:0 0 auto;';
    bmWrap.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
    var bmBtn = mkBtn('★ 收藏', '打开收藏列表', function () { toggleBmMenu(); });
    var bmMenu = document.createElement('div');
    bmMenu.style.cssText = 'display:none;position:absolute;top:100%;right:0;margin-top:4px;min-width:280px;max-width:380px;' +
      'max-height:300px;overflow-y:auto;background:#1d232d;border:1px solid #3a4150;border-radius:8px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.5);padding:4px;z-index:99999;scrollbar-width:thin;';
    var bmFooter = document.createElement('div');
    bmFooter.style.cssText = 'display:flex;gap:4px;padding:3px 4px;border-top:1px solid #3a4150;margin-top:4px;align-items:center;';
    var bmHint = document.createElement('span');
    bmHint.style.cssText = 'flex:1;color:#6b7686;font:11px sans-serif;';
    bmFooter.appendChild(bmHint);
    bmFooter.appendChild(mkBtn('⤓ 导入本机收藏', '导入 Chrome/Edge 收藏', function () {
      toast('正在导入收藏…');
      api('bookmarks_import_chrome', {}).then(function (r) {
        if (r.ok) { toast('导入完成：找到 ' + r.found + ' 条，新增 ' + r.added + ' 条'); renderBookmarks(); }
        else toast('导入失败: ' + (r.error || ''));
      });
    }));
    bmMenu.appendChild(bmFooter);
    bmWrap.appendChild(bmBtn); bmWrap.appendChild(bmMenu);

    function toggleBmMenu(force) {
      var show = force != null ? force : bmMenu.style.display === 'none';
      bmMenu.style.display = show ? 'block' : 'none';
      if (show) renderBookmarks();
    }
    document.addEventListener('pointerdown', function (e) {
      if (!bmWrap.contains(e.target)) bmMenu.style.display = 'none';
    });

    function renderBookmarks() {
      api('bookmarks_list').then(function (r) {
        // 清掉除 footer 外的旧项
        Array.prototype.slice.call(bmMenu.children).forEach(function (c) { if (c !== bmFooter) bmMenu.removeChild(c); });
        var items = (r && r.ok && r.bookmarks) || [];
        bmHint.textContent = items.length ? ('共 ' + items.length + ' 条收藏 · 左键打开 · 右键删除') : '（还没有收藏：点 ☆ 收藏当前页）';
        items.forEach(function (b) {
          var it = document.createElement('div');
          it.textContent = b.title || b.url;
          it.title = b.url + '\n左键打开 · 右键删除';
          it.style.cssText = 'color:#c8ceda;font:12px sans-serif;padding:5px 8px;border-radius:5px;cursor:pointer;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          it.addEventListener('mouseenter', function () { it.style.background = '#2e3542'; });
          it.addEventListener('mouseleave', function () { it.style.background = 'transparent'; });
          it.addEventListener('click', function () { nav(b.url); toggleBmMenu(false); });
          it.addEventListener('contextmenu', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (!confirm('删除书签「' + (b.title || b.url) + '」？')) return;
            api('bookmarks_del', { url: b.url }).then(function (r2) {
              if (r2.ok) { toast('已删除'); renderBookmarks(); }
            });
          });
          bmMenu.insertBefore(it, bmFooter);
        });
      });
    }
    renderBookmarks();
    row2.appendChild(bmWrap);

    row1.appendChild(title);
    row1.appendChild(mkBtn('📌', '固定/取消固定（置顶）', function () {
      el.style.zIndex = el.style.zIndex === '99998' ? String(Z + _seq) : '99998';
    }));
    row1.appendChild(mkBtn('↗', '截图到画布', function () { shotToCanvas(); }));
    row1.appendChild(mkBtn('🐞', '控制台（F12 风格错误日志）', function () {
      srcPanel.style.display = 'none';
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') refreshConsole();
    }));
    row1.appendChild(mkBtn('</>', '查看页面源代码（可一键复制）', function () {
      panel.style.display = 'none';
      srcPanel.style.display = srcPanel.style.display === 'none' ? 'block' : 'none';
      if (srcPanel.style.display === 'block') refreshSrc();
    }));
    row1.appendChild(mkBtn('✕', '关闭', function () { stopPoll(); remove(node); }));

    bar.appendChild(row1); bar.appendChild(row2);

    /* ---- 控制台面板（F12 风格，停靠在右侧）---- */
    var panel = document.createElement('div');
    panel.style.cssText = 'flex:0 0 240px;display:none;flex-direction:column;background:#0b0e13;' +
      'border-left:1px solid #3a4150;font:12px/1.5 Consolas,monospace;color:#c8ceda;';
    var panelHead = document.createElement('div');
    panelHead.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;background:#161b22;font:11px sans-serif;color:#8a94a6;';
    var panelTitle = document.createElement('span');
    panelTitle.textContent = '控制台';
    panelTitle.style.cssText = 'flex:1;';
    var selLevel = document.createElement('select');
    selLevel.style.cssText = 'background:#161b22;color:#c8ceda;border:1px solid #3a4150;border-radius:4px;font:11px sans-serif;';
    ['all', 'error', 'warning', 'info', 'log'].forEach(function (lv) {
      var o = document.createElement('option'); o.value = lv;
      o.textContent = lv === 'all' ? '全部' : (lv === 'error' ? '错误' : lv);
      selLevel.appendChild(o);
    });
    var clearBtn = mkBtn('🗑', '清空日志', function () {
      api('console', { clear: true }).then(function () { refreshConsole(); });
    });
    var copyBtn = mkBtn('⧉', '复制全部日志（可粘贴给 AI）', function () {
      var txt = Array.prototype.map.call(panelBody.children, function (d) { return d.textContent; }).join('\n');
      if (!txt) { toast('没有日志可复制'); return; }
      try { navigator.clipboard.writeText(txt).then(function () { toast('已复制 ' + panelBody.children.length + ' 条日志'); }); }
      catch (e) { toast('复制失败，请手动选中复制'); }
    });
    var autoChk = document.createElement('label');
    autoChk.style.cssText = 'display:flex;align-items:center;gap:2px;cursor:pointer;';
    var autoBox = document.createElement('input');
    autoBox.type = 'checkbox'; autoBox.checked = true;
    autoChk.appendChild(autoBox);
    autoChk.appendChild(document.createTextNode('自动'));
    panelHead.appendChild(panelTitle);
    panelHead.appendChild(selLevel);
    panelHead.appendChild(clearBtn);
    panelHead.appendChild(copyBtn);
    panelHead.appendChild(autoChk);
    var panelBody = document.createElement('div');
    panelBody.style.cssText = 'flex:1;overflow-y:auto;padding:4px 8px;white-space:pre-wrap;word-break:break-all;scrollbar-width:thin;';
    panel.appendChild(panelHead); panel.appendChild(panelBody);

    var _lastErrCount = 0;
    function refreshConsole() {
      api('console', { limit: 300 }).then(function (r) {
        if (!r || !r.ok) return;
        var logs = r.logs || [];
        var lv = selLevel.value;
        var shown = lv === 'all' ? logs : logs.filter(function (x) { return x.level === lv; });
        panelBody.innerHTML = '';
        if (!shown.length) {
          var hint = document.createElement('div');
          hint.textContent = '（暂无日志）';
          hint.style.cssText = 'color:#5a6474;';
          panelBody.appendChild(hint);
        }
        shown.forEach(function (x) {
          var d = document.createElement('div');
          d.textContent = x.t + ' ' + x.text;
          var c = { error: '#ff6b6b', warning: '#e5c07b', info: '#61afef', log: '#c8ceda' }[x.level] || '#c8ceda';
          if (x.level === 'error') d.style.background = 'rgba(255,80,80,.08)';
          d.style.cssText += 'color:' + c + ';padding:1px 0;border-bottom:1px solid rgba(255,255,255,.03);';
          panelBody.appendChild(d);
        });
        panelBody.scrollTop = panelBody.scrollHeight;
        var errs = logs.filter(function (x) { return x.level === 'error'; }).length;
        if (errs > _lastErrCount && panel.style.display !== 'block') {
          toast('🐞 页面有 ' + errs + ' 条错误，点 🐞 查看');
        }
        _lastErrCount = errs;
      });
    }
    selLevel.addEventListener('change', refreshConsole);
    panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    /* ---- 源代码面板（停靠在右侧，与控制台互斥）---- */
    var srcPanel = document.createElement('div');
    srcPanel.style.cssText = 'flex:0 0 300px;display:none;flex-direction:column;background:#0b0e13;' +
      'border-left:1px solid #3a4150;font:12px/1.5 Consolas,monospace;color:#9fb0a8;';
    var srcHead = document.createElement('div');
    srcHead.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;background:#161b22;font:11px sans-serif;color:#8a94a6;';
    var srcTitle = document.createElement('span');
    srcTitle.textContent = '源代码';
    srcTitle.style.cssText = 'flex:1;';
    var srcCopyBtn = mkBtn('⧉', '一键复制源代码', function () {
      var txt = _srcTA().value || '';
      if (!txt) { toast('还没有源代码，请先点 🔄 加载'); return; }
      var done = function () { toast('✅ 已复制源代码（' + txt.length + ' 字符）'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { _srcCopyFallback(txt); });
      } else { _srcCopyFallback(txt); }
    });
    function _srcCopyFallback(txt) {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        toast('✅ 已复制源代码（' + txt.length + ' 字符）');
      } catch (e) { toast('复制失败，请手动选中复制'); }
    }
    var srcRefreshBtn = mkBtn('🔄', '重新加载源代码', function () { refreshSrc(); });
    var _srcWrap = null; // 懒创建的 <textarea>
    function _srcTA() {
      if (!_srcWrap) {
        _srcWrap = document.createElement('textarea');
        _srcWrap.readOnly = true;
        _srcWrap.spellcheck = false;
        _srcWrap.wrap = 'off';
        _srcWrap.style.cssText = 'display:block;width:100%;height:100%;box-sizing:border-box;resize:none;background:#0b0e13;' +
          'border:none;outline:none;color:#9fb0a8;font:11px/1.45 Consolas,monospace;padding:6px 8px;' +
          'white-space:pre;overflow:auto;scrollbar-width:thin;';
        srcBody.appendChild(_srcWrap);
      }
      return _srcWrap;
    }
    function refreshSrc() {
      api('content').then(function (r) {
        if (!r || !r.ok) { srcBody.textContent = '加载失败：' + ((r && r.error) || '未知错误'); return; }
        var html = r.html || r.text || '';
        _srcTA().value = html;
        srcBody.style.display = 'none';
        srcTitle.textContent = '源代码（' + html.length + ' 字符）';
        if (!html) { srcBody.style.display = 'block'; srcBody.textContent = '（页面为空：请先在浏览器节点里打开一个网页）'; }
      });
    }
    srcHead.appendChild(srcTitle);
    srcHead.appendChild(srcCopyBtn);
    srcHead.appendChild(srcRefreshBtn);
    var srcBody = document.createElement('div');
    srcBody.style.cssText = 'flex:1;overflow:auto;padding:4px 8px;white-space:pre-wrap;word-break:break-all;scrollbar-width:thin;color:#5a6474;';
    srcBody.textContent = '（点击 </> 按钮加载源代码）';
    srcPanel.appendChild(srcHead); srcPanel.appendChild(srcBody);
    srcPanel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    /* ---- 显示区：<img> 截图 + 坐标交互 ---- */
    var view = document.createElement('div');
    view.style.cssText = 'flex:1;position:relative;background:#0d1117;overflow:hidden;cursor:crosshair;';
    var img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;';
    img.src = '/api/browser?action=shot&t=' + Date.now();
    view.appendChild(img);

    /* 视口尺寸（由后端 resize 动作同步，截图与显示区 1:1 同比例） */
    var vp = { w: 1280, h: 800 };          /* 后端已生效的视口 */
    var _target = { w: 1280, h: 800 };     /* 目标视口（乐观更新，坐标映射立即跟随） */
    var _rzTimer = 0, _rzBusy = false, _rzLast = null, _lastSent = 0;
    var RZ_MIN_GAP = 90;   /* 两次 resize 的最小间隔：拖拽中实时跟随又不刷爆后端 */

    /* 发送 resize 请求：串行节流（领先+兜底），拖拽过程中持续以最新尺寸跟随 */
    function _sendResize(force) {
      var gap = Date.now() - _lastSent;
      if (!force && gap < RZ_MIN_GAP) {
        if (!_rzTimer) _rzTimer = setTimeout(function () { _rzTimer = 0; _sendResize(true); }, RZ_MIN_GAP - gap);
        return;
      }
      _rzBusy = true;
      _lastSent = Date.now();
      api('resize', { width: _target.w, height: _target.h }).then(function () {
        _rzBusy = false;
        if (_rzLast) {                                /* 请求期间有更新：追发最新尺寸 */
          var p = _rzLast; _rzLast = null;
          _target.w = p.width; _target.h = p.height;
          _sendResize(true);
        } else {
          vp.w = _target.w; vp.h = _target.h;         /* 追平真实视口 */
        }
        refresh();
      }, function () { _rzBusy = false; refresh(); }); /* 失败也要复位在途标记，防止卡死 */
    }

    function syncViewport(immediate) {
      var vr = view.getBoundingClientRect();
      var nw = Math.round(vr.width), nh = Math.round(vr.height);
      if (nw < 320 || nh < 240 || (nw === _target.w && nh === _target.h)) return;
      _target.w = nw; _target.h = nh;   /* 乐观更新：坐标映射立即用新尺寸 */
      if (_rzTimer) { clearTimeout(_rzTimer); _rzTimer = 0; }
      if (_rzBusy) { _rzLast = { width: nw, height: nh }; return; }   /* 在途：排队最新值，响应回来立即补发 */
      _sendResize(!!immediate);
    }

    /* 缩放显示：截图 _target.w x _target.h → 实际显示尺寸（拖拽中随乐观值实时跟随） */
    function toPageXY(ev) {
      var vr = view.getBoundingClientRect();
      var scale = Math.min(vr.width / _target.w, vr.height / _target.h);
      var ox = (vr.width - _target.w * scale) / 2, oy = (vr.height - _target.h * scale) / 2;
      return {
        x: Math.round((ev.clientX - vr.left - ox) / scale),
        y: Math.round((ev.clientY - vr.top - oy) / scale)
      };
    }
    view.addEventListener('mousedown', function (ev) {
      var p = toPageXY(ev);
      var acts = { 0: 'click', 1: 'middleclick', 2: 'rightclick' };
      // 交出焦点输入框里的内容
      var typing = document.activeElement === urlBox;
      if (typing) return;
      ev.preventDefault();
      var body = { x: p.x, y: p.y };
      if (ev.detail >= 2) body.clickCount = 2;
      api(acts[ev.button] || 'click', body).then(function (res) {
        if (res && res.url) urlBox.value = res.url;
        refresh();
      });
    });
    view.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    view.addEventListener('wheel', function (ev) {
      var p = toPageXY(ev);
      ev.preventDefault();
      api('wheel', { x: p.x, y: p.y, deltaY: ev.deltaY }).then(refresh);
    }, { passive: false });

    /* ---- 键盘输入 ---- */
    var keyHandler = function (ev) {
      var top = _nodes[_nodes.length - 1];
      if (!top || top.el !== el) return; // 只响应最上层节点
      if (document.activeElement === urlBox) return;
      if (ev.key.length === 1 || ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(ev.key) >= 0) {
        ev.preventDefault();
        api('key', { key: ev.key }).then(refresh);
      }
    };
    document.addEventListener('keydown', keyHandler, true);

    /* ---- 尺寸拉手 ---- */
    var grip = document.createElement('div');
    grip.style.cssText = 'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:6;' +
      'background:linear-gradient(135deg,transparent 50%,rgba(200,206,218,.45) 50%);';

    var edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    var edgeCss = {
      n: 'top:0;left:0;right:0;height:6px;cursor:ns-resize;',
      s: 'bottom:0;left:0;right:0;height:6px;cursor:ns-resize;',
      e: 'right:0;top:0;bottom:0;width:6px;cursor:ew-resize;',
      w: 'left:0;top:0;bottom:0;width:6px;cursor:ew-resize;',
      ne: 'right:0;top:0;width:14px;height:14px;cursor:nesw-resize;',
      nw: 'left:0;top:0;width:14px;height:14px;cursor:nwse-resize;',
      se: 'right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;',
      sw: 'left:0;bottom:0;width:14px;height:14px;cursor:nesw-resize;'
    };
    edges.forEach(function (dir) {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;z-index:5;' + edgeCss[dir];
      d.addEventListener('pointerdown', function (e) { startResize(e, dir); });
      el.appendChild(d);
    });
    grip.addEventListener('pointerdown', function (e) { startResize(e, 'se'); });

    function startResize(ev, dir) {
      ev.preventDefault(); ev.stopPropagation();
      var sx = ev.clientX, sy = ev.clientY, sw = el.offsetWidth, sh = el.offsetHeight;
      var mv = function (e2) {
        var dx = e2.clientX - sx, dy = e2.clientY - sy;
        if (dir.indexOf('e') >= 0) el.style.width = Math.max(380, sw + dx) + 'px';
        if (dir.indexOf('s') >= 0) el.style.height = Math.max(280, sh + dy) + 'px';
        if (dir.indexOf('w') >= 0) { el.style.width = Math.max(380, sw - dx) + 'px'; el.style.left = (parseInt(el.style.left) + Math.min(dx, sw - 380)) + 'px'; }
        if (dir.indexOf('n') >= 0) { el.style.height = Math.max(280, sh - dy) + 'px'; el.style.top = (parseInt(el.style.top) + Math.min(dy, sh - 280)) + 'px'; }
      };
      var up = function () {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        syncViewport(true);   /* 拖拽结束/中断：立即同步最终尺寸，避免残余节流延迟 */
      };
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    }

    /* ---- 尺寸观察：无论什么原因（手动拖拽/画布缩放/窗口改变）导致节点尺寸变化，都实时自适应 ---- */
    if (typeof ResizeObserver !== 'undefined') {
      var _ro = new ResizeObserver(function () { syncViewport(false); });
      _ro.observe(view);
    } else {
      window.addEventListener('resize', function () { syncViewport(false); });
    }

    /* ---- 拖拽移动 ---- */
    function startDrag(ev) {
      if (ev.target.tagName === 'BUTTON' || ev.target === urlBox) return;
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      var sx = ev.clientX, sy = ev.clientY;
      var sl = parseInt(el.style.left, 10) || 0, st = parseInt(el.style.top, 10) || 0;
      var mv = function (e2) {
        var nl = sl + e2.clientX - sx;
        var nt = st + e2.clientY - sy;
        /* 限制：顶部不能拖出画布上方（最小 0），左右也不允许拖出左边界 */
        if (nt < 0) nt = 0;
        if (nl < 0) nl = 0;
        el.style.left = nl + 'px';
        el.style.top = nt + 'px';
      };
      var up = function () {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        try { document.body.style.userSelect = ''; } catch (e3) {}
      };
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      try { document.body.style.userSelect = 'none'; } catch (e3) {}
    }
    row1.addEventListener('pointerdown', startDrag);
    title.addEventListener('pointerdown', startDrag);
    el.addEventListener('pointerdown', function () {
      /* 置顶：点击任意位置把节点提到最前 */
      el.style.zIndex = ++Z;
    });

    /* ---- 轮询截图 ---- */
    var timer = 0, seq = 0;
    function refresh() {
      img.src = '/api/browser?action=shot&t=' + (++seq);
      if (srcPanel.style.display === 'block') refreshSrc();
      api('status').then(function (s) {
        if (s && s.ok) {
          if (s.url && document.activeElement !== urlBox) { urlBox.value = s.url; lock.textContent = /^https:/i.test(s.url) ? '🔒' : '⚠'; lock.title = /^https:/i.test(s.url) ? '安全连接 (HTTPS)' : '非加密连接'; }
          title.textContent = '🖥 ' + (s.title || s.url || '内置浏览器');
          stLeft.textContent = s.url || '就绪';
        }
      });
    }
    function stopPoll() { if (timer) { clearInterval(timer); timer = 0; } }
    function startPoll() { stopPoll(); timer = setInterval(function () { img.src = '/api/browser?action=shot&t=' + (++seq); if (panel.style.display === 'block' && autoBox.checked) refreshConsole(); }, _pollMs); }

    function nav(u) {
      if (!u) return;
      startProgress(); stLeft.textContent = '正在加载 ' + u + ' …';
      api('goto', { url: u }).then(function (res) {
        endProgress();
        if (!res.ok) { toast('打开失败: ' + (res.error || '')); stLeft.textContent = '加载失败'; return; }
        urlBox.value = res.url; title.textContent = '🖥 ' + (res.title || res.url);
        stLeft.textContent = '完成 · ' + res.url;
        refresh();
      });
    }

    /* ---- 键盘快捷键（节点获得焦点时生效）---- */
    el.addEventListener('keydown', function (e) {
      if (e.key === 'F5') { e.preventDefault(); api('reload').then(refresh); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); urlBox.focus(); urlBox.select(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); api('reload').then(refresh); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); api('back').then(function (r) { if (r && r.url) urlBox.value = r.url; refresh(); }); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); api('forward').then(function (r) { if (r && r.url) urlBox.value = r.url; refresh(); }); }
    });

    /* 截图固定到画布（生成本地记录 img 节点） */
    function shotToCanvas() {
      var pic = document.createElement('img');
      pic.src = '/api/browser?action=shot&t=' + Date.now();
      pic.style.cssText = 'position:absolute;left:' + (parseInt(el.style.left) + w + 20) + 'px;top:' + el.style.top +
        ';width:420px;border:1px solid #3a4150;border-radius:8px;z-index:' + (Z - 100) + ';background:#fff;';
      pic.title = '浏览器截图 ' + new Date().toLocaleString();
      canvas.appendChild(pic);
      toast('截图已放到画布');
    }

    /* ---- 底部状态栏（Edge 风格）---- */
    var status = document.createElement('div');
    status.style.cssText = 'flex:0 0 auto;height:22px;display:flex;align-items:center;gap:12px;padding:0 10px;' +
      'background:#161b22;border-top:1px solid #2a313d;color:#6b7686;font:11px sans-serif;';
    var stLeft = document.createElement('span');
    stLeft.textContent = '就绪';
    stLeft.style.cssText = 'flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
    var stZoom = document.createElement('span');
    stZoom.textContent = '截图 0.8s/次'; stZoom.title = '点击暂停/继续轮询';
    stZoom.style.cssText = 'cursor:pointer;flex:0 0 auto;';
    stZoom.addEventListener('click', function () {
      if (timer) { stopPoll(); stZoom.textContent = '已暂停轮询'; }
      else { startPoll(); stZoom.textContent = '截图 0.8s/次'; }
    });
    status.appendChild(stLeft); status.appendChild(stZoom);

    var mainRow = document.createElement('div');
    mainRow.style.cssText = 'flex:1;display:flex;overflow:hidden;min-height:0;';
    mainRow.appendChild(view); mainRow.appendChild(panel); mainRow.appendChild(srcPanel);
    el.appendChild(bar); el.appendChild(mainRow); el.appendChild(status);; el.appendChild(grip);
    canvas.appendChild(el);

    var node = { id: id, el: el, img: img, urlBox: urlBox, refresh: refresh, stopPoll: stopPoll, syncViewport: syncViewport };
    _nodes.push(node);
    try { if (window.CanvasNodeLock) CanvasNodeLock.register({ id: id, el: el }); } catch (e0) {}
    startPoll();
    /* 节点刚插入 DOM，等一帧布局稳定后把显示区真实像素同步给后端视口 */
    setTimeout(syncViewport, 0);
    setTimeout(syncViewport, 400);

    if (url) nav(url);
    else api('settings_get').then(function (r) {
      var hp = (r && r.ok && r.settings && r.settings.homepage) || 'https://www.zf3d.com';
      nav(hp);
    });

    return node;
  }

  function remove(node) {
    try { if (window.CanvasNodeLock && node) CanvasNodeLock.unregister({ id: node.id, el: node.el }); } catch (e0) {}
    var i = _nodes.indexOf(node);
    if (i >= 0) _nodes.splice(i, 1);
    if (node && node.el && node.el.parentNode) node.el.parentNode.removeChild(node.el);
  }
  function closeAll() { while (_nodes.length) remove(_nodes[0]); }

  /* ---- 顶栏按钮 ---- */
  function injectToolbarButton() {
    // 已整合进「更多」下拉（app-canvas-more-menu.js），不再单独注入顶栏按钮
    return;
    if (document.getElementById('btnBrowserNode')) return;
    var host = document.getElementById('btnSettings') || document.getElementById('settingsBtn') ||
      document.querySelector('.topbar, .toolbar, header') || document.body;
    var btn = document.createElement('button');
    btn.id = 'btnBrowserNode';
    btn.title = '在画布上打开内置浏览器节点';
    btn.textContent = '🖥';
    btn.style.cssText = 'margin-left:6px;height:28px;min-width:30px;padding:0 6px;border:none;' +
      'background:transparent;color:inherit;opacity:.65;border-radius:6px;cursor:pointer;font-size:14px;';
    btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '.65'; });
    btn.addEventListener('click', function () { add(); });
    if (host !== document.body && host.parentNode) host.parentNode.insertBefore(btn, host.nextSibling);
    else host.appendChild(btn);
  }

  /* ---- 右键菜单 ---- */
  function injectContextMenu() {
    var canvas = _canvas();
    if (!canvas) return;
    canvas.addEventListener('contextmenu', function (ev) {
      var t = ev.target;
      if (t !== canvas && !t.classList.contains('canvas-grid') && t.id !== 'canvasArea') return;
      setTimeout(function () {
        if (document.getElementById('ctx-browser-node')) return;
        var menu = document.createElement('div');
        menu.id = 'ctx-browser-node';
        menu.textContent = '🖥 浏览器节点';
        menu.style.cssText =
          'position:fixed;left:' + ev.clientX + 'px;top:' + ev.clientY + 'px;z-index:99999;' +
          'background:#222833;border:1px solid #3a4150;color:#c8ceda;border-radius:8px;' +
          'padding:8px 14px;font:13px/1.4 sans-serif;cursor:pointer;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.5);user-select:none;';
        menu.addEventListener('mouseenter', function () { menu.style.background = 'rgba(80,160,255,.15)'; });
        menu.addEventListener('mouseleave', function () { menu.style.background = '#161b22'; });
        menu.addEventListener('click', function () { add(null, ev.clientX, ev.clientY - 40); menu.remove(); });
        document.body.appendChild(menu);
        var kill = function () { if (menu.parentNode) menu.remove(); document.removeEventListener('mousedown', kill, true); };
        setTimeout(function () { document.addEventListener('mousedown', kill, true); }, 50);
      }, 60);
    }, true);
  }

  function boot(retries) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      injectToolbarButton(); injectContextMenu();
      return;
    }
    if ((retries || 0) < 40) setTimeout(function () { boot((retries || 0) + 1); }, 500);
  }
  boot();

  window.BrowserNode = {
    add: add, remove: remove, closeAll: closeAll,
    nodes: function () { return _nodes.slice(); },
    api: api
  };
})();
