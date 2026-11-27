/* ============================================================
 * ui.matrix-board —— Dock 独立小应用：i进化看板（charlie 2026-11-27）
 * 通过 window.ZFDockBridge {register, createAppWindow} 与主文件解耦；
 * 必须在 zf-app-dock.js 之后加载（依赖 ZFDockBridge），同 dockapps-extra 模式。
 * 窗口内容 = iframe 内嵌 /api/matrix/board?view=html（自带 10s 自动刷新）。
 * ============================================================ */
(function () {
    'use strict';
    var bridge = window.ZFDockBridge;
    if (!bridge || !bridge.register || !bridge.createAppWindow) { console.warn('[matrix-board] ZFDockBridge 未就绪，跳过'); return; }
    var register = bridge.register, createAppWindow = bridge.createAppWindow;
    /* 仪表盘图标：表盘+心跳线 */
    var ICON_BOARD = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M6 12l2.5-3 2 2.5L13 8l2 3h3"/><path d="M9 21h6M12 17v4"/></svg>';
    var boardWin = null;
    function openBoard() {
        if (!boardWin) {
            boardWin = createAppWindow({
                id: 'zfMatrixBoardWin',
                title: 'i进化看板',
                icon: ICON_BOARD,
                bodyHtml: '<div id="zfMatrixBoardBody" style="flex:1;overflow:hidden;display:flex;background:#0d1117;">'
                    + '<iframe id="zfMatrixBoardFrame" src="/api/matrix/board?view=html" title="Matrix 进化看板" '
                    + 'style="flex:1;border:0;width:100%;height:100%;background:#0d1117;"></iframe></div>',
                onClose: function (w) { w.classList.remove('open'); }
            });
            document.body.appendChild(boardWin);
        }
        boardWin.classList.add('open');
    }
    register({
        id: 'matrix-board-app',
        name: 'i进化看板',
        icon: ICON_BOARD,
        onClick: function () {
            if (boardWin && boardWin.classList.contains('open')) { boardWin.classList.remove('open'); } else { openBoard(); }
        }
    });
})();
