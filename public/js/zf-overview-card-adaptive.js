/* 【用户令·i缩小整理总览卡片自适应补丁】独立补丁，不改引擎文件（引擎文件历轮会被后台回滚）
 * 1. 标题字号随卡宽+标题长度自适应（下限9px保可读，超长靠省略号截断），不出框，居中对齐
 * 2. 四球固定卡片顶部水平居中
 * 3. 四球尺寸随卡宽自适应，标题 top 与球底沿联动（CSS变量 --ov-ball）
 * 4. 退出总览模式时清理 inline style； MutationObserver 响应 DOM 变化
 */
(function () {
  'use strict';
  var css = document.createElement('style');
  css.textContent =
    'body.zf-overview-mode .chatbox .chatbox > .ov-mile-track{position:absolute !important;top:6px !important;left:50% !important;transform:translateX(-50%) !important;z-index:9 !important;--ov-ball:18px;display:flex !important;gap:6px;}' +
    'body.zf-overview-mode .chatbox .chatbox > .ov-panel-title{left:8px !important;right:8px !important;text-align:center !important;top:calc(6px + var(--ov-ball,18px) + 26px) !important;}' +
    /* 【用户令 2026-11-27】文字后面的黑色圆角块=内层嵌套 .chatbox 的原生深色背景，总览态必须清透明 */
    'body.zf-overview-mode .chatbox .chatbox{background:transparent !important;background-image:none !important;box-shadow:none !important;border:none !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}' +
    /* 【用户令 2026-11-27·v6 彻底去黑】黑块真身=内层 .chatbox 的 ::before 伪元素(style-chatbox.css 第7行,深色var(--bg-card))，前几轮只清了元素自身背景漏了伪元素，故黑色一直在。这里连 ::before 一并铲掉 */ /* 【用户令·下移】标题与四球间距 4→26px，不遮挡四球 */
    'body.zf-overview-mode .chatbox .chatbox::before{content:none !important;display:none !important;background:none !important;}';
  document.head.appendChild(css);

  function fitOne(el) {
    /* 【缩放补偿 v4】当前画布缩放比 = rect宽/offset宽（与 app-canvas-overview.js scaleOf 同源）。
       总览被摄像机缩小到如 0.2 时，原 12px 字实际只剩 2.4px 根本看不见；
       字号按 1/scale 反向补偿：scale=0.2 → 12px 变 60px 布局，屏幕上仍呈现约 12px 的清晰大字。
       上限 160px 防极端小缩放把标题撑爆卡片（可读性优先，超长靠省略号截断）。 */
    var _r = el.getBoundingClientRect();
    var _sc = (el.offsetWidth > 0 && _r.width > 0) ? _r.width / el.offsetWidth : 1;
    var _comp = 1 / Math.max(_sc, 0.08); // 下限 0.08 防除零爆冲
    var ttl = el.querySelector('.ov-panel-title');
    if (ttl) {
      var w = el.offsetWidth || 200;
      var len = Math.max((ttl.textContent || '').length, 8);
      // 下限9px：可读性优先，超长标题交给 ellipsis 截断而非无限缩字
      /* 【用户令 2026-11-27·第三次放大】文字要大得多：下限26→40px、上限44→72px；标题背景透明 */
      var fs = Math.max(160, Math.min(288, Math.min(w / (len * 0.55), w / 6))) * _comp; /* 【用户令·继续加倍】下限80→160px、上限144→288px */
      ttl.style.fontSize = Math.min(300, fs) + 'px';
      ttl.style.background = 'none';
      ttl.style.maxWidth = '100%';
      ttl.style.overflow = 'hidden';
      ttl.style.whiteSpace = 'normal';   /* 允许自动换行，长标题多行显示 */
      ttl.style.wordBreak = 'break-word';
      ttl.style.lineHeight = '1.35';
      ttl.style.textAlign = 'center';
    }
    var track = el.querySelector(':scope > .ov-mile-track');
    if (track) {
      var bw = Math.max(14, Math.min(30, (el.offsetWidth || 200) / 12)) * _comp; // 【2026-11-27 用户令】四球跟随变大
      // 球底沿=6+bw，标题 top 联动，避免球径调大压标题
      el.style.setProperty('--ov-ball', bw + 'px');
      var balls = track.querySelectorAll('.zf-mile-ball');
      balls.forEach(function (b) {
        b.style.width = bw + 'px';
        b.style.height = bw + 'px';
        b.style.fontSize = Math.max(5, bw / 2) + 'px';
        b.style.lineHeight = bw + 'px';
        b.style.borderRadius = '50%';
      });
    }
  }
  function clearOne(el) {
    var ttl = el.querySelector('.ov-panel-title');
    if (ttl) ttl.removeAttribute('style');
    var track = el.querySelector(':scope > .ov-mile-track');
    if (track) track.querySelectorAll('.zf-mile-ball').forEach(function (b) { b.removeAttribute('style'); });
    el.style.removeProperty('--ov-ball');
  }
  function fitAll() {
    var on = document.body.classList.contains('zf-overview-mode');
    var cards = document.querySelectorAll('.chatbox .chatbox');
    if (!on) { // 退出总览模式：清理 inline 残留（只清一次，用标记防重复）
      if (fitAll._wasOn) {
        cards.forEach(clearOne);
        fitAll._wasOn = false;
      }
      return;
    }
    fitAll._wasOn = true;
    cards.forEach(fitOne);
  }
  setInterval(fitAll, 600);
  window.addEventListener('resize', fitAll);
  // DOM 变化即时响应（新卡片出现/引擎重渲染）
  new MutationObserver(function () { fitAll(); })
    .observe(document.body, { childList: true, subtree: true });
})();
