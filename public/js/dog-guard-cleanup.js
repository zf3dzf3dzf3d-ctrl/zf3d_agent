/* dog-guard-cleanup.js — 修复“安全助手(小狗守卫)打开后无法关闭”
 * 背景：app-dog-guard.js / dog-guard-chat.js 已被移除（备份于 private/备份/dog-guard-移除备份/），
 * 但历史会话的 localStorage（dogGuardEnabled=1）与残留 DOM 仍会让守卫按钮/面板出现且无法关闭。
 * 本脚本：1) 清除开启标记并持久化；2) 移除残留按钮与面板 DOM；3) 若按钮将来被其它代码重建，也自动再次移除。
 */
(function () {
    'use strict';
    if (window.__DOG_GUARD_CLEANUP__) return;
    window.__DOG_GUARD_CLEANUP__ = true;

    var SET_KEY = 'dogGuardEnabled';

    function clearFlag() {
        try {
            localStorage.removeItem(SET_KEY);
            localStorage.setItem(SET_KEY, '0');
            localStorage.removeItem('dogGuardX');
            localStorage.removeItem('dogGuardY');
        } catch (e) { }
    }

    function cleanup() {
        // 1) 残留按钮
        var btn = document.getElementById('dogGuardBtn');
        if (btn) {
            btn.classList.remove('dog-guard-btn--on');
            btn.style.display = 'none';
            btn.setAttribute('aria-pressed', 'false');
            // 若其行容器整体只为守卫服务，则整行隐藏
            var row = btn.closest('.studio-switch-row, .zf-dock-btn-wrap, li, .switch-row');
            if (row && row !== document.body) row.style.display = 'none';
        }
        // 2) 残留面板/悬浮窗（dog guard 聊天面板等）
        var panelIds = ['dogGuardPanel', 'dogGuardChatPanel', 'dog-guard-panel', 'dogChatPanel'];
        panelIds.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('.dog-guard-panel, .dog-guard-chat, [data-dog-guard-panel]').forEach(function (el) { el.remove(); });
        // 3) 记录全局引用清空，避免其它脚本误用
        try { if (window.App) { window.App._dogGuardEl = null; } } catch (e) { }
    }

    clearFlag();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanup);
    } else {
        cleanup();
    }
    // 兜底：按钮/面板被其它脚本重建时自动再清
    setInterval(cleanup, 3000);
    try {
        new MutationObserver(function () { cleanup(); }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { }
})();
