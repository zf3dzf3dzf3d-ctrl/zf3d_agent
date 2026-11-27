// 插件管理面板（设置面板 → 🧩插件管理）
// 数据源：/api/plugin-manager/list 与 enable|disable|reload|status|config（参数走 query，?id=xxx）
// token：经 /api/plugin-manager/local-token（仅本机回环发放）
// 【注】server do_POST 入口 _drain_body 排干请求体，故本面板 POST 一律不用 body。
(function () {
    'use strict';
    var _token = null;
    // 【低调搜索】插件页签搜索框（#pluginMgrSearch）：同时过滤 i桌面 Dock 程序与后端插件两个列表
    var _query = '';        // 当前搜索词（小写）
    var _lastList = null;   // 最近一次 /list 接口数据缓存，键入时免重发请求即可重过滤
    var _searchTimer = null;

    function hit(text) {
        return !_query || String(text || '').toLowerCase().indexOf(_query) > -1;
    }

    function bindSearch() {
        var input = document.getElementById('pluginMgrSearch');
        if (!input || input._zfSearchBound) return;
        input._zfSearchBound = true;
        input.addEventListener('input', function () {
            _query = String(this.value || '').trim().toLowerCase();
            if (_searchTimer) clearTimeout(_searchTimer);
            _searchTimer = setTimeout(function () {
                // render 内部会连带重绘 Dock 列表；无缓存数据时不动作（等 load 完成自然带出）
                if (_lastList) render(null, _lastList);
                else renderDockApps();
            }, 140);
        });
    }

    function qs(o) {
        var a = [];
        for (var k in o) if (o[k] !== undefined && o[k] !== null) a.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k]));
        return a.length ? ('?' + a.join('&')) : '';
    }

    function api(path, params, cb) {
        fetch('/api/plugin-manager/' + path + qs(params), {
            method: 'POST',
            headers: { 'X-Plugin-Token': _token || '' }
        }).then(function (r) {
            if (r.status === 403) throw new Error('无权限(403)：token 校验失败');
            return r.json();
        }).then(function (j) { cb(null, j); }).catch(function (e) { cb(e); });
    }

    function ensureToken(cb) {
        if (_token) return cb();
        fetch('/api/plugin-manager/local-token').then(function (r) {
            if (!r.ok) throw new Error('token 端点不可用(' + r.status + ')，请确认 server 已重启生效');
            return r.json();
        }).then(function (j) {
            if (!j || !j.ok || !j.token) throw new Error('token 发放失败');
            _token = j.token; cb();
        }).catch(function (e) { cb(e); });
    }

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* 【2026-11-17 方案A】i桌面 Dock 程序显隐管理区块（同 key zfDockHiddenApps，与 i无限面板拖拽互通；
       如实标注：隐藏≠卸载，JS 逻辑仍可用，仅 Dock 不显示图标） */
    function renderDockApps() {
        var box = document.getElementById('dockAppsList');
        if (!box || !window.ZFDock || !window.ZFDock.apps) return;
        var apps = (window.ZFDock.apps() || []).filter(function (a) {
            return hit(a.name) || hit(a.id);
        });
        var hid = window.ZFDock.hiddenApps ? window.ZFDock.hiddenApps() : [];
        if (!apps.length) {
            box.innerHTML = '<div class="settings-fs-12" style="color:var(--text2);">' +
                (_query ? '无匹配「' + esc(_query) + '」的 Dock 程序' : 'Dock 尚未加载完成，稍后重开本页可见') + '</div>';
            return;
        }
        var html = '';
        apps.forEach(function (a) {
            var shown = hid.indexOf(a.id) < 0;
            html += '<div class="email-toggle-field" style="background:rgba(127,127,127,.08);border-radius:8px;padding:6px 10px;margin-bottom:4px;font-size:12px;">' +
                '<span class="email-toggle-info"><span class="email-toggle-title" style="font-size:12px;font-weight:400;">' + esc(a.name || a.id) +
                ' <span style="color:#999;font-size:11px;">' + a.id + '</span></span>' +
                '<div style="font-size:11px;color:' + (shown ? '#27ae60' : '#999') + ';margin-top:2px;">' +
                (shown ? '● 显示中' : '○ 已隐藏（未卸载）') + '</div></span>' +
                '<span class="email-toggle-control"><label class="email-toggle-wrapper" title="切换 Dock 显示">' +
                '<input type="checkbox" class="email-toggle-checkbox" data-da-id="' + a.id + '"' + (shown ? ' checked' : '') + '>' +
                '<span class="email-toggle-track"><span class="email-toggle-thumb"></span></span>' +
                '</label></span></div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('input[data-da-id]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                window.ZFDock.setHidden(cb.getAttribute('data-da-id'), cb.checked);
                renderDockApps();
            });
        });
    }

    function render(err, j) {
        var box = document.getElementById('pluginMgrList');
        if (!box) return;
        if (err) {
            box.innerHTML = '<div style="color:#e74c3c;font-size:12px;">加载失败：' + esc(err.message) + '</div>';
            return;
        }
        _lastList = j;
        var list = ((j && j.plugins) || []).filter(function (p) {
            return hit(p.id) || hit(p.name) || hit(p.description) || hit(p.type);
        });
        renderDockApps();
        if (!list.length) {
            box.innerHTML = '<div style="font-size:12px;color:#888;">' +
                (_query ? '无匹配「' + esc(_query) + '」的后端插件' : '未列出插件（接口返回空）') + '</div>';
            return;
        }
        var html = '';
        // 搜索时隐藏启用/禁用说明长文，减少噪音
        if (!_query) {
            html += '<div style="font-size:11px;color:#888;line-height:1.7;padding:4px 10px 10px;">' +
                '✅ <b>启用</b>：插件立即注册其工具/端点并生效（写入配置，重启后保持开启）；' +
                '⛔ <b>禁用</b>：立即卸载该插件提供的全部功能（持久化，重启后保持关闭）。' +
                '系统核心功能插件（文件工具/旧轨桥接/主脑/插件管理器）建议保持启用，演示类可随意关闭。</div>';
        }
        list.forEach(function (p) {
            var id = p.id || '';
            var cname = p.name && p.name !== id ? p.name : '';
            var enabled = p.status === 'enabled';
            var meta = p.version ? ('v' + p.version + (p.type ? ' · ' + p.type : '')) : (p.type || '');
            var dline = p.description || '';
            var errTip = p.error ? (' <span style="color:#e67e22;font-size:11px;">⚠ ' + esc(p.error) + '</span>') : '';
            html += '<div style="padding:8px 10px;margin-bottom:6px;background:rgba(127,127,127,.08);border-radius:8px;">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:13px;font-weight:600;">🧩 ' + (cname ? esc(cname) + ' <span style="font-weight:400;color:#999;font-size:11px;">' + esc(id) + '</span>' : esc(id)) +
                ' <span style="font-size:11px;font-weight:400;color:' + (enabled ? '#27ae60' : '#999') + '">' +
                (enabled ? '● 已启用' : '○ 已禁用') + '</span>' +
                (p.core ? ' <span style="font-size:10px;color:#fff;background:#8e44ad;padding:1px 6px;border-radius:4px;">核心</span>' : '') + errTip + '</div>' +
                (dline ? '<div style="font-size:12px;color:#666;line-height:1.5;margin-top:3px;">' + esc(dline) + '</div>' : '') +
                (meta ? '<div style="font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(meta) + '</div>' : '') +
                '</div>' +
                '<button data-pm-act="toggle" data-pm-id="' + esc(id) + '" data-pm-enabled="' + (enabled ? 1 : 0) + '"' +
                (p.core ? ' title="核心插件不可禁用（管理API自锁保护）" style="padding:4px 12px;font-size:12px;border:none;border-radius:6px;cursor:not-allowed;background:#ccc;color:#888;" disabled' :
                ' style="padding:4px 12px;font-size:12px;border:none;border-radius:6px;cursor:pointer;position:relative;z-index:1;' +
                (enabled ? 'background:#e67e22;color:#fff;' : 'background:#27ae60;color:#fff;') + '"') + '>' +
                (enabled ? (p.core ? '核心' : '禁用') : '启用') + '</button>' +
                '<button data-pm-act="reload" data-pm-id="' + esc(id) + '"' +
                ' style="padding:4px 10px;font-size:12px;border:none;border-radius:6px;cursor:pointer;position:relative;z-index:1;background:#4a90d9;color:#fff;">重载</button>' +
                '</div></div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('button[data-pm-act]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-pm-id');
                var act = btn.getAttribute('data-pm-act');
                btn.disabled = true;
                btn.textContent = '…';
                function done(e2) {
                    if (e2) { alert('操作失败：' + e2.message); }
                    load();
                }
                if (act === 'reload') {
                    api('reload', { id: id }, done);
                } else {
                    var enable = btn.getAttribute('data-pm-enabled') !== '1';
                    api(enable ? 'enable' : 'disable', { id: id }, done);
                }
            });
        });
    }

    function load() {
        bindSearch();
        ensureToken(function (e) {
            if (e) { render(e); return; }
            fetch('/api/plugin-manager/list', { headers: { 'X-Plugin-Token': _token } })
                .then(function (r) { return r.json(); })
                .then(function (j) { render(null, j); })
                .catch(function (e) { render(e); });
        });
    }

    window.PluginManagerPanel = { init: load, load: load };
})();
