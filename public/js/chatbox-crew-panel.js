/* =====================================================================
 * chatbox-crew-panel.js — 🐝 小队卡通派出面板（v1.0 2026-10-27）
 * =====================================================================
 * 交互（对应用户定稿）：
 *   1. 一排卡通角色卡（策划🧭 反驳🔥 进化🧬 施工🔨 审核🛡️ 验证🧪 专家🎓 总结📋 加入团队🛠 技能总结🧠 发布广场🌐 普通对话💬 …协议团队卡 讲解师🗣️）
 *      【2026-11-27 改版】「自定义🎭」卡已删（能力并入普通对话💬，两卡留一）；讲解师移入策划组、排在协议注入卡（律师）之后
 *      点一次 +1，卡片右上角显示数量角标；右键点击 -1（减员）
 *   2. 下方名单列表 = 本次派出去的人（可点 ✕ 取消单人）
 *   3. 「一句话」输入框（必填，空则派出按钮置灰）
 *   4. 大「🚀 派出」按钮：一次多路派出，错峰 500ms
 *   5. 回收全自动：派出前写入 window._zfAutoGatherNext（时间戳标志，
 *      原三种箭头各自读取），不再需要回收按钮/选项
 *   6. 叮嘱注入：每个角色 setTimeout 回调执行前重写 window._zfCustomNoteNext
 *      （原机制首窗消费即置 null，逐个重写 = 每个角色都拿到同一句话）
 *   7. 施工队走 ZFCrew.dispatchCrew（不吃叮嘱）；总结师/自定义吃叮嘱
 * 挂载：幂等守卫 + MutationObserver 常驻轮询重注入（防抽屉重建丢面板）
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFCrewPanel) return; // 幂等守卫
  var P = window.ZFCrewPanel = { version: '1.3' };
  /* 【XSS 防护】自定义协议角色名来自可导入 MD，插入 innerHTML 前必须转义 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── 白色简约线稿 SVG 图标（stroke 风格，currentColor 随文字色） ── */
  var ICONS = {
    thinker:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M12 7l2 3h-4l2-3z"/><path d="M9.5 12a2.5 2.5 0 0 0 5 0"/></svg>',
    crew:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5l6 6-2 2-6-6 2-2z"/><path d="M11 7L4 14a2 2 0 0 0 0 3l3 3a2 2 0 0 0 3 0l7-7"/><path d="M9 13l2 2"/></svg>',
    objector:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.3-2-.8-3-.5 1-1.2 1.5-1.2 1.5C16.5 6 14 4 12 3z"/><path d="M9 14a3 3 0 1 0 6 0c0-1.5-1-2.5-2-3.5 0 1.5-2 2-2 3.5"/><path d="M5 21h14"/></svg>',
    evolution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8c0 4 3 5 5 8 1.5 2.3 1 4-1 4-3 0-7-3-7-8 0-2 .5-4 3-4z"/><path d="M17 16c0-4-3-5-5-8-1.5-2.3-1-4 1-4 3 0 7 3 7 8 0 2-.5 4-3 4z"/></svg>',
    verifier:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4M11 3v6l-5 8a2.5 2.5 0 0 0 2.2 4h7.6A2.5 2.5 0 0 0 18 17l-5-8V3"/><path d="M8.5 15h7"/></svg>',
    qc:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    summarizer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    sumcrew:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5l5 5M21 5l-5 5"/></svg>',
    sumskill:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3z"/></svg>',
    sumforum:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9h8M8 12h5"/></svg>',
    polisher:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20L14 10"/><path d="M13 5l1.2 2.8L17 9l-2.8 1.2L13 13l-1.2-2.8L9 9l2.8-1.2L13 5z"/><path d="M18.5 13.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7.7-1.6z"/></svg>',
    security:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"/><rect x="9.5" y="10.5" width="5" height="4" rx="0.8"/><path d="M10.5 10.5V9.5a1.5 1.5 0 0 1 3 0v1"/></svg>',
    refactor:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h7a1.5 1.5 0 0 1 1.5 1.5v3M14 17.5H7A1.5 1.5 0 0 1 5.5 16v-3"/></svg>',
    memkeeper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z"/><path d="M6.5 8h2.5M6.5 11h2.5M6.5 14h1.5"/><path d="M13 8c1.5-.5 3 .5 3 2s-1.5 2.5-3 2"/><circle cx="15.5" cy="13.5" r=".7" fill="currentColor"/><circle cx="17.5" cy="15.5" r=".7" fill="currentColor"/><path d="M16 14l1.3 1.2"/></svg>',
    custom:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 15.5c1 1 2 1.5 3.5 1.5s2.5-.5 3.5-1.5"/></svg>',
    plain:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4V5z"/><circle cx="9" cy="10.5" r="0.6" fill="currentColor"/><circle cx="12" cy="10.5" r="0.6" fill="currentColor"/><circle cx="15" cy="10.5" r="0.6" fill="currentColor"/></svg>',
    expert:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9l10-4 10 4-10 4L2 9z"/><path d="M6 11v4c0 1.5 2.7 3 6 3s6-1.5 6-3v-4"/><path d="M22 9v5"/></svg>',
    breakthrough:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c2.8 2 4.5 5.5 4.5 9l-1.5 4h-6l-1.5-4c0-3.5 1.7-7 4.5-9z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9 15.5L7 20l3-1.5M15 15.5L17 20l-3-1.5"/><path d="M12 16v4"/></svg>',
    /* 【沙盘三师白色线稿】打磨师=魔法棒+星光 / 外力师=地球+外力环 / 预演师=戏剧面具 */
    polishplan:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l8-8"/><path d="M13.5 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z"/><path d="M19 13l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z"/></svg>',
    externalcap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12.5 12.5 0 0 1 0 16a12.5 12.5 0 0 1 0-16z"/><path d="M21 17l2 2M21 21l2-2"/></svg>',
    preplan:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4c3.5 1 6 1.5 8 1.5S16.5 5 20 4c0 5-1 9-3.5 11.5C14.8 17.2 13.5 18 12 18s-2.8-.8-4.5-2.5C5 13 4 9 4 4z"/><path d="M9 10.5c0-1 .7-1.6 1.5-1.6s1.5.6 1.5 1.6"/><path d="M12 13.5c-.6.6-1.4.9-2 .7"/><path d="M14 10.5c0-1 .7-1.6 1.5-1.6s1.5.6 1.5 1.6"/><path d="M8 18c-1 1.5-2.5 2.5-4.5 2.5 0-2 .5-3.5 1.5-4.5"/><path d="M16 18c1 1.5 2.5 2.5 4.5 2.5 0-2-.5-3.5-1.5-4.5"/></svg>',
    /* 【安全攻防双角色白色线稿 2026-11-19】黑客=终端窗口+十字光标 / 红客=盾牌+对勾 */
    hacker:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 8.5h18"/><path d="M6 6.2h.01M8.4 6.2h.01"/><path d="M7 12l2.5 2L7 16"/><path d="M12.5 16h4"/></svg>',
    redguard:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 2.6v5.1c0 4.6-3 8.3-7 10.3-4-2-7-5.7-7-10.3V5.6L12 3z"/><path d="M9 11.6l2.2 2.2L15.5 9.5"/></svg>',
    /* 【文本师·工程师白色线稿 2026-11-22】文本师=笔+纸页 / 工程师=桥梁结构（小木桥→水泥桥） */
    textmaster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6V3z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 15.5h7M9 8.5h2.5"/></svg>',
    engineer:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M3 18L12 6l9 12"/><path d="M8.5 18V12M15.5 18V12M12 6v3"/><path d="M5.5 14.5h13"/></svg>',
    /* 【日志师白色线稿 2026-11-24】笔记本+笔尖（途中记录工作日志） */
    logger:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5V3z"/><path d="M5 3v18"/><path d="M9.5 8H16M9.5 12H16M9.5 16h4"/><path d="M9.5 6h2"/></svg>',
  };
  function icon(key, size, face, name) {
    /* 【图标兜底】协议注入角色 key 动态（proto_x_y），按角色名查线性 SVG 表；都没有回退 face emoji */
    var svg = ICONS[key] || (name && ICONS_BY_NAME[name]);
    return '<span style="display:inline-flex;width:' + (size || 20) + 'px;height:' + (size || 20) + 'px;color:#fff;">' + (svg || (face ? esc(face) : '')) + '</span>';
  }
  /* ── 十三师线性 SVG 图标（stroke 风格，按角色名匹配，协议注入角色通用） ── */
  var ICONS_BY_NAME = {
    '游戏师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="10" rx="5"/><path d="M7 11v4M5 13h4"/><circle cx="16" cy="12" r=".7" fill="currentColor"/><circle cx="18.5" cy="14" r=".7" fill="currentColor"/></svg>',
    '漫画师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="10" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><path d="M13 16.5h8"/><path d="M5 7l2.5 2"/></svg>',
    '聊天师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H10l-6 4V5z"/><path d="M12 10.8c-.9-1.6-3-1-3 .5 0 1.2 1.5 2.1 3 3.2 1.5-1.1 3-2 3-3.2 0-1.5-2.1-2.1-3-.5z"/></svg>',
    '股票师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 3.5 3.5L20 7"/><path d="M15 7h5v5"/></svg>',
    '背景师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M3 17l5-4 4 3 4-5 5 6"/></svg>',
    '图标师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><path d="M4 17h6v4H4z"/><path d="M17 14v7M13.5 17.5h7"/></svg>',
    '音效师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/></svg>',
    '色彩师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.7-2.5H17a4.5 4.5 0 0 0 4.5-4.5C21.5 7 17.2 3 12 3z"/><circle cx="8" cy="9" r=".8" fill="currentColor"/><circle cx="12.5" cy="7.5" r=".8" fill="currentColor"/><circle cx="16.5" cy="10" r=".8" fill="currentColor"/></svg>',
    'UI师':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/><circle cx="6" cy="6.5" r=".6" fill="currentColor"/></svg>',
    '动画师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14"/><path d="M10.5 10l4 2.5-4 2.5v-5z"/></svg>',
    '特效师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8L12 4z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></svg>',
    '插件师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4V4z"/></svg>',
    '垃圾师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/></svg>',
    '突破师':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c2.8 2 4.5 5.5 4.5 9l-1.5 4h-6l-1.5-4c0-3.5 1.7-7 4.5-9z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9 15.5L7 20l3-1.5M15 15.5L17 20l-3-1.5"/><path d="M12 16v4"/></svg>',
    '推进师': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 14h10"/><circle cx="7" cy="14" r="2" fill="currentColor"/></svg>'
  };

  /* ── 角色注册表（表驱动，新增角色只改这里） ── */
  /* 【悬停即时提示】卡片说明浮层：单例 div，mouseenter 即显即隐（无延迟） */
  var _tipEl = null;
  function _tipBox() {
    if (_tipEl) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.style.cssText = 'position:fixed;z-index:99999;max-width:260px;padding:6px 10px;border-radius:8px;background:rgba(18,20,28,.95);color:#e8eaf0;font-size:12px;line-height:1.5;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.35);display:none;white-space:normal;';
    document.body.appendChild(_tipEl);
    return _tipEl;
  }
  function _attachCardTip(el, text) {
    el.addEventListener('mouseenter', function () {
      if (!text) return;
      var t = _tipBox();
      t.textContent = text;
      t.style.display = 'block';
      var r = el.getBoundingClientRect();
      var tw = t.offsetWidth, th = t.offsetHeight;
      var x = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6));
      var y = r.top - th - 8;
      if (y < 6) y = r.bottom + 8; /* 上方放不下放下方 */
      t.style.left = x + 'px';
      t.style.top = y + 'px';
    });
    el.addEventListener('mouseleave', function () { if (_tipEl) _tipEl.style.display = 'none'; });
  }
  var ROLES = [
    { key: 'thinker',  face: '🧭', name: '策划师',  count: 1, note: true,  group: '策划', tip: '策划师=开工第一步：把你的诉求拆成分步可执行方案，产出策划案', fn: function (box, chat) { App._thinkerExpand(box, chat); } },
    { key: 'objector', face: '🔥', name: '反驳师',  count: 0, note: true,  group: '策划', tip: '反驳师=专职挑刺：用证据攻击方案漏洞，只出反驳不夸方案', fn: function (box, chat) { App._objectorExpand(box, chat); } },
    { key: 'evolution',face: '🧬', name: '进化师',  count: 0, note: true,  group: '策划', tip: '进化师=把问题沉淀成改进课题入课题池，让团队不再重复踩坑', fn: function (box, chat) { App._evolutionistExpand(box, chat); } },
    /* 【i进化四新师】沙盘研究角色：只出策划案不实际干活（工具分类=只读沙盘） */
    { key: 'cognitive', face: '🧠', name: '认知师', count: 0, note: true, group: '沙盘', tip: '认知师=开工前盘点家底：检索项目记忆与代码现状，产出认知备忘', fn: function (box, chat) { App._cognitiveExpand ? App._cognitiveExpand(box, chat) : App._stepToast('认知师模块未加载', false); } },
    { key: 'emergence', face: '🌱', name: '涌现师', count: 0, note: true, group: '沙盘', tip: '涌现师=只找别人没提过的新方向：跨领域类比+盲区补位，复述判无效', fn: function (box, chat) { App._emergenceExpand ? App._emergenceExpand(box, chat) : App._stepToast('涌现师模块未加载', false); } },
    { key: 'polishplan', face: '🪄', name: '打磨师', count: 0, note: true, group: '沙盘', tip: '打磨师=纯文本推演：找方案表述含糊与失败模式，只提精度不改方向', fn: function (box, chat) { App._polishPlanExpand ? App._polishPlanExpand(box, chat) : App._stepToast('打磨师模块未加载', false); } },
    { key: 'externalcap', face: '🌍', name: '外力师', count: 0, note: true, group: '沙盘', tip: '外力师=只读联网核实方案可行性：技术/竞品是否真实存在，结论附来源链接', fn: function (box, chat) { App._externalCapExpand ? App._externalCapExpand(box, chat) : App._stepToast('外力师模块未加载', false); } },
    { key: 'preplan', face: '🎭', name: '预演师', count: 0, note: true, group: '沙盘', tip: '预演师=纸上预演方案：假装真做一遍，专找第一步就会卡住的坑', fn: function (box, chat) { App._preplanExpand ? App._preplanExpand(box, chat) : App._stepToast('预演师模块未加载', false); } },
    /* 【文本师·工程师 2026-11-22】沙盘新师：文本师=帮助md等文本写作修改优化方案；工程师=项目工程化改造施工图（小木桥→水泥桥） */
    { key: 'textmaster', face: '✎︎', name: '文本师', count: 0, note: true, group: '沙盘', tip: '文本师=文档诊断与改写方案：问题清单+大纲+分步修改清单，只出方案不动文件', fn: function (box, chat) { App._textmasterExpand ? App._textmasterExpand(box, chat) : App._stepToast('文本师模块未加载', false); } },
    { key: 'engineer', face: '⚒︎', name: '工程师', count: 0, note: true, group: '沙盘', tip: '工程师=工程化改造设计：把「能用但不工程」升级出分阶段施工图，只出图不施工', fn: function (box, chat) { App._engineerExpand ? App._engineerExpand(box, chat) : App._stepToast('工程师模块未加载', false); } },
    { key: 'breakthrough', face: '🚀', name: '突破师', count: 0, note: true,  group: '策划', tip: '突破师=挑战「只能这么做」：找杠杆点、砍复杂度，给出最小验证实验', fn: function (box, chat) { App._breakthroughExpand ? App._breakthroughExpand(box, chat) : App._stepToast('突破师模块未加载', false); } },
    { key: 'expert',   face: '🎓', name: '专家团',  count: 0, note: true,  group: '策划', tip: '专家团=按任务领域临时组团：弹窗选专家并行干活，全部回来后收口拍板', fn: function (box, chat) { if (window.ZFExpertTeam && window.ZFExpertTeam.dispatch) App._expertDispatch(box, chat); else App._stepToast('专家团模块未加载', false); } },
    { key: 'plain',    face: '💬', name: '普通对话', count: 0, note: true, group: '策划', tip: '普通对话=无预设角色的新窗口：只带你的叮嘱和首问，多开做冗余对照', fn: function (box, chat) { App._plainExpand ? App._plainExpand(box, chat) : App._stepToast('普通对话模块未加载', false); } },
    /* 【去自定义卡 2026-11-27】「自定义🎭」卡已删除：其能力（写叮嘱+可起名派窗）全并入「普通对话💬」，
       两卡留一（用户定稿留普通对话）。_customExpand 内核函数保留——Bug五师(_openBugRole)与
       专家团(chatbox-expert-team.js)仍复用它派单，只是面板不再有独立入口卡。 */
    { key: 'crew',     face: '👥', name: '协作师',  count: 0, note: false, group: '施工', tip: '协作师=一次派出多个 AI 成组并行干活：组内互相播报进展、共享上下文', fn: function (box, chat, note, nArg, total) { if (window.ZFCollab && ZFCollab.dispatch) { ZFCollab.dispatch(chat, total || nArg || 2, note, nArg || 1); } else App._stepToast('协作师模块未加载（chatbox-collab.js）', false); } },
    /* 【讲解师归策划组 2026-11-27】讲解师从「收尾」组移到「策划」组（卡位于 ROLES 定义序的策划组卡之后，非数组字面末尾），
      渲染按 group 分桶落「策划桶末位」=协议注入的律师卡之后（用户定稿排序）。【措辞修正 2026-11-27 收口】审核员指出"ROLES 末尾"字面不实，改按渲染桶口径表述 */
    { key: 'explainer', face: '🗣️', name: '讲解师', count: 0, note: true, group: '策划', tip: '讲解师=翻译官：把技术结论讲成外行能听懂的大白话，附30秒极简总结', fn: function (box, chat) { App._explainerExpand ? App._explainerExpand(box, chat) : App._stepToast('讲解师模块未加载', false); } },
    { key: 'refactor', face: '🧩', name: '代码师',  count: 0, note: true,  group: '施工', tip: '代码师=只审结构不改码：标出坏味道行号，出每步≤3文件的拆分施工图', fn: function (box, chat) { App._refactorExpand ? App._refactorExpand(box, chat) : App._stepToast('代码师模块未加载', false); } },
    { key: 'qc',       face: '🛡️', name: '审核师',  count: 0, note: true,  group: '质检', tip: '审核师=验收把关：对照策划逐条核验，默认立场是「不通过」', fn: function (box, chat) { App._objectiveVerify(box, chat); } },
    { key: 'verifier', face: '🧪', name: '验证师',  count: 0, note: true,  group: '质检', tip: '验证师=终验交付：亲跑代码/实开网页交叉取证，评分<60 一票退回', fn: function (box, chat) { App._verifierExpand(box, chat); } },
    { key: 'security', face: '🔒', name: '安全师',  count: 0, note: true,  group: '质检', tip: '安全师=只查不改的安全审计：注入/越权/泄密逐项过，标严重度给行号', fn: function (box, chat) { App._securityExpand ? App._securityExpand(box, chat) : App._stepToast('安全师模块未加载', false); } },
    { key: 'polisher', face: '✨', name: '优化师',  count: 0, note: true,  group: '界面', tip: '优化师=成品精修：消除冗余、提升流畅与美感，改完打【优化评分】', fn: function (box, chat) { App._polisherExpand ? App._polisherExpand(box, chat) : App._stepToast('优化师模块未加载', false); } },
    { key: 'summarizer',face:'📋', name: '总结师',  count: 0, note: true,  group: '收尾', tip: '总结师=收尾沉淀：把本对话结论与经验教训写成总结记录存档', fn: function (box, chat) { App._summarizerExpand ? App._summarizerExpand(box, chat) : App._stepToast('总结师请从角色列表选择', true); } },
    { key: 'sumcrew',   face:'🛠', name: '加入团队', count: 0, note: true, group: '收尾', tip: '加入团队=收尾动作：把本对话实际干活的成员转正入职「团队」名单，下次可直接点名派活', fn: function (box, chat) {
        // AI 全自动：无任何弹窗，后端读对话历史 + AI 总结成员名/接手线索/路径，直接入库
        var chatId = String((chat && chat.id) || window.__zfChatId || window.__chatId || (window.currentSession && window.currentSession.id) || '');
        App._stepToast ? App._stepToast('🛠 AI 正在总结本对话并加入团队…', false) : null;
        fetch('/api/butler/team', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'auto_join', chat_id: String(chatId) })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (x) {
              if (!x.ok || x.j.ok === false) throw new Error(x.j.err || x.j.error || ('HTTP ' + x.ok));
              App._stepToast ? App._stepToast('✅ 已自动加入工作台团队：' + x.j.name + (x.j.relation && x.j.relation !== '团队成员' ? '（' + x.j.relation + '）' : ''), true) : _dlgAlert('✅ 已自动加入工作台团队：' + x.j.name);
          })
          .catch(function (e) { _dlgAlert('加入失败：' + (e.message || e)); });
      } },
    { key: 'sumskill',  face:'🧠', name: '技能总结', count: 0, note: true,  group: '收尾', tip: '技能总结=把本对话用过的工具与方法提炼成可复用的技能卡', fn: function (box, chat) { App._summarizerExpand ? App._summarizerExpand(box, chat, 'skill') : App._stepToast('总结师请从角色列表选择', true); } },
    { key: 'sumforum',  face:'🌐', name: '发布广场', count: 0, note: true, group: '收尾', tip: '发布广场=把本对话成果整理成帖，发布到社区广场分享', fn: function (box, chat) { App._summarizerExpand ? App._summarizerExpand(box, chat, 'forum') : App._stepToast('总结师请从角色列表选择', true); } },
    { key: 'memkeeper', face: '📚', name: '记忆师',  count: 0, note: true,  group: '收尾', tip: '记忆师=只读巡检记忆库：抽样体检记忆健康度，产出报告不改动记忆', fn: function (box, chat) { App._memoryKeeperExpand ? App._memoryKeeperExpand(box, chat) : App._stepToast('记忆师模块未加载', false); } },
    /* 【日志师 2026-11-24】途中记录角色：把当前+之前全部工作与用户诉求整理成 md 工作日志落盘，为下一次工作做提前可见的交接；箭头可不返回（产出=md 文件本身） */
    { key: 'logger', face: '📓', name: '日志师',  count: 0, note: true,  group: '收尾', tip: '日志师=随时可派的工作记录员：整理全部工作与诉求落盘 md 日志，供下一步交接', fn: function (box, chat) { App._loggerExpand ? App._loggerExpand(box, chat) : App._stepToast('日志师模块未加载', false); } },
    /* 【讲解师归策划组 2026-11-27】原「收尾」组讲解师卡已移入上方策划组区段（渲染落策划桶末位、律师协议卡之后），此处留位注释 */
    { key: 'architect', face: '🏛️', name: '架构师', count: 0, note: true,  group: '收尾', tip: '架构师=画方向图：模块划分/依赖/数据流的结构设计与演进路径', fn: function (box, chat) { App._architectExpand ? App._architectExpand(box, chat) : App._stepToast('架构师模块未加载', false); } },
    { key: 'progress', face: '📊', name: '推进师', count: 0, note: true,  group: '质检', tip: '推进师=算进度：逐条核对任务完成度打百分比，汇报一行【工程进度】XX%总览', fn: function (box, chat) { App._progressExpand ? App._progressExpand(box, chat) : App._stepToast('推进师模块未加载', false); } },
    /* 【Bug五师接入派出团队 2026-11-16】角色库（roles_db.json g_bugfix 分组）已有五师，但本面板 ROLES 为硬编码清单未收录 → 用户看不到。现补录：点卡时动态从 /api/roles 按名字精确找角色并 openRoleChat 开新窗（叮嘱走 _zfCustomNoteNext 通道，与自定义师同口径） */
    { key: 'bugfixer',    face: '🔧', name: 'Bug修复师', label: 'Bug修复', count: 0, note: true, group: 'Bug治理', tip: 'Bug修复师=按定位证据动手修 Bug：最小改动+运行时实测，无证据拒动手', fn: function (box, chat) { _openBugRole(box, chat, 'Bug修复师'); } },
    { key: 'buglocator',  face: '🎯', name: 'Bug定位师', label: 'Bug定位', count: 0, note: true, group: 'Bug治理', tip: 'Bug定位师=钉死根因：栈抓取+二分隔离给到文件/行号，只定位不改动', fn: function (box, chat) { _openBugRole(box, chat, 'Bug定位师'); } },
    { key: 'bughunter',   face: '🔍', name: 'Bug排查师', label: 'Bug排查', count: 0, note: true, group: 'Bug治理', tip: 'Bug排查师=防复发收口：复发比对+同类扫雷+沉淀免疫卡，杜绝同坑再踩', fn: function (box, chat) { _openBugRole(box, chat, 'Bug排查师'); } },
    { key: 'bugbreaker',  face: '🪓', name: 'Bug拆解师', label: 'Bug拆解', count: 0, note: true, group: 'Bug治理', tip: 'Bug拆解师=把复杂 Bug 拆成可独立验证的子问题清单，交给定位师逐个钉', fn: function (box, chat) { _openBugRole(box, chat, 'Bug拆解师'); } },
    { key: 'bugoptimizer',face: '⚙️', name: 'Bug优化师', label: 'Bug优化', count: 0, note: true, group: 'Bug治理', tip: 'Bug优化师=修复后加固：清扫同类隐患+沉淀免疫卡，防复发', fn: function (box, chat) { _openBugRole(box, chat, 'Bug优化师'); } },
    /* 【安全攻防双角色接入 2026-11-18】黑客⭐=红队纸面推演（战前找洞）；红客🛡️=蓝队应急响应（被攻击时止血+取证+复盘）。走 _openBugRole 同款通道 */
    { key: 'hacker',    face: '⭐', name: '黑客', label: '黑客·攻', count: 0, note: true, group: 'Bug治理', tip: '黑客=红队纸面推演：以攻击者视角列攻击面与漏洞假设，只推演不真攻击', fn: function (box, chat) { _openBugRole(box, chat, '黑客'); } },
    { key: 'redguard',  face: '🛡️', name: '红客', label: '红客·防', count: 0, note: true, group: 'Bug治理', tip: '红客=被攻击时的应急指挥：识别→止血→取证→根除复盘四步走', fn: function (box, chat) { _openBugRole(box, chat, '红客'); } }
  ];
  /* 【Bug五师 v2 2026-11-16】改走 App._customExpand 派单内核（与审核师同款：紧贴源窗定位 + ZFSwarm 收口箭头 + 配置继承）。
     旧版直接 App.openRoleChat(role) 开独立角色窗：不进蜂群注册表 → 无箭头、不按源窗定位 → 位置乱（本 bug 根因）。
     现改为：拉 /api/roles 找到角色 → 写 _zfBugRoleNext（角色对象+面板叮嘱）→ 调 _customExpand，由内核统一派出。 */
  function _openBugRole(box, chat, roleName) {
    fetch('/api/roles').then(function (r) { return r.json(); }).then(function (res) {
      var list = (res && res.roles) || [];
      var role = list.filter(function (x) { return String(x.name || '').indexOf(roleName) !== -1; })[0];
      if (!role) { App._stepToast('角色库中未找到「' + roleName + '」', false); return; }
      try { window._zfBugRoleNext = { role: role, note: String((state(chat) && state(chat).note) || '').trim(), ts: Date.now() }; } catch (eN) {}
      if (App._customExpand) { App._customExpand(box, chat); }
      else { window._zfBugRoleNext = null; App._stepToast('_customExpand 派单内核未加载，无法派出', false); }
    }).catch(function (e) { App._stepToast('拉取角色库失败：' + (e.message || e), false); });
  }
  P.ROLES = ROLES; // 【复用】暴露全量角色表（19+5=24个），供缩小整理 dock 等外部宿主混编派发

  /* 全部角色进面板，按 策划/施工/质检/界面/收尾/Bug治理 分组渲染（2026-11-27：讲解师自收尾移入策划组，渲染落策划桶末位、律师协议卡之后；【收口措辞修正】按渲染桶口径表述） */

  /* ── 面板状态（挂 chat 上，切对话独立） ── */
  function state(chat) {
    if (!chat._crewPanel) chat._crewPanel = { picks: {}, note: '', collapsed: true };
    return chat._crewPanel;
  }

  /* ── 渲染面板（注入到按钮行 wrap 之后的 body 里；找不到就返回 null 等下轮） ── */
  function mount(box, chat, opts) {
    var body = (opts && opts.container) || (box && box.querySelector ? box.querySelector('.chatbox-body') : null);
    if (!body) return false;
    var _exist = body.querySelector('.zf-crew-panel');
    if (_exist) {
      /* 【常驻中部】面板固定挂在「自验收/本次提问」按钮行（.msg.compress-selector）之后——
         那一排原来就是审核/策划等按钮的位置，派出团队面板应与其同区，而不是跟到最后一条消息后面
         （流式追加/尾部工具行都不会把它挤走） */
      var _btnRow = body.querySelector('.msg.compress-selector');
      if (_btnRow) { if (_btnRow.previousElementSibling !== _exist) _btnRow.before(_exist); }
      else {
        /* 兜底：按钮行还没渲染时先跟在最后一条消息后，按钮行出现后下轮重挂会自动归位 */
        var _msgs = body.querySelectorAll('.msg');
        var _lastM = _msgs.length ? _msgs[_msgs.length - 1] : null;
        if (_lastM) { if (_lastM.nextElementSibling !== _exist) _lastM.after(_exist); }
        else if (body.lastElementChild !== _exist) body.appendChild(_exist);
      }
      return true; // 已挂载
    }
    var st = state(chat);

    var panel = document.createElement('div');
    panel.className = 'zf-crew-panel';
    panel.style.cssText = 'margin:0;padding:10px 12px;border:none;border-radius:12px;background:transparent;';
    panel.innerHTML =
      '<div class="zfp-head" style="display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;padding:2px 0;">' +
      '<span class="zfp-title" style="font-size:13px;font-weight:bold;">派出团队</span>' +
      '</div>' +
      '<div class="zfp-body" style="display:none;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
      '<div class="zfp-cards" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;flex:1;"></div>' +
      '</div>' +
      '<div class="zfp-roster" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:10px;"></div>' +
      '<div style="display:flex;gap:8px;align-items:stretch;">' +
      '<input class="zfp-note" type="text" placeholder="一句话叮嘱（选填，可不写）…" style="flex:1;padding:8px 10px;border-radius:8px;border:none;background:transparent;color:inherit;font-size:13px;box-sizing:border-box;min-width:0;box-shadow:0 2px 8px rgba(0,0,0,.18);outline:none;">' +
      '<button class="zfp-go" style="padding:8px 22px;border-radius:8px;border:none;background:var(--q-blue,#4da3ff);color:#fff;font-size:14px;font-weight:bold;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;"><svg class="zfp-go-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><line x1="12" y1="21" x2="12" y2="3"></line><polygon points="12 3 5 12 12 12 12 21 19 12 12 3"></polygon></svg> 派出</button>' +
      '</div></div>';

    var cardsEl = panel.querySelector('.zfp-cards');
    var rosterEl = panel.querySelector('.zfp-roster');
    var noteEl = panel.querySelector('.zfp-note');
    var goBtn = panel.querySelector('.zfp-go');

    noteEl.value = st.note || '';

    /* ── 【拖拽让位动画 v1.3】拖动时插入虚线占位槽（其余卡片实时让位）+ FLIP 动画平滑过渡 ── */
    var _drag = { kind: '', src: '' };
    var _ph = null;
    (function _injectKF() {
      if (document.getElementById('zfpDropSlotKF')) return;
      var s = document.createElement('style');
      s.id = 'zfpDropSlotKF';
      s.textContent = '@keyframes zfpSlotPulse{0%,100%{opacity:.55}50%{opacity:1}}';
      document.head.appendChild(s);
    })();
    function ensurePlaceholder() {
      if (!_ph) {
        _ph = document.createElement('div');
        _ph.className = 'zfp-drop-slot';
        _ph.setAttribute('data-k', 'ph');
        _ph.style.cssText = 'border:1.5px dashed var(--q-blue,#4da3ff);background:color-mix(in srgb, var(--q-blue,#4da3ff) 10%, transparent);border-radius:10px;box-sizing:border-box;width:100%;min-height:44px;animation:zfpSlotPulse .9s ease-in-out infinite;';
      }
      return _ph;
    }
    function removePlaceholder() { if (_ph && _ph.parentNode) _ph.parentNode.removeChild(_ph); _ph = null; }
    /* FLIP：记录 key→坐标，布局变化后从旧位置平滑滑到新位置（让位/重排都走这个） */
    function snapPos() {
      var m = {};
      Array.prototype.forEach.call(cardsEl.children, function (el) {
        if (!el.dataset || !el.dataset.k) return;
        var r = el.getBoundingClientRect();
        m[el.dataset.k] = { x: r.left, y: r.top };
      });
      return m;
    }
    function flipPlay(oldPos) {
      if (!oldPos) return;
      Array.prototype.forEach.call(cardsEl.children, function (el) {
        if (!el.dataset || !el.dataset.k || !oldPos[el.dataset.k]) return;
        var r = el.getBoundingClientRect();
        var dx = oldPos[el.dataset.k].x - r.left, dy = oldPos[el.dataset.k].y - r.top;
        if (!dx && !dy) return;
        el.style.transition = 'none';
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        requestAnimationFrame(function () {
          el.style.transition = 'transform .22s cubic-bezier(.2,.7,.3,1)';
          el.style.transform = '';
          setTimeout(function () { el.style.transition = ''; }, 260);
        });
      });
    }

    /* ── 【拖拽排序 v1.1】用户自定义分组序/组内序，localStorage 持久化 ──
       zf_crew_order_v1 = { groups:[组名...], cards:{ 组名:[roleKey...] } }
       跨组拖动卡片 = 修改分类；新组/新角色未列入时按默认序追加尾部（向前兼容） */
    var ORDER_KEY = 'zf_crew_order_v1';
    function loadOrder() { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '{}') || {}; } catch (eO) { return {}; } }
    function saveOrder(o) {
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch (eO1) {}
      /* 【排序上云 v1.2】同步落盘 server，AI 对话直接 GET /api/crew/order 按用户序派出 */
      try {
        fetch('/api/crew/order', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups: o.groups || [], cards: o.cards || {} }) });
      } catch (eO2) {}
    }
    /* 计算有效顺序：{ groups:[组名], gmap:{ 组名:[角色def] } }，渲染与派出共用这一份 */
    function orderedGroups() {
      var saved = loadOrder();
      var defOrder = ['策划', '施工·质检·界面', '收尾', '素材', '专项', '家人', '其他'];
      function groupOf(r) {
        var g = r.group || '策划';
        return (g === '施工' || g === '质检' || g === '界面') ? '施工·质检·界面' : g;
      }
      /* ① 角色→组归属：saved.cards 优先（跨组拖动结果），否则按定义 */
      var _where = {};
      if (saved.cards) Object.keys(saved.cards).forEach(function (g) {
        (saved.cards[g] || []).forEach(function (k) { _where[k] = g; });
      });
      /* ② 组序：saved.groups 在前，默认序补漏，新组追加尾部 */
      var allG = {}, groups = [];
      ROLES.forEach(function (r) { allG[_where[r.key] || groupOf(r)] = 1; });
      (saved.groups || []).forEach(function (g) { if (allG[g]) { groups.push(g); allG[g] = 0; } });
      defOrder.forEach(function (g) { if (allG[g]) { groups.push(g); allG[g] = 0; } });
      Object.keys(allG).forEach(function (g) { if (allG[g]) groups.push(g); });
      /* ③ 组内：saved.cards[g] 序优先，未列入按 ROLES 定义序追加 */
      var gmap = {};
      groups.forEach(function (g) {
        var arr = [], done = {};
        ((saved.cards && saved.cards[g]) || []).forEach(function (k) {
          for (var i = 0; i < ROLES.length; i++) {
            var r = ROLES[i];
            if (r.key === k && !done[k] && (_where[k] || groupOf(r)) === g) { arr.push(r); done[k] = 1; break; }
          }
        });
        ROLES.forEach(function (r) {
          if (!done[r.key] && (_where[r.key] || groupOf(r)) === g) arr.push(r);
        });
        gmap[g] = arr;
      });
      return { groups: groups, gmap: gmap };
    }

    function total() {
      var t = 0; ROLES.forEach(function (r) { t += st.picks[r.key] || 0; }); return t;
    }

    function render() {
      /* 角色卡 */
      cardsEl.innerHTML = '';
      /* 【分组折叠批次0】按 r.group 分组渲染（默认「策划」），组头可点击折叠，localStorage 记忆 */
      /* 【拖拽排序 v1.1】分组序/组内序由 orderedGroups() 按用户拖拽结果给出（zf_crew_order_v1） */
      var _groupState = null;
      try { _groupState = JSON.parse(localStorage.getItem('zf_crew_group_collapse') || '{}'); } catch (eG0) {}
      var og = orderedGroups();
      var _groups = og.groups, _gmap = og.gmap;
      function saveGroupState() { try { localStorage.setItem('zf_crew_group_collapse', JSON.stringify(_groupState)); } catch (eG1) {} }
      _groups.forEach(function (g) {
        var isCollapsed = _groupState ? _groupState[g] === true : (_groups.length > 1 && g !== '策划');
        var head = document.createElement('div');
        head.setAttribute('data-k', 'g:' + g); /* 【FLIP 让位动画 v1.3】组头也纳入让位追踪 */
        head.style.cssText = 'grid-column:1 / -1;display:flex;align-items:center;gap:6px;padding:3px 2px 1px;cursor:pointer;user-select:none;';
        head.innerHTML = '<span style="font-size:11px;font-weight:bold;opacity:.75;">' + (isCollapsed ? '▸' : '▾') + ' ' + esc(g) +
          '（' + _gmap[g].length + '）</span><span style="flex:1;height:1px;background:var(--zfp-divider, rgba(255,255,255,.12));"></span>';
        var frag = document.createDocumentFragment();
        head.onclick = function () {
          _groupState = _groupState || {};
          _groupState[g] = !(_groupState[g] === true ? true : (_groups.length > 1 && g !== '策划'));
          saveGroupState();
          render();
        };
        /* 【拖拽排序 v1.1】组头可拖动换组序；卡片拖到组头 = 移动到该组末尾（改分类）
           原生 HTML5 DnD 一旦 dragstart 触发，mouseup 不再派发 click，折叠不误触 */
        head.draggable = true;
        head.ondragstart = function (ev) {
          ev.dataTransfer.setData('text/plain', 'g:' + g);
          ev.dataTransfer.effectAllowed = 'move';
          _drag = { kind: 'g', src: g };
          head.style.opacity = '.45';
        };
        head.ondragend = function () { head.style.opacity = ''; _drag = { kind: '', src: '' }; removePlaceholder(); };
        head.ondragover = function (ev) {
          ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
          /* 组头 dragover：占位槽缩窄垫在组头下，提示"将插入此处" */
          var ph = ensurePlaceholder();
          if (_ph.parentNode !== cardsEl || _ph.previousElementSibling !== head) {
            var _p0 = snapPos();
            head.after(ph);
            ph.style.gridColumn = '1 / -1'; ph.style.minHeight = '8px';
            flipPlay(_p0);
          }
        };
        head.ondrop = function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var d = ev.dataTransfer.getData('text/plain') || '';
          var kind = d.charAt(0), src = d.slice(2);
          var _p0 = snapPos();
          var o = loadOrder();
          if (kind === 'g') {
            /* 组→组头：源组插入到目标组位置 */
            var gs = (o.groups && o.groups.length ? o.groups.slice() : _groups.slice());
            var si = gs.indexOf(src), ti = gs.indexOf(g);
            if (si < 0 || ti < 0 || si === ti) return;
            gs.splice(si, 1); gs.splice(ti, 0, src);
            o.groups = gs; saveOrder(o); removePlaceholder(); render(); flipPlay(_p0);
          } else if (kind === 'c') {
            /* 卡→组头：移动到目标组末尾 */
            var cards = o.cards || {};
            Object.keys(cards).forEach(function (gg) { cards[gg] = (cards[gg] || []).filter(function (k) { return k !== src; }); });
            var arr = _gmap[g].map(function (x) { return x.key; }).filter(function (k) { return k !== src; });
            arr.push(src);
            cards[g] = arr; o.cards = cards; saveOrder(o); removePlaceholder(); render(); flipPlay(_p0);
          }
        };
        cardsEl.appendChild(head);
        if (!isCollapsed) {
          _gmap[g].forEach(function (r) {
            var n = st.picks[r.key] || 0;
            var card = document.createElement('div');
            card.className = 'zfp-card';
            card.setAttribute('data-k', 'c:' + r.key); /* 【FLIP 让位动画 v1.3】拖拽重排时按 key 追踪旧坐标 */
            var sel = n > 0;
            card.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:5px 2px;border-radius:10px;cursor:pointer;user-select:none;transition:background .15s,border-color .15s;box-sizing:border-box;width:100%;border:1px solid ' + (sel ? 'var(--q-blue,#4da3ff)' : 'var(--zfp-card-line, rgba(255,255,255,.18))') + ';background:' + (sel ? 'var(--zfp-card-sel-bg, rgba(77,163,255,.18))' : 'transparent') + ';';
            /* 【悬停即时提示】mouseenter 即时浮出说明（原生 title 有约 1 秒延迟，体感不出现） */
            _attachCardTip(card, r.tip || r.name);
            card.innerHTML = icon(r.key, 20, r.face, r.name) +
              '<span style="font-size:11px;opacity:.8;">' + esc(r.label || r.name) + '</span>' +
              (sel ? '<span style="position:absolute;top:-7px;right:-7px;background:var(--q-blue,#4da3ff);color:#fff;font-size:11px;min-width:18px;height:18px;line-height:18px;text-align:center;border-radius:9px;font-weight:bold;">' + n + '</span>' : '');
            card.onclick = function () {
              st.picks[r.key] = (st.picks[r.key] || 0) + 1;
              render();
            };
            /* 【右键减员】右键点击卡片 = -1（数量为 0 时不再减） */
            card.oncontextmenu = function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              st.picks[r.key] = Math.max(0, (st.picks[r.key] || 0) - 1);
              render();
              return false;
            };
            /* 【拖拽排序 v1.1】卡片可拖动：拖到同组卡片上=换位，拖到别组=修改分类 */
            card.draggable = true;
            card.ondragstart = function (ev) {
              ev.dataTransfer.setData('text/plain', 'c:' + r.key);
              ev.dataTransfer.effectAllowed = 'move';
              _drag = { kind: 'c', src: r.key };
              card.style.opacity = '.45';
            };
            card.ondragend = function () { card.style.opacity = ''; _drag = { kind: '', src: '' }; removePlaceholder(); };
            card.ondragover = function (ev) {
              ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
              /* 【让位动画 v1.3】dragover 实时把占位槽插到目标卡之前，其余卡片 FLIP 平滑让位 */
              if (_drag.kind !== 'c' || _drag.src === r.key) return;
              var ph = ensurePlaceholder();
              var want = ph.previousElementSibling === card ? null : 'before';
              if (want === 'before' || ph.parentNode !== cardsEl) {
                var _p1 = snapPos();
                card.before(ph);
                flipPlay(_p1);
              }
            };
            card.ondrop = function (ev) {
              ev.preventDefault(); ev.stopPropagation();
              var d = ev.dataTransfer.getData('text/plain') || '';
              if (d.charAt(0) !== 'c') return;
              var src = d.slice(2);
              if (src === r.key) return;
              var _p2 = snapPos();
              var o = loadOrder();
              var cards = o.cards || {};
              /* 从旧位置移除 */
              Object.keys(cards).forEach(function (gg) { cards[gg] = (cards[gg] || []).filter(function (k) { return k !== src; }); });
              /* 按当前显示顺序整组写入，再插到目标卡之前（src 原属本组时同样重排） */
              var arr = _gmap[g].map(function (x) { return x.key; }).filter(function (k) { return k !== src; });
              var ri = arr.indexOf(r.key);
              arr.splice(ri < 0 ? arr.length : ri, 0, src);
              cards[g] = arr; o.cards = cards; saveOrder(o); removePlaceholder(); render(); flipPlay(_p2);
            };
            frag.appendChild(card);
          });
          cardsEl.appendChild(frag);
        }
      });

      /* 名单 */
      rosterEl.innerHTML = '';
      var any = false;
      ROLES.forEach(function (r) {
        var n = st.picks[r.key] || 0;
        for (var i = 0; i < n; i++) {
          any = true;
          (function (r, idx) {
            var chip = document.createElement('span');
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;border:1px solid var(--zfp-card-line, rgba(255,255,255,.2));background:transparent;font-size:12px;line-height:1.4;';
            chip.innerHTML = icon(r.key, 14, r.face, r.name) + ' ' + esc(r.name) + (n > 1 ? (idx + 1) : '') +
              ' <b data-del="1" style="cursor:pointer;color:#ff7a7a;padding:0 2px;">✕</b>';
            chip.querySelector('[data-del]').onclick = function (ev) {
              ev.stopPropagation();
              st.picks[r.key] = Math.max(0, (st.picks[r.key] || 0) - 1);
              render();
            };
            rosterEl.appendChild(chip);
          })(r, i);
        }
      });
      rosterEl.style.display = any ? 'flex' : 'none';
      /* 派出按钮态：只要选了人即可；一句话叮嘱选填（2026-10-27 改） */
      var ok = total() > 0;
      goBtn.style.opacity = ok ? '1' : '.4';
      goBtn.style.pointerEvents = ok ? 'auto' : 'none';
      goBtn.innerHTML = ok ? '<svg class="zfp-go-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><line x1="12" y1="21" x2="12" y2="3"></line><polygon points="12 3 5 12 12 12 12 21 19 12 12 3"></polygon></svg> 派出 ' + total() + ' 人' : '<svg class="zfp-go-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><line x1="12" y1="21" x2="12" y2="3"></line><polygon points="12 3 5 12 12 12 12 21 19 12 12 3"></polygon></svg> 派出';
    }

    /* ── 折叠交互：默认折叠，点标题栏展开/收起（2026-10-27 恢复） ── */
    var headEl = panel.querySelector('.zfp-head');
    var arrowEl = panel.querySelector('.zfp-arrow');
    var bodyEl0 = panel.querySelector('.zfp-body');

    function renderCollapse() {
      var c = st.collapsed !== false;
      bodyEl0.style.display = c ? 'none' : '';
      /* 【居中修复】折叠时收紧面板内边距，让标题文字垂直居中、下方不再多出一截空白 */
      panel.style.padding = c ? '0 12px;' : '10px 12px;';
      var arrowEl = panel.querySelector('.zfp-arrow');
      if (arrowEl) arrowEl.style.transform = '';
    }
    headEl.onclick = function () {
      st.collapsed = (st.collapsed === false);
      renderCollapse();
    };
    /* 【拖拽排序 v1.1】标题栏右键 = 恢复默认排序（清空持久化，不另设按钮） */
    headEl.oncontextmenu = function (ev) {
      ev.preventDefault();
      try { localStorage.removeItem('zf_crew_order_v1'); } catch (eR) {}
      render();
      try { App._stepToast('已恢复默认排序', true); } catch (eR2) {}
      return false;
    };
    renderCollapse();

    noteEl.addEventListener('input', function () { st.note = noteEl.value; render(); });

    goBtn.onclick = function () {
      var note = noteEl.value.trim();
      var _crewTotal = total();
      if (_crewTotal <= 0) return;
      /* 【复用·dock 宿主接管】opts.onDispatch 存在时：把选人结果打包交给宿主，
         面板只负责选角色/写叮嘱，派发账本/叮嘱标志/错峰节奏全部由宿主统一管理（避免双份） */
      if (opts && typeof opts.onDispatch === 'function') {
        /* 【拖拽排序 v1.1】orderedKeys = 用户排序后的角色 key 序列，宿主按它派发（双入口顺序一致） */
        var _ogD = orderedGroups(), _ok = [];
        _ogD.groups.forEach(function (g) {
          _ogD.gmap[g].forEach(function (r) {
            if ((st.picks[r.key] || 0) > 0 && _ok.indexOf(r.key) < 0) _ok.push(r.key);
          });
        });
        opts.onDispatch({ picks: Object.assign({}, st.picks), note: note, total: _crewTotal, orderedKeys: _ok });
        st.picks = {}; st.collapsed = true; renderCollapse(); render();
        return;
      }
      /* 【v10 防提前收口·账本登记】派出团队派发时向派发登记账本登记派出份数（重置式开新账），
         使 gatherFor 的账本闸门生效：①outstanding>0（窗口未全开出）不收口；②canGather（回收+核销
         < 派出数）不收口。此前仅专家团登记（expert-team.js L73），派出团队漏登 → 收口判据只查
         pair.memberIds，后开出/未开出的成员不在名单内即可被提前回收汇总（用户实锤场景）。 */
      try { if (window.ZFDispatchLedger && ZFDispatchLedger.registerExpected) ZFDispatchLedger.registerExpected(chat.id, _crewTotal); } catch (eLed) {}
      try { if (App && typeof App._onSendComplete === 'function' && !chat.isSending) App._onSendComplete(box, chat); } catch (e) {}
      /* ♻ 全自动回收：写入时间戳标志，三种箭头各自读取（60s 内有效） */
      /* 【2026-11-01 彻底移除自动返回】凭证永不写入 */
      try { window._zfAutoGatherNext = 0; window._zfGatherExpireWarned = false; } catch (e) {}
      /* 逐角色错峰派出：每个角色执行前重写叮嘱标志（原机制首窗消费即置 null） */
      /* 【拖拽排序 v1.1】派出顺序跟随用户拖拽排序（谁排前面谁先开窗） */
      var seq = [];
      var ogGo = orderedGroups();
      ogGo.groups.forEach(function (g) {
        ogGo.gmap[g].forEach(function (r) {
          var n = st.picks[r.key] || 0;
          for (var i = 0; i < n; i++) seq.push(r);
        });
      });
      /* 【协作师修复 2026-11-24】pick 快照：下面 st.picks 会在 setTimeout 触发前被清空
         （清空代码跑在同步段，循环触发在 500ms 错峰之后）→ 循环里读 st.picks 恒空。
         快照在此处（清空前）定格每角色份数，setTimeout 回调改读 _pickSnap。 */
      var _pickSnap = {};
      Object.keys(st.picks).forEach(function (k) { _pickSnap[k] = st.picks[k]; });
      /* 【v2 普通对话派发前置】同一批派出前写入：①独立叮嘱标志（防跨角色串扰）；
         ②批次 id（_plainExpand 内所有窗共享，登记到 Store.data.plainBatches） */
      var _plainCnt = st.picks['plain'] || 0;
      if (_plainCnt > 0) {
        if (note) window._zfPlainNoteNext = { note: note.slice(0, 500), ts: Date.now() };
        window._zfPlainBatchNext = 'pb_' + chat.id + '_' + Date.now();
      }
      seq.forEach(function (r, i) {
        setTimeout(function () {
          try {
            if (r.note && note) {
              window._zfCustomNoteNext = { note: note.slice(0, 500), ts: Date.now(), imgs: [], pastes: [] };
            }
            /* 【协作师专用 2026-11-24】pickN 快照提前取（L592 已把 st.picks 清空，setTimeout
               里读到恒为 1）；协作师 fn 第四参传该份的序号，第五参传该角色总份数。
               【派2出3修复 2026-11-24】协作师整批只有「1 份语义」：第 1 份按总份数建 N 人组，
               第 2..N 份直接跳过（此前第2份仍会触发 dispatch → 800ms 防抖并入逻辑给首组
               扩 +1 员 → 派2出3，实锤；同理派3会出4）。 */
            var _pickN = _pickSnap[r.key] || 0;
            if (r.key === 'crew') {
              if (i > 0) return; /* 第 2..N 份跳过：一份=整组，绝不重复触发 */
              r.fn(box, chat, note, 1, Math.min(_pickN, 4));
            } else {
              r.fn(box, chat, _pickN || 1);
            }
            try { if (App._bumpSpawnCount) App._bumpSpawnCount(r.name, 1, chat); } catch (e2) {}
          } catch (e) {
            try { console.warn('[crew-panel] 派出失败:', r.name, e); } catch (e2) {}
            try { App._stepToast('派出「' + r.name + '」失败：' + (e.message || e), false); } catch (e3) {}
          }
        }, i * 500);
      });
      try { App._stepToast('小队已派出（' + seq.length + ' 人）', true); } catch (e) {}
      /* 派出后收起面板：已派出完成，收起来不占地方（2026-10-27 恢复折叠） */
      st.picks = {};
      st.collapsed = true;
      renderCollapse();
      render();
    };

    /* ── 【查进度 2026-11-14 已迁移】按钮移至右侧队列卡（chatbox-right-queue.js 总结/查进度/全关），此处旧死代码已清理 ── */

    /* ── 【v2 P2 一键回收+并排展示】多路普通对话答案回收 ── */
    function _renderGather() {
      var _old = panel.parentNode && panel.parentNode.querySelector('.zfp-plain-gather');
      if (_old) _old.remove();
      var _batches = (window.Store && Store.data && Store.data.plainBatches) || {};
      var _mine = Object.keys(_batches).map(function (k) { return _batches[k]; })
        .filter(function (b) { return b.srcChatId === chat.id && b.members && b.members.length; })
        .sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
      if (!_mine.length) return;
      var _latest = _mine[0];
      /* 【v10 动态调整】剔除已被用户关闭的成员，计数自适应存活数 */
      var _liveMembers = _latest.members.filter(function (m) {
        try { return !!Store.data.chatBoxes.find(function (c) { return c.id === m.chatId; }); } catch (e) { return false; }
      });
      if (!_liveMembers.length) { if (_old) _old.remove(); return; }
      var _done = 0;
      _liveMembers.forEach(function (m) {
        try {
          var _c = Store.data.chatBoxes.find(function (c) { return c.id === m.chatId; });
          if (_c && _c.history && _c.history.some(function (h) { return h.role === 'assistant' && !h._meta && (h.content || '').trim(); })) _done++;
        } catch (e) {}
      });
      var _closedCnt = _latest.members.length - _liveMembers.length;
      var _g = document.createElement('div');
      _g.className = 'zfp-plain-gather';
      _g.style.cssText = 'margin:6px 0 2px;padding:8px 10px;border:1px dashed rgba(120,200,255,.4);border-radius:10px;background:transparent;';
      var _closeHtml = '<button class="zfp-gather-close" title="关闭这个回收条（批次不受影响）" style="float:right;margin-left:6px;font-size:11px;width:18px;height:18px;line-height:16px;text-align:center;border-radius:6px;border:1px solid var(--zfp-card-line, rgba(255,255,255,.14));background:var(--zfp-chip-bg, rgba(255,255,255,.06));color:var(--zfp-btn-text, #9aa4b5);cursor:pointer;">✕</button>';
      var _html = '<div style="font-size:11px;color:#8fc4ff;margin-bottom:6px;">💬 多路答案批次（' + _done + '/' + _liveMembers.length + ' 已回答' + (_closedCnt ? '，已关闭 ' + _closedCnt + ' 路' : '') + '）' +
        _closeHtml +
        '<button class="zfp-gather-btn" style="float:right;font-size:11px;padding:2px 10px;border-radius:8px;border:1px solid rgba(120,200,255,.5);background:rgba(120,200,255,.12);color:#8fc4ff;cursor:pointer;">一键回收并排展示</button></div>';
      _g.innerHTML = _html;
      /* 【v10】点击 ✕ 只移除这个回收条 */
      _g.querySelector('.zfp-gather-close').onclick = function () { _g.remove(); };
      _g.querySelector('.zfp-gather-btn').onclick = function () {
        try {
          var _items = _liveMembers.map(function (m, i) {
            var _c = Store.data.chatBoxes.find(function (c) { return c.id === m.chatId; });
            var _ans = '';
            if (_c && _c.history) {
              for (var j = _c.history.length - 1; j >= 0; j--) {
                var _h = _c.history[j];
                if (_h && _h.role === 'assistant' && !_h._meta && (_h.content || '').trim()) { _ans = String(_h.content).trim(); break; }
              }
            }
            return { idx: i + 1, chatId: m.chatId, modelId: m.modelId || '（源模型）', ans: _ans };
          });
          if (!_items.some(function (it) { return it.ans; })) { App._stepToast('普通对话尚未产生回答，稍后再试', false); return; }
          var _out = ['【多路普通对话答案并排对比 · 共 ' + _items.length + ' 路 · 叮嘱：' + String(_latest.srcNote || '').slice(0, 60) + '】', ''];
          _items.forEach(function (it) {
            _out.push('—— 第 ' + it.idx + ' 路（' + it.modelId + (it.ans ? '' + (it.ans.length) + '字' : '，未回答') + '）——');
            _out.push(it.ans || '（未回答）');
            _out.push('');
          });
          _out.push('（以上为多路独立作答，请人工择优采纳；各路原对话窗口保留在画布上）');
          /* addMsg 签名 (box, text, who, modelId, isFinal, skipSave)：box 为 DOM 元素，skipSave=true 只展示不写入历史 */
          var _gdiv = App.addMsg(chat.el, _out.join('\n'), 'user', chat.modelId, false, true);
          /* 【md 块级渲染】回收内容是给人类看的 Markdown（标题/列表/表格/代码块），
             user 气泡默认只走 ZFMD.inline 行内轻渲染，这里对该气泡升级为 ZFMD.render 块级渲染
             （ZFMD.render 内部先整体转义防 XSS），并补代码块增强，与 AI 气泡观感一致 */
          try {
            var _gd = _gdiv || (chat.el.querySelectorAll('.msg.user') || []).slice(-1)[0];
            if (_gd && window.ZFMD && ZFMD.render) {
              _gd.innerHTML = ZFMD.render(_out.join('\n'), { breaks: true });
              _gd.classList.add('md-body');
              if (typeof App.enhanceCodeBlocks === 'function') App.enhanceCodeBlocks(_gd);
            }
          } catch (eMd) {}
          App._stepToast('💬 已回收 ' + _items.length + ' 路答案并排展示到本对话', true);
        } catch (eG) {
          try { App._stepToast('回收失败：' + (eG.message || eG), false); } catch (e2) {}
        }
      };
      panel.after(_g);
    }
    _renderGather();
    var _gatherTimer = setInterval(function () {
      try {
        if (!document.body.contains(panel)) { clearInterval(_gatherTimer); return; }
        _renderGather();
      } catch (e) { clearInterval(_gatherTimer); }
    }, 3000);

    /* 插到「自验收/本次提问」按钮行（.msg.compress-selector）之后——与审核/策划等按钮同区；
       按钮行尚未渲染时兜底跟在最后一条消息后，按钮行出现后常驻重挂逻辑会自动归位 */
    var _btnRow = body.querySelector('.msg.compress-selector');
    if (_btnRow) _btnRow.before(panel);
    else {
      var _msgs0 = body.querySelectorAll('.msg');
      var _lastM0 = _msgs0.length ? _msgs0[_msgs0.length - 1] : null;
      if (_lastM0) _lastM0.after(panel); else body.appendChild(panel);
    }
    renderCollapse();
    render();
    return true;
  }

  /* ── 【复用入口】mountTo(container, chat, opts)：供外部宿主（缩小整理 dock 等）挂载面板 ──
     opts: { collapsed: 初始是否折叠(默认 true), onDispatch(payLoad): 接管派出（宿主传了就走宿主派发） }
     与 chatbox 内 mount(box,chat) 共用同一套 DOM/状态逻辑，零重复实现 */
  P.mountTo = function (container, chat, opts) {
    opts = opts || {};
    if (!container || !chat) return false;
    var _old = container.querySelector(':scope > .zf-crew-panel');
    if (_old) _old.remove();
    opts.container = container; /* mount 内所有插入/查询都落在宿主容器，panel 直接挂进来 */
    var ok = mount({}, chat, opts);
    if (ok && opts.collapsed === false) {
      var h = container.querySelector('.zfp-head');
      if (h) h.click();
    }
    /* 【hideHead v1 20261130】外部宿主（缩小整理 dock）可要求隐藏面板头部标题：
       dock 按钮已写「☰ 派出团队」，宿主浮层里再出一个"派出团队"标题头 = 用户看到的
       "又出现一次派出团队"。隐藏头部 + 保持 body 展开，点击即直接出对话框本体。 */
    if (ok && opts.hideHead) {
      var hh = container.querySelector('.zfp-head');
      if (hh) hh.style.display = 'none';
      var hb = container.querySelector('.zfp-body');
      if (hb && opts.collapsed === false) hb.style.display = 'block';
    }
    return ok;
  };

  /* ── 常驻重注入：MutationObserver 监听聊天区重建，面板丢了就补 ── */
  function tryMountAll() {
    try {
      var boxes = (window.App && App.chatBoxes) || [];
      boxes.forEach(function (chat) {
        if (!chat || !chat.el || chat._meta) return;
        if (chat._isThinkerChat || chat._isQcChat || chat._isObjectorChat || chat._isCustomChat || chat._raceChat || chat._isVerifierChat || chat._isPolisherChat || chat._isSecurityChat || chat._isPlainChat) return; // 子窗不挂
        /* 【协议角色】动态 flag _isProtoChat_<team>_<idx> 的子窗同样不挂（前缀匹配，避免逐个登记） */
        try { for (var k in chat) { if (k.indexOf('_isProtoChat_') === 0 && chat[k]) return; } } catch (eP) {}
        if (chat._crewPanel && chat._crewPanel._closed) return; // 用户主动关闭过，不再重挂
        mount(chat.el, chat);
      });
    } catch (e) {}
  }

  /* ============ i进化·沙盘入口【2026-11-16 已废弃】 ============ */
  /* 【2026-11-16 用户要求撤下】原右下角浮动 i进化 按钮（mountEvolveBtn）连同函数体一并移除，
     i进化入口已彻底移除（i无限面板入口+窗口+接线均已删），引擎文件 zf-sandtable-engine.js 保留可恢复。 */

  function boot() {
    tryMountAll();
    /* 【2026-11-16 用户要求撤下】右下角多余 i进化 浮动按钮已移除；i进化入口已彻底移除 */
    var mo = new MutationObserver(function () { tryMountAll(); });
    function start() {
      var anchor = document.body;
      if (!anchor) { setTimeout(start, 300); return; }
      mo.observe(anchor, { childList: true, subtree: true });
      setInterval(tryMountAll, 2000); // 兜底轮询
    }
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
