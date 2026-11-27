/* svg-icons.js —— AI 图标工坊 P2：SVG 矢量图标系统（v1）
   目标：图标 = 纯 SVG + CSS 变量配色，跟随主题风格自动换色（零 JS 重绘）。
   三种图标变体：line 细线描边 / fill 扁平填充 / duo 双色填充，持久化 localStorage zf_icon_variant。
   配色约定：
     主色   var(--acc, #2196F3)   —— 主题强调色（风格包 accent 映射）
     文字色 var(--text, #cfd6e0)  —— 线稿描边
     背景色 var(--bg, #101418)    —— 挖空/底衬
   颜色全部走 CSS 变量或 currentColor，theme.js setStyle 热替换变量后图标即时变色。
   暴露 window.ZFSvgIcons：get(name) / setVariant(v) / getVariant() / list()。
   挂载点：#organizeDockBtn / #kiteToggleBtn / #chatStatusBtn（与 zf-dock-icons 同一收敛机制，
   通过 data-zf-ico2 标记避免与其互相覆盖死循环）。 */
(function () {
  'use strict';

  var VARIANT_KEY = 'zf_icon_variant';
  var VARIANTS = ['line', 'fill', 'duo'];

  // ---------- 变体外壳 ----------
  function shell(variant) {
    if (variant === 'line') {
      return '<svg class="zf-svg2" viewBox="0 0 24 24" width="22" height="22" style="vertical-align:-0.18em;fill:none;stroke:var(--text,#cfd6e0);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true">';
    }
    if (variant === 'duo') {
      return '<svg class="zf-svg2" viewBox="0 0 24 24" width="1.05em" height="1.05em" style="vertical-align:-0.2em;fill:none;stroke:var(--acc,#2196F3);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true">';
    }
    return '<svg class="zf-svg2" viewBox="0 0 24 24" width="1.05em" height="1.05em" style="vertical-align:-0.2em;fill:var(--acc,#2196F3);stroke:none" aria-hidden="true">';
  }

  // ---------- 图标形体（仅形体，不带颜色）----------
  var BODY = {
    organize:
      '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="8.4" height="9" rx="1.5"/><rect x="12.6" y="11" width="8.4" height="9" rx="1.5"/>',
    kite:
      '<path d="M12 3l6 6-6 6-6-6z"/><path d="M12 3v12M6 9h12"/><path d="M12 15c0 2.6-1.4 3-1.4 5"/>',
    chat:
      '<path d="M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L5.5 20v-3.5A2.5 2.5 0 0 1 2.5 14v-7A2.5 2.5 0 0 1 5 4.5z"/><circle cx="8.5" cy="11" r="0.7"/><circle cx="12" cy="11" r="0.7"/><circle cx="15.5" cy="11" r="0.7"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
    send:
      '<path d="M3.5 11.5L20.5 3.5 14 20.5l-2.8-6.2z"/><path d="M11.2 14.3l9.3-10.8"/>',
    stop:
      '<rect x="5" y="5" width="14" height="14" rx="2.5"/>',
    plus:
      '<path d="M12 4v16M4 12h16"/>',
    search:
      '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    folder:
      '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.5h7A2.5 2.5 0 0 1 21 9v8.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    agent:
      '<rect x="4.5" y="7" width="15" height="12" rx="2.5"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M12 7V4M9.5 16.5h5"/>',
    team:
      '<circle cx="8.5" cy="8.5" r="3"/><circle cx="16" cy="9.5" r="2.4"/><path d="M3.5 19c.5-3.4 2.6-5 5-5s4.5 1.6 5 5"/><path d="M15.5 14.2c2.3.2 4.2 1.6 4.8 4.8"/>',
    sparkle:
      '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>'
  };

  // fill 变体下，细线形体不适用的高亮小元素改用底色挖空
  var FILL_TWEAK = {
    chat: '<circle cx="8.5" cy="11" r="0.9" fill="var(--bg,#101418)" stroke="none"/><circle cx="12" cy="11" r="0.9" fill="var(--bg,#101418)" stroke="none"/><circle cx="15.5" cy="11" r="0.9" fill="var(--bg,#101418)" stroke="none"/>',
    agent: '<circle cx="9" cy="13" r="1.2" fill="var(--bg,#101418)" stroke="none"/><circle cx="15" cy="13" r="1.2" fill="var(--bg,#101418)" stroke="none"/>'
  };

  var variant = loadVariant();

  function loadVariant() {
    try {
      var v = localStorage.getItem(VARIANT_KEY);
      return VARIANTS.indexOf(v) >= 0 ? v : 'line';
    } catch (e) { return 'line'; }
  }

  function buildIcon(name, v) {
    var body = BODY[name];
    if (!body) return '';
    if (v === 'fill' && FILL_TWEAK[name]) body = body.replace(/<circle[^>]*\/><circle[^>]*\/><circle[^>]*\/>|<circle[^>]*\/><circle[^>]*\/>/, FILL_TWEAK[name]);
    return shell(v) + body + '</svg>';
  }

  // ---------- 注入（与 zf-dock-icons 同款收敛机制，标记 data-zf-ico2）----------
  var RULES = [
    { sel: '#organizeDockBtn', name: 'organize' },
    { sel: '#kiteToggleBtn', name: 'kite' },
    { sel: '#chatStatusBtn', name: 'chat' }
  ];
  var EMOJI_RE = /\p{Extended_Pictographic}/u;

  function isClean(host, name) {
    var svgs = host.querySelectorAll('svg.zf-svg2');
    if (svgs.length !== 1) return false;
    if (svgs[0].getAttribute('data-zf-ico2') !== name) return false;
    var nodes = host.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var kids = nodes[i].childNodes;
      for (var t = 0; t < kids.length; t++) {
        if (kids[t].nodeType === 3 && EMOJI_RE.test(kids[t].nodeValue)) return false;
      }
    }
    return true;
  }

  function cleanHost(host) {
    var kids = Array.prototype.slice.call(host.childNodes);
    kids.forEach(function (n) {
      if (n.nodeType === 3) {
        if (EMOJI_RE.test(n.nodeValue)) host.removeChild(n);
      } else if (n.nodeType === 1) {
        var isIconish = n.classList.contains('zf-icons') || n.tagName.toLowerCase() === 'svg' ||
          (n.querySelector && n.querySelector('svg.zf-svg, svg.zf-svg2'));
        if (isIconish) host.removeChild(n);
      }
    });
  }

  function inject(host, name) {
    if (isClean(host, name)) return;
    cleanHost(host);
    var wrap = document.createElement('span');
    wrap.className = 'zf-icons';
    wrap.innerHTML = buildIcon(name, variant);
    var s = wrap.querySelector('svg');
    if (s) s.setAttribute('data-zf-ico2', name);
    host.insertBefore(wrap, host.firstChild);
  }

  var raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; applyAll(); });
  }
  function applyAll() {
    RULES.forEach(function (r) {
      document.querySelectorAll(r.sel).forEach(function (btn) {
        var host = btn.querySelector('.tk-label') || btn;
        try { inject(host, r.name); } catch (e) {}
      });
    });
  }
  function observe() {
    if (!document.body) { setTimeout(observe, 60); return; }
    applyAll();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe);
  else observe();

  // ---------- 公开 API ----------
  window.ZFSvgIcons = {
    get: function (name) { return buildIcon(name, variant); },
    list: function () { return Object.keys(BODY); },
    getVariant: function () { return variant; },
    setVariant: function (v) {
      if (VARIANTS.indexOf(v) < 0) return false;
      variant = v;
      try { localStorage.setItem(VARIANT_KEY, v); } catch (e) {}
      applyAll();
      return true;
    }
  };
})();
