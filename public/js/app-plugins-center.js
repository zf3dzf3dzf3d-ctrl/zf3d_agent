/* 插件中心 — 磁盘清理（白名单目录：回收站/归档/冒烟残留/pyc 缓存） */
(function () {
    'use strict';

    function _T(s) { try { return (window.I18N && window.I18N.t) ? window.I18N.t(s) : s; } catch (e) { return s; } }
    function fmt(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB'; }

    function card(t) {
        var btn;
        if (t.size <= 0) {
            btn = '<button class="btn ghost" disabled style="white-space:nowrap;flex-shrink:0;font-size:12px;">✅ ' + _T('干净') + '</button>';
        } else {
            btn = '<button class="btn btn-primary pc-clean-btn" data-key="' + t.key + '" style="white-space:nowrap;flex-shrink:0;font-size:12px;">🧹 ' + _T('清理') + ' (' + fmt(t.size) + ')</button>';
        }
        return '<div class="pc-card" data-key="' + t.key + '" style="border:1px solid var(--border,#ddd);border-radius:8px;padding:10px 14px;margin-bottom:10px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
            '<div style="font-size:13px;">' + t.label + '<span style="font-size:11px;color:var(--text2);margin-left:8px;">' + t.count + ' ' + _T('项') + '</span></div>' +
            btn + '</div></div>';
    }

    async function load() {
        var list = document.getElementById('pluginCenterList');
        if (!list) return;
        try {
            const r = await fetch('/api/plugins/center/status', { method: 'POST' });
            const d = await r.json();
            if (!d.ok) { list.innerHTML = '<div style="font-size:12px;color:var(--text2);">加载失败：' + (d.error || '') + '</div>'; return; }
            list.innerHTML = d.targets.map(card).join('');
            list.querySelectorAll('.pc-clean-btn').forEach(function (btn) {
                btn.addEventListener('click', function () { clean(btn.dataset.key, btn); });
            });
        } catch (e) {
            list.innerHTML = '<div style="font-size:12px;color:var(--text2);">加载失败：' + e + '</div>';
        }
    }

    async function clean(key, btn) {
        if (!confirm(_T('确认清理该类目？此操作不可恢复。'))) return;
        btn.disabled = true;
        btn.textContent = _T('清理中…');
        try {
            const r = await fetch('/api/plugins/center/clean', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key })
            });
            const d = await r.json();
            if (d.ok) {
                window.showToast && showToast(d.note || '清理完成', 'success');
            } else {
                window.showToast && showToast('清理失败：' + (d.error || '未知错误'), 'error');
            }
        } catch (e) {
            window.showToast && showToast('清理失败：' + e, 'error');
        }
        load();
    }

    // 设置面板打开后延迟挂载（面板 DOM 由 dom-settings-panel.js 注入）
    function watch() {
        var panel = document.getElementById('settingsPanel-components');
        if (panel && !document.getElementById('pluginCenterList')) {
            var sec = document.createElement('div');
            sec.style.cssText = 'margin-top:18px;border-top:1px solid var(--border,#ddd);padding-top:14px;';
            sec.innerHTML = '<div style="font-weight:600;margin-bottom:6px;">🧹 ' + _T('磁盘清理（插件中心）') + '</div>' +
                '<div style="font-size:12px;color:var(--text2);margin-bottom:10px;">' + _T('清理测试残留与缓存，释放磁盘空间。仅限白名单目录，不影响功能与用户数据。') + '</div>' +
                '<div id="pluginCenterList"></div>';
            panel.appendChild(sec);
            load();
        }
        if (panel && !document.getElementById('pluginOndemandList')) {
            var od = document.createElement('div');
            od.style.cssText = 'margin-top:18px;border-top:1px solid var(--border,#ddd);padding-top:14px;';
            od.innerHTML = '<div style="font-weight:600;margin-bottom:6px;">📦 ' + _T('按需插件（下载安装）') + '</div>' +
                '<div style="font-size:12px;color:var(--text2);margin-bottom:10px;">' + _T('大体积扩展组件按需下载安装，卸载即释放空间。本体必需的 Python 运行时不受影响。') + '</div>' +
                '<div id="pluginOndemandList"><div style="font-size:12px;color:var(--text2);">加载中…</div></div>';
            panel.appendChild(od);
            if (window.App && App.refreshOndemandPlugins) App.refreshOndemandPlugins();
        }
        setTimeout(watch, 1500);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watch);
    } else {
        watch();
    }
})();
