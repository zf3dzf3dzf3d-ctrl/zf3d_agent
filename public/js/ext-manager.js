// ============================================================
// ext-manager.js — 扩展子系统管理面板（独立文件，删除即下线）
// 功能：MCP server 增删/连通性测试/工具列表 + 技能开关/关键词查看
// 入口：右下角浮窗按钮 🧩，或 ExtManager.open()
// API 见 extensions/*.py
// ============================================================
(function () {
    'use strict';
    var M = window.ExtManager = {
        el: null,

        open: function () {
            if (M.el) { M.el.style.display = 'flex'; M.loadAll(); return; }
            M.build();
            M.el.style.display = 'flex';
            M.loadAll();
        },
        close: function () { if (M.el) M.el.style.display = 'none'; },

        build: function () {
            var st = document.createElement('style');
            st.id = 'ext-manager-style';
            st.textContent = [
                '.extmgr-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:none;align-items:center;justify-content:center;}',
                '.extmgr{width:min(760px,92vw);max-height:84vh;overflow:auto;background:var(--bg-card,#1e1e2e);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);padding:18px 20px;font-size:13px;color:var(--text,#fff);border:1px solid var(--border,#333344);}',
                '.extmgr h3{margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;}',
                '.extmgr h4{margin:16px 0 8px;border-bottom:1px solid var(--border,#333344);padding-bottom:4px;}',
                '.extmgr table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;}',
                '.extmgr th,.extmgr td{border:1px solid var(--border,#333344);padding:5px 8px;text-align:left;word-break:break-all;color:var(--text,#fff);}',
                '.extmgr th{background:var(--bg-hover,#252535);}',
                '.extmgr .row{display:flex;gap:8px;margin:6px 0;flex-wrap:wrap;}',
                '.extmgr input,.extmgr select{padding:5px 8px;border:1px solid var(--border,#333344);border-radius:6px;font-size:12px;background:var(--bg,#1a1a2e);color:var(--text,#fff);}',
                '.extmgr button{padding:4px 12px;border:1px solid var(--border,#333344);border-radius:7px;background:var(--bg-hover,#252535);cursor:pointer;font-size:12px;color:var(--text,#fff);}',
                '.extmgr button.pri{background:var(--blue,#0984e3);border-color:var(--blue,#0984e3);color:#fff;}',
                '.extmgr .muted{color:var(--text2,#b8b8cc);font-size:11px;}',
                '.extmgr .switch{cursor:pointer;}'
            ].join('');
            document.head.appendChild(st);

            // 浮窗按钮已移除：入口统一收敛到「设置 → 🔌 MCP / 🎯 技能」页内的管理按钮

            var mask = document.createElement('div');
            mask.className = 'extmgr-mask';
            mask.innerHTML =
                '<div class="extmgr">' +
                '<h3>🧩 扩展管理 <button onclick="ExtManager.close()">✕</button></h3>' +
                '<div class="muted">MCP 网关 · 技能包 · 声明式 UI（extensions/ 独立模块）</div>' +

                '<h4>MCP Servers</h4>' +
                '<div class="row">' +
                '<input id="extm-name" placeholder="名称，如 filesystem" style="width:150px">' +
                '<input id="extm-url" placeholder="URL (http://127.0.0.1:9000/mcp) 或命令行 (stdio://python server.py)" style="flex:1;min-width:280px">' +
                '<button class="pri" onclick="ExtManager.addServer()">添加</button>' +
                '</div>' +
                '<div id="extm-servers"></div>' +

                '<h4>MCP 工具</h4>' +
                '<div id="extm-tools" class="muted">未加载</div>' +

                '<h4>技能包 <button onclick="ExtManager.toggleMarket()">🛒 技能市场</button></h4>' +
                '<div id="extm-market" style="display:none"></div>' +
                '<div id="extm-skills"></div>' +
                '<div class="muted">技能文件夹：extensions/skills/&lt;id&gt;/skill.json，改完 mtime 自动热更新</div>' +
                '</div>';
            mask.addEventListener('click', function (e) { if (e.target === mask) M.close(); });
            document.body.appendChild(mask);
            M.el = mask;
        },

        loadAll: function () { M.loadServers(); M.loadTools(); M.loadSkills(); },

        // ---------- MCP ----------
        loadServers: function () {
            fetch('/api/ext/mcp/servers').then(function (r) { return r.json(); }).then(function (d) {
                var box = document.getElementById('extm-servers');
                var list = (d && d.servers) || [];
                if (!list.length) { box.innerHTML = '<div class="muted">尚未配置 MCP server。</div>'; return; }
                box.innerHTML = '<table><tr><th>名称</th><th>transport</th><th>目标</th><th style="width:170px">操作</th></tr>' + list.map(function (s) {
                    return '<tr><td>' + M.esc(s.name) + '</td><td>' + M.esc(s.transport || s.type || 'http') + '</td><td>' + M.esc(s.url || s.command || '') + '</td>' +
                        '<td>' + (s.enabled === false ? '⚫' : '🟢') +
                        '<button onclick="ExtManager.testServer(\'' + M.esc(s.name) + '\')">测试</button> ' +
                        '<button onclick="ExtManager.toggleServer(\'' + M.esc(s.name) + '\',' + (s.enabled === false ? 'true' : 'false') + ')">' + (s.enabled === false ? '启用' : '停用') + '</button> ' +
                        '<button onclick="ExtManager.delServer(\'' + M.esc(s.name) + '\')">删除</button></td></tr>';
                }).join('') + '</table>';
            }).catch(function (e) { console.error('[ExtManager]', e); });
        },
        addServer: function () {
            var name = document.getElementById('extm-name').value.trim();
            var target = document.getElementById('extm-url').value.trim();
            if (!name || !target) return alert('名称与目标都要填');
            var body = { id: name };
            if (target.indexOf('stdio://') === 0) { body.type = 'stdio'; body.command = target.slice(8); }
            else { body.type = 'http'; body.url = target; }
            fetch('/api/ext/mcp/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (d) { if (!d.ok) return alert(d.error || '添加失败'); M.loadAll(); });
        },
        toggleServer: function (name, enabled) {
            fetch('/api/ext/mcp/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: name, enabled: enabled }) })
                .then(function () { M.loadAll(); });
        },
        delServer: function (name) {
            if (!confirm('删除 MCP server「' + name + '」？')) return;
            fetch('/api/ext/mcp/servers_delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: name }) })
                .then(function () { M.loadAll(); });
        },
        testServer: function (name) {
            fetch('/api/ext/mcp/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: name }) })
                .then(function (r) { return r.json(); })
                .then(function (d) { alert(d.ok ? '✅ 连通' : '❌ ' + (d.error || '失败')); });
        },
        loadTools: function () {
            fetch('/api/ext/mcp/tools').then(function (r) { return r.json(); }).then(function (d) {
                var box = document.getElementById('extm-tools');
                var list = (d && d.tools) || [];
                box.innerHTML = list.length
                    ? '<table><tr><th>工具名</th><th>描述</th></tr>' + list.map(function (t) {
                        return '<tr><td>' + M.esc(t.name || (t.function && t.function.name)) + '</td><td>' + M.esc((t.description || (t.function && t.function.description) || '').slice(0, 80)) + '</td></tr>';
                    }).join('') + '</table>'
                    : '<span class="muted">无外部工具（未连接或 server 无 tools）。</span>';
            }).catch(function () {});
        },

        // ---------- Skills ----------
        loadSkills: function () {
            fetch('/api/ext/skills/list').then(function (r) { return r.json(); }).then(function (d) {
                var box = document.getElementById('extm-skills');
                var list = (d && d.skills) || [];
                box.innerHTML = list.length
                    ? '<table><tr><th>技能</th><th>触发词</th><th>自动注入</th><th>状态</th><th>操作</th></tr>' + list.map(function (s) {
                        return '<tr><td><b>' + M.esc(s.name) + '</b><div class="muted">' + M.esc(s.description || '') + '</div></td>' +
                            '<td>' + M.esc((s.triggers || []).join('、')) + '</td>' +
                            '<td>' + (s.autoInject ? '✅' : '—') + '</td>' +
                            '<td>' + (s.enabled !== false ? '启用' : '停用') + '</td>' +
                            '<td><button onclick="ExtManager.toggleSkill(\'' + M.esc(s.id) + '\',' + (s.enabled !== false ? 'false' : 'true') + ')">' + (s.enabled !== false ? '停用' : '启用') + '</button></td></tr>';
                    }).join('') + '</table>'
                    : '<span class="muted">无技能包。复制 extensions/skills/_template 改名即可创建。</span>';
            }).catch(function () {});
        },
        toggleSkill: function (id, enabled) {
            fetch('/api/ext/skills/set_enabled', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, enabled: enabled }) })
                .then(function () { M.loadSkills(); });
        },

        // ---------- 技能市场 ----------
        toggleMarket: function () {
            var box = document.getElementById('extm-market');
            if (!box) return;
            if (box.style.display === 'none') { box.style.display = ''; if (!box.dataset.loaded) M.loadMarket(); }
            else box.style.display = 'none';
        },
        loadMarket: function (q) {
            var box = document.getElementById('extm-market');
            if (!box) return;
            fetch('/api/ext/skills/market_list').then(function (r) { return r.json(); }).then(function (d) {
                box.dataset.loaded = '1';
                var items = (d && d.items) || [];
                var up = d && d.updated ? new Date(d.updated * 1000).toLocaleString() : '';
                if (q) items = items.filter(function (it) {
                    return ((it.name || '') + (it.description || '') + (it.id || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0;
                });
                items.sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); });
                var html = '<div class="row"><input id="extm-market-q" placeholder="搜索技能…" onkeydown="if(event.key===\'Enter\')ExtManager.loadMarket(this.value)">' +
                    '<button onclick="ExtManager.loadMarket(document.getElementById(\'extm-market-q\').value)">搜索</button>' +
                    '<button onclick="ExtManager.refreshMarket(this)">刷新索引</button>' +
                    '<span class="muted">共 ' + items.length + ' 个（本地只存下载路径，安装时才联网下载）' + (up ? ' · 更新于 ' + up : '') + '</span></div>';
                html += items.length
                    ? '<table><tr><th>技能</th><th>来源</th><th>星标</th><th style="width:120px">操作</th></tr>' + items.map(function (it) {
                        return '<tr><td><b>' + M.esc(it.name || it.id) + '</b> <span class="muted">' + M.esc(it.id) + '</span><div class="muted">' + M.esc((it.description || '').slice(0, 100)) + '</div></td>' +
                            '<td><a href="' + M.esc(it.url || '#') + '" target="_blank">' + M.esc(it.source || '') + '</a></td>' +
                            '<td>⭐ ' + (it.stars || 0) + '</td>' +
                            '<td>' + (it.installed
                                ? '<button onclick="ExtManager.uninstallSkill(\'' + M.esc(it.id) + '\')">卸载</button>'
                                : '<button onclick="ExtManager.installSkill(this,\'' + M.esc(it.id) + '\')">安装</button>') + '</td></tr>';
                    }).join('') + '</table>'
                    : '<span class="muted">索引为空，点「刷新索引」联网拉取。</span>';
                box.innerHTML = html;
            }).catch(function () { box.innerHTML = '<span class="muted">加载失败。</span>'; });
        },
        refreshMarket: function (btn) {
            var box = document.getElementById('extm-market');
            if (btn) { btn.disabled = true; btn.textContent = '拉取中…'; }
            fetch('/api/ext/skills/market_refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                .then(function (r) { return r.json(); })
                .then(function () { if (btn) { btn.disabled = false; btn.textContent = '刷新索引'; } M.loadMarket(); })
                .catch(function () { if (btn) { btn.disabled = false; btn.textContent = '刷新索引'; } });
        },
        installSkill: function (btn, id) {
            if (btn) { btn.disabled = true; btn.textContent = '安装中…'; }
            fetch('/api/ext/skills/market_install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
                .then(function (r) { return r.json(); })
                .then(function (d) { alert(d && d.ok ? '已安装：' + id : ('安装失败：' + ((d && d.error) || '未知错误'))); M.loadMarket(); M.loadSkills(); })
                .catch(function () { if (btn) { btn.disabled = false; btn.textContent = '安装'; } });
        },
        uninstallSkill: function (id) {
            if (!confirm('确定卸载技能「' + id + '」？将删除 skills/' + id + '/ 目录。')) return;
            fetch('/api/ext/skills/market_delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
                .then(function () { M.loadMarket(); M.loadSkills(); });
        },

        esc: function (s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { M.build(); });
    else M.build();
})();
