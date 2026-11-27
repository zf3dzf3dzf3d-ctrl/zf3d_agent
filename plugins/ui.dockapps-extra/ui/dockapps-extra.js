/* ============================================================
 * zf-app-dock-apps.js - Dock 独立小应用注册段（S4 拆分 2026-11-30）
 * 从 zf-app-dock.js 2838-2931 行原样抽出：i采集/i授权/i密室 三个 dock 应用。
 * 通过 window.ZFDockBridge {register, createAppWindow} 与主文件解耦；
 * 必须在 zf-app-dock.js 之后加载（依赖 ZFDockBridge）。
 * ============================================================ */
(function () {
    'use strict';
    var bridge = window.ZFDockBridge;
    if (!bridge || !bridge.register || !bridge.createAppWindow) { console.warn('[zf-app-dock-apps] ZFDockBridge 未就绪，跳过'); return; }
    var register = bridge.register, createAppWindow = bridge.createAppWindow;
    /* ---------- i采集（通用网页采集，甩网址→AI 自动归档） ---------- */
    var ICON_COLLECT = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
    var collectWin = null;
    function openCollect() {
      if (!collectWin) {
        collectWin = createAppWindow({
          id: 'zfCollectWin',
          title: 'i采集',
          icon: ICON_COLLECT,
          bodyHtml: '<div id="zfCollectBody" style="flex:1;overflow:hidden;display:flex;"></div>',
          onClose: function (w) { w.classList.remove('open'); }
        });
        document.body.appendChild(collectWin);
      }
      collectWin.classList.add('open');
      var body = collectWin.querySelector('#zfCollectBody');
      if (!body) return;
      if (window.ZFCollect && window.ZFCollect.onOpen) { window.ZFCollect.onOpen(body); return; }
      /* 动态加载 zf-app-collect.js（与 i模型生成 同款模式） */
      var s = document.createElement('script');
      s.src = 'js/zf-app-collect.js?v=1';
      s.onload = function () { if (window.ZFCollect && window.ZFCollect.onOpen) window.ZFCollect.onOpen(body); };
      document.head.appendChild(s);
    }
    register({
      id: 'collect-app',
      name: 'i采集',
      icon: ICON_COLLECT,
      onClick: function () {
        if (collectWin && collectWin.classList.contains('open')) { collectWin.classList.remove('open'); } else { openCollect(); }
      }
    });
    /* ---------- i授权（网页 AI 授权问答，/api/iauth 桥接层） ---------- */
    var ICON_IAUTH = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.6"/></svg>';
    var iauthWin = null;
    function openIauth() {
      if (!iauthWin) {
        iauthWin = createAppWindow({
          id: 'zfIauthWin',
          title: 'i授权',
          icon: ICON_IAUTH,
          bodyHtml: '<div id="zfIauthBody" style="flex:1;overflow:hidden;display:flex;"></div>',
          onClose: function (w) { if (window.ZFIauth && window.ZFIauth.onClose) window.ZFIauth.onClose(); w.classList.remove('open'); }
        });
        document.body.appendChild(iauthWin);
      }
      iauthWin.classList.add('open');
      var body = iauthWin.querySelector('#zfIauthBody');
      if (!body) return;
      if (window.ZFIauth && window.ZFIauth.onOpen) { window.ZFIauth.onOpen(body); return; }
      var s = document.createElement('script');
      s.src = 'js/zf-app-iauth.js?v=1';
      s.onload = function () { if (window.ZFIauth && window.ZFIauth.onOpen) window.ZFIauth.onOpen(body); };
      document.head.appendChild(s);
    }
    register({
      id: 'iauth-app',
      name: 'i授权',
      icon: ICON_IAUTH,
      onClick: function () {
        if (iauthWin && iauthWin.classList.contains('open')) { iauthWin.classList.remove('open'); } else { openIauth(); }
      }
    });
    /* ---------- i密室（每局程序生成关卡，服务端判定防泄底） ---------- */
    var ICON_ESCAPE = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="15.5" cy="12" r="2.2"/><path d="M15.5 14.2V17M12 8h-4M8 12h2"/></svg>';
    var escapeWin = null;
    function openEscape() {
      if (!escapeWin) {
        escapeWin = createAppWindow({
          id: 'zfEscapeWin',
          title: 'i密室',
          icon: ICON_ESCAPE,
          bodyHtml: '<div id="zfEscapeBody" style="flex:1;overflow:hidden;display:flex;"></div>',
          onClose: function (w) { w.classList.remove('open'); }
        });
        document.body.appendChild(escapeWin);
      }
      escapeWin.classList.add('open');
      var body = escapeWin.querySelector('#zfEscapeBody');
      if (!body) return;
      if (window.ZFEscape && window.ZFEscape.onOpen) { window.ZFEscape.onOpen(body); return; }
      var s = document.createElement('script');
      s.src = 'js/zf-app-escape.js?v=4';
      s.onload = function () { if (window.ZFEscape && window.ZFEscape.onOpen) window.ZFEscape.onOpen(body); };
      document.head.appendChild(s);
    }
    register({
      id: 'escape-app',
      name: 'i密室',
      icon: ICON_ESCAPE,
      onClick: function () {
        if (escapeWin && escapeWin.classList.contains('open')) { escapeWin.classList.remove('open'); } else { openEscape(); }
      }
    });
})();
