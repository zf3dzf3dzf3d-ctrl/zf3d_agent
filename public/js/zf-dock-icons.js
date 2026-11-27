/* zf-dock-icons.js —— 统一重绘 4 个功能图标（整理面板 / 风筝系统 / 大师集群 / 右侧对话）
   风格基准：与「对话/文件/项目/工具」参考图标一致 —— class=zf-svg, viewBox 1 1 22 22,
   width/height 1.18em, 垂直线性渐变（蓝色家族 #6EC6FF → #2196F3），扁平圆角填充。
   实现：MutationObserver 常驻，命中目标按钮后把其内部图标容器(.zf-icons / svg.zf-svg)
   替换为统一 SVG，避免被全局 icons.js 的 emoji 通用映射再覆盖回杂乱配色。 */
(function () {
  'use strict';
  if (window.ZF_ICONS_OFF) return;

  // 统一蓝色渐变家族（与参考图标同款色），各自唯一 gradient id
  var GRAD = function (id, c1, c2) {
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
      '</linearGradient></defs>';
  };
  var OPEN = '<svg class="zf-svg" viewBox="1 1 22 22" width="1.18em" height="1.18em" style="vertical-align:-0.22em" aria-hidden="true">';

  // 4 个图标，统一用蓝色家族 #6EC6FF→#2196F3 作主色，深色 #1565C0 作点缀描线
  var ICONS = {
    // 整理面板：三格收纳抽屉（顶格 + 下方两格）
    organize: OPEN + GRAD('zfOrgG', '#6EC6FF', '#2196F3') +
      '<rect x="3" y="4.5" width="16" height="4.5" rx="1.6" fill="url(#zfOrgG)"/>' +
      '<rect x="3" y="11" width="7.4" height="8" rx="1.6" fill="url(#zfOrgG)"/>' +
      '<rect x="11.6" y="11" width="7.4" height="8" rx="1.6" fill="url(#zfOrgG)"/>' +
      '<circle cx="6.2" cy="6.75" r="0.95" fill="#fff" opacity=".85"/></svg>',

    // 风筝系统：菱形风筝 + 飘线尾巴
    kite: OPEN + GRAD('zfKiteG', '#6EC6FF', '#2196F3') +
      '<path d="M11 2.4l6 5-6 5-6-5z" fill="url(#zfKiteG)"/>' +
      '<path d="M11 2.4v10M5 7.4h12" stroke="#fff" stroke-width="0.9" opacity=".8" fill="none"/>' +
      '<path d="M11 12.4c0 3-1.6 3-1.6 5.2" stroke="#2196F3" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
      '<circle cx="11" cy="19.6" r="1" fill="#6EC6FF"/></svg>',

    // 大师集群：中心节点 + 三向连接（集群拓扑，区别于单一大师图标）
    master: OPEN + GRAD('zfMcG', '#6EC6FF', '#2196F3') +
      '<path d="M11 11.5L5 5M11 11.5L17 5M11 11.5L11 18" stroke="#90CAF9" stroke-width="1" opacity=".7" fill="none"/>' +
      '<circle cx="5" cy="5" r="2.3" fill="url(#zfMcG)"/>' +
      '<circle cx="17" cy="5" r="2.3" fill="url(#zfMcG)"/>' +
      '<circle cx="11" cy="18" r="2.3" fill="url(#zfMcG)"/>' +
      '<circle cx="11" cy="11.3" r="3.1" fill="#2196F3" stroke="#fff" stroke-width="0.8"/></svg>',

    // 右侧对话：圆角气泡 + 三个圆点（与参考同款造型）
    chat: OPEN + GRAD('zfChatG', '#6EC6FF', '#2196F3') +
      '<path d="M4 4h14a2.4 2.4 0 012.4 2.4v8.2A2.4 2.4 0 0118 17H9.5L5 20.5V17H4A2.4 2.4 0 011.6 14.6V6.4A2.4 2.4 0 014 4z" fill="url(#zfChatG)"/>' +
      '<circle cx="7.5" cy="10.6" r="1.3" fill="#fff"/>' +
      '<circle cx="11" cy="10.6" r="1.3" fill="#fff"/>' +
      '<circle cx="14.5" cy="10.6" r="1.3" fill="#fff"/></svg>'
  };

  /* ===== 2026-10 白线清淡改造（遥控器/桌面统一）=====
     整理 / 风筝 / 对话(消息) 三枚图标改为：与右上角「专注/设置」同款的细线描边、
     偏淡的浅色（#cfd6e0），并把尺寸从 1.18em 缩小到 0.95em（“做小”诉求）。
     直接覆盖上方 ICONS 的彩色填充版本；mastercluster 维持原蓝色风格不动。 */
  var WLOPEN = '<svg class="zf-svg" viewBox="0 0 24 24" width="0.95em" height="0.95em" ' +
    'fill="none" stroke="#cfd6e0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="vertical-align:-0.18em" aria-hidden="true">';
  ICONS.organize = WLOPEN +
    '<rect x="3" y="4" width="18" height="5" rx="1.5"/>' +
    '<rect x="3" y="11" width="8.4" height="9" rx="1.5"/>' +
    '<rect x="12.6" y="11" width="8.4" height="9" rx="1.5"/></svg>';
  ICONS.kite = WLOPEN +
    '<path d="M12 3l6 6-6 6-6-6z"/>' +
    '<path d="M12 3v12M6 9h12"/>' +
    '<path d="M12 15c0 2.6-1.4 3-1.4 5"/></svg>';
  ICONS.chat = WLOPEN +
    '<path d="M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L5.5 20v-3.5A2.5 2.5 0 0 1 2.5 14v-7A2.5 2.5 0 0 1 5 4.5z"/>' +
    '<circle cx="8.5" cy="11" r="0.7"/>' +
    '<circle cx="12" cy="11" r="0.7"/>' +
    '<circle cx="15.5" cy="11" r="0.7"/></svg>';

  // 目标选择器 -> 图标 key
  var RULES = [
    { sel: '#organizeDockBtn', key: 'organize' },
    { sel: '#kiteToggleBtn', key: 'kite' },
    // 【去除大师图标】大师集群按钮不再注入图标（用户要求：大师左边图标去掉，只留文字）
    // { sel: '.mastercluster-btn', key: 'master' },
    { sel: '#chatStatusBtn', key: 'chat' }
  ];

  var EMOJI_RE = /\p{Extended_Pictographic}/u;

  // host 是否已是「仅含我们这一个图标、且无残留 emoji 文本」的干净状态
  function isClean(host) {
    var icons = host.querySelectorAll('svg');
    if (icons.length !== 1) return false;
    if (!icons[0].hasAttribute('data-zf-ico')) return false;
    // 不允许存在 emoji 文本节点（否则 icons.js 会再插入一个脏 svg）
    var nodes = host.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      for (var t = 0; t < nodes[i].childNodes.length; t++) {
        var c = nodes[i].childNodes[t];
        if (c.nodeType === 3 && EMOJI_RE.test(c.nodeValue)) return false;
      }
    }
    return true;
  }

  function cleanHost(host) {
    // 删除已有图标容器/裸 svg/emoji 文本，保留 .cs-btn-count 计数与 .tk-dot 状态点
    var kids = Array.prototype.slice.call(host.childNodes);
    kids.forEach(function (n) {
      if (n.nodeType === 3) {
        if (EMOJI_RE.test(n.nodeValue)) host.removeChild(n);
      } else if (n.nodeType === 1) {
        var cl = n.className || '';
        if (n.classList.contains('zf-icons') || n.tagName.toLowerCase() === 'svg') {
          host.removeChild(n);
        } else if (cl.indexOf('cs-btn-count') < 0 && cl.indexOf('tk-dot') < 0) {
          // 其它包裹（如残留 emoji 被 icons.js 包成的结构）也清掉图标，但保留容器
          Array.prototype.slice.call(n.childNodes).forEach(function (m) {
            if (m.nodeType === 3 && EMOJI_RE.test(m.nodeValue)) n.removeChild(m);
            else if (m.nodeType === 1 && (m.classList.contains('zf-icons') || m.tagName.toLowerCase() === 'svg')) n.removeChild(m);
          });
        }
      }
    });
  }

  function inject(btn, svg) {
    // 整理/风筝按钮图标在 .tk-label 内；对话/大师按钮直接在按钮内
    var label = btn.querySelector('.tk-label');
    var host = label || btn;
    if (isClean(host)) return;            // 收敛：干净则不动，避免 MutationObserver 死循环
    cleanHost(host);
    var wrap = document.createElement('span');
    wrap.className = 'zf-icons';
    wrap.innerHTML = svg;
    var s = wrap.querySelector('svg'); if (s) s.setAttribute('data-zf-ico', '1');
    host.insertBefore(wrap, host.firstChild);
  }

  function applyAll() {
    RULES.forEach(function (r) {
      var svg = ICONS[r.key];
      document.querySelectorAll(r.sel).forEach(function (btn) {
        try { inject(btn, svg); } catch (e) {}
      });
    });
  }

  // 常驻监听：mastercluster 等按钮延迟注入 / 重渲染时自动重绘
  var raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; applyAll(); });
  }
  function observe() {
    if (!document.body) { setTimeout(observe, 60); return; }
    applyAll();
    var mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    observe();
  }
  window.App && (App._zfDockIconsApply = applyAll);
})();
