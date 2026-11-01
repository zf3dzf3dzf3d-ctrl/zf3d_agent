/* =====================================================================
 * mc-quick-nav.js - 设置面板「模型配置」右侧快速滚动导航条
 * 需求：模型列表条目很多时，列表右侧出现一列快速定位按钮（首字缩写），
 *       hover 显示完整模型名，点击平滑滚动到对应模型卡片，滚动时自动高亮。
 * 适配（v5.7.0 修正）：实际生效面板为 V2 ModelConfigRewrite（#modelPanelMount
 *       内的 [data-mc-wrap] / #mc-model-list / .mc-item / .mc-item-name）。
 *       同时兼容旧版 V1（#modelList / .model-item / .mi-name-input），自动探测。
 * 方案 v3（当前）：导航条 position:fixed 钉视口右缘（right:6px、垂直居中、
 *       zIndex:10000），按用户要求浮空于无限画布之上，不挂在设置面板内部；
 *       可见性仍按面板/列表几何判断。
 * ===================================================================== */
(function () {
  'use strict';

  var MIN_ITEMS = 5;          // 条目少于该数时不显示导航条
  var nav = null;             // 导航条 DOM
  var cur = [];               // 当前条目 [{card, text}]
  var ticking = false;

  // 找到当前列表容器（V2 优先，兼容 V1）
  function findList() {
    return document.getElementById('mc-model-list') ||
           document.getElementById('modelList');
  }

  // 取列表中所有模型卡片（含名称文本），适配两种结构
  function getItems(list) {
    if (!list) return [];
    var out = [];
    var cards = list.querySelectorAll('.mc-item, .model-item');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      // 「添加新模型」占位卡由下方正则 /添加|＋/ 过滤
      var text = '';
      var nameEl = card.querySelector('.mc-item-name') || card.querySelector('.mi-name-input');
      if (nameEl) {
        text = (nameEl.tagName === 'INPUT') ? (nameEl.value || '') : (nameEl.textContent || '');
        text = text.trim();
      }
      if (!text) {
        text = card.getAttribute('data-id') || card.getAttribute('data-model-id') || '';
      }
      // 过滤添加卡片（名称含「添加」/「＋」）
      if (!text || /添加|＋/.test(text)) continue;
      out.push({ card: card, text: text });
    }
    return out;
  }

  // 缩写：按需求统一取 6 个字（中英文均取模型名前 6 个字符，过长省略号由 hover 看全名）
  function shortLabel(text) {
    return text.trim().slice(0, 6);
  }

  function ensureNav() {
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'mc-quick-nav';
      nav.style.cssText =
        'display:flex;flex-direction:column;gap:2px;' +
        'padding:6px 4px;width:auto;box-sizing:border-box;' +
        'border:1px solid rgba(128,128,128,.3);border-radius:8px;' +
        'background:rgba(20,20,20,.7);backdrop-filter:blur(4px);' +
        'overflow:hidden;scrollbar-width:none;';
      nav.style.display = 'none';
    }
    // 按需求浮空到无限画布右侧：fixed 钉视口右缘垂直居中，不再挂在设置面板内部
    if (nav.parentNode !== document.body) {
      document.body.appendChild(nav);
    }
    // 事件委托：点击按 data-idx 定位卡片。重建按钮不需要重新绑监听器，
    // 也避免按钮在 mousedown~click 之间被轮询重建导致 click 丢失。
    if (!nav.__delegated) {
      nav.__delegated = true;
      nav.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('button[data-idx]');
        if (!btn) return;
        var it = cur[parseInt(btn.getAttribute('data-idx'), 10)];
        if (it && it.card && it.card.isConnected) scrollToCard(it.card);
      });
    }
    return nav;
  }

  // 高亮当前可视中线对应的条目
  function highlight() {
    if (!nav || !cur.length || nav.style.display === 'none') return;
    var mid = window.innerHeight / 2;
    var best = -1, bestD = 1e9;
    for (var i = 0; i < cur.length; i++) {
      var r = cur[i].card.getBoundingClientRect();
      // 仅统计在视口内的卡片
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      var c = r.top + r.height / 2;
      var d = Math.abs(c - mid);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    var btns = nav.children;
    for (var j = 0; j < btns.length; j++) {
      btns[j].style.background = (j === best) ? 'rgba(80,140,255,.6)' : 'rgba(128,128,128,.15)';
      btns[j].style.color = (j === best) ? '#fff' : 'inherit';
    }
  }

  function scrollToCard(card) {
    // 修复「点击无效」：scrollIntoView 在 overlay/transform 祖先下会被页面级滚动劫持，
    // 改为直接滚动模型列表所在的最近滚动容器，几何计算不受面板 transform 影响。
    var scroller = null, el = card;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) { scroller = el; break; }
      el = el.parentElement;
    }
    if (scroller) {
      var sr = scroller.getBoundingClientRect();
      var cr = card.getBoundingClientRect();
      var delta = (cr.top + cr.height / 2) - (sr.top + sr.height / 2);
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'smooth' });
    } else {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(highlight, 380);
  }

  function build() {
    var list = findList();
    // 仅当列表在「模型配置」面板内可见时才显示导航条
    var mount = document.getElementById('modelPanelMount');
    var v1Panel = document.getElementById('modelList');
    // 修复「看不到」：offsetParent 在 fixed/overlay 祖先内可能异常，改用几何尺寸判断可见
    var visibleHost = false;
    if (list) { var _r = list.getBoundingClientRect(); visibleHost = (_r.width > 40 && _r.height > 40); }
    cur = getItems(list);
    if (!visibleHost || cur.length < MIN_ITEMS) { hide(); return; }

    // 内容无变化时跳过重建：1.5s 兜底轮询 + MutationObserver 会频繁触发 build，
    // 若每次都 innerHTML 重建，按钮会在 mousedown/mouseup 之间被替换，导致 click 永远不触发。
    var sig = cur.map(function (it) { return it.text; }).join('\u0001');
    ensureNav();
    if (nav.__sig === sig && nav.style.display === 'flex') {
      requestAnimationFrame(highlight);
      return;
    }
    nav.__sig = sig;

    // 浮空定位：fixed 钉在视口右缘、垂直居中，不随设置面板移动/缩放
    ensureNav();
    nav.style.position = 'fixed';
    nav.style.right = '6px';
    nav.style.top = '50%';
    nav.style.transform = 'translateY(-50%)';
    nav.style.zIndex = '10000';
    nav.style.maxHeight = '70vh';
    nav.innerHTML = '';
    for (var idx = 0; idx < cur.length; idx++) {
      var it = cur[idx];
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = shortLabel(it.text);
      b.title = it.text;
      b.style.cssText =
        'min-width:26px;height:18px;line-height:16px;padding:0 3px;border:none;border-radius:5px;' +
        'font-size:10px;cursor:pointer;background:rgba(128,128,128,.15);color:inherit;' +
        'white-space:nowrap;flex:0 0 auto;user-select:none;-webkit-user-select:none;';
      // 用 data-idx 委托点击（见下方 nav 级监听器），避免轮询重建期间监听器失效
      b.setAttribute('data-idx', String(idx));
      nav.appendChild(b);
    }
    nav.style.display = 'flex';
    requestAnimationFrame(highlight);
  }

  function hide() {
    if (nav) nav.style.display = 'none';
  }

  var ro = null, roTarget = null;
  function attachObserver(list) {
    if (!list || roTarget === list) return;
    if (ro) try { ro.disconnect(); } catch (e) {}
    roTarget = list;
    ro = new MutationObserver(function () { scheduleBuild(); });
    ro.observe(list, { childList: true, subtree: true });
  }

  var buildTimer = null;
  function scheduleBuild() {
    if (buildTimer) return;
    buildTimer = setTimeout(function () {
      buildTimer = null;
      var list = findList();
      build();
      if (list) attachObserver(list);
    }, 120);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; highlight(); });
  }

  function init() {
    var list = findList();
    build();
    if (list) attachObserver(list);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', scheduleBuild);
  }

  function scheduleInit() {
    // 设置面板打开是异步渲染的：连续探测，找到列表即初始化
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var list = findList();
      if (list) { clearInterval(timer); init(); }
      else if (tries > 60) clearInterval(timer);
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInit);
  } else {
    scheduleInit();
  }
  // 常驻慢速兜底探测：每 1.5s 重算一次（build 内部会因不可见/条目不足自动隐藏，开销极小）
  setInterval(scheduleBuild, 1500);
  // 点击「模型配置」导航项时再次探测（面板可能被重复挂载/切换分类）
  document.addEventListener('click', function (e) {
    var tab = e.target && e.target.closest && e.target.closest('[data-settings-tab="models"]');
    if (tab) { scheduleInit(); setTimeout(scheduleBuild, 300); }
  }, true);
  // 分类切换（语言/视觉等 mc-type-tab）时重绘
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-mc-type]');
    if (t) setTimeout(scheduleBuild, 200);
  }, true);
})();
