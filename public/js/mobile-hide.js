/* ============================================================
   mobile-hide.js —— 手机端精简 UI（电脑端零影响）
   检测到手机/触屏窄屏时注入 CSS，隐藏桌面端专属控件。
   保留：右上角「专注模式」、底部「整理」。
   v3（2026-10-12）：「对话」按钮从隐藏组中解放——手机上唯一对话入口必须可见；
   只隐藏「更多」按钮及其菜单。
   v2（峰控遥控器模式）：右上角只保留专注（去掉最小化/最大化/关闭）；
   原右下角浮动栏整组隐藏——导致手机看不到对话入口（已修正）。
   ============================================================ */
(function () {
  'use strict';
  var isMobile =
    /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);
  if (!isMobile) return; // 电脑端：什么都不做
  document.documentElement.setAttribute('data-zf-mobile', '1');

  var css = [
    /* ===== 顶栏（2026-10-14 修复）=====
       真凶：本文件动态注入的同名 !important 隐藏规则会被 setTimeout 移到 head 末尾，
       优先级反盖过静态 mobile-ui-fix.css 的「恢复显示」，导致改 CSS 无效、顶栏反复消失。
       修复必须在源头取消这些隐藏。诉求：标题/文件夹图标/右侧时间/右侧功能图标/更多 一律可见，
       仅隐藏手机 WebView 点不动的桌面窗口控制（最小化/最大化/关闭）。 */
    '#topbarMinBtn, #topbarMaxBtn, #topbarCloseBtn { display: none !important; }',
    /* ---- 右上角窗口控制条：整条隐藏（真实元素为 span#zfWinMin/Max/Close） ---- */
    '#zfWinCtrl, .zf-win-btn { display: none !important; }',
    /* ---- 底部状态栏：保留「整理」，其余（含版本号）隐藏 ---- */
    '#statusbarVersion,',
    '#status-model-trigger, #kiteToggleBtn, #dogGuardBtn, #butlerDockBtn, #turboDockBtn { display: none !important; }',
    /* ---- 右下角浮动组：隐藏「更多」及菜单，保留「对话」按钮（手机上唯一的对话入口） ---- */
    '.tp-fab-group #tpFabMoreBtn, .tp-fab-group #tpFabMoreMenu { display: none !important; }',
    /* ---- 画布坐标 + 导航小地图 ---- */
    '#canvasCoord, #minimap, .minimap-tooltip, #reviewNextBtn { display: none !important; }',
    /* ---- 风筝龙 + 小狗管家（实体与面板入口一并隐藏，默认不开启） ---- */
    '#zfKiteRoot, .kite-dragon, .dog-guard { display: none !important; }',
    /* ---- v3 遥控模式：放大对话面板下拉/控件（原生 select 收起态，符合 44px 可点标准） ---- */
    '.chatbox select, .zf-hosted select, .chatbox .mp-line select {',
    '  min-height: 44px !important; min-width: 44px !important;',
    '  font-size: 16px !important; padding: 6px 12px !important;',
    '  appearance: auto !important; -webkit-appearance: menulist !important;',
    '}',
    '.chatbox input:not([type=checkbox]):not([type=radio]), .zf-hosted input:not([type=checkbox]):not([type=radio]) {',
    '  min-height: 40px !important; font-size: 16px !important;',
    '}',
    /* ---- v3 消息区触摸惯性滚动强化（iOS WebView） ---- */
    '.chatbox-body, .zf-hosted .chatbox-body {',
    '  -webkit-overflow-scrolling: touch !important;',
    '  touch-action: pan-y !important;',
    '  overscroll-behavior: contain !important;',
    '}'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'zfMobileHide';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  // 动态注入的元素兜底：稍后再补一次（部分控件延迟创建）
  setTimeout(function () {
    var s = document.getElementById('zfMobileHide');
    if (s && s.parentNode) { document.head.appendChild(s); } // 移到末尾提高优先级
  }, 1500);
})();
