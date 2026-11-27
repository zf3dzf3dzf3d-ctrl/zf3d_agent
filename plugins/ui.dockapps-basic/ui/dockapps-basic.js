/* ui.dockapps-basic —— Dock 第一波 4 程序（R1-2，策划案v4 T1）
 * 与主文件解耦：只经 window.ZFDockBridge {register, createAppWindow, zfVerSrc,
 * prefetchAppJs} 交互；本文件由 ui-mounts 装载器在 DOMContentLoaded 后注入
 * （晚于 zf-app-dock.js 静态执行，桥必然就绪）。
 * 搬运来源：zf-app-dock.js 冻结区对应分支（逻辑零改动，仅容器换桥）。
 */
(function () {
  'use strict';
  var b = window.ZFDockBridge;
  if (!b || !b.register || !b.createAppWindow) {
    console.warn('[ui.dockapps-basic] ZFDockBridge 未就绪，跳过');
    return;
  }
  var register = b.register, createAppWindow = b.createAppWindow,
      zfVerSrc = b.zfVerSrc, prefetchAppJs = b.prefetchAppJs;

  /* ---------- i模型生成（复用 /api/igen 桥接层） ---------- */
  var ICON_IGEN = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
  var igenWin = null;
  function openIgen() {
    if (!igenWin) {
      igenWin = createAppWindow({
        id: 'zfIgenWin',
        title: 'i模型生成',
        icon: ICON_IGEN,
        bodyHtml: '<div id="zfIgenBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFIgen && window.ZFIgen.onClose) window.ZFIgen.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(igenWin);
    }
    igenWin.classList.add('open');
    var body = igenWin.querySelector('#zfIgenBody');
    if (body) {
      if (!body.dataset.zfigenMounted) {
        body.dataset.zfigenMounted = '1';
        var s = document.createElement('script');
        s.src = zfVerSrc('js/zf-app-igen.js');
        s.onload = function () { if (window.ZFIgen && window.ZFIgen.onOpen) window.ZFIgen.onOpen(body); };
        document.head.appendChild(s);
      } else if (window.ZFIgen) {
        window.ZFIgen.onOpen(body);
      }
    }
  }
  register({
    id: 'igen-app',
    name: 'i模型生成',
    icon: ICON_IGEN,
    onClick: function () {
      if (igenWin && igenWin.classList.contains('open')) { if (window.ZFIgen && window.ZFIgen.onClose) window.ZFIgen.onClose(); igenWin.classList.remove('open'); } else { openIgen(); }
    }
  });

  /* ---------- i网页（S1+S2 垂直切片） ---------- */
  /* 【2026-11-17 图标去重】双链环语义=网页链接 */
  var ICON_WEB = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5a4.5 4.5 0 0 0 6.7.4l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.7-.4l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/></svg>';
  var webWin = null;
  function openWeb() {
    if (!webWin) {
      webWin = createAppWindow({
        id: 'zfWebWin',
        title: 'i网页',
        icon: ICON_WEB,
        bodyHtml: '<div id="zfWebBody" style="flex:1;overflow:hidden;display:flex;"></div>',
        onClose: function (w) { if (window.ZFWeb && window.ZFWeb.onClose) window.ZFWeb.onClose(); w.classList.remove('open'); }
      });
      document.body.appendChild(webWin);
    }
    webWin.classList.add('open');
    var webBody = webWin.querySelector('#zfWebBody');
    if (webBody) {
      if (!webBody.dataset.zfwMounted) {
        webBody.dataset.zfwMounted = '1';
        var sw = document.createElement('script');
        sw.src = zfVerSrc('js/zf-app-web.js');  /* 固定版本号：命中浏览器缓存（旧 Date.now() 每次强制重新下载，打开慢主因） */
        sw.onload = function () { if (window.ZFWeb && window.ZFWeb.onOpen) window.ZFWeb.onOpen(webBody); };
        document.head.appendChild(sw);
      } else if (window.ZFWeb) {
        window.ZFWeb.onOpen(webBody);
      }
    }
  }
  /* 【2026-11-19 初始提速】dock 空闲预取（逻辑随搬运保留） */
  if (prefetchAppJs) prefetchAppJs(['js/zf-app-web.js']);
  register({
    id: 'web-app',
    name: 'i网页',
    icon: ICON_WEB,
    onClick: function () {
      if (webWin && webWin.classList.contains('open')) { if (window.ZFWeb && window.ZFWeb.onClose) window.ZFWeb.onClose(); webWin.classList.remove('open'); } else { openWeb(); }
    }
  });

  /* ---------- i设置（独立桌面图标：打开设置面板/模型配置） ---------- */
  register({
    id: 'app-settings',
    name: 'i设置',
    icon: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#e8e8ee" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.51-1 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    onClick: function () {
      /* 【统一交互】点击打开，再点关闭（与各 App 窗口一致） */
      var ov = document.getElementById('settingsOverlay');
      if (ov && ov.classList.contains('show')) { ov.classList.remove('show'); return; }
      if (window.App && window.App.openSettingsPanel) window.App.openSettingsPanel('models');
      else if (ov) ov.classList.add('show');
    }
  });

  /* ---------- 新建对话（画布双击 openDualPanels 面板的 Dock 入口） ---------- */
  register({
    id: 'new-chat',
    name: '新建对话',
    icon: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#e8e8ee" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    onClick: function () {
      var existed = document.querySelector('.kite-dual-create-panel');
      if (existed) { existed.remove(); return; }
      /* 位置：屏幕底部居中（Dock 正上方），面板内部自行换算画布坐标系 */
      var x = Math.max(20, (window.innerWidth - 320) / 2);
      var y = window.innerHeight - 420;
      if (y < 80) y = 80;
      if (window.KiteCanvas && typeof KiteCanvas.openDualPanels === 'function') {
        KiteCanvas.openDualPanels(x, y);
      } else if (window.App && App._toast) {
        App._toast('画布组件未加载完成，请刷新页面后重试', 'warn');
      }
    }
  });
})();
