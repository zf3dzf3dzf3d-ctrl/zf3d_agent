/* app-sync-btn.js — 双端同步按钮（电脑端）
 * 手机峰控在电脑外干活时，云端比本地新 → 每个 chatbox 标题栏亮「⬇ 同步」按钮，
 * 点击调 /api/zf3d/remote_sync?pull=1 把手机消息拉回本地 remote_ 会话并刷新。
 */
(function () {
    'use strict';
    if (window.__zfSyncBtn) return;
    window.__zfSyncBtn = true;

    var stale = false;
    var checking = false;

    function check() {
        if (checking) return;
        checking = true;
        fetch('/api/zf3d/remote_sync', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.ok) { stale = !!d.stale; refreshBtns(); }
            })
            .catch(function () {})
            .finally(function () { checking = false; });
    }

    function refreshBtns() {
        document.querySelectorAll('.chatbox-header-row1').forEach(function (row1) {
            var btn = row1.querySelector('.zf-sync-btn');
            if (stale) {
                if (!btn) {
                    btn = document.createElement('button');
                    btn.className = 'hd-btn zf-sync-btn';
                    btn.title = '手机峰控有新消息，点击同步到最新';
                    btn.textContent = '⬇';
                    btn.style.cssText = 'background:#f59e0b;color:#fff;font-weight:700;animation:zfSyncPulse 1.5s infinite;';
                    btn.addEventListener('click', function (e) {
                        e.stopPropagation(); e.preventDefault();
                        doSync(btn);
                    });
                    var closeBtn = row1.querySelector('.hd-btn.close');
                    row1.insertBefore(btn, closeBtn || row1.firstChild);
                }
                btn.style.display = '';
            } else if (btn) {
                btn.style.display = 'none';
            }
        });
    }

    function doSync(btn) {
        if (btn) { btn.textContent = '…'; btn.style.animation = 'none'; }
        fetch('/api/zf3d/remote_sync?pull=1', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                stale = false;
                refreshBtns();
                if (typeof window.showToast === 'function') {
                    window.showToast('同步完成：拉回 ' + ((d && d.pulled) || 0) + ' 条消息');
                } else {
                    console.log('[SyncBtn] 同步完成', d);
                }
                // 刷新当前打开会话的消息（触发历史重载）
                try { if (window.App && typeof App.refreshActiveChat === 'function') App.refreshActiveChat(); } catch (e) {}
                try { if (window.App && typeof App.loadHistory === 'function') App.loadHistory(); } catch (e) {}
                setTimeout(function () { if (btn) { btn.textContent = '⬇'; } }, 800);
            })
            .catch(function () {
                if (btn) { btn.textContent = '⬇'; btn.style.animation = ''; }
            });
    }

    function start() {
        // MutationObserver：动态新建的 chatbox 自动补按钮
        var mo = new MutationObserver(function () { refreshBtns(); });
        mo.observe(document.body, { childList: true, subtree: true });
        setInterval(check, 10000); // 10s 轻轮询版本号
        setTimeout(check, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // 动画样式
    if (!document.getElementById('zf-sync-btn-style')) {
        var st = document.createElement('style');
        st.id = 'zf-sync-btn-style';
        st.textContent = '@keyframes zfSyncPulse{0%,100%{opacity:1}50%{opacity:.5}}';
        document.head.appendChild(st);
    }
})();
