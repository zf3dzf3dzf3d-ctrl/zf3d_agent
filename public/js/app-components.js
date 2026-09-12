/* 组件下载 — 设置面板（首次安装可选组件，用户在设置面板自行选择下载，无需点 .bat） */
(function () {
    'use strict';

    const GROUP_NAMES = {}; // 由 status 返回填充

    async function fetchStatus() {
        try {
            const r = await fetch('/api/components/status', { method: 'POST' });
            return await r.json();
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    }

    function row(g) {
        return '<div class="comp-card" data-key="' + g.key + '" style="border:1px solid var(--border,#ddd);border-radius:8px;padding:14px 16px;margin-bottom:12px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
            '<div><div style="font-weight:600;">' + g.name + '</div>' +
            '<div style="font-size:12px;color:var(--text2);margin-top:4px;">' + g.desc + '</div></div>' +
            '<button class="btn btn-primary comp-btn" data-key="' + g.key + '" style="white-space:nowrap;flex-shrink:0;">检测中…</button>' +
            '</div>' +
            '<div class="comp-tip" style="font-size:12px;color:var(--text2);margin-top:8px;"></div>' +
            '</div>';
    }

    function render(st) {
        const list = document.getElementById('componentsList');
        if (!list) return;
        if (!st || !st.ok) {
            list.innerHTML = '<div style="color:var(--text2);font-size:13px;">无法获取组件状态：' + (st && st.error ? st.error : '未知错误') + '</div>';
            return;
        }
        list.innerHTML = st.groups.map(row).join('');
        st.groups.forEach(g => updateRow(g));
        list.querySelectorAll('.comp-btn').forEach(btn => {
            btn.addEventListener('click', () => install(btn.dataset.key));
        });
    }

    function updateRow(g) {
        const card = document.querySelector('.comp-card[data-key="' + g.key + '"]');
        if (!card) return;
        const btn = card.querySelector('.comp-btn');
        const tip = card.querySelector('.comp-tip');
        if (g.checking) {
            btn.textContent = '检测中…';
            btn.disabled = true;
            tip.textContent = '';
            return;
        }
        if (g.installed) {
            btn.textContent = '✅ 已安装';
            btn.disabled = true;
            tip.textContent = '已就绪。';
        } else {
            btn.textContent = '⬇️ 下载安装';
            btn.disabled = false;
            tip.textContent = '未安装（缺少：' + (g.missing || []).join(', ') + '）。点击在线安装（使用国内镜像加速）。';
        }
    }

    async function install(key) {
        const btn = document.querySelector('.comp-btn[data-key="' + key + '"]');
        const card = document.querySelector('.comp-card[data-key="' + key + '"]');
        const tip = card ? card.querySelector('.comp-tip') : null;
        if (btn) { btn.textContent = '安装中…'; btn.disabled = true; }
        if (tip) tip.textContent = '正在后台安装，可能需要几分钟，可点「查看日志」看进度…';
        try {
            const r = await fetch('/api/components/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key })
            });
            const d = await r.json();
            if (!d.ok && tip) tip.textContent = '安装请求失败：' + (d.error || '未知错误');
        } catch (e) {
            if (tip) tip.textContent = '安装请求失败：' + String(e);
        }
    }

    async function showLog() {
        const box = document.getElementById('componentsLog');
        if (!box) return;
        box.style.display = 'block';
        try {
            const r = await fetch('/api/components/log');
            const d = await r.json();
            box.textContent = d.log || '（暂无日志）';
            if (d.running) setTimeout(showLog, 3000);
        } catch (e) {
            box.textContent = '读取日志失败：' + String(e);
        }
    }

    async function refresh() {
        const st = await fetchStatus();
        render(st);
    }

    window.App = window.App || {};
    App.refreshComponents = refresh;
    App.showComponentsLog = showLog;

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
