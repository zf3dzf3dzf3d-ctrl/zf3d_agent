/* app-project-panel.js — 项目驾驶舱 v2.1：工作台抽屉顶层注入「👥 团队」「📊 数据」两个标签
 * （v2 曾做成单个「🧭 项目」内子标签，用户裁决：应为顶层独立标签；情报并入数据）
 * 「📊 数据」内含两个子页：数据中心钉板 / 情报组件（网页看板）
 * 依赖接口：/api/workbench/widgets、/api/butler/team、/api/pins
 */
(function () {
    'use strict';
    if (window.ProjectPanel && window.ProjectPanel.version === '2.1') return; // 幂等守卫
    var NS = window.ProjectPanel = { version: '2.1' };
    var WBPANEL = 'wbp-view3';
    var _wired = false;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function pid() {
        try { return (window.App && App.activeProject && App.activeProject.id) || localStorage.getItem('active_project_id') || 'default'; }
        catch (e) { return 'default'; }
    }
    function drawer() {
        return document.querySelector('.wb-drawer') || null;
    }
    function pane(id) { return document.getElementById(id); }

    // 往 wb-drawer 顶层注入「👥 团队」「📊 数据」两个标签（幂等）
    function mountIntoWorkbench() {
        var d = drawer();
        if (!d) return false;
        var tabs = d.querySelector('.wb-drawer-tabs');
        var body = d.querySelector('.wb-drawer-body');
        if (!tabs || !body || d.querySelector('[data-wbtab="ds-team"]')) return true;

        var flip = tabs.querySelector('.wb-flip');
        function mkBtn(tabName, title, label) {
            var b = document.createElement('button');
            b.className = 'wb-tab';
            b.setAttribute('data-wbtab', tabName);
            b.title = title;
            b.textContent = label;
            tabs.insertBefore(b, flip || null);
            return b;
        }
        mkBtn('ds-team', '管家团：分工 / 档案', '👥 团队');
        mkBtn('ds-data', '数据中心：钉住的外站指标 + 情报组件', '📊 数据');

        // 数据页容器（内含 钉板/情报 子页）
        var work = document.createElement('div');
        work.className = 'wb-workbench';
        work.setAttribute('data-wbwork', 'ds-data');
        work.style.cssText = 'display:none;flex-direction:column;height:100%;min-height:0;padding:0;';
        work.innerHTML =
            '<div class="wbp2-subtabs" style="display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(128,140,160,.25);align-items:center;">' +
                '<button class="wbp2-tab" data-wbp2="pins">钉板</button>' +
                '<button class="wbp2-tab" data-wbp2="intel">情报组件</button>' +
                '<span style="flex:1"></span>' +
                '<button class="wbp2-add" title="添加情报组件（URL）" style="display:none;font-size:12px;padding:1px 8px;border-radius:10px;border:1px solid rgba(128,140,160,.4);background:transparent;color:inherit;cursor:pointer">＋组件</button>' +
            '</div>' +
            '<div class="wbp2-views" style="flex:1;min-height:0;overflow:auto;padding:10px">' +
                '<div id="wbpData" style="display:none"></div>' +
                '<div id="wbpIntel" style="display:none"></div>' +
            '</div>';
        body.appendChild(work);

        // 团队页容器
        var workT = document.createElement('div');
        workT.className = 'wb-workbench';
        workT.setAttribute('data-wbwork', 'ds-team');
        workT.style.cssText = 'display:none;flex-direction:column;height:100%;min-height:0;overflow:auto;padding:10px;';
        workT.innerHTML = '<div id="wbpTeam"></div>';
        body.appendChild(workT);

        d.querySelectorAll('.wbp2-tab').forEach(function (b) {
            b.style.cssText = 'font-size:12px;padding:2px 10px;border-radius:10px;border:1px solid rgba(128,140,160,.4);background:transparent;color:inherit;cursor:pointer';
        });

        // 数据标签点击：恢复子页记忆
        tabs.querySelector('[data-wbtab="ds-data"]').addEventListener('click', function () {
            var saved = 'pins';
            try { saved = localStorage.getItem(WBPANEL) || 'pins'; } catch (e) {}
            setDataView(saved);
        });
        work.querySelector('.wbp2-subtabs').addEventListener('click', function (e) {
            var t = e.target.closest('.wbp2-tab');
            if (t) { setDataView(t.getAttribute('data-wbp2')); return; }
            if (e.target.closest('.wbp2-add')) promptAdd();
        });
        // 团队标签点击：首次/每次进入刷新
        tabs.querySelector('[data-wbtab="ds-team"]').addEventListener('click', function () {
            renderTeam();
        });
        _wired = true;
        return true;
    }

    function setDataView(v) {
        try { localStorage.setItem(WBPANEL, v); } catch (e) {}
        document.querySelectorAll('.wbp2-tab').forEach(function (b) {
            var on = b.getAttribute('data-wbp2') === v;
            b.style.background = on ? 'rgba(90,140,255,.25)' : 'transparent';
            b.style.fontWeight = on ? '700' : '400';
        });
        var data = pane('wbpData'), intel = pane('wbpIntel');
        if (data) data.style.display = (v === 'pins') ? '' : 'none';
        if (intel) intel.style.display = (v === 'intel') ? '' : 'none';
        var addBtn = document.querySelector('.wbp2-add');
        if (addBtn) addBtn.style.display = (v === 'intel') ? '' : 'none';
        if (v === 'pins') renderData();
        if (v === 'intel') renderIntel();
    }

    // ===== 团队页：只读 /api/butler/team =====
    function renderTeam() {
        var el = pane('wbpTeam');
        if (!el) return;
        el.innerHTML = '<div style="opacity:.6;font-size:12px">加载中…</div>';
        fetch('/api/butler/team').then(function (r) { return r.json(); }).then(function (j) {
            var team = (j && j.team) || [];
            if (!team.length) { el.innerHTML = '<div style="opacity:.6;font-size:12px">管家团暂无成员。</div>'; return; }
            el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">' +
                team.map(function (m) {
                    var fields = (m.fields && m.fields.length) ? m.fields.map(esc).join('、') : '—';
                    var persona = String(m.persona || '').slice(0, 60);
                    return '<div style="border:1px solid rgba(128,140,160,.3);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.04)">' +
                        '<div style="font-size:14px;font-weight:700">' + esc(m.avatar || '👤') + ' ' + esc(m.name || '') + '</div>' +
                        '<div style="font-size:11px;opacity:.75;margin-top:4px;line-height:1.5">' + esc(persona) + (String(m.persona || '').length > 60 ? '…' : '') + '</div>' +
                        '<div style="font-size:10px;opacity:.55;margin-top:4px">档案字段：' + fields + '</div>' +
                        '</div>';
                }).join('') + '</div>';
        }).catch(function (e) {
            el.innerHTML = '<div style="color:#e88;font-size:12px">团队加载失败：' + esc(e.message || e) + '</div>';
        });
    }

    // ===== 情报组件页 =====
    function renderIntel() {
        var el = pane('wbpIntel');
        if (!el) return;
        el.innerHTML = '<div style="opacity:.6;font-size:12px">加载中…</div>';
        fetch('/api/workbench/widgets?project=' + encodeURIComponent(pid())).then(function (r) { return r.json(); }).then(function (j) {
            var ws = (j && j.widgets) || [];
            if (!ws.length) {
                el.innerHTML = '<div style="opacity:.6;font-size:12px;padding:20px;text-align:center">暂无情报组件。点右上「＋组件」添加一个网页看板（如新闻、行情、监控页）。</div>';
                return;
            }
            el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px">' +
                ws.map(function (w) {
                    return '<div class="wbp-widget" style="border:1px solid rgba(128,140,160,.3);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:rgba(255,255,255,.04)">' +
                        '<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid rgba(128,140,160,.2)">' +
                        '<span style="font-size:12px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(w.title) + '</span>' +
                        '<button class="wbp-del" data-del="' + esc(w.id || '') + '" title="删除组件" style="border:none;background:none;color:#e88;cursor:pointer;font-size:12px">✕</button>' +
                        '</div>' +
                        '<iframe src="' + esc(w.url) + '" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" style="width:100%;height:260px;border:none;background:#0d0f14" loading="lazy"></iframe>' +
                        '</div>';
                }).join('') + '</div>';
            el.querySelectorAll('.wbp-del').forEach(function (b) {
                b.addEventListener('click', function () {
                    if (!confirm('删除该情报组件？')) return;
                    fetch('/api/workbench/widgets?project=' + encodeURIComponent(pid()) + '&id=' + encodeURIComponent(b.getAttribute('data-del')), { method: 'DELETE' })
                        .then(function () { renderIntel(); });
                });
            });
        }).catch(function (e) {
            el.innerHTML = '<div style="color:#e88;font-size:12px">情报组件加载失败：' + esc(e.message || e) + '</div>';
        });
    }

    function promptAdd() {
        var url = prompt('情报组件 URL（网页看板地址）：');
        if (!url) return;
        var title = prompt('组件名称（可留空自动取域名）：', '') || url.replace(/^https?:\/\//, '').split('/')[0];
        fetch('/api/workbench/widgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: pid(), title: title, url: url })
        }).then(function () { renderIntel(); });
    }

    // ===== 数据中心钉板页：/api/pins =====
    function renderData() {
        var el = pane('wbpData');
        if (!el) return;
        el.innerHTML = '<div style="opacity:.6;font-size:12px">加载中…</div>';
        fetch('/api/pins?project=' + encodeURIComponent(pid())).then(function (r) { return r.json(); }).then(function (j) {
            var pins = (j && (j.pins || j.items)) || [];
            if (!pins.length) {
                el.innerHTML = '<div style="opacity:.6;font-size:12px;padding:20px;text-align:center">数据中心暂无钉住的指标。<br>在对话里对 AI 说「把（某网站）的（某数值）钉到数据中心」即可创建。</div>';
                return;
            }
            el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">' +
                pins.map(function (p) {
                    return '<div class="wbp-pin" data-pin="' + esc(p.id || '') + '" style="border:1px solid rgba(128,140,160,.3);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.04);cursor:pointer" title="点击刷新该指标">' +
                        '<div style="font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title || p.name || p.url || '') + '</div>' +
                        '<div style="font-size:18px;font-weight:800;margin-top:4px">' + esc(p.value != null ? String(p.value) : '—') + '</div>' +
                        '<div style="font-size:10px;opacity:.5;margin-top:2px">' + esc(p.updated_at || p.updated || '') + '</div>' +
                        '</div>';
                }).join('') + '</div>';
            el.querySelectorAll('.wbp-pin').forEach(function (c) {
                c.addEventListener('click', function () {
                    c.querySelector('div:nth-child(2)').textContent = '刷新中…';
                    fetch('/api/pins/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ project: pid(), id: c.getAttribute('data-pin') })
                    }).then(function (r) { return r.json(); }).then(function () { renderData(); })
                      .catch(function () { renderData(); });
                });
            });
        }).catch(function (e) {
            el.innerHTML = '<div style="color:#e88;font-size:12px">数据中心加载失败：' + esc(e.message || e) + '</div>';
        });
    }

    // ===== 挂载轮询（抽屉懒建，等 .wb-drawer 出现） =====
    var tries = 0;
    (function poll() {
        if (mountIntoWorkbench()) return;
        if (++tries > 600) return; // 5 分钟后放弃
        setTimeout(poll, 500);
    })();
})();
