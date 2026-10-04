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

    /* ===== 按需插件：大体积目录按需安装/卸载 ===== */
    const OD_API = '/api/plugins/ondemand/';

    async function odFetch(action, body) {
        try {
            const r = await fetch(OD_API + action, {
                method: 'POST',
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined
            });
            return await r.json();
        } catch (e) { return { ok: false, error: String(e) }; }
    }

    function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }

    async function odInstall(key, btn, tip) {
        btn.disabled = true; btn.textContent = '安装中…';
        const d = await odFetch('install', { key: key });
        window.showToast && showToast(d.ok ? (d.note || '安装成功') : ('安装失败：' + (d.error || '未知错误')), d.ok ? 'success' : 'error');
        await odRefresh();
    }

    async function odUninstall(key, btn, tip) {
        if (!confirm('确定卸载该插件并释放磁盘空间？卸载后可随时重新安装。')) return;
        btn.disabled = true; btn.textContent = '卸载中…';
        const d = await odFetch('uninstall', { key: key });
        window.showToast && showToast(d.ok ? (d.note || '已卸载') : ('卸载失败：' + (d.error || '未知错误')), d.ok ? 'success' : 'error');
        await odRefresh();
    }

    async function odRefresh() {
        const box = document.getElementById('pluginOndemandList');
        if (!box) return;
        const st = await odFetch('status');
        if (!st || !st.ok) { box.innerHTML = '<div style="color:var(--text2);font-size:12px;">无法获取按需插件状态</div>'; return; }
        box.innerHTML = '';
        (st.plugins || []).forEach(p => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);';
            const info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';
            info.innerHTML = '<div style="font-size:13px;font-weight:bold;">' + p.name +
                ' <span style="font-weight:normal;color:var(--text2);font-size:11px;">(' + fmtMB(p.sizeHint) + ')</span></div>' +
                '<div style="font-size:11px;color:var(--text2);">' + p.desc + '</div>';
            const btn = document.createElement('button');
            btn.style.cssText = 'padding:4px 12px;font-size:12px;cursor:pointer;white-space:nowrap;';
            if (p.installed) {
                btn.textContent = '✅ 已安装 · 卸载';
                btn.disabled = false;
                btn.onclick = () => odUninstall(p.key, btn);
            } else if (!p.sourceAvailable) {
                btn.textContent = '不可用';
                btn.disabled = true;
            } else {
                btn.textContent = '⬇️ 安装';
                btn.disabled = false;
                btn.onclick = () => odInstall(p.key, btn);
            }
            row.appendChild(info); row.appendChild(btn);
            box.appendChild(row);
        });
    }

    window.App = window.App || {};
    App.installAudioVideoPlugin = install;
    App.refreshPluginStatus = refresh;
    App.refreshOndemandPlugins = odRefresh;

    // 设置面板打开时刷新状态
    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('settingsOverlay');
        if (!overlay) return;
        const mo = new MutationObserver(() => {
            if (overlay.classList.contains('show')) { refresh(); odRefresh(); }
        });
        mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    });
})();
