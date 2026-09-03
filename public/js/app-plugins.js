/* 插件管理 — 录音/录像可选插件（默认不随程序分发，用户点击安装后启用） */
(function () {
    'use strict';

    async function fetchStatus() {
        try {
            const r = await fetch('/api/plugins/audio-video/status', { method: 'POST' });
            return await r.json();
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    }

    function render(st) {
        const btn = document.getElementById('pluginAvBtn');
        const tip = document.getElementById('pluginAvStatus');
        if (!btn || !tip) return;
        if (!st || !st.ok) {
            btn.textContent = '状态未知';
            btn.disabled = true;
            tip.textContent = '无法获取插件状态：' + (st && st.error ? st.error : '未知错误');
            return;
        }
        if (st.installed) {
            btn.textContent = '✅ 已安装';
            btn.disabled = true;
            tip.textContent = '录音、录屏功能已可用。';
        } else if (!st.sourceAvailable) {
            btn.textContent = '不可用';
            btn.disabled = true;
            tip.textContent = '本程序未携带插件包（plugins/audio-video-plugin 缺失），请从官方完整包获取。';
        } else {
            btn.textContent = '⬇️ 下载安装';
            btn.disabled = false;
            tip.textContent = '尚未安装。点击按钮启用录音/录像功能（约需数秒，安装后需重启程序生效）。';
        }
    }

    async function install() {
        const btn = document.getElementById('pluginAvBtn');
        const tip = document.getElementById('pluginAvStatus');
        if (!btn || btn.disabled) return;
        btn.textContent = '安装中…';
        btn.disabled = true;
        if (tip) tip.textContent = '正在安装插件，请稍候…';
        try {
            const r = await fetch('/api/plugins/audio-video/install', { method: 'POST' });
            const data = await r.json();
            if (data.ok) {
                window.showToast && showToast('录音/录像插件安装成功，重启程序后生效', 'success');
            } else {
                window.showToast && showToast('插件安装失败：' + (data.error || '未知错误'), 'error');
            }
        } catch (e) {
            window.showToast && showToast('插件安装失败：' + e, 'error');
        }
        render(await fetchStatus());
    }

    async function refresh() { render(await fetchStatus()); }

    window.App = window.App || {};
    App.installAudioVideoPlugin = install;
    App.refreshPluginStatus = refresh;

    // 设置面板打开时刷新状态
    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('settingsOverlay');
        if (!overlay) return;
        const mo = new MutationObserver(() => {
            if (overlay.classList.contains('show')) refresh();
        });
        mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    });
})();
