
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  window.alert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

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
  var _focusedNode = null;   /* 当前聚焦的浏览器节点 el：只有点过它才转发键盘 */
  var _outsideBound = false;

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

  /* ---- 引擎下载迷你进度卡：右下角悬浮，不阻挡画面 ---- */
  var _miniCard = null;
  function _showMiniProgress() {
    if (_miniCard && document.body.contains(_miniCard)) return;
    var card = document.createElement('div');
    card.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99500;width:280px;' +
      'background:#1b212c;border:1px solid #3a4150;border-radius:10px;padding:12px 14px;' +
      'color:#dfe4ec;font:12.5px sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.55);';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
      '<span style="font-size:15px;">\u2699\ufe0f</span>' +
      '<span style="flex:1;font-weight:600;">浏览器引擎下载中</span>' +
      '<span class="bn-mini-pct" style="opacity:.85;">0%</span>' +
      '<span class="bn-mini-hide" style="cursor:pointer;opacity:.6;padding:0 4px;" title="收起">\u2013</span></div>' +
      '<div style="height:5px;background:#2a3140;border-radius:3px;overflow:hidden;">' +
      '<div class="bn-mini-bar" style="height:100%;width:0;background:linear-gradient(90deg,#3b82f6,#60a5fa);' +
      'border-radius:3px;transition:width .4s ease;"></div></div>' +
      '<div class="bn-mini-msg" style="margin-top:7px;opacity:.72;font-size:11.5px;">正在准备…</div>';
    document.body.appendChild(card);
    _miniCard = card;
    card.querySelector('.bn-mini-hide').onclick = function () { card.style.display = 'none'; };
  }
  function _updateMiniProgress(prog) {
    if (!prog || !prog.running) return;
    _showMiniProgress();
    if (_miniCard) _miniCard.style.display = '';
    var pct = Math.max(0, Math.min(99, prog.pct | 0));
    _miniCard.querySelector('.bn-mini-pct').textContent = pct + '%';
    _miniCard.querySelector('.bn-mini-bar').style.width = pct + '%';
    _miniCard.querySelector('.bn-mini-msg').textContent = prog.msg || prog.phase || '下载中…';
  }
  function _finishMiniProgress(ok) {
    if (!_miniCard) return;
    var card = _miniCard; _miniCard = null;
    card.querySelector('.bn-mini-pct').textContent = ok ? '100%' : '!';
    card.querySelector('.bn-mini-bar').style.width = ok ? '100%' : '0';
    card.querySelector('.bn-mini-msg').textContent = ok ? '\u2714 安装完成，浏览器节点已就绪' : '安装失败，请到 设置 → 组件下载 查看';
    if (!ok) card.querySelector('.bn-mini-bar').style.background = '#ef4444';
    setTimeout(function () { card.remove(); }, ok ? 4000 : 10000);
  }
  /* 后台轮询进度（安装完成后自动提示） */
  function _pollInstallProgress(onDone) {
    fetch('/api/components/progress', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var p = d && d.ok ? d.progress : null;
        if (p && p.running) {
          _updateMiniProgress(p);
          setTimeout(function () { _pollInstallProgress(onDone); }, 1000);
        } else {
          fetch('/api/components/status', { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (s2) {
              var g2 = (s2 && s2.ok && s2.groups || []).filter(function (x) { return x.key === 'browser'; })[0];
              var ok = !!(g2 && g2.installed);
              _finishMiniProgress(ok);
              if (ok && typeof onDone === 'function') onDone();
            }).catch(function () { _finishMiniProgress(false); });
        }
      }).catch(function () { setTimeout(function () { _pollInstallProgress(onDone); }, 2000); });
  }

  /* ---- 未安装时的引导对话框：带醒目的「立即下载」按钮，下载中实时反馈 ---- */
  function _engineInstallDialog(onStarted) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:99000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
      var box = document.createElement('div');
      box.style.cssText = 'width:380px;background:#1b212c;border:1px solid #3a4150;border-radius:12px;padding:22px;text-align:center;color:#dfe4ec;box-shadow:0 16px 48px rgba(0,0,0,.6);';
      box.innerHTML = '<div style="font-size:40px;line-height:1;">🌐</div>' +
        '<div style="font-size:16px;font-weight:600;margin:10px 0 6px;">内置浏览器引擎未安装</div>' +
        '<div class="bn-eng-desc" style="font-size:12.5px;opacity:.72;line-height:1.7;">首次使用需下载 Playwright + Chromium（约 150MB）。<br>下载在后台进行，完成后自动打开浏览器节点。</div>';
      var btn = document.createElement('button');
      btn.textContent = '⬇️ 立即下载';
      btn.style.cssText = 'margin-top:16px;width:100%;padding:10px 0;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:14px;cursor:pointer;';
      var cancel = document.createElement('button');
      cancel.textContent = '暂不用';
      cancel.style.cssText = 'margin-top:8px;width:100%;padding:8px 0;border:none;border-radius:8px;background:transparent;color:#8b93a3;font-size:13px;cursor:pointer;';
      box.appendChild(btn); box.appendChild(cancel); mask.appendChild(box); document.body.appendChild(mask);
      function close(ok) { mask.remove(); resolve(ok); }
      cancel.onclick = function () { close(false); };
      btn.onclick = function () {
        /* fire-and-forget：请求发出即关弹窗放行页面，迷你进度卡接管（含失败提示）；
           装好由 _pollInstallProgress(onDone) 自动回调打开节点 */
        close(false);
        if (typeof onStarted === 'function') onStarted();
        _showMiniProgress();
        _miniCard.querySelector('.bn-mini-msg').textContent = '\u23f3 已发起，后台下载中…';
        fetch('/api/components/install', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'browser' })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d || !d.ok) {
            if (_miniCard) {
              _miniCard.querySelector('.bn-mini-msg').textContent = '\u26a0\ufe0f 下载发起失败：' + ((d && d.error) || '未知错误');
              _miniCard.querySelector('.bn-mini-bar').style.background = '#ef4444';
              var _c1 = _miniCard; _miniCard = null;
              setTimeout(function () { _c1.remove(); }, 10000);
            }
            return;
          }
          _pollInstallProgress();
        }).catch(function () {
          if (_miniCard) {
            _miniCard.querySelector('.bn-mini-msg').textContent = '\u26a0\ufe0f 网络错误，请重试';
            var _c2 = _miniCard; _miniCard = null;
            setTimeout(function () { _c2.remove(); }, 10000);
          }
        });
      };
    });
  }

  /* ---- 引擎依赖检查：未安装时引导用户一键后台下载，装好自动继续 ---- */
  function ensureEngine() {
    return fetch('/api/components/status', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (st) {
        var g = (st && st.ok && st.groups || []).filter(function (x) { return x.key === 'browser'; })[0];
        if (!g) return true;                     /* 状态接口异常时不拦路，交由后端报错 */
        if (g.installed) return true;
        /* 后台已有安装任务在跑：不拦路，显示迷你进度卡，装完自动提示 */
        return fetch('/api/components/progress', { method: 'POST' })
          .then(function (r2) { return r2.json(); })
          .then(function (pd) {
            var p2 = pd && pd.ok ? pd.progress : null;
            if (p2 && (p2.running || p2.running_flag)) {
              _pollInstallProgress();
              return true;
            }
            return _engineInstallDialog(function () {
              /* 已发起后台安装：装好后自动补开节点 */
              _pollInstallProgress(function () { _add(url, x, y, w, h); });
            });
          }).catch(function () { return _engineInstallDialog(); });
      })
      .catch(function () { return true; });
  }

  function add(url, x, y, w, h) {
    ensureEngine().then(function (ok) { if (ok) _add(url, x, y, w, h); });
    return null;
  }

  function _add(url, x, y, w, h) {
    var canvas = _canvas();
    if (!canvas) {
      /* 兜底：非画布视图（如首页/聊天页）也允许打开，挂一个全屏浮动层 */
      canvas = document.getElementById('canvasArea_fallback');
      if (!canvas) {
        canvas = document.createElement('div');
        canvas.id = 'canvasArea_fallback';
        canvas.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;';
        document.body.appendChild(canvas);
      }
    }
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
    /* 标记：地址栏聚焦时，画布全局按键捕获层（keyHandler）不再转发按键到后端，
       避免 Enter 被两处消费导致"输入后回车无反应" */
    urlBox.dataset.zfLocalInput = '1';
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
    var rel = mkBtn('⟳', '刷新', function () { api('reload').then(function(){opBurst();refresh();}); });
    var star = mkBtn('☆', '收藏当前页面', function () {
      var u = urlBox.value;
      if (!u) { toast('当前没有页面'); return; }
      api('bookmarks_add', { url: u, title: title.textContent.replace(/^🖥 /, '') })
        .then(function (r) { if (r.ok) { toast(r.duplicate ? '已在收藏中' : '已收藏'); renderBookmarks(); } });
    });
    var home = mkBtn('⌂', '打开主页', function () { nav(_settings.homepage || 'https://www.zf3d.com'); });
    var gear = mkBtn('⚙', '浏览器设置', function () { toggleSettings(); });
    row2.appendChild(back); row2.appendChild(fwd); row2.appendChild(rel);
    row2.appendChild(urlWrap);
    row2.appendChild(star);
    row2.appendChild(bmWrap);

    /* 辅助按钮收纳：分隔线 + 🧰 弹出菜单，避免地址栏行过挤 */
    function mkAuxBtn(txt, tip, fn) {
      var b = mkBtn(txt, tip, fn);
      b.style.fontSize = '12px';
      return b;
    }
    var auxWrap = document.createElement('div');
    auxWrap.style.cssText = 'position:relative;flex:0 0 auto;';
    var auxBtn = mkAuxBtn('🧰', '更多工具：主页 / 设置 / 安全探测 / 截图 / 控制台 / 源代码', function () {
      auxMenu.style.display = auxMenu.style.display === 'none' ? 'block' : 'none';
    });
    var auxMenu = document.createElement('div');
    auxMenu.style.cssText = 'display:none;position:absolute;top:28px;right:0;z-index:99999;min-width:180px;background:#1b212c;' +
      'border:1px solid #3a4150;border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.5);';
    function mkAuxItem(txt, fn) {
      var it = document.createElement('div');
      it.textContent = txt;
      it.style.cssText = 'color:#c8ceda;font:12px sans-serif;padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap;';
      it.addEventListener('mouseenter', function () { it.style.background = '#2e3542'; });
      it.addEventListener('mouseleave', function () { it.style.background = 'transparent'; });
      it.addEventListener('click', function (e) { e.stopPropagation(); auxMenu.style.display = 'none'; fn(e); });
      return it;
    }
    /* 点击其他区域收起菜单 */
    document.addEventListener('pointerdown', function (e) {
      if (auxMenu.style.display === 'block' && !auxWrap.contains(e.target)) auxMenu.style.display = 'none';
    });
    auxMenu.appendChild(mkAuxItem('⌂ 打开主页', function () { nav(_settings.homepage || 'https://www.zf3d.com'); }));
    auxMenu.appendChild(mkAuxItem('⚙ 浏览器设置', function () { toggleSettings(); }));
    auxMenu.appendChild(mkAuxItem('🛡 安全探测当前网址', function () { scoutAction(); }));
    auxMenu.appendChild(mkAuxItem('↗ 截图到画布', function () { shotToCanvas(); }));
    auxMenu.appendChild(mkAuxItem('🐞 控制台日志', function () {
      srcPanel.style.display = 'none';
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') refreshConsole();
    }));
    auxMenu.appendChild(mkAuxItem('</> 查看源代码', function () {
      panel.style.display = 'none';
      srcPanel.style.display = srcPanel.style.display === 'none' ? 'block' : 'none';
      if (srcPanel.style.display === 'block') refreshSrc();
    }));
    auxWrap.appendChild(auxBtn); auxWrap.appendChild(auxMenu);
    row2.appendChild(auxWrap);

    /* ---- 🛡 安全探测：对当前网址调用 webrecon，弹窗展示体检卡 ---- */
    function scoutAction() {
      var u = (urlBox.value || '').trim();
      if (!u) { toast('请先打开一个网址'); return; }
      _dlgConfirm('对「' + u + '」执行安全探测？\n（仅限自有或已授权的站点，只探测不利用）').then(function (yes) {
        if (!yes) return;
        var body = u.match(/^https?:\/\//i) ? u : 'https://' + u;
        toast('🛡 正在探测，约 10 秒…');
        fetch('/api/webrecon', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: body })
        }).then(function (r) { return r.json(); }).then(function (r) {
          if (!r.ok) { toast('探测失败：' + (r.error || '未知错误')); return; }
          _showScoutReport(body, r.report);
        }).catch(function (e) { toast('探测失败：' + e); });
      });
    }

    /* ---- 🛡 安全探测按钮逻辑已收纳至 🧰 菜单（scoutAction） ---- */

    function _sec(t, rows) {
      if (!rows || !rows.length) return '';
      return '<div style="margin-bottom:10px;"><div style="font-weight:bold;color:#7fb2ff;margin-bottom:4px;">' + t + '</div>' +
        rows.map(function (kv) {
          return '<div style="display:flex;gap:8px;"><span style="color:#8a94a6;flex:0 0 110px;">' + kv[0] + '</span><span style="word-break:break-all;">' + kv[1] + '</span></div>';
        }).join('') + '</div>';
    }
    function _listSec(t, items) {
      if (!items || !items.length) return '<div style="margin-bottom:10px;"><div style="font-weight:bold;color:#7fb2ff;">' + t + '</div><div style="color:#67c47f;">未发现</div></div>';
      return '<div style="margin-bottom:10px;"><div style="font-weight:bold;color:#e0a34a;">' + t + '</div>' +
        items.map(function (x) { return '<div style="word-break:break-all;">• ' + x + '</div>'; }).join('') + '</div>';
    }
    function _showScoutReport(url, rep) {
      var mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:99000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
      mask.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
      var box = document.createElement('div');
      box.style.cssText = 'width:520px;max-height:80vh;overflow-y:auto;background:#1b212c;border:1px solid #3a4150;border-radius:12px;padding:18px;color:#dfe4ec;font:12px/1.7 sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.6);';
      var b = rep.basic || {}, tls = rep.tls || {}, dns = rep.dns || {};
      var fp = (rep.fingerprints || []);
      var paths = (rep.sensitive_paths || rep.paths || []).map(function (x) {
        return (x.path || x) + ' → ' + (x.status || x.status_code || '');
      });
      var redirs = (b.redirect_chain || []).map(function (r) { return (typeof r === 'string' ? r : r.url) + ' (' + (typeof r === 'string' ? '' : (r.status || '')) + ')'; }).join(' → ');
      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<div style="font-size:15px;font-weight:bold;">🛡 网站体检卡</div>' +
        '<button style="border:none;background:#2e3542;color:#c8ceda;border-radius:5px;padding:3px 10px;cursor:pointer;">关闭</button></div>' +
        '<div style="color:#8a94a6;margin-bottom:12px;word-break:break-all;">' + url + '</div>' +
        _sec('基础信息', [
          ['状态码', b.status_code || b.status || '-'],
          ['IP', (b.ip || '-') + (dns && dns.A ? '　MX/NS 见报告' : '')],
          ['Server', b.server || '-'],
          ['标题', b.title || '-'],
          ['最终 URL', b.final_url || '-'],
          ['重定向链', redirs || '无']
        ]) +
        _sec('技术栈指纹', [(['识别', fp.length ? fp.join('、') : '未识别（可扩充指纹表）'])]) +
        _sec('TLS 证书', [
          ['状态', tls.warning ? '<span style="color:#e0a34a;">' + tls.warning + '</span>' : (tls.note || '')],
          ['签发者', tls.issuer || '-'],
          ['有效期至', tls.not_after || '-'],
          ['主体', tls.subject || '-']
        ]) +
        _sec('DNS', [['A', (dns.A || '-')], ['MX', (dns.MX || []).join(', ') || '-'], ['NS', (dns.NS || []).join(', ') || '-']]) +
        _listSec('敏感路径（仅探测）', paths) +
        '<div style="color:#6b7280;font-size:11px;margin-top:6px;">⚠️ 仅限授权目标的被动探测，未做任何利用。</div>';
      box.querySelector('button').addEventListener('click', function () { mask.remove(); });
      mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
      mask.appendChild(box); document.body.appendChild(mask);
    }

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
    setBtns.appendChild(mkBtn('恢复默认', '恢复为朱峰智能体主页', function () {
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
            if (!_dlgConfirmSync('删除书签「' + (b.title || b.url) + '」？')) return;
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
    /* ---- 📟 停靠跟随：吸附到主对话框左缘外 8px，rAF 实时跟随（复用随手标题范式） ---- */
    var _dock = null;            /* {chatId, dy} */
    var _dockRaf = 0;
    function _dockChatEl() {
      if (!_dock) return null;
      var c = document.getElementById('chatbox-' + _dock.chatId) ||
        (document.querySelector('.chatbox[data-chat-id="' + _dock.chatId + '"]'));
      return (c && document.body.contains(c)) ? c : null;
    }
    function _dockTick() {
      if (!_dock) { _dockRaf = 0; return; }
      var c = _dockChatEl();
      if (!c) { dockOff(); return; }       /* 主对话框被删/关 → 自动解除 */
      var host = el.offsetParent;
      if (host && c.offsetParent) {
        /* 对话框左缘(画布系) - 节点宽 - 8px 间隙；clamp >= 0 */
        var chatL = c.offsetLeft - (c.offsetParent.offsetLeft - host.offsetLeft) * 0; /* 同一 host 内直接用 offsetLeft */
        var nl = Math.max(0, c.offsetLeft - el.offsetWidth - 8);
        var nt = Math.max(0, c.offsetTop + _dock.dy);
        el.style.left = nl + 'px';
        el.style.top = nt + 'px';
      }
      _dockRaf = requestAnimationFrame(_dockTick);
    }
    function dockOff(silent) {
      _dock = null;
      if (_dockRaf) { cancelAnimationFrame(_dockRaf); _dockRaf = 0; }
      var b = document.getElementById('bn-dock-btn');
      if (b) { b.style.opacity = '.75'; b.title = '停靠到主对话框（跟随移动）'; }
      if (!silent) toast('已解除停靠');
    }
    var dockBtn = mkBtn('📟', '停靠到主对话框（跟随移动）', function () {
      if (_dock) { dockOff(); return; }
      /* 找最近可见主对话框（画布同一挂载层内，取面积最大的） */
      var best = null, bestA = 0;
      el.offsetParent && el.offsetParent.querySelectorAll('.chatbox').forEach(function (c) {
        var a = c.offsetWidth * c.offsetHeight;
        if (a > bestA) { bestA = a; best = c; }
      });
      if (!best) { toast('画布上没有可停靠的对话框'); return; }
      var chatId = best.dataset.chatId || (best.id || '').replace(/^chatbox-/, '');
      _dock = { chatId: chatId, dy: el.offsetTop - best.offsetTop };
      dockBtn.style.opacity = '1';
      dockBtn.title = '解除停靠（当前：' + chatId + '）';
      toast('已停靠到主对话框，移动/最小化都会跟随');
      if (!_dockRaf) _dockRaf = requestAnimationFrame(_dockTick);
    });
    dockBtn.id = 'bn-dock-btn';
    /* 手动拖动节点即解除停靠 */
    el.addEventListener('pointerdown', function (e) {
      if (_dock && e.target.closest && !e.target.closest('#bn-dock-btn')) {
        /* 延迟到确认是拖标题栏才解除，由 startDrag 内不感知停靠——这里简单：按住标题栏区拖动即解除 */
        if (e.target === title || (title.contains && title.contains(e.target))) dockOff(true);
      }
    });
    row1.appendChild(dockBtn);
    row1.appendChild(mkBtn('📌', '固定/取消固定（置顶）', function () {
      el.style.zIndex = el.style.zIndex === '99998' ? String(Z + _seq) : '99998';
    }));
    /* 截图/控制台/源代码等工具按钮已收纳至地址栏行 🧰 菜单，标题栏只留高频操作 */
    row1.appendChild(mkBtn('✕', '关闭', function () { stopPoll(); stopStream(); remove(node); }));

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
      /* A5: 双 tab —— raw=服务器原始 HTML，dom=渲染后 DOM */
      api('viewsource', { mode: _srcMode }).then(function (r) {
        if (!r || !r.ok) { srcBody.textContent = '加载失败：' + ((r && r.error) || '未知错误'); return; }
        var html = r.html || '';
        _srcTA().value = html;
        srcBody.style.display = 'none';
        srcTitle.textContent = '源代码·' + (_srcMode === 'raw' ? '原始HTML' : '渲染DOM') + '（' + html.length + ' 字符）';
        if (!html) { srcBody.style.display = 'block'; srcBody.textContent = '（页面为空：请先在浏览器节点里打开一个网页）'; }
      });
    }
    var _srcMode = 'raw';
    var _srcTabRaw = document.createElement('span');
    var _srcTabDom = document.createElement('span');
    function _srcTabStyle() {
      var on = 'cursor:pointer;padding:1px 8px;border-radius:8px;background:#2d5af0;color:#fff;';
      var off = 'cursor:pointer;padding:1px 8px;border-radius:8px;color:#8a94a6;';
      _srcTabRaw.style.cssText = _srcMode === 'raw' ? on : off;
      _srcTabDom.style.cssText = _srcMode === 'dom' ? on : off;
    }
    _srcTabRaw.textContent = '原始HTML';
    _srcTabDom.textContent = '渲染DOM';
    _srcTabRaw.addEventListener('click', function () { _srcMode = 'raw'; _srcTabStyle(); refreshSrc(); });
    _srcTabDom.addEventListener('click', function () { _srcMode = 'dom'; _srcTabStyle(); refreshSrc(); });
    _srcTabStyle();
    srcHead.appendChild(srcTitle);
    srcHead.appendChild(_srcTabRaw);
    srcHead.appendChild(_srcTabDom);
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

    /* ---- 直连模式：iframe 走同域代理，原生渲染、原生交互；失败自动降级截图流 ---- */
    var _proxyMode = false;   /* 当前节点是否处于直连模式；默认 false（同步流，AI 视口为主），仅状态栏手动切换 */
    var _proxyOk = null;
    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:none;background:#fff;';
    view.appendChild(iframe);
    function proxyUrl(u) { return '/api/webproxy?url=' + encodeURIComponent(u); }
    function setProxyMode(on, url) {
      _proxyMode = !!on && _proxyOk !== false;
      iframe.style.display = _proxyMode ? 'block' : 'none';
      img.style.visibility = _proxyMode ? 'hidden' : 'visible';
      if (_proxyMode && url) { _proxyOk = null; iframe.src = proxyUrl(url); }
      if (!_proxyMode) { try { iframe.src = 'about:blank'; } catch (e) {} stopPoll(); if (url) startPoll(); }
    }
    iframe.addEventListener('load', function () {
      /* 代理失败时后端返回 JSON（ok:false），检测到则降级截图流 */
      try {
        var t = iframe.contentDocument && iframe.contentDocument.body && iframe.contentDocument.body.innerText || '';
        if (t.indexOf('代理请求失败') >= 0 || t.indexOf('SSRF') >= 0 || t.indexOf('缺少 url') >= 0) { _proxyFail(); return; }
      } catch (e) {}  /* 跨域文档读取失败 = 正常网页，直连成功 */
      _proxyOk = true;
    });
    function _proxyFail() {
      _proxyOk = false; _proxyMode = false;
      iframe.style.display = 'none'; img.style.visibility = 'visible';
      toast('该站点不支持直连，已降级截图流');
      startPoll();
    }
    iframe.addEventListener('error', _proxyFail);

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
      api('touch_human', { note: '人在节点内点击/滚轮' }).catch(function () {}); /* 人机互斥：标记人活跃 */
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
      api('touch_human', { note: '人在节点内滚动页面' }); /* 人机互斥：标记人活跃 */
      /* 合并滚轮事件：60ms 内只发最后一次，减少截图流一卡一卡 + 白屏闪烁 */
      if (!view._wheelPend) view._wheelPend = { x: p.x, y: p.y, deltaY: 0, timer: 0 };
      var wp = view._wheelPend;
      wp.x = p.x; wp.y = p.y; wp.deltaY += ev.deltaY;
      if (wp.timer) clearTimeout(wp.timer);
      wp.timer = setTimeout(function () {
        wp.timer = 0;
        api('wheel', { x: wp.x, y: wp.y, deltaY: wp.deltaY }).then(function(){opBurst();refresh();});
      }, 60);
    }, { passive: false });

    /* ---- 键盘输入 ---- */
    var keyHandler = function (ev) {
      /* 只有点过浏览器节点（聚焦状态）才转发按键，其他情况一律还给工作台 */
      if (_focusedNode !== el) return;
      if (document.activeElement === urlBox) return;
      if (ev.target && (ev.target === urlBox || ev.target === homeInput ||
          (ev.target.dataset && ev.target.dataset.zfLocalInput))) return; /* 本地输入框不转发 */
      /* 焦点在任何可编辑元素（input/textarea/contentEditable）时不转发，避免吞掉退格/快捷键 */
      var ae = document.activeElement;
      if (ae) {
        var tag = (ae.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || ae.isContentEditable) return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return; /* 组合键（Ctrl+C/V/F 等）一律留给工作台，不转发 */
      if (['Enter', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(ev.key) >= 0) {
        ev.preventDefault();
        api('touch_human', { note: '人正在节点内敲键盘' }); /* 人机互斥：标记人活跃 */
        api('key', { key: ev.key }).then(function(){opBurst();refresh();});
      }
    };
    document.addEventListener('keydown', keyHandler, true);
    /* 点击节点 = 聚焦；点击节点外（含页面其他地方）= 失焦，键盘归还工作台 */
    el.addEventListener('mousedown', function () { _focusedNode = el; }, true);
    if (!_outsideBound) {
      _outsideBound = true;
      document.addEventListener('mousedown', function (ev) {
        if (_focusedNode && !(ev.target && ev.target.closest && ev.target.closest('.browser-node'))) {
          _focusedNode = null;
        }
      }, true);
    }

    /* ---- 尺寸拉手 ---- */
    var grip = document.createElement('div');
    grip.style.cssText = 'position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:6;' +
      'background:linear-gradient(135deg,transparent 50%,rgba(200,206,218,.45) 50%);';

    var edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    var edgeCss = {
      n: 'top:0;left:0;right:0;height:10px;cursor:ns-resize;',
      s: 'bottom:0;left:0;right:0;height:10px;cursor:ns-resize;',
      e: 'right:0;top:0;bottom:0;width:10px;cursor:ew-resize;',
      w: 'left:0;top:0;bottom:0;width:10px;cursor:ew-resize;',
      ne: 'right:0;top:0;width:22px;height:22px;cursor:nesw-resize;',
      nw: 'left:0;top:0;width:22px;height:22px;cursor:nwse-resize;',
      se: 'right:0;bottom:0;width:22px;height:22px;cursor:nwse-resize;',
      sw: 'left:0;bottom:0;width:22px;height:22px;cursor:nesw-resize;'
    };
    var _hl = document.createElement('div');
    _hl.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:7;background:#3b82f6;opacity:.85;border-radius:2px;';
    el.appendChild(_hl);
    edges.forEach(function (dir) {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;z-index:5;' + edgeCss[dir];
      d.addEventListener('pointerdown', function (e) { startResize(e, dir); });
      d.addEventListener('mouseenter', function () {
        var vert = dir === 'n' || dir === 's';
        var horiz = dir === 'e' || dir === 'w';
        _hl.style.cssText = 'position:absolute;pointer-events:none;z-index:7;background:#3b82f6;opacity:.85;border-radius:2px;';
        if (vert) { _hl.style.left = '0'; _hl.style.right = '0'; _hl.style.height = '2px'; _hl.style[dir] = '0'; }
        else if (horiz) { _hl.style.top = '0'; _hl.style.bottom = '0'; _hl.style.width = '2px'; _hl.style[dir] = '0'; }
        else { var ne = dir.indexOf('n') >= 0, ee = dir.indexOf('e') >= 0; _hl.style.width = '22px'; _hl.style.height = '2px'; _hl.style[ne ? 'top' : 'bottom'] = '0'; _hl.style[ee ? 'right' : 'left'] = '0'; }
        _hl.style.display = 'block';
      });
      d.addEventListener('mouseleave', function () { _hl.style.display = 'none'; });
      el.appendChild(d);
    });
    grip.addEventListener('pointerdown', function (e) { startResize(e, 'se'); });

    function startResize(ev, dir) {
      ev.preventDefault(); ev.stopPropagation();
      var sx = ev.clientX, sy = ev.clientY, sw = el.offsetWidth, sh = el.offsetHeight;
      var mv = function (e2) {
        var dx = e2.clientX - sx, dy = e2.clientY - sy;
        var MINW = 380, MINH = 280;
        if (dir.indexOf('e') >= 0) el.style.width = Math.max(MINW, sw + dx) + 'px';
        if (dir.indexOf('s') >= 0) el.style.height = Math.max(MINH, sh + dy) + 'px';
        if (dir.indexOf('w') >= 0) {
          var nw2 = Math.max(MINW, sw - dx);
          el.style.width = nw2 + 'px';
          /* 回弹修复：先定新宽，再同步 left = 原left + (旧宽-新宽)，右边缘钉住不动 */
          el.style.left = ((parseInt(el.style.left, 10) || 0) + (sw - nw2)) + 'px';
        }
        if (dir.indexOf('n') >= 0) {
          var nh2 = Math.max(MINH, sh - dy);
          el.style.height = nh2 + 'px';
          el.style.top = ((parseInt(el.style.top, 10) || 0) + (sh - nh2)) + 'px';
        }
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

    /* ---- 实时流（CDP screencast 推帧：签名高频轮询，变了才拉 JPEG，接近实时） ---- */
    var timer = 0, seq = 0, _lastSig = '', _sigBusy = false;
    var _lastNavUrl = '', _lastNavTitle = '';   /* 标签跟随：上次同步过的 URL/标题 */
    var POLL_ACTIVE = 180, POLL_IDLE = 400;   /* 流模式下统一高频（签名请求极轻） */
    var _lastOpTs = 0;
    var _streamStarted = false;
    function ensureStream() {
      if (_streamStarted) return;
      _streamStarted = true;
      node._streamOn = true;
      api('stream_start', { quality: 65 }).catch(function () { _streamStarted = false; });
    }
    function stopStream() {
      node._streamOn = false;
      if (_streamStarted) {
        _streamStarted = false;
        // 只有当没有其他节点还在推流时才真正关流（推流为全局共享会话）
        var anyOtherStreaming = _nodes.some(function (n) { return n !== node && n._streamOn; });
        if (!anyOtherStreaming) { try { api('stream_stop').catch(function () {}); } catch (e) {} }
      }
    }
    function refresh() {
      img.src = '/api/browser?action=shot&fmt=jpeg&t=' + (++seq);
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
    function startPoll() {
      stopPoll();
      timer = setInterval(function () {
        if (_sigBusy) return;
        _sigBusy = true;
        api('stream_poll').then(function (r) {
          var sig = r && r.ok ? r.sig : '';
          if (sig && sig !== _lastSig) { _lastSig = sig; img.src = '/api/browser?action=shot&src=stream&t=' + (++seq); }
          if (r && r.url && document.activeElement !== urlBox && r.url) {
            urlBox.value = r.url;
            lock.textContent = /^https:/i.test(r.url) ? '🔒' : '⚠';
          }
          /* 标签跟随：AI 操作导致 URL/标题变化时，标题栏与状态栏立即同步（不再停留在老页面） */
          var _nu = (r && r.url) || '', _nt = (r && r.title) || '';
          if (_nu && (_nu !== _lastNavUrl || _nt !== _lastNavTitle)) {
            _lastNavUrl = _nu; _lastNavTitle = _nt;
            title.textContent = '🖥 ' + (_nt || _nu);
            stLeft.textContent = _nu;
          }
          /* 人机感知：AI 侧轮询 stream_poll 时若人在操作，节点上显示"让行"气泡 */
          if (r && r.human_active) {
            showBadge('🖐 你操作中，AI 已让行' + (r.human_note ? ' · ' + r.human_note : ''));
          }
          /* AI 操作提示框：AI 正在操作浏览器时，节点顶部显示持续醒目横幅，结束自动消失 */
          if (r && typeof r.ai_active !== 'undefined') _aiBanner(!!(r && r.ai_active));
        }).catch(function () {}).finally(function () { _sigBusy = false; });
        if (panel.style.display === 'block' && autoBox.checked) refreshConsole();
        if (typeof _syncZoomTxt === 'function') _syncZoomTxt();
      }, (Date.now() - _lastOpTs < 8000) ? POLL_ACTIVE : POLL_IDLE);
      if (typeof _syncZoomTxt === 'function') _syncZoomTxt();
    }
    function opBurst() { _lastOpTs = Date.now(); startPoll(); if (typeof _syncZoomTxt === 'function') _syncZoomTxt(); }

    /* ---- 人机协作气泡：节点右上角浮层，3 秒淡出 ---- */
    var _badge = null, _badgeTimer = 0;
    function showBadge(text) {
      if (!_badge) {
        _badge = document.createElement('div');
        _badge.style.cssText = 'position:absolute;top:6px;right:8px;z-index:20;pointer-events:none;' +
          'background:rgba(59,130,246,.92);color:#fff;font:12px sans-serif;padding:4px 10px;' +
          'border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.4);transition:opacity .6s;';
        el.style.position = el.style.position || 'relative';
        el.appendChild(_badge);
      }
      _badge.textContent = text;
      _badge.style.opacity = '1';
      if (_badgeTimer) clearTimeout(_badgeTimer);
      _badgeTimer = setTimeout(function () { if (_badge) _badge.style.opacity = '0'; }, 3000);
    }

    /* ---- AI 操作提示横幅：AI 操作中持续显示，结束后淡出 ---- */
    var _aiBannerEl = null, _aiOn = false;
    function _aiBanner(on) {
      if (on === _aiOn && _aiBannerEl) return;
      _aiOn = on;
      if (!_aiBannerEl) {
        _aiBannerEl = document.createElement('div');
        _aiBannerEl.style.cssText = 'position:absolute;top:0;left:0;right:0;z-index:30;pointer-events:none;' +
          'display:flex;align-items:center;justify-content:center;gap:6px;' +
          'background:linear-gradient(90deg,rgba(37,99,235,.95),rgba(99,102,241,.95));color:#fff;' +
          'font:bold 12px/1 sans-serif;padding:6px 0;letter-spacing:1px;transition:opacity .5s;';
        _aiBannerEl.innerHTML = '<span style="animation:pulse 1s infinite">🤖</span> AI 正在操作浏览器…';
        var st = document.createElement('style');
        st.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}';
        document.head.appendChild(st);
        el.appendChild(_aiBannerEl);
      }
      _aiBannerEl.style.opacity = on ? '1' : '0';
    }

    function nav(u) {
      if (!u) return;
      opBurst();
      /* 默认同步流（AI 视口为主）：仅当用户在状态栏手动切到直连时才走 iframe 直连 */
      if (_proxyMode) { urlBox.value = u; iframe.src = proxyUrl(u); stLeft.textContent = '🔀直连模式（独立会话，与 AI 不同步）· ' + u; return; }
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
      if (e.key === 'F5') { e.preventDefault(); api('reload').then(function(){opBurst();refresh();}); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); urlBox.focus(); urlBox.select(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); api('reload').then(function(){opBurst();refresh();}); }
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
    var _zoomTxt = function () { return '实时流 ' + ((Date.now() - _lastOpTs < 8000) ? POLL_ACTIVE : POLL_IDLE) + 'ms'; };
    var _syncZoomTxt = function () { if (timer) stZoom.textContent = _zoomTxt(); };
    stZoom.textContent = _zoomTxt(); stZoom.title = '点击暂停/继续轮询';
    stZoom.style.cssText = 'cursor:pointer;flex:0 0 auto;';
    stZoom.addEventListener('click', function () {
      if (timer) { stopPoll(); stZoom.textContent = '已暂停轮询'; }
      else { startPoll(); stZoom.textContent = _zoomTxt(); }
    });
    status.appendChild(stLeft); status.appendChild(stZoom);
    var proxyBtn = document.createElement('span');
    function _syncProxyBtn() {
      proxyBtn.textContent = _proxyMode ? '🔀独立会话' : '🔄同步流';
      proxyBtn.title = _proxyMode
        ? '当前为 iframe 直连模式：画面和登录态与 AI 的无头浏览器【不同步】。点击切回同步流即可同屏'
        : '当前为截图流模式：与后台 AI 无头浏览器实时同屏（browser_control 打开的页面会显示在这里）。点击切换直连模式';
      proxyBtn.style.cssText = 'cursor:pointer;flex:0 0 auto;color:' + (_proxyMode ? '#d29922' : '#3fb950') + ';font-weight:bold;';
    }
    proxyBtn.addEventListener('click', function () {
      var on = !_proxyMode;
      var u = (urlBox.value || '').trim();
      if (on && !/^https?:/i.test(u)) { toast('请先打开一个网址'); return; }
      setProxyMode(on, u); _syncProxyBtn();
      if (on) stopPoll(); else { startPoll(); toast('已切回同步流：与 AI 无头浏览器同屏，登录态互通'); }
    });
    _syncProxyBtn();
    status.appendChild(proxyBtn);

    var mainRow = document.createElement('div');
    mainRow.style.cssText = 'flex:1;display:flex;overflow:hidden;min-height:0;';
    mainRow.appendChild(view); mainRow.appendChild(panel); mainRow.appendChild(srcPanel);
    el.appendChild(bar); el.appendChild(mainRow); el.appendChild(status);; el.appendChild(grip);
    canvas.appendChild(el);

    var node = { id: id, el: el, img: img, urlBox: urlBox, refresh: refresh, stopPoll: stopPoll, syncViewport: syncViewport };
    _nodes.push(node);
    try { if (window.CanvasNodeLock) CanvasNodeLock.register({ id: id, el: el }); } catch (e0) {}
    startPoll();
    ensureStream();
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
    /* stream_stop 已统一由 stopStream() 判断发送（含其他节点推流检查），此处不再重复 */
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
    // 已禁用：右键菜单不再出现「浏览器节点」入口（仍可通过更多菜单或 BrowserNode.add() 打开）
    return;
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
