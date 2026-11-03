/* app-project-panel.js — 项目驾驶舱 v2.1：工作台抽屉顶层注入「👥 团队」「📊 数据」两个标签
 * （v2 曾做成单个「🧭 项目」内子标签，用户裁决：应为顶层独立标签；情报并入数据）
 * 依赖接口：/api/butler/team、/api/pins
 */
(function () {
    'use strict';
    if (window.ProjectPanel && window.ProjectPanel.version === '2.1') return; // 幂等守卫
    var NS = window.ProjectPanel = { version: '2.2' };
    var WBPANEL = 'wbp-view3';
    var _wired = false;
    var _uidN = 0;   // 抽屉实例序号（pane id 加后缀防多抽屉冲突）

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function pid() {
        try { return (window.App && App.activeProject && App.activeProject.id) || localStorage.getItem('active_project_id') || 'default'; }
        catch (e) { return 'default'; }
    }
    function drawerEls() { return Array.prototype.slice.call(document.querySelectorAll('.wb-drawer')); }

    // 自定义确认对话框（替代原生 confirm）：深色主题，返回不阻塞，通过 onOk 回调继续
    function wbpConfirm(title, msg, onOk) {
        var old = document.getElementById('wbp-confirm-mask');
        if (old) old.parentNode.removeChild(old);
        var mask = document.createElement('div');
        mask.id = 'wbp-confirm-mask';
        mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        mask.innerHTML =
            '<div id="wbp-confirm-box" style="width:320px;background:#1a1a20;border:1px solid rgba(128,140,160,.35);border-radius:12px;padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:inherit">' +
            '<div style="font-size:14px;font-weight:700;color:#e8ecf2">' + esc(title) + '</div>' +
            '<div style="font-size:12.5px;color:#aab4c2;margin-top:10px;line-height:1.6;word-break:break-all">' + esc(msg) + '</div>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
            '<button id="wbp-confirm-no" style="padding:6px 16px;border-radius:8px;border:1px solid rgba(128,140,160,.4);background:transparent;color:#cfd6df;font-size:12.5px;cursor:pointer">取消</button>' +
            '<button id="wbp-confirm-yes" style="padding:6px 16px;border-radius:8px;border:none;background:#c84040;color:#fff;font-size:12.5px;cursor:pointer">删除</button>' +
            '</div></div>';
        document.body.appendChild(mask);
        function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
        mask.querySelector('#wbp-confirm-yes').addEventListener('click', function () { close(); onOk && onOk(); });
        mask.querySelector('#wbp-confirm-no').addEventListener('click', close);
        mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
        document.addEventListener('keydown', function h(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', h); } });
    }
    function pane(kind) {
        var d = activeDrawer();
        return d ? d.querySelector('[data-ppane="' + kind + '"]') : null;
    }
    // 当前活跃抽屉：团队/数据页签处于 active 的那个；否则第一个已挂载的
    function activeDrawer() {
        var t = document.querySelector('.wb-drawer .wb-tab[data-wbtab="ds-team"].active, .wb-drawer .wb-tab[data-wbtab="ds-data"].active');
        if (t) { var dd = t.closest('.wb-drawer'); if (dd && dd.dataset.ppanelMounted === '1') return dd; }
        var list = drawerEls();
        for (var i = 0; i < list.length; i++) if (list[i].dataset.ppanelMounted === '1') return list[i];
        return null;
    }

    // 往**每个** wb-drawer 顶层注入「👥 团队」「📊 数据」两个标签（幂等，逐抽屉守卫）
    function mountIntoWorkbench() {
        var list = drawerEls();
        if (!list.length) return false;
        var mounted = false;
        list.forEach(function (d) { if (_mountOne(d)) mounted = true; });
        return mounted;
    }
    function _mountOne(d) {
        var tabs = d.querySelector('.wb-drawer-tabs');
        var body = d.querySelector('.wb-drawer-body');
        if (!tabs || !body) return false;
        if (d.dataset.ppanelMounted === '1') return true;   // 守卫绑定到当前抽屉实例（抽屉重建后 dataset 归零，会重新注入）
        // pane id 按抽屉加后缀，避免多抽屉 id 冲突（如 wbpTeam@cb482…）
        var sid = d.dataset.ppanelSid || (d.dataset.ppanelSid = String(++_uidN));

        var flip = tabs.querySelector('.wb-flip');
        var engineTab = tabs.querySelector('[data-wbtab="engine"]');
        function mkBtn(tabName, title, label) {
            var b = document.createElement('button');
            b.className = 'wb-tab';
            b.setAttribute('data-wbtab', tabName);
            b.title = title;
            b.textContent = label;
            tabs.insertBefore(b, engineTab || flip || null);   // 统一插到「引擎」前：浏览器/数据/团队/引擎…
            return b;
        }
        mkBtn('ds-data', '数据中心：钉住的外站指标', '');
        mkBtn('ds-team', '管家团：分工 / 档案', '');
        // 页签图标改为线性 SVG（与其它 wb-tab 图标风格一致）
        var icoData = '<svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H4z"/><path d="M4 9h16"/><path d="M9 4v5"/><path d="M9 16v4"/><path d="M6.5 20h5"/></svg>';
        var icoTeam = '<svg class="wb-tab-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.8" cy="9.5" r="2.4"/><path d="M15.8 14.3c2.4.2 4.1 1.8 4.7 4.2"/></svg>';
        tabs.querySelector('[data-wbtab="ds-data"]').innerHTML = icoData + '<span class="wb-tab-txt">数据</span>';
        tabs.querySelector('[data-wbtab="ds-team"]').innerHTML = icoTeam + '<span class="wb-tab-txt">团队</span>';

        // 数据页容器（无限画布）
        var work = document.createElement('div');
        work.className = 'wb-workbench';
        work.setAttribute('data-wbwork', 'ds-data');
        work.style.cssText = 'flex-direction:column;height:100%;min-height:0;padding:0;';
        work.innerHTML =
            '<div class="wbp2-views" style="flex:1;min-height:0;overflow:hidden;position:relative;cursor:grab">' +
                '<div data-ppane="pins" class="wbp2-canvas" style="position:absolute;left:0;top:0;transform-origin:0 0;display:none"></div>' +
            '</div>';
        body.appendChild(work);

        // 团队页容器
        var workT = document.createElement('div');
        workT.className = 'wb-workbench';
        workT.setAttribute('data-wbwork', 'ds-team');
        workT.style.cssText = 'flex-direction:column;height:100%;min-height:0;overflow:hidden;padding:0;';
        workT.innerHTML = '<div data-ppane="team" style="height:100%"></div>';
        body.appendChild(workT);

        // 数据标签点击：恢复画布
        tabs.querySelector('[data-wbtab="ds-data"]').addEventListener('click', function () {
            _setDataView('pins', d);
        });
        // 团队标签点击：首次/每次进入刷新
        tabs.querySelector('[data-wbtab="ds-team"]').addEventListener('click', function () {
            renderTeam();
        });
        _wired = true;
        d.dataset.ppanelMounted = '1';
        return true;
    }

    function setDataView(v) { _setDataView(v, activeDrawer()); }
    function _setDataView(v, d) {
        d = d || activeDrawer();
        if (!d) return;
        var data = pane('pins');
        if (data) { data.style.display = ''; if (!data.dataset.canvasInit) initCanvas(data); renderData(); }
    }

    // ===== 无限画布：平移 + 滚轮缩放 + 卡片拖拽摆位（位置记忆 localStorage） =====
    function initCanvas(canvas) {
        canvas.dataset.canvasInit = '1';
        var view = canvas.parentElement;
        var st = { x: 0, y: 0, s: 1 };
        try {
            var saved = JSON.parse(localStorage.getItem(WBPANEL + ':cam') || 'null');
            if (saved && typeof saved.x === 'number') st = saved;
        } catch (e) {}
        var saveTimer = null;
        function apply() {
            canvas.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
            clearTimeout(saveTimer);
            saveTimer = setTimeout(function () {
                try { localStorage.setItem(WBPANEL + ':cam', JSON.stringify(st)); } catch (e) {}
            }, 300);
        }
        function toCanvas(clientX, clientY) {
            var r = view.getBoundingClientRect();
            return { x: (clientX - r.left - st.x) / st.s, y: (clientY - r.top - st.y) / st.s };
        }
        // 平移（空白处按下拖动）
        view.addEventListener('mousedown', function (e) {
            if (e.target.closest('.wbp-pin')) return;
            var sx = e.clientX, sy = e.clientY, ox = st.x, oy = st.y;
            view.style.cursor = 'grabbing';
            function mv(ev) { st.x = ox + ev.clientX - sx; st.y = oy + ev.clientY - sy; apply(); }
            function up() { view.style.cursor = 'grab'; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
            window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
            e.preventDefault();
        });
        // 滚轮缩放（以鼠标为中心）
        view.addEventListener('wheel', function (e) {
            e.preventDefault();
            var r = view.getBoundingClientRect();
            var mx = e.clientX - r.left, my = e.clientY - r.top;
            var ns = Math.min(2.5, Math.max(0.3, st.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
            st.x = mx - (mx - st.x) * (ns / st.s);
            st.y = my - (my - st.y) * (ns / st.s);
            st.s = ns; apply();
        }, { passive: false });
        // 卡片拖拽摆位
        canvas.addEventListener('mousedown', function (e) {
            var card = e.target.closest('.wbp-pin');
            if (!card) return;
            var id = card.getAttribute('data-pin');
            var c0 = toCanvas(e.clientX, e.clientY);
            var ox = parseFloat(card.style.left) || 0, oy = parseFloat(card.style.top) || 0;
            var moved = false;
            function mv(ev) {
                var c = toCanvas(ev.clientX, ev.clientY);
                var dx = c.x - c0.x, dy = c.y - c0.y;
                if (moved || Math.abs(dx) + Math.abs(dy) > 3) {
                    moved = true;
                    card.style.left = (ox + dx) + 'px';
                    card.style.top = (oy + dy) + 'px';
                }
                ev.preventDefault();
            }
            function up() {
                window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
                if (moved) {
                    card.dataset.dragMoved = '1';
                    setTimeout(function () { delete card.dataset.dragMoved; }, 50);
                    var pos = {};
                    try { pos = JSON.parse(localStorage.getItem(WBPANEL + ':pos') || '{}'); } catch (err) {}
                    pos[id] = { x: parseFloat(card.style.left) || 0, y: parseFloat(card.style.top) || 0 };
                    try { localStorage.setItem(WBPANEL + ':pos', JSON.stringify(pos)); } catch (err) {}
                    // 同步持久化到服务端（跨重启/换浏览器不丢）
                    fetch('/api/pins', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ project: pid(), op: 'save_pos', positions: pos })
                    }).catch(function () {});
                }
            }
            window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        });
        apply();
    }

    // ===== 团队页 v3：项目级团队（默认空）+ 全局管家团切换 + 缓存秒显 + 模板库 =====
    var _teamScope = 'project';            // project | global
    var _teamCache = { project: {}, global: null };  // pid -> team 数组
    var _teamTpl = null;

    function curTeam() {
        return (_teamScope === 'project') ? (_teamCache.project[pid()] || null) : _teamCache.global;
    }
    function teamOp(op, payload) {
        var b = payload || { op: op };
        if (_teamScope === 'global') b.scope = 'global';
        else b.project = pid();
        return fetch('/api/butler/team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b)
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.ok) throw new Error((j && j.err) || '操作失败');
            var t = j.team || [];
            if (_teamScope === 'global') _teamCache.global = t;
            else _teamCache.project[pid()] = t;
            renderTeam();
        });
    }
    function promptAddMember() {
        // 策划案六.4：默认名带时间戳后缀防撞名
        var _d = new Date(), _md = ('0' + (_d.getMonth() + 1)).slice(-2) + ('0' + _d.getDate()).slice(-2);
        var name = prompt('新成员名字（不可与现有重名）：', '调查-新成员@' + _md);
        if (!name) return;
        var avatar = prompt('头像（emoji，可留空）：', '🛠') || '🛠';
        var persona = prompt('人设说明（这个成员负责什么）：', '') || '';
        var fields = prompt('档案字段（英文逗号分隔，可留空）：', '') || '';
        teamOp('add', { op: 'add', member: {
            name: name, avatar: avatar, persona: persona,
            fields: fields.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        } }).catch(function (e) { alert('新增失败：' + (e.message || e)); });
    }
    // ===== 工作台团队：AI 按描述自动生成员工角色（参照专家团自动生成，落 butler 团队） =====
    function promptGenMember() {
        var hint = prompt('用一句话描述需要什么样的员工（AI 会据此设计岗位、职责与档案字段）：\n例：负责项目所有图标的图标制作师', '');
        if (hint === null || !String(hint).trim()) return;
        var cnt = prompt('生成几名？（1-6，留空默认1）', '1');
        if (cnt === null) return;
        var _btns = document.querySelectorAll('.wbp-team-gen');
        _btns.forEach(function (b) { b.disabled = true; b.textContent = '🤖 生成中…'; });
        teamOp('auto_generate', { op: 'auto_generate', hint: String(hint).trim(), count: parseInt(cnt, 10) || 1 })
            .catch(function (e) { alert('AI 生成失败：' + (e.message || e)); })
            .then(function () {
                _btns.forEach(function (b) { b.disabled = false; b.textContent = '🤖 AI生成'; });
            });
    }
    // ===== 工作台团队：加入当前对话为成员（策划案六.3：用户点按钮触发，AI 只产简报文本） =====
    function promptJoinWorkbench() {
        var _d = new Date(), _md = ('0' + (_d.getMonth() + 1)).slice(-2) + ('0' + _d.getDate()).slice(-2);
        var name = prompt('加入工作台团队——成员名（建议带主题）：', '调查-' + (document.title || '').replace(/[-–].*$/, '').trim().slice(0, 12) + '@' + _md);
        if (!name) return;
        var summary = prompt('接手线索：这个对话干了什么/结论是什么（派出时展示）：', '') || '';
        var paths = (prompt('相关文件/目录路径（英文逗号分隔，可留空）：', '') || '')
            .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var chatId = String((Tools && Tools.currentChatId) || window.__zfChatId || window.__chatId || '');
        teamOp('add', { op: 'add', member: {
            name: name, avatar: '🛠', type: 'workbench',
            chat_id: String(chatId), summary: summary, paths: paths,
            commits: [], last_ts: new Date().toLocaleString('zh-CN')
        } }).catch(function (e) { alert('加入失败：' + (e.message || e)); });
    }
    // ===== 工作台团队：派出（v2 真正创建新对话框并派单，策划案六.2） =====
    function dispatchMember(name, m) {
        var lines = ['【派出简报】你接手同事「' + (m.name || name) + '」的工作，请按下方简报直接开工：'];
        if (m.summary) lines.push('干了什么：' + m.summary);
        if (m.paths && m.paths.length) lines.push('相关路径：\n  ' + m.paths.join('\n  '));
        if (m.commits && m.commits.length) lines.push('相关提交：' + m.commits.join(' '));
        if (m.last_ts) lines.push('最后活动：' + m.last_ts);
        function launch(prompt) {
            var box = null, chat = null;
            try {
                for (var k = 0; k < (App.chatBoxes || []).length; k++) { chat = App.chatBoxes[k]; break; }
                var r = (chat && chat.el) ? chat.el.getBoundingClientRect() : { left: 120, top: 120 };
                box = App.createChatBox(Math.round(r.left + 46), Math.round(r.top + 46), chat && chat.modelId);
            } catch (err) {}
            if (!box) { alert('派出失败：新建对话框不可用（可能达到画布上限）\n\n' + prompt); return; }
            try { if (chat && chat._modelIdOverride) box._modelIdOverride = chat._modelIdOverride; } catch (e2) {}
            if (box.el) box = box.el;
            var attempts = 0;
            (function trySend() {
                attempts++;
                var newChat = null;
                for (var k = 0; k < (App.chatBoxes || []).length; k++) {
                    if (App.chatBoxes[k].id === box.id) { newChat = App.chatBoxes[k]; break; }
                }
                if (newChat && !newChat.isSending) {
                    try { App.addMsg(box, prompt, 'user', newChat.modelId); } catch (e3) {}
                    try { App.updateChatTitle(box, '📤 ' + (m.name || name) + ' · 派出'); } catch (e5) {}
                    App.sendToModel(box, newChat);
                    try { App.activate(box); } catch (e6) {}
                    try { Store.addLog('info', newChat.id, 'team-dispatch', '工作台团队派出「' + (m.name || name) + '」→ 新对话 [' + box.id + ']'); } catch (e7) {}
                } else if (attempts < 20) {
                    setTimeout(trySend, 150);
                } else {
                    alert('派出失败：新对话框未能就绪，简报如下：\n\n' + prompt);
                }
            })();
        }
        if (m.chat_id) {
            fetch('/api/butler/chat_brief?id=' + encodeURIComponent(m.chat_id))
                .then(function (r) { return r.json(); }).then(function (j) {
                    if (j && j.found && j.brief && j.brief.length) {
                        lines.push('原对话开头片段：');
                        j.brief.forEach(function (b) { lines.push('  [' + b.role + '] ' + b.preview); });
                    } else {
                        lines.push('⚠ 原对话(' + m.chat_id + ')已无法唤回（幽灵成员），请按上方 paths 与项目记录接手。');
                    }
                    launch(lines.join('\n'));
                }).catch(function () { launch(lines.join('\n')); });
        } else {
            launch(lines.join('\n'));
        }
    }
    function showTemplates() {
        if (_teamTpl) { _renderTpl(); return; }
        fetch('/api/butler/team?templates=1').then(function (r) { return r.json(); }).then(function (j) {
            _teamTpl = (j && j.templates) || [];
            _renderTpl();
        }).catch(function (e) { alert('模板加载失败：' + (e.message || e)); });
    }
    function _renderTpl() {
        var names = (_teamTpl || []).map(function (t, i) { return (i + 1) + '.' + t.avatar + t.name; }).join('  ');
        var pick = prompt('从模板添加（输入编号）：\n' + names + '\n（留空取消）', '');
        if (pick === null || !String(pick).trim()) return;
        var t = _teamTpl[parseInt(pick, 10) - 1];
        if (!t) { alert('编号无效'); return; }
        teamOp('add', { op: 'add', member: { name: t.name, avatar: t.avatar, persona: t.persona, fields: t.fields } })
            .catch(function (e) { alert('添加失败：' + (e.message || e)); });
    }
    function _bindTeamEvents(el) {
        var add = el.querySelector('.wbp-team-add');
        if (add) add.addEventListener('click', promptAddMember);
        var join = el.querySelector('.wbp-team-join');
        if (join) join.addEventListener('click', promptJoinWorkbench);
        var tpl = el.querySelector('.wbp-team-tpl');
        if (tpl) tpl.addEventListener('click', showTemplates);
        var gen = el.querySelector('.wbp-team-gen');
        if (gen) gen.addEventListener('click', promptGenMember);
        el.querySelectorAll('.wbp-team-dispatch').forEach(function (b) {
            b.addEventListener('click', function () {
                var nm = b.getAttribute('data-name');
                var m = ((curTeam() || []).filter(function (x) { return x.name === nm; })[0]) || { name: nm };
                dispatchMember(nm, m);
            });
        });
        el.querySelectorAll('.wbp-team-scope').forEach(function (b) {
            b.addEventListener('click', function () {
                _teamScope = b.getAttribute('data-scope');
                renderTeam();
                if (!curTeam()) _fetchTeam();
            });
        });
        el.querySelectorAll('.wbp-team-del').forEach(function (b) {
            b.addEventListener('click', function () {
                if (!confirm('删除成员「' + b.getAttribute('data-name') + '」？（其档案数据保留，可手工恢复）')) return;
                teamOp('delete', { op: 'delete', name: b.getAttribute('data-name') })
                    .catch(function (e) { alert('删除失败：' + (e.message || e)); });
            });
        });
        el.querySelectorAll('.wbp-team-edit').forEach(function (b) {
            b.addEventListener('click', function () {
                var nm = b.getAttribute('data-name');
                var persona = prompt('编辑「' + nm + '」的人设说明：', '');
                if (persona === null) return;
                teamOp('update', { op: 'update', name: nm, patch: { persona: persona } })
                    .catch(function (e) { alert('更新失败：' + (e.message || e)); });
            });
        });
        el.querySelectorAll('.wbp-team-rel').forEach(function (b) {
            b.addEventListener('click', function () {
                var nm = b.getAttribute('data-name');
                var sel = prompt('修改「' + nm + '」的关系类型（四选一，直接输入）：\n团队成员 / 伴侣 / 孩子 / 父母', '团队成员');
                if (sel === null) return;
                sel = sel.trim();
                if (['团队成员', '伴侣', '孩子', '父母'].indexOf(sel) < 0) { alert('无效的关系类型：' + sel); return; }
                teamOp('relation', { op: 'relation', name: nm, relation: sel })
                    .then(function () { renderTeam(); })
                    .catch(function (e) { alert('修改关系失败：' + (e.message || e)); });
            });
        });
        _bindTeamCanvas(el);
    }
    /* ===== v4 无限画布交互：空白拖拽平移 / 滚轮缩放 / 卡片拖拽换位（位置持久化） ===== */
    function _bindTeamCanvas(el) {
        el.querySelectorAll('.wbp-team-canvas').forEach(function (cv) {
            var world = cv.querySelector('.wbp-team-world');
            if (!world) return;
            var cam = { x: 0, y: 0, s: 1 };
            var applied = false;
            function apply() {
                world.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.s + ')';
                applied = true;
            }
            try {   // 恢复上次相机
                var saved = JSON.parse(localStorage.getItem(_teamPosKey() + ':cam') || 'null');
                if (saved && isFinite(saved.s) && saved.s > 0.05 && saved.s < 8) { cam = saved; apply(); }
            } catch (e) {}
            function saveCam() { try { localStorage.setItem(_teamPosKey() + ':cam', JSON.stringify(cam)); } catch (e) {} }
            function toWorld(px, py) { return { x: (px - cam.x) / cam.s, y: (py - cam.y) / cam.s }; }
            var drag = null;    // {type:'pan'|'node', ...}
            cv.addEventListener('mousedown', function (ev) {
                var node = ev.target.closest ? ev.target.closest('.wbp-team-node') : null;
                if (node && !ev.target.closest('button')) {
                    var wx = toWorld(ev.clientX - cv.getBoundingClientRect().left, ev.clientY - cv.getBoundingClientRect().top);
                    drag = { type: 'node', node: node, dx: wx.x - parseFloat(node.style.left), dy: wx.y - parseFloat(node.style.top), moved: false };
                } else if (!ev.target.closest('button')) {
                    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y, moved: false };
                }
                if (drag) { ev.preventDefault(); cv.style.cursor = 'grabbing'; }
            });
            window.addEventListener('mousemove', function (ev) {
                if (!drag) return;
                var r = cv.getBoundingClientRect();
                if (drag.type === 'pan') {
                    cam.x = drag.cx + (ev.clientX - drag.sx);
                    cam.y = drag.cy + (ev.clientY - drag.sy);
                    if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
                    apply();
                } else {
                    var wx = toWorld(ev.clientX - r.left, ev.clientY - r.top);
                    drag.node.style.left = (wx.x - drag.dx) + 'px';
                    drag.node.style.top = (wx.y - drag.dy) + 'px';
                    drag.moved = true;
                }
            });
            window.addEventListener('mouseup', function () {
                if (!drag) return;
                if (drag.type === 'pan' && drag.moved) saveCam();
                if (drag.type === 'node' && drag.moved) _teamPosSet(drag.node.getAttribute('data-name'), parseFloat(drag.node.style.left), parseFloat(drag.node.style.top));
                cv.style.cursor = 'grab';
                drag = null;
            });
            cv.addEventListener('wheel', function (ev) {
                ev.preventDefault();
                var r = cv.getBoundingClientRect();
                var px = ev.clientX - r.left, py = ev.clientY - r.top;
                var wx = toWorld(px, py);
                var f = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
                var ns = Math.min(4, Math.max(0.15, cam.s * f));
                cam.x = px - wx.x * ns;
                cam.y = py - wx.y * ns;
                cam.s = ns;
                apply(); saveCam();
            }, { passive: false });
            function zoomAt(f) {
                var r = cv.getBoundingClientRect();
                var px = r.width / 2, py = r.height / 2;
                var wx = toWorld(px, py);
                var ns = Math.min(4, Math.max(0.15, cam.s * f));
                cam.x = px - wx.x * ns; cam.y = py - wx.y * ns; cam.s = ns;
                apply(); saveCam();
            }
            var zin = cv.querySelector('.wbp-tz-in'), zout = cv.querySelector('.wbp-tz-out'), zfit = cv.querySelector('.wbp-tz-fit');
            if (zin) zin.addEventListener('click', function () { zoomAt(1.25); });
            if (zout) zout.addEventListener('click', function () { zoomAt(1 / 1.25); });
            if (zfit) zfit.addEventListener('click', function () { cam = { x: 0, y: 0, s: 1 }; apply(); saveCam(); });
        });
    }
    function _teamHtml(team) {
        var btn = 'border:1px solid rgba(90,140,255,.5);border-radius:8px;background:rgba(90,140,255,.15);color:#cfe0ff;padding:4px 12px;cursor:pointer;font-size:12px';
        var tab = 'border:1px solid rgba(128,140,160,.4);border-radius:10px;padding:2px 10px;font-size:12px;cursor:pointer;background:transparent;color:inherit';
        var html = '';
        if (!team || !team.length) {
            html += '<div style="opacity:.65;font-size:12px;padding:28px 10px;text-align:center">' +
                (_teamScope === 'project'
                    ? '本项目还没有团队成员。<br>在对话里对 AI 说「帮我新增一名负责XX的成员」或「把当前对话加入团队」即可创建与管理。'
                    : '全局管家团暂无成员。') + '</div>';
            return html;
        }
        // 策划案三：三分区 👥常规 / 🎓专家 / 🛠工作台 —— v4 改为无限画布：成员卡为可拖拽节点，支持平移/缩放
        var all = [];
        var secTitle = { normal: '👥 常规', expert: '🎓 专家团', workbench: '🛠 工作台团队' };
        Object.keys(secTitle).forEach(function (k) {
            (team || []).forEach(function (m) {
                var t = m.type || (m.persona && /专家/.test(m.persona) ? 'expert' : 'normal');
                if (t === k) all.push({ m: m, sec: k });
            });
        });
        html += '<div class="wbp-team-canvas" style="position:relative;overflow:hidden;height:100%;border:none;border-radius:0;cursor:grab;user-select:none;background:radial-gradient(rgba(128,140,160,.18) 1px,transparent 1px);background-size:24px 24px">' +
            '<div class="wbp-team-world" style="position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform">';
        if (!all.length) {
            html += '<div style="position:absolute;left:24px;top:24px;opacity:.55;font-size:12px;white-space:nowrap">还没有成员，在对话里对 AI 说「新增/加入成员」即可。</div>';
        }
        all.forEach(function (it, i) {
            var pos = _teamPos(it.m.name) || { x: 40 + (i % 4) * 240, y: 40 + Math.floor(i / 4) * 190 };
            html += '<div class="wbp-team-node" data-name="' + esc(it.m.name) + '" style="position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;cursor:grab">' +
                '<div style="font-size:11px;opacity:.6;margin-bottom:2px;white-space:nowrap">' + secTitle[it.sec] + '</div>' +
                _memberCard(it.m, it.sec) + '</div>';
        });
        html += '</div>' +
            '<div class="wbp-team-zoom" style="position:absolute;right:8px;bottom:8px;display:flex;gap:4px;z-index:5">' +
            '<button class="wbp-tz-in" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(128,140,160,.4);background:rgba(30,30,40,.6);color:#fff;cursor:pointer">＋</button>' +
            '<button class="wbp-tz-out" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(128,140,160,.4);background:rgba(30,30,40,.6);color:#fff;cursor:pointer">－</button>' +
            '<button class="wbp-tz-fit" style="width:38px;height:26px;border-radius:6px;border:1px solid rgba(128,140,160,.4);background:rgba(30,30,40,.6);color:#fff;cursor:pointer;font-size:11px">复位</button>' +
            '</div>' +
            '';
        return html;
    }
    /* v4 无限画布：成员卡位置持久化（localStorage，按 scope+项目隔离） */
    function _teamPosKey() {
        return WBPANEL + ':teamPos:' + _teamScope + ':' + (_teamScope === 'project' ? pid() : 'global');
    }
    function _teamPosAll() {
        try { return JSON.parse(localStorage.getItem(_teamPosKey()) || '{}'); } catch (e) { return {}; }
    }
    function _teamPos(name) {
        return _teamPosAll()[name] || null;
    }
    function _teamPosSet(name, x, y) {
        var all = _teamPosAll();
        all[name] = { x: Math.round(x), y: Math.round(y) };
        try { localStorage.setItem(_teamPosKey(), JSON.stringify(all)); } catch (e) {}
    }
    function _memberCard(m, sec) {
        var fields = (m.fields && m.fields.length) ? m.fields.map(esc).join('、') : '—';
        var persona = String(m.persona || '').slice(0, 60);
        var delBtn = (_teamScope === 'global' && m.name === '主脑') ? '' :
            '<button class="wbp-team-del" data-name="' + esc(m.name) + '" title="删除成员（档案保留）" style="border:none;background:none;color:#e88;cursor:pointer;font-size:12px">✕</button>';
        var dispBtn = (sec === 'workbench') ?
            '<button class="wbp-team-dispatch" data-name="' + esc(m.name) + '" title="派出：展示接手简报" style="border:none;background:none;color:#7fdb8a;cursor:pointer;font-size:11px">📤</button>' : '';
        var extra = (sec === 'workbench') ?
            '<div style="font-size:10px;opacity:.6;margin-top:4px;line-height:1.5">' +
            ((m.relation && m.relation !== '团队成员') ? '<span class="wbp-team-rel" data-name="' + esc(m.name) + '" title="点击修改关系类型" style="cursor:pointer;color:#f6a;color:#ff6ea9;font-weight:700">💗 ' + esc(m.relation) + '</span> · ' : '') +
            (m.summary ? '📌 ' + esc(String(m.summary).slice(0, 80)) + (String(m.summary).length > 80 ? '…' : '') + '<br>' : '') +
            (m.paths && m.paths.length ? '📁 ' + m.paths.slice(0, 3).map(esc).join('<br>📁 ') + (m.paths.length > 3 ? ' 等' + m.paths.length + '项' : '') + '<br>' : '') +
            (m.chat_id ? '💬 ' + esc(m.chat_id) : '<span style="color:#da8">⚠ 无对话关联</span>') +
            '</div>' : '';
        return '<div style="border:1px solid rgba(128,140,160,.3);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.04)">' +
            '<div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px"><span style="flex:1">' + _avHtml + ' ' + esc(m.name || '') + '</span>' +
            '<button class="wbp-team-edit" data-name="' + esc(m.name) + '" title="编辑人设" style="border:none;background:none;color:#8ab4ff;cursor:pointer;font-size:11px">✎</button>' + dispBtn + delBtn + '</div>' +
            '<div style="font-size:11px;opacity:.75;margin-top:4px;line-height:1.5">' + esc(persona) + (String(m.persona || '').length > 60 ? '…' : '') + '</div>' +
            (sec === 'workbench' ? extra : '<div style="font-size:10px;opacity:.55;margin-top:4px">档案字段：' + fields + '</div>') +
            '</div>';
    }
    function renderTeam() {
        var el = pane('team');
        if (!el) return;
        var cached = curTeam();
        if (cached !== null) {
            el.innerHTML = _teamHtml(cached);   // 缓存秒显，不再显示"加载中"
            _bindTeamEvents(el);
            _fetchTeam(true);               // stale-while-revalidate：先显缓存，后台静默刷新
            return;
        }
        el.innerHTML = '<div style="opacity:.4;font-size:12px;padding:20px;text-align:center"><span class="wbp-skel">▰▰▰</span> 加载中…</div>';
        _fetchTeam();
    }
    var _lastTeamKey = null;
    function _fetchTeam(silent) {
        var el = pane('team');
        if (!el) return;
        var url = (_teamScope === 'global') ? '/api/butler/team' : '/api/butler/team?project=' + encodeURIComponent(pid());
        fetch(url).then(function (r) { return r.json(); }).then(function (j) {
            var team = (j && j.team) || [];
            var key = JSON.stringify(team);
            if (silent && key === _lastTeamKey) return;   // 静默刷新：内容没变不动 DOM，防闪烁
            _lastTeamKey = key;
            if (_teamScope === 'global') _teamCache.global = team;
            else _teamCache.project[pid()] = team;
            var el2 = pane('team');
            if (!el2) return;
            el2.innerHTML = _teamHtml(team);
            _bindTeamEvents(el2);
        }).catch(function (e) {
            if (silent) return;   // 静默刷新失败不打扰（缓存内容仍在显示）
            var el2 = pane('team');
            if (el2) el2.innerHTML = '<div style="color:#e88;font-size:12px">团队加载失败：' + esc(e.message || e) + '</div>';
        });
    }
    // 实时更新：团队页可见时每 15s 静默轮询，成员/人设变更自动上屏
    setInterval(function () {
        var t = document.querySelector('.wb-drawer .wb-tab[data-wbtab="ds-team"].active');
        if (t && pane('team')) _fetchTeam(true);
    }, 15000);

    // ===== 数据中心钉板页：/api/pins =====
    // 顶部进度条：载入/刷新期显示
    function _pinProgress(el, pct) {
        var view = el && el.parentElement;
        if (!view) return;
        var bar = view.querySelector('.wbp-load-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'wbp-load-bar';
            view.style.position = 'relative';
            view.appendChild(bar);
        }
        bar.style.width = pct + '%';
        if (pct >= 100) setTimeout(function () { var b = view.querySelector('.wbp-load-bar'); if (b) { b.style.width = '0%'; } }, 400);
    }
    function renderData() {
        var el = pane('pins');
        if (!el) return;
        _pinProgress(el, 15);
        if (!document.getElementById('wbp-pin-del-style')) {
            var st = document.createElement('style');
            st.id = 'wbp-pin-del-style';
            st.textContent = '.wbp-pin .wbp-pin-del{opacity:0!important;transition:opacity .15s}.wbp-pin:hover .wbp-pin-del{opacity:1!important}' +
                '.wbp-load-bar{position:absolute;left:0;top:0;height:3px;width:0;background:linear-gradient(90deg,#4a9eff,#7fdb8a);border-radius:2px;z-index:10;transition:width .25s;box-shadow:0 0 6px rgba(74,158,255,.6)}';
            document.head.appendChild(st);
        }
        // 清除旧的空态提示（挂在 view 层，不随相机变换）
        var view = el.parentElement;
        if (view) { var old = view.querySelector('.wbp-pin-hint'); if (old) old.parentNode.removeChild(old); }
        el.innerHTML = '<div style="opacity:.6;font-size:12px">加载中…</div>';
        _pinProgress(el, 45);
        fetch('/api/pins?project=' + encodeURIComponent(pid())).then(function (r) { return r.json(); }).then(function (j) {
            _pinProgress(el, 85);
            var pins = (j && (j.pins || j.items)) || [];
            if (!pins.length) {
                el.innerHTML = '';
                if (view) {
                    var hint = document.createElement('div');
                    hint.className = 'wbp-pin-hint';
                    hint.style.cssText = 'position:absolute;left:16px;top:16px;opacity:.6;font-size:12px;padding:20px;white-space:nowrap;pointer-events:none';
                    hint.textContent = '数据中心暂无钉住的指标。在对话里对 AI 说「把（某网站）的（某数值）钉到数据中心」即可创建。';
                    view.appendChild(hint);   // 挂 view 层：不随画布相机平移/缩放，保证可见
                }
                return;
            }
                    var pos = (j && j.pos) || {};   // 服务端持久化位置（跨重启）
            el.innerHTML = pins.map(function (p, i) {
                var key = p.id || ('idx' + i);   // id 兜底：空 id 用序号，防多卡片共享同一 pos 键
                var po = pos[key] || { x: 20 + (i % 5) * 210, y: 20 + Math.floor(i / 5) * 110 };
                // 迷你趋势图：数值类钉且有 >=2 条历史时生成 sparkline SVG
                var spark = '';
                var h = Array.isArray(p.history) ? p.history : [];
                if (h.length >= 2) {
                    var vs = h.map(function (x) { return x.v; });
                    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
                    if (mx > mn) {
                        var W = 90, H = 22, pts = vs.map(function (v, k) {
                            return (k / (vs.length - 1) * W).toFixed(1) + ',' + (H - 2 - (v - mn) / (mx - mn) * (H - 4)).toFixed(1);
                        }).join(' ');
                        spark = '<svg width="' + W + '" height="' + H + '" style="display:block;margin-top:4px" title="近' + h.length + '次记录 ' + mn + '~' + mx + '">' +
                            '<polyline points="' + pts + '" fill="none" stroke="#5ad" stroke-width="1.5"/></svg>';
                    }
                }
                return '<div class="wbp-pin" data-pin="' + esc(key) + '" style="position:absolute;left:' + po.x + 'px;top:' + po.y + 'px;width:190px;border:1px solid rgba(128,140,160,.3);border-radius:10px;padding:8px 10px;background:rgba(18,18,22,.92);cursor:pointer" title="拖拽摆放位置 / 点击刷新该指标">' +
                    '<div style="font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title || p.name || p.url || '') + '</div>' +
                    '<div style="font-size:18px;font-weight:800;margin-top:4px">' + esc(p.value != null ? String(p.value) : '—') + '</div>' +
                    spark +
                    '<div class="wbp-pin-del" data-del="' + esc(key) + '" title="删除该指标" style="display:block;position:absolute;right:6px;top:6px;z-index:5;width:18px;height:18px;line-height:16px;text-align:center;border-radius:50%;background:rgba(200,60,60,.85);color:#fff;font-size:12px;cursor:pointer;transition:opacity .15s">✕</div>' +
                    '</div>';
            }).join('');
            el.querySelectorAll('.wbp-pin').forEach(function (c) {
                c.addEventListener('click', function (e) {
                    if (c.dataset.dragMoved) return;
                    var del = e.target.closest('.wbp-pin-del');
                    if (del) {
                        e.stopPropagation();
                        var did = del.getAttribute('data-del');
                        var title = c.querySelector('div:nth-child(1)').textContent;
                        wbpConfirm('删除指标', '确定删除指标「' + title + '」吗？删除后不可恢复。', function () {
                            fetch('/api/pins', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ project: pid(), op: 'delete', id: did })
                            }).then(function (r) { return r.json(); }).then(function () { renderData(); })
                              .catch(function () { renderData(); });
                        });
                        return;
                    }
                    c.querySelector('div:nth-child(2)').textContent = '刷新中…';
                    fetch('/api/pins/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ project: pid(), id: c.getAttribute('data-pin') })
                    }).then(function (r) { return r.json(); }).then(function () { renderData(); })
                      .catch(function () { renderData(); });
                });
            });
            _pinProgress(el, 100);
        }).catch(function (e) {
            _pinProgress(el, 100);
            el.innerHTML = '<div style="color:#e88;font-size:12px">数据中心加载失败：' + esc(e.message || e) + '</div>';
        });
    }

    // ===== 挂载轮询（抽屉懒建/可重建 → 常驻低频检测，重建后自动重新注入） =====
    setInterval(function () { try { mountIntoWorkbench(); } catch (e) {} }, 1000);
})();
