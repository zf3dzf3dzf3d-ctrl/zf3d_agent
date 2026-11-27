/* ============================================================
 * zf-icons.js — 线性图标库（设置面板极简进化 S1）
 * 零依赖 · 内联 SVG · stroke 1.5px · 24×24 viewBox · currentColor
 * 用法：
 *   1) 声明式：<span data-icon="cpu"></span> → 自动注入
 *   2) 编程式：ZF.icon('cpu') 返回 SVG 字符串
 *   3) 动态 tab 注入后调用 ZF.icon.refresh() 补扫（#settingsNav 已有 Observer 自动补扫）
 * ============================================================ */
(function () {
  'use strict';

  var P = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var S = '</svg>';

  function wrap(inner) { return P + inner + S; }

  var ICONS = {
    gear: wrap('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"/>'),
    /* 芯片（模型配置） */
    cpu: wrap('<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3"/>'),
    /* 终端（运行日志） */
    terminal: wrap('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>'),
    /* 信封（邮件） */
    mail: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>'),
    /* 锁（隐私） */
    lock: wrap('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    /* 数据库（备份） */
    database: wrap('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5"/><path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12"/>'),
    /* 折线图（Token 统计） */
    chart: wrap('<path d="M4 4v16h16"/><path d="M7.5 14l3.5-4 3 2.5L18.5 7"/>'),
    /* 盾牌（安全防护） */
    shield: wrap('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V6z"/><path d="M9 11.5l2.2 2.2L15.5 9.5"/>'),
    /* 下载托盘（组件下载） */
    download: wrap('<path d="M12 3v10M8 9.5l4 4 4-4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
    /* 四格网格（插件管理） */
    grid: wrap('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    /* 心跳（健康守护） */
    pulse: wrap('<path d="M3 12h4l2.5-5.5L14 17l2.5-5H21"/>'),
    /* 书本（简介） */
    book: wrap('<path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v14c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-14c-4.5 0-6.5.5-8 2z"/><path d="M12 6.5v14"/>'),
    /* 圆圈问号（帮助） */
    help: wrap('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.1 1-1.1 1.9"/><circle cx="12" cy="16.8" r=".4" fill="currentColor"/>'),
    /* 时钟（版本更新） */
    clock: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    /* 圆圈 i（关于） */
    info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".4" fill="currentColor"/>'),
    /* 插头（MCP） */
    plug: wrap('<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>'),
    /* 闪电（技能） */
    bolt: wrap('<path d="M13 3L5 13.5h5L11 21l8-10.5h-5z"/>'),
    /* 三角警示（颜色归 accent） */
    warn: wrap('<path d="M12 4L2.8 20h18.4z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".4" fill="currentColor"/>'),
    /* 圆点（状态，代替 💚 等） */
    dot: wrap('<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>'),
    /* 方框（工具箱/包） */
    box: wrap('<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
    /* 大脑 */
    brain: wrap('<path d="M9.5 4.5a2.5 2.5 0 0 0-2.5 2.5c-1.5.3-2.5 1.4-2.5 3 0 1 .5 2 1.3 2.5-.6.7-.8 1.6-.5 2.5.4 1.2 1.5 2 2.7 2 .2 1.5 1.4 2.5 3 2.5 1.1 0 2-.6 2.5-1.5V5.8c-.5-.8-1.3-1.3-2.5-1.3z"/><path d="M14.5 4.5A2.5 2.5 0 0 1 17 7c1.5.3 2.5 1.4 2.5 3 0 1-.5 2-1.3 2.5.6.7.8 1.6.5 2.5-.4 1.2-1.5 2-2.7 2-.2 1.5-1.4 2.5-3 2.5"/>'),
    /* 火焰 */
    flame: wrap('<path d="M12 3c1 3-4 5-4 10a4.5 4.5 0 0 0 9 0c0-2-1-3.5-2-5-.5 1.5-1.5 2-2.5 2C13.5 8 14 5 12 3z"/>'),
    /* 天平 */
    scale: wrap('<path d="M12 4v16M7 20h10"/><path d="M5 8h14M12 4l-2 1.5M12 4l2 1.5"/><path d="M5 8l-2.5 5a3 3 0 0 0 5 0zM19 8l-2.5 5a3 3 0 0 0 5 0z"/>'),
    /* 机器人 */
    robot: wrap('<rect x="5" y="8" width="14" height="10" rx="2.5"/><circle cx="9.5" cy="12.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="12.5" r=".6" fill="currentColor"/><path d="M12 8V4.5M12 4.5h.01M9 18v2M15 18v2"/>'),
    /* 播放三角 */
    play: wrap('<path d="M8 5.5v13l11-6.5z"/>'),
    /* 保存软盘（补充线性版） */
    save: wrap('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 14h8v6"/>'),
    /* 眼睛-关（补充线性版） */
    'eye-off': wrap('<path d="M4 12s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 4l16 16"/>'),
    /* 禁止 */
    ban: wrap('<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>'),
    /* 铅笔（补充线性版） */
    pencil: wrap('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
    /* 扫帚（清理） */
    broom: wrap('<path d="M14 4l6 6M17 7l-8.5 8.5M8.5 15.5L4 20c2 1 5.5 1 7.5-1l1-1.5z"/><path d="M8.5 15.5L11 18"/>'),
    /* 拼图（插件） */
    puzzle: wrap('<path d="M5 5h4a2 2 0 1 1 4 0h2v4a2 2 0 1 0 0 4v4h-4a2 2 0 1 0-4 0H5z" transform="translate(1 1)"/>'),
    /* —— S2 内部图标线性化新增 —— */
    eye: wrap('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
    'eye-off': wrap('<path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-3 3.9M6.1 6.8A16.8 16.8 0 0 0 2.5 12s3.5 7 9.5 7a9.5 9.5 0 0 0 5.4-1.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>'),
    star: wrap('<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/>'),
    x: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
    check: wrap('<path d="M4.5 12.5l5 5L19.5 7"/>'),
    flask: wrap('<path d="M9.5 3h5M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4A1.5 1.5 0 0 0 19.5 19L14 9V3"/><path d="M7.5 14.5h9"/>'),
    save: wrap('<path d="M5 3.5h11L19.5 7v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z"/><path d="M8 3.5V8h7V3.5"/><rect x="8" y="13" width="8" height="7.5"/>'),
    copy: wrap('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>'),
    trash: wrap('<path d="M4.5 6.5h15M9.5 6V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V6"/><path d="M6.5 6.5l1 13A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-13"/><path d="M10 10.5v6M14 10.5v6"/>'),
    pencil: wrap('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
    'arrow-up': wrap('<path d="M12 20V4M5.5 10.5L12 4l6.5 6.5"/>'),
    'arrow-down': wrap('<path d="M12 4v16M5.5 13.5L12 20l6.5-6.5"/>'),
    broom: wrap('<path d="M14 3l7 7-5.5 1.5L13 9z"/><path d="M13 9L4.5 17.5a3.2 3.2 0 0 0 4.5 4.5L17.5 13.5"/><path d="M7.5 15.5l1.5 1.5"/>'),
    ban: wrap('<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>'),
    puzzle: wrap('<path d="M9.5 4.5a2 2 0 1 1 4 0H16a1.5 1.5 0 0 1 1.5 1.5v2.5a2 2 0 1 1 0 4V15a1.5 1.5 0 0 1-1.5 1.5h-2.5a2 2 0 1 0-4 0H7A1.5 1.5 0 0 1 5.5 15v-2.5a2 2 0 1 1 0-4V6A1.5 1.5 0 0 1 7 4.5z"/>'),
    'dot-off': wrap('<circle cx="12" cy="12" r="5.5"/><path d="M4 20L20 4" opacity=".45"/>')
  };

  var ZF = window.ZF = window.ZF || {};

  /**
   * 取图标 SVG 字符串
   * @param {string} name 图标名
   * @param {string} [fallbackText] 未知图标名时的兜底文本（可空）
   */
  ZF.icon = function (name, fallbackText) {
    if (ICONS[name]) return ICONS[name];
    return fallbackText != null ? fallbackText : '';
  };

  /** 是否存在该图标 */
  ZF.hasIcon = function (name) { return !!ICONS[name]; };

  /** 扫描并注入所有 [data-icon] 空元素 */
  function injectAll(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-icon-done') === '1') continue;
      var svg = ICONS[el.getAttribute('data-icon')];
      if (svg) { el.innerHTML = svg; el.setAttribute('data-icon-done', '1'); }
    }
  }

  /** 手动补扫（动态 tab 注入后可调用） */
  ZF.icon.refresh = function () { injectAll(document); };

  /* ============================================================
   * S2 emoji→线性图标自动替换引擎
   * 设置面板内的 emoji 图标按映射表替换为 ZF 线性 SVG，
   * 全量 MutationObserver 兜底，动态注入的按钮同样生效。
   * 仅作用于按钮/标题/状态文本的「前导图标位」，不改正文语义。
   * ============================================================ */
  var EMOJI_MAP = {
    '👁': 'eye', '🙈': 'eye-off', '⭐': 'star', '★': 'star', '☆': 'star',
    '✕': 'x', '✖': 'x', '❌': 'x', '🚫': 'ban', '⛔': 'ban',
    '✓': 'check', '✔': 'check', '✅': 'check',
    '✗': 'x',
    '🧪': 'flask', '💾': 'save', '📋': 'copy', '🗑': 'trash',
    '✏️': 'pencil', '✏': 'pencil',
    '⬆': 'arrow-up', '⬇': 'arrow-down',
    '🧹': 'broom', '🧩': 'puzzle', '📊': 'chart',
    '🕓': 'clock', '🟢': 'dot', '⚫': 'dot-off',
    '📦': 'box', '🧠': 'brain', '🔥': 'flame', '⚖': 'scale', '⚖️': 'scale',
    '🤖': 'robot', '⚡': 'bolt', '❓': 'help', 'ℹ️': 'info', 'ℹ': 'info',
    '▶': 'play', '▶️': 'play'
  };
  /* 只替换纯图标按钮（textContent 恰为一个 emoji 前缀场景） */
  var EMOJI_KEYS = Object.keys(EMOJI_MAP).sort(function (a, b) { return b.length - a.length; });

  function replaceEmojiInEl(el) {
    if (el.getAttribute && el.getAttribute('data-emoji-done') === '1') return;
    if (el.getAttribute) el.setAttribute('data-emoji-done', '1');
    var kids = el.querySelectorAll ? el.querySelectorAll('button, .mc-icon-btn, h3, h4, h5, [title], .settings-section-title, .model-card-header span, .mc-title, span, div') : [];
    var all = (el.matches && (el.matches('button') || el.matches('h3') || el.matches('h4')))
      ? [el].concat(Array.prototype.slice.call(kids))
      : Array.prototype.slice.call(kids);
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      var txt = (node.textContent || '').trim();
      if (!txt) continue;
      for (var j = 0; j < EMOJI_KEYS.length; j++) {
        var emo = EMOJI_KEYS[j];
        if (txt.indexOf(emo) !== 0) continue;
        var rest = txt.slice(emo.length).trim();
        var name = EMOJI_MAP[emo];
        if (!ZF.hasIcon(name)) break;
        /* 纯图标（如 👁 / ✕ / ⭐ / 📋）：整颗替换 */
        if (!rest) {
          /* 【2026-11 修复】容器内若含 input/textarea/select/子元素，绝不清空——
             曾把"密码框容器 div(含 input + 👁 按钮)"误判为纯图标按钮，
             textContent='' 连带删除密码输入框，导致登录框看不到密码框 */
          if (node.querySelector && node.querySelector('input,textarea,select')) break;
          if (node.children && node.children.length > 0) break;
          node.textContent = '';
          node.setAttribute('data-icon', name);
          node.setAttribute('data-emoji-done', '1');
          node.style.display = 'inline-flex';
          node.style.alignItems = 'center';
          node.style.justifyContent = 'center';
          injectAll(node.parentElement || document);
          break;
        }
        /* 前导图标 + 文字（如 "💾 保存"）：SVG 前缀 */
        var span = document.createElement('span');
        span.setAttribute('data-icon', name);
        span.setAttribute('data-emoji-done', '1');
        span.style.display = 'inline-flex';
        span.style.marginRight = '5px';
        span.style.verticalAlign = '-3px';
        var tn = node.firstChild;
        while (tn && tn.nodeType === 3 && tn.textContent.indexOf(emo) === -1) tn = tn.nextSibling;
        if (tn && tn.nodeType === 3) {
          tn.textContent = tn.textContent.replace(emo, '');
          node.insertBefore(span, tn);
          injectAll(node);
        }
        break;
      }
    }
  }
  ZF.icon.replaceEmoji = replaceEmojiInEl;

  /* 面板范围观察器：设置面板容器子树变化时自动做 emoji 替换 */
  function watchPanels() {
    if (!window.MutationObserver) return;
    var roots = [document.getElementById('settingsPanel'), document.getElementById('settingsNav'),
                 document.getElementById('panelContainer'), document.body];
    var root = null;
    for (var i = 0; i < roots.length; i++) if (roots[i]) { root = roots[i]; break; }
    if (!root) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        replaceEmojiInEl(root);
      }, 60);
    }).observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { injectAll(document); replaceEmojiInEl(document); watchPanels(); });
  } else {
    injectAll(document); replaceEmojiInEl(document); watchPanels();
  }
})();
