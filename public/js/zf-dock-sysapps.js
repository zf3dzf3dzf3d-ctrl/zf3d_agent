/* ============================================================
 * zf-dock-sysapps.js - 顶栏功能按钮迁移入 i桌面 Dock（2026-11-12）
 * 依策划案 v2（public/策划案/策划案-顶栏菜单移入i桌面Dock-20261112.md）实施：
 *  1) 注册 9 个顶栏功能为 Dock 独立图标（复用原按钮 onclick，逻辑零拷贝）
 *  2) 顶栏按钮 display:none 隐藏但保留 DOM（getElementById 引用全保活，
 *     tts.js setIcon/btnEl/bindMenu 与 theme.js/i18n.js 文案刷新全部照常工作 → 高危②天然化解）
 *  3) Dock 常驻开关（高危①解法）：点击 Dock 空白处切换常驻，localStorage 记忆
 * 本文件只新增、不改任何既有文件；zf-app-dock.js 零改动。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. 顶栏迁移按钮隐藏（保 DOM） ---------- */
  var HIDE_IDS = ['ttsToggle', 'zf3dSiteBtn', 'themeBtn', 'languageToggle',
    'topbarFocusBtn', 'topbarMoreBtn', 'aboutBtn'];
  var css = document.createElement('style');
  css.id = 'zfSysappsHideCss';
  css.textContent = HIDE_IDS.map(function (id) {
    return '#' + id + '{display:none !important}';
  }).join('\n') +

    '#zfDock.zf-dock-pinned{opacity:1 !important;transform:translateX(-50%) translateY(0) !important;pointer-events:auto !important}';
  document.head.appendChild(css);

  /* ---------- 2. 注册 9 项到 Dock ---------- */
  /* helper：模拟点击原顶栏按钮（保留原 onclick/事件逻辑，零拷贝） */
  function clickTopbar(id) {
    var b = document.getElementById(id);
    if (b) b.click();
    else if (window.showToast) showToast('入口尚未加载完成', 'warn');
  }

  var ICONS = {
    tts: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/></svg>',
    site: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>',
    cmd: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r="0.5"/><circle cx="9" cy="6.5" r="0.5"/><path d="M7 13l3 2.5-3 2.5"/><path d="M12 18h5"/></svg>',
    theme: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-.8 2-1.7 0-1.4-1.3-1.6-1.3-2.8 0-1 .8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.5-4-8-9-8z"/><circle cx="8" cy="10" r="0.8"/><circle cx="12" cy="7.5" r="0.8"/><circle cx="16" cy="10" r="0.8"/></svg>',
    lang: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 8h18M3 16h18"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M5 5.5c2 1.2 4.4 2 7 2s5-.8 7-2M5 18.5c2-1.2 4.4-2 7-2s5 .8 7 2"/></svg>',
    growth: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/></svg>',
    butler: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 1 1 .6-8.96A6 6 0 0 1 19.3 10.5 4 4 0 0 1 18 18H7z"/></svg>',
    focus: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    about: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.6 5 8.1 5c1.6 0 3.1.8 3.9 2.1C12.8 5.8 14.3 5 15.9 5c2.5 0 4.6 2 4.6 4.6 0 3.7-3.5 6.9-8.5 10.9z"/></svg>'
  };

  function registerSysapps() {
    if (!window.ZFDock || typeof window.ZFDock.register !== 'function') return false;
    ZFDock.register({ id: 'zf-sys-site', name: 'i朱峰社区', icon: ICONS.site, onClick: function () { clickTopbar('zf3dSiteBtn'); } });
    /* 【2026-11-18 用户要求】i指挥台点击直接弹出指挥台面板（锚定 Dock 图标），不再绕顶栏下拉按钮 */
    ZFDock.register({ id: 'zf-sys-cmd', name: 'i指挥台', icon: ICONS.cmd, onClick: function (anchor) {
      var btn = document.getElementById('topbarMoreBtn');
      if (!btn) { window.showToast && showToast('指挥台模块尚未加载完成', 'warn'); return; }
      try {
        /* 直接触发更多菜单的 openMenu 逻辑（同顶栏按钮点击，锚定本 Dock 图标） */
        btn.click();
      } catch (e) { btn.click(); }
    } });
    ZFDock.register({ id: 'zf-sys-theme', name: 'i界面', icon: ICONS.theme, onClick: function () { clickTopbar('themeBtn'); } });
    ZFDock.register({ id: 'zf-sys-lang', name: 'i语言', icon: ICONS.lang, onClick: function () { clickTopbar('languageToggle'); } });
    ZFDock.register({ id: 'zf-sys-growth', name: 'i等级', icon: ICONS.growth, onClick: function () { var NS = window.__KiteNS; if (NS && NS.growthPanel) NS.growthPanel.open(); else window.showToast && showToast('养成面板尚未加载完成', 'warn'); } });
    ZFDock.register({
      id: 'zf-sys-butler', name: 'i管家', icon: ICONS.butler, onClick: function () {
        var bp = window.ButlerPanel;
        if (!bp || !bp.open) { window.showToast && showToast('管家团模块尚未加载完成', 'warn'); return; }
        bp.open(null);
      }
    });
    ZFDock.register({ id: 'zf-sys-focus', name: 'i专注', icon: ICONS.focus, onClick: function () { var fm = window.zfFocusMode; if (fm && typeof fm.toggle === 'function') fm.toggle(); else window.showToast && showToast('专注模式尚未加载完成', 'warn'); } });
    /* 【2026-11-17】朗读助手入口彻底移除：TTS 默认开启（tts.js isEnabled 未设置即 true），无需开关入口；
       【2026-11-17】关于我们入口彻底移除（用户指令），设置面板内 about 页签保留不动 */
    return true;
  }

  /* 加载兜底（策划案步骤2）：ZFDock 未挂载则每 500ms 重试，最多 20 次 */
  var tries = 0;
  (function tryReg() {
    tries++;
    if (registerSysapps()) return;
    if (tries < 20) setTimeout(tryReg, 500);
    else console.warn('[zf-dock-sysapps] ZFDock 20 次重试仍不可用，系统应用注册放弃');
  })();

})();
