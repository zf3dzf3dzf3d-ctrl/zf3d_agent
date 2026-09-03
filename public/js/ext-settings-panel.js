// ============================================================
// ext-settings-panel.js — 设置面板「🔌 MCP」与「🎯 技能」双独立页
// （独立文件，删除即下线；主设置面板零污染，DOM 动态注入）
// 功能：
//   1. 🔌 MCP tab：MCP 网关总开关 + server 列表（启用/停用/测试/管理）
//   2. 🎯 技能 tab：技能包总开关 + 技能列表（启用/停用/管理）
// 入口：设置面板导航（本文件 build() 注入两个 nav 项）
// 依赖：panel-settings.js 的 switchSettingsTab('ext-mcp'|'ext-skills') 调用 init()
// ============================================================
(function () {
    'use strict';
    var P = window.ExtSettingsPanel = { _inited: false, settings: { mcp: true, skills: true } };

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    P.loadSettings = function () {
        return fetch('/api/ext/settings').then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) P.settings = d.settings || { mcp: true, skills: true };
            return P.settings;
        }).catch(function () { return P.settings; });
    };

    P.saveSetting = function (key, val) {
        P.settings[key] = val;
        var body = {}; body[key] = val;
        fetch('/api/ext/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.ok) { alert('保存失败'); return; }
                P.settings = d.settings;
                P.renderToggle(key);
                // 开关变更后刷新 MCP 工具注册（前端桥接即时生效）
                if (window.ExtBridge && ExtBridge.loadMcpTools) ExtBridge.loadMcpTools();
            });
    };

    function toggleRow(key, icon, title, desc) {
        var on = P.settings[key] !== false;
        return '<div class="extset-row" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--bg);">'
            + '<div><div style="font-weight:600;font-size:13px;">' + icon + ' ' + title + '</div>'
            + '<div style="font-size:11px;color:var(--text2);margin-top:2px;">' + desc + '</div></div>'
            + '<label style="cursor:pointer;display:flex;align-items:center;gap:8px;flex-shrink:0;">'
            + '<span style="font-size:12px;color:' + (on ? 'var(--green,#2ea043)' : 'var(--text2)') + ';">' + (on ? '已开启' : '已关闭') + '</span>'
            + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="ExtSettingsPanel.saveSetting(\'' + key + '\',this.checked)" style="width:18px;height:18px;cursor:pointer;">'
            + '</label></div>';
    }

    P.renderToggle = function (key) {
        var box = document.getElementById('extToggle-' + key);
        if (!box) return;
        if (key === 'mcp') {
            box.innerHTML = toggleRow('mcp', '🔌', 'MCP 网关总开关', '关闭后 MCP server 连接与外部工具调用全部停用，模型看不到任何 mcp_ 工具。');
        } else {
            box.innerHTML = toggleRow('skills', '🎯', '技能包总开关', '关闭后技能关键词匹配与提示词注入停用，技能文件夹仍保留。');
        }
    };

    // ---------- 🔐 MCP server 列表 ----------
    P.loadServers = function () {
        var box = document.getElementById('extSettingsServers');
        if (!box) return;
        fetch('/api/ext/mcp/servers').then(function (r) { return r.json(); }).then(function (d) {
            var list = (d && d.servers) || [];
            if (!list.length) { box.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:8px 0;">尚未配置 MCP server。点击下方按钮添加。</div>'; return; }
            box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
                + '<tr style="color:var(--text2);text-align:left;"><th style="padding:4px 6px;">名称</th><th>类型</th><th>状态</th><th style="width:150px;">操作</th></tr>'
                + list.map(function (s) {
                    var on = s.enabled !== false;
                    return '<tr><td style="padding:4px 6px;border-top:1px solid var(--border);"><b>' + esc(s.name) + '</b></td>'
                        + '<td style="border-top:1px solid var(--border);">' + esc(s.transport || s.type || 'http') + '</td>'
                        + '<td style="border-top:1px solid var(--border);">' + (on ? '<span style="color:var(--green,#2ea043);">启用</span>' : '<span style="color:var(--text2);">停用</span>') + '</td>'
                        + '<td style="border-top:1px solid var(--border);">'
                        + '<button class="btn ghost" style="font-size:11px;padding:2px 8px;" onclick="ExtSettingsPanel.toggleServer(\'' + esc(s.name) + '\',' + (on ? 'false' : 'true') + ')">' + (on ? '停用' : '启用') + '</button> '
                        + '<button class="btn ghost" style="font-size:11px;padding:2px 8px;" onclick="ExtSettingsPanel.testServer(\'' + esc(s.name) + '\')">测试</button></td></tr>';
                }).join('') + '</table>';
        }).catch(function () { });
    };
    P.toggleServer = function (name, enabled) {
        fetch('/api/ext/mcp/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: name, enabled: enabled }) })
            .then(function () { P.loadServers(); if (window.ExtBridge && ExtBridge.loadMcpTools) ExtBridge.loadMcpTools(); });
    };
    P.testServer = function (name) {
        fetch('/api/ext/mcp/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: name }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { alert(d.ok ? '✅ 连通' : '❌ ' + (d.error || '失败')); });
    };

    // ---------- 🎯 技能列表 ----------
    P.loadSkills = function () {
        var box = document.getElementById('extSettingsSkills');
        if (!box) return;
        fetch('/api/ext/skills/list').then(function (r) { return r.json(); }).then(function (d) {
            var list = (d && d.skills) || [];
            if (!list.length) { box.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:8px 0;">无技能包。复制 extensions/skills/_template 改名即可创建。</div>'; return; }
            box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
                + '<tr style="color:var(--text2);text-align:left;"><th style="padding:4px 6px;">技能</th><th>状态</th><th style="width:90px;">操作</th></tr>'
                + list.map(function (s) {
                    var on = s.enabled !== false;
                    return '<tr><td style="padding:4px 6px;border-top:1px solid var(--border);"><b>' + esc(s.name || s.id) + '</b></td>'
                        + '<td style="border-top:1px solid var(--border);">' + (on ? '<span style="color:var(--green,#2ea043);">启用</span>' : '<span style="color:var(--text2);">停用</span>') + '</td>'
                        + '<td style="border-top:1px solid var(--border);"><button class="btn ghost" style="font-size:11px;padding:2px 8px;" onclick="ExtSettingsPanel.toggleSkill(\'' + esc(s.id) + '\',' + (on ? 'false' : 'true') + ')">' + (on ? '停用' : '启用') + '</button></td></tr>';
                }).join('') + '</table>';
        }).catch(function () { });
    };
    P.toggleSkill = function (id, enabled) {
        fetch('/api/ext/skills/set_enabled', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, enabled: enabled }) })
            .then(function () { P.loadSkills(); });
    };

    // ---------- 双 tab 构建 ----------
    function addNav(tabId, icon, label, anchorTab) {
        var nav = document.querySelector('.settings-nav');
        if (!nav || nav.querySelector('[data-settings-tab="' + tabId + '"]')) return;
        var item = document.createElement('div');
        item.className = 'settings-nav-item';
        item.setAttribute('data-settings-tab', tabId);
        item.innerHTML = '<span class="settings-nav-icon">' + icon + '</span><span>' + label + '</span>';
        item.onclick = function () { App.switchSettingsTab(tabId); };
        var anchor = nav.querySelector('[data-settings-tab="' + anchorTab + '"]');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(item, anchor);
        else nav.appendChild(item);
    }

    function addPanel(tabId, html) {
        var content = document.querySelector('.settings-content');
        if (!content || document.getElementById('settingsPanel-' + tabId)) return;
        var panel = document.createElement('div');
        panel.className = 'settings-panel';
        panel.id = 'settingsPanel-' + tabId;
        panel.innerHTML = html;
        content.appendChild(panel);
    }

    P.build = function () {
        addNav('ext-mcp', '🔌', 'MCP', 'comparison');
        addNav('ext-skills', '🎯', '技能', 'comparison');
        addPanel('ext-mcp',
            '<h3 style="margin:0 0 12px 0;">🔌 MCP 服务管理</h3>'
            + '<div style="font-size:12px;color:var(--text2);margin-bottom:14px;">连接外部 MCP server，工具自动注入模型。开关即时生效，无需重启。</div>'
            + '<div id="extToggle-mcp"></div>'
            + '<h4 style="margin:18px 0 8px;">Servers</h4><div id="extSettingsServers"></div>'
            + '<div style="margin-top:14px;"><button class="btn ghost" onclick="ExtManager.open()">🧩 添加 / 删除 server（完整管理）</button></div>');
        addPanel('ext-skills',
            '<h3 style="margin:0 0 12px 0;">🎯 技能包管理</h3>'
            + '<div style="font-size:12px;color:var(--text2);margin-bottom:14px;">技能 = 提示词 + 工具组合，按关键词自动注入对话。</div>'
            + '<div id="extToggle-skills"></div>'
            + '<h4 style="margin:18px 0 8px;">已安装技能</h4><div id="extSettingsSkills"></div>'
            + '<div style="margin-top:14px;font-size:12px;color:var(--text2);">技能文件夹：extensions/skills/&lt;id&gt;/skill.json，修改后自动热更新。server 的添加 / 删除 / 测试请到「🔌 MCP」页操作。</div>');
    };

    // ---------- 激活（由 switchSettingsTab 调用，tab 为 ext-mcp / ext-skills） ----------
    P.init = function (tab) {
        P.build();
        P.loadSettings().then(function () {
            P.renderToggle('mcp');
            P.renderToggle('skills');
        });
        // 只刷新当前 tab 的列表，减少无关请求；不传则全刷
        if (!tab || tab === 'ext-mcp') P.loadServers();
        if (!tab || tab === 'ext-skills') P.loadSkills();
    };
})();
