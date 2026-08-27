// ============================================================
// app-userinfo.js — 左上角浮动图标 → 用户信息列表面板
// 功能：对话列表（今日/历史）、每条用户问题及成败状态、
//       时间显示、搜索筛选、一键重建对话窗口（带历史）
// ============================================================
var UserInfo = {
    open: false,
    data: null,          // { sessions: [...], todayStart }
    filterStatus: 'all', // all / ok / fail / pending
    keyword: '',
    expanded: {},        // sid -> bool

    init: function() {
        var self = this;
        if (document.getElementById('ui-fab')) return;

        // ---- 浮动图标（左上角）----
        var fab = document.createElement('div');
        fab.id = 'ui-fab';
        fab.title = '用户信息列表';
        fab.innerHTML = '<span class="ui-fab-icon">📋</span><span class="ui-fab-badge" style="display:none">0</span>';
        document.body.appendChild(fab);
        fab.addEventListener('click', function() { self.togglePanel(); });

        // ---- 面板 ----
        var panel = document.createElement('div');
        panel.id = 'ui-panel';
        panel.style.display = 'none';
        panel.innerHTML =
            '<div class="ui-header">' +
                '<div class="ui-title">📋 用户信息列表</div>' +
                '<button class="ui-refresh" title="刷新数据">↻</button>' +
                '<button class="ui-close" title="关闭">✕</button>' +
            '</div>' +
            '<div class="ui-today">今日统计：加载中…</div>' +
            '<div class="ui-toolbar">' +
                '<input class="ui-search" type="text" placeholder="🔍 搜索问题内容…"/>' +
                '<select class="ui-filter">' +
                    '<option value="all">全部状态</option>' +
                    '<option value="ok">✅ 已完成</option>' +
                    '<option value="fail">❌ 未完成</option>' +
                    '<option value="pending">⏳ 无记录</option>' +
                '</select>' +
            '</div>' +
            '<div class="ui-list"></div>';
        document.body.appendChild(panel);

        panel.querySelector('.ui-close').addEventListener('click', function() { self.hidePanel(); });
        panel.querySelector('.ui-refresh').addEventListener('click', function() { self.load(); });
        panel.querySelector('.ui-search').addEventListener('input', function() {
            self.keyword = this.value.trim();
            self.render();
        });
        panel.querySelector('.ui-filter').addEventListener('change', function() {
            self.filterStatus = this.value;
            self.render();
        });

        // 点击面板外关闭
        document.addEventListener('click', function(e) {
            if (!self.open) return;
            if (panel.contains(e.target) || fab.contains(e.target)) return;
            self.hidePanel();
        }, true);
    },

    togglePanel: function() { this.open ? this.hidePanel() : this.showPanel(); },

    showPanel: function() {
        this.open = true;
        var p = document.getElementById('ui-panel');
        if (p) p.style.display = 'flex';
        this.load();
    },

    hidePanel: function() {
        this.open = false;
        var p = document.getElementById('ui-panel');
        if (p) p.style.display = 'none';
    },

    load: function() {
        var self = this;
        var listEl = document.querySelector('#ui-panel .ui-list');
        if (listEl) listEl.innerHTML = '<div class="ui-empty">⏳ 加载中…</div>';
        fetch('/api/db/stats?view=userlist').then(function(r) { return r.json(); }).then(function(res) {
            if (!res || !res.ok) { self._err(listEl, '数据加载失败'); return; }
            self.data = res.data || {};
            self.render();
        }).catch(function() { self._err(listEl, '网络错误，无法连接数据库'); });
    },

    _err: function(el, msg) {
        if (el) el.innerHTML = '<div class="ui-empty">⚠️ ' + msg + '</div>';
        var t = document.querySelector('#ui-panel .ui-today');
        if (t) t.textContent = '今日统计：加载失败';
    },

    _fmtTime: function(ts) {
        if (!ts) return '--';
        try {
            var d = new Date(Number(ts));
            var hh = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2);
            var mo = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
            var now = new Date();
            var isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
            return isToday ? ('今日 ' + hh + ':' + mm) : (mo + '-' + dd + ' ' + hh + ':' + mm);
        } catch (e) { return '--'; }
    },

    _fmtDur: function(ms) {
        if (!ms || ms < 0) return '';
        if (ms < 60000) return Math.round(ms / 1000) + '秒';
        if (ms < 3600000) return Math.round(ms / 60000) + '分';
        return (ms / 3600000).toFixed(1) + '时';
    },

    render: function() {
        var self = this;
        var panel = document.getElementById('ui-panel');
        if (!panel || !this.data) return;
        var listEl = panel.querySelector('.ui-list');

        var sessions = (this.data.sessions || []).slice();
        var todayStart = this.data.todayStart || 0;

        // ---- 今日统计 ----
        var todaySess = sessions.filter(function(s) { return (s.lastTs || 0) >= todayStart; });
        var tQ = 0, tOk = 0, tFail = 0, tPend = 0;
        todaySess.forEach(function(s) {
            (s.questions || []).forEach(function(q) {
                tQ++;
                if (q.ok === 1) tOk++; else if (q.ok === 0) tFail++; else tPend++;
            });
        });
        panel.querySelector('.ui-today').innerHTML =
            '📅 今日统计：<b>' + todaySess.length + '</b> 个对话 · ' +
            tQ + ' 个问题 · <span class="ui-ok">✅' + tOk + '</span> · <span class="ui-fail">❌' + tFail + '</span>' +
            (tPend ? ' · <span class="ui-pend">⏳' + tPend + '</span>' : '');

        // ---- 筛选 ----
        var kw = this.keyword.toLowerCase();
        var status = this.filterStatus;
        sessions = sessions.filter(function(s) {
            if (kw) {
                var hit = false;
                (s.questions || []).some(function(q) {
                    if ((q.text || '').toLowerCase().indexOf(kw) >= 0) { hit = true; return true; }
                    return false;
                });
                if (!hit) return false;
            }
            if (status !== 'all') {
                var has = (s.questions || []).some(function(q) {
                    return status === 'ok' ? q.ok === 1 : (status === 'fail' ? q.ok === 0 : q.ok === null || q.ok === undefined);
                });
                if (!has) return false;
            }
            return true;
        });

        if (sessions.length === 0) {
            listEl.innerHTML = '<div class="ui-empty">🔍 没有匹配的对话记录</div>';
            return;
        }

        // ---- 分组：今日对话 / 历史对话 ----
        var today = [], hist = [];
        sessions.forEach(function(s) {
            ((s.lastTs || 0) >= todayStart ? today : hist).push(s);
        });

        var html = '';
        if (today.length) html += '<div class="ui-group-title">🕐 今日对话（' + today.length + '）</div>';
        today.forEach(function(s) { html += self._renderSess(s); });
        if (hist.length) html += '<div class="ui-group-title">📚 历史对话（' + hist.length + '）</div>';
        hist.forEach(function(s) { html += self._renderSess(s); });

        listEl.innerHTML = html;

        // 绑定事件
        listEl.querySelectorAll('.ui-sess-head').forEach(function(h) {
            h.addEventListener('click', function() {
                var sid = h.getAttribute('data-sid');
                self.expanded[sid] = !self.expanded[sid];
                self._applyExpanded();
            });
        });
        listEl.querySelectorAll('.ui-rebuild').forEach(function(b) {
            b.addEventListener('click', function(e) {
                e.stopPropagation();
                var sid = b.getAttribute('data-sid');
                self.rebuildWindow(sid, b);
            });
        });
        this._applyExpanded();
    },

    _renderSess: function(s) {
        var qsHtml = '';
        (s.questions || []).forEach(function(q, i) {
            var cls = q.ok === 1 ? 'ok' : (q.ok === 0 ? 'fail' : 'pend');
            var icon = q.ok === 1 ? '✅' : (q.ok === 0 ? '❌' : '⏳');
            qsHtml +=
                '<div class="ui-q ' + cls + '">' +
                    '<span class="ui-q-icon">' + icon + '</span>' +
                    '<span class="ui-q-num">' + (i + 1) + '</span>' +
                    '<span class="ui-q-text" title="' + (q.text || '').replace(/"/g, '&quot;') + '">' + (q.text || '(空)') + '</span>' +
                    '<span class="ui-q-time">' + this._fmtTime(q.ts) + '</span>' +
                '</div>';
        }, this);
        if (!qsHtml) qsHtml = '<div class="ui-q pend"><span class="ui-q-icon">⏳</span><span class="ui-q-text">无用户问题记录</span></div>';

        var title = '对话 ' + (s.sid || '?');
        var html =
            '<div class="ui-sess" data-sid="' + s.sid + '">' +
                '<div class="ui-sess-head" data-sid="' + s.sid + '">' +
                    '<span class="ui-caret">▸</span>' +
                    '<span class="ui-sess-title">💬 ' + title + '</span>' +
                    '<span class="ui-sess-time">' + this._fmtTime(s.lastTs) + '</span>' +
                    '<button class="ui-rebuild" data-sid="' + s.sid + '" title="以该对话历史新建窗口">⊞ 新建窗口</button>' +
                '</div>' +
                '<div class="ui-sess-body">' + qsHtml + '</div>' +
            '</div>';
        return html;
    },

    _applyExpanded: function() {
        var self = this;
        document.querySelectorAll('#ui-panel .ui-sess').forEach(function(el) {
            var sid = el.getAttribute('data-sid');
            var isOpen = !!self.expanded[sid];
            el.classList.toggle('open', isOpen);
            var caret = el.querySelector('.ui-caret');
            if (caret) caret.textContent = isOpen ? '▾' : '▸';
        });
    },

    // ===== 一键重建新窗口（带历史信息）=====
    rebuildWindow: function(sid, btn) {
        var self = this;
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

        fetch('/api/db/chat/' + sid).then(function(r) { return r.json(); }).then(function(res) {
            if (!res || !res.ok || !res.data || res.data.length === 0) {
                self._toast('⚠️ 该对话没有可恢复的历史消息', 'fail');
                if (btn) { btn.disabled = false; btn.textContent = '⊞ 新建窗口'; }
                return;
            }
            var msgs = res.data.filter(function(m) {
                return m.role === 'user' || m.role === 'assistant' || m.role === 'system';
            });

            // 创建新窗口
            var app = window.App || window.app;
            if (!app || !app.createChatBox) {
                self._toast('⚠️ 应用未就绪', 'fail');
                if (btn) { btn.disabled = false; btn.textContent = '⊞ 新建窗口'; }
                return;
            }
            var modelId = msgs.length ? (msgs[0].model_id || msgs[0].modelId || null) : null;
            var chat = app.createChatBox({ modelId: modelId, title: '恢复: ' + sid });

            var body = chat.el.querySelector('.chatbox-body');
            var added = 0;
            msgs.forEach(function(m) {
                var whoCls = m.role === 'user' ? 'user' : 'ai';
                var div = document.createElement('div');
                div.className = 'msg ' + whoCls;
                app.setMsgContent(div, m.content, whoCls);
                body.appendChild(div);
                chat.history.push({ role: m.role, content: m.content });
                Store.addMessage(chat.id, m.role, m.content, 'text', chat.modelId);
                added++;
            });
            body.scrollTop = body.scrollHeight;
            if (app.updateMinimap) app.updateMinimap();

            // 关闭面板，聚焦新窗口
            self.hidePanel();
            if (app.activate) app.activate(chat.el);
            if (typeof app.canvasFocusChat === 'function') app.canvasFocusChat(chat.id);
            else if (app.setCamera) app.setCamera({ target: 'chat:' + chat.id });

            self._toast('✅ 已重建窗口，恢复 ' + added + ' 条消息', 'ok');
        }).catch(function() {
            self._toast('⚠️ 恢复失败：网络错误', 'fail');
            if (btn) { btn.disabled = false; btn.textContent = '⊞ 新建窗口'; }
        });
    },

    _toast: function(msg, type) {
        if (typeof Toast !== 'undefined' && Toast.show) { Toast.show(msg); return; }
        if (window.showToast) { window.showToast(msg); return; }
        var t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:8px;z-index:99999;font-size:13px;';
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 2600);
    }
};

// 自动初始化
(function() {
    function boot() { try { UserInfo.init(); } catch (e) { console.error('UserInfo init failed', e); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
