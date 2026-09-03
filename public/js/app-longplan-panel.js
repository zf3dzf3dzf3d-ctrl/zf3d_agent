// ========== app-longplan-panel.js - 右侧面板「长任务」Tab ==========
// 列出所有超长计划（lp-*.md），展示每步状态；支持：
//  1. 「从这里开始做」→ 新建对话并自动发送续做指令（接力执行）
//  2. 并行分段：选择起点批量开多个对话分段认领，加速完成
(function() {
    // 兜底：本文件在 app.js 之前加载，App 可能尚未定义（不能直接 return，
    // 否则 _loadLongPlanPanel 永远注册不上，任务面板「长任务」Tab 报"尚未就绪"）
    window.App = window.App || {};
    var App = window.App;
    Object.assign(App, {
        _lpCache: [],
        _lpLoaded: false,

        _loadLongPlanPanel: function() {
            var self = this;
            var body = document.getElementById('longPlanPanelBody');
            if (!body) return;
            // 性能优化：有缓存先秒开渲染，再后台刷新最新数据
            if (self._lpCache && self._lpCache.length) {
                self._renderLongPlanPanel();
            }
            var reqStart = Date.now();
            fetch('/api/tools/long_plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list', light: true })
            }).then(function(r) { return r.json(); }).then(function(data) {
                self._lpCache = (data && data.plans) || [];
                self._lpLoaded = true;
                // 数据没变化时跳过重渲染，避免闪烁；首次（无缓存）必渲染
                if (!self._lpRenderedAt || JSON.stringify(self._lpCache) !== self._lpLastJson) {
                    self._lpLastJson = JSON.stringify(self._lpCache);
                    self._lpRenderedAt = Date.now();
                    self._renderLongPlanPanel();
                }
            }).catch(function() {
                if (!self._lpCache || !self._lpCache.length) {
                    body.innerHTML = '<div class="tp-empty">超长计划加载失败</div>';
                }
            });
        },

        _renderLongPlanPanel: function() {
            var self = this;
            var body = document.getElementById('longPlanPanelBody');
            if (!body) return;
            if (!self._lpCache.length) {
                body.innerHTML = '<div class="tp-empty">暂无超长计划。<br>对智能体说「创建一个50步的超长计划：...」即可。</div>';
                return;
            }
            var html = '<div style="padding:8px 10px 4px;font-size:12px;color:var(--text-sub,#888);">超长计划（MD 持久化，多对话接力执行）</div>';
            self._lpCache.forEach(function(p) {
                var pct = p.total ? Math.round(p.done * 100 / p.total) : 0;
                var badge = p.finished ? '<span style="color:#2e7d32;">✅ 已完成</span>'
                    : '<span style="color:#b26a00;">⏳ ' + p.done + '/' + p.total + '（' + pct + '%）</span>';
                html += '<div class="lp-plan-card" data-plan="' + p.plan_id + '" style="margin:6px 10px;padding:10px;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--bg,#fff);">'
                    + '<div style="font-weight:600;font-size:13px;margin-bottom:4px;">📜 ' + (p.title || p.plan_id) + '</div>'
                    + '<div style="font-size:11px;color:var(--text-sub,#888);margin-bottom:4px;">' + p.plan_id + ' · ' + badge + '</div>'
                    + '<div style="height:5px;border-radius:3px;background:var(--border,#eee);margin-bottom:8px;overflow:hidden;">'
                    + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#4caf50,#8bc34a);"></div></div>'
                    + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
                    + '<button class="lp-btn-detail" data-plan="' + p.plan_id + '" style="font-size:12px;padding:3px 8px;border:1px solid var(--border,#555);border-radius:5px;background:transparent;color:var(--text,#e8e8ea);cursor:pointer;">📋 查看步骤</button>'
                    + (p.finished ? '' :
                        '<button class="lp-btn-continue" data-plan="' + p.plan_id + '" style="font-size:11px;padding:3px 8px;border:none;border-radius:5px;background:#4caf50;color:#fff;cursor:pointer;">▶ 从这里开始做</button>'
                        + '<button class="lp-btn-parallel" data-plan="' + p.plan_id + '" style="font-size:11px;padding:3px 8px;border:none;border-radius:5px;background:#1e88e5;color:#fff;cursor:pointer;">⚡ 并行分段执行</button>')
                    + '</div>'
                    + '<div class="lp-detail" style="display:none;margin-top:8px;"></div>'
                    + '</div>';
            });
            body.innerHTML = html;

            // 展开步骤详情
            body.querySelectorAll('.lp-btn-detail').forEach(function(btn) {
                btn.addEventListener('click', function() { self._togglePlanDetail(btn.getAttribute('data-plan'), btn); });
            });

            // 默认展开所有计划的步骤详情
            body.querySelectorAll('.lp-btn-detail').forEach(function(btn) {
                self._togglePlanDetail(btn.getAttribute('data-plan'), btn);
            });
            // 从这里开始做：新建对话 + 自动发续做消息
            body.querySelectorAll('.lp-btn-continue').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    self._lpStartFrom(btn.getAttribute('data-plan'), null);
                });
            });
            // 并行分段执行
            body.querySelectorAll('.lp-btn-parallel').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    self._lpShowParallelConfig(btn.getAttribute('data-plan'));
                });
            });
        },

        _togglePlanDetail: function(planId, btn) {
            var card = btn.closest('.lp-plan-card');
            var box = card && card.querySelector('.lp-detail');
            if (!box) return;
            if (box.style.display !== 'none') { box.style.display = 'none'; return; }
            box.style.display = '';
            box.innerHTML = '<div style="font-size:11px;color:var(--text-sub,#888);">加载中...</div>';
            fetch('/api/tools/long_plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'stats', plan_id: planId })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (!data || !data.ok) { box.innerHTML = '<div style="font-size:11px;color:#c62828;">加载失败</div>'; return; }
                var steps = data.steps || [];
                var icons = { completed: '✅', skipped: '⏭️', pending: '⬜' };
                var html = '<div style="max-height:260px;overflow-y:auto;font-size:11px;line-height:1.9;">';
                steps.forEach(function(s) {
                    html += '<div style="display:flex;align-items:center;gap:4px;" class="lp-step-row" data-no="' + s.no + '">'
                        + '<span>' + (icons[s.status] || '⬜') + '</span>'
                        + '<span style="flex:1;">' + s.no + '. ' + App._lpEscape(s.title || '') + '</span>'
                        + (s.status === 'pending' ? '<button class="lp-btn-step-start" data-plan="' + planId + '" data-no="' + s.no + '" title="从此步开始" style="font-size:10px;padding:1px 6px;border:1px solid var(--border,#555);border-radius:4px;background:transparent;color:var(--text,#e8e8ea);cursor:pointer;">▶</button>' : '')
                        + '</div>';
                });
                html += '</div>';
                box.innerHTML = html;
                box.querySelectorAll('.lp-btn-step-start').forEach(function(b) {
                    b.addEventListener('click', function() {
                        App._lpStartFrom(b.getAttribute('data-plan'), parseInt(b.getAttribute('data-no'), 10));
                    });
                });
            }).catch(function() {
                box.innerHTML = '<div style="font-size:11px;color:#c62828;">加载失败</div>';
            });
        },

        // 收集派单上下文：用户原始超长任务 + 源对话最近几轮摘要，随续做指令带给新对话
        _lpCollectContext: function(planId) {
            try {
                var boxes = (typeof App.chatBoxes !== 'undefined' && App.chatBoxes) ? App.chatBoxes : [];
                if (!boxes.length) return '';
                // 判断一个对话是否是"派生对话"（首条用户消息就是派单/续做指令，不是用户原始任务）
                function isDerived(c) {
                    for (var d = 0; d < c.history.length; d++) {
                        var dm = c.history[d];
                        if (!dm || dm.role !== 'user') continue;
                        var txt = String(dm.content || '');
                        // 跳过守卫注入等非真实消息
                        if (dm._guardInject || dm._maxDepthRecovery || dm._verifyRound || dm._continueRound
                            || txt.indexOf('🐕【小狗守卫巡查报告】') === 0) continue;
                        return txt.indexOf('继续执行超长计划') === 0;
                    }
                    return false;
                }
                // 优先选提到该计划/超长任务的非派生源对话，否则选历史最长的非派生对话，最后兜底选历史最长的
                var src = null, srcMention = null;
                for (var i = 0; i < boxes.length; i++) {
                    var c = boxes[i];
                    if (!c || !c.history || !c.history.length) continue;
                    var eligible = !isDerived(c);
                    if (eligible && c.history.length > ((src && src.history && src.history.length) || 0)) src = c;
                    for (var j = 0; j < c.history.length; j++) {
                        var m = c.history[j];
                        if (m && m.role === 'user' && String(m.content || '').indexOf(planId) >= 0) { if (eligible) srcMention = c; break; }
                    }
                }
                src = srcMention || src;
                if (!src) { // 全是派生对话时兜底取最长的
                    for (var i2 = 0; i2 < boxes.length; i2++) {
                        if (boxes[i2] && boxes[i2].history && boxes[i2].history.length > ((src && src.history && src.history.length) || 0)) src = boxes[i2];
                    }
                }
                if (!src) return '';
                var out = '';
                // 1) 原始用户任务：第一条真实用户消息（跳过守卫/注入/续做指令）
                var firstUser = null;
                for (var j2 = 0; j2 < src.history.length; j2++) {
                    var m2 = src.history[j2];
                    if (m2 && m2.role === 'user' && !m2._guardInject && !m2._maxDepthRecovery && !m2._verifyRound && !m2._continueRound
                        && String(m2.content || '').indexOf('🐕【小狗守卫巡查报告】') !== 0
                        && String(m2.content || '').indexOf('继续执行超长计划') !== 0) { firstUser = m2; break; }
                }
                if (firstUser) {
                    out += '\n\n【用户原始超长任务（背景，来自源对话）】\n'
                        + String(firstUser.content).slice(0, 2000);
                }
                // 2) 源对话最近几轮摘要（最多 6 条，每条 400 字）
                var tail = src.history.slice(-6), parts = [];
                for (var k = 0; k < tail.length; k++) {
                    var t = tail[k];
                    if (!t || !t.content) continue;
                    parts.push((t.role === 'user' ? '用户' : 'AI') + ': '
                        + String(t.content).replace(/\s+/g, ' ').slice(0, 400));
                }
                if (parts.length) {
                    out += '\n\n【源对话最近交流摘要（背景，供参考）】\n' + parts.join('\n');
                }
                return out;
            } catch (e) { return ''; }
        },

        // 核心按钮：新建对话并发送续做指令（from_step 可指定起点）
        _lpStartFrom: function(planId, fromStep) {
            var self = this;
            var msg = '继续执行超长计划 ' + planId
                + '：请先调用 long_plan.stats(plan_id="' + planId + '") 查看进度，'
                + '然后调用 plan_batch.claim(plan_id="' + planId + '"'
                + (fromStep ? ', from_step=' + fromStep : '')
                + ') 认领下一批步骤并逐项执行，每完成一步立即 plan_batch.report 汇报。'
                + self._lpCollectContext(planId);
            // 若当前画布没有对话或用户点了具体起点，都开新对话
            var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var x = 60 + Math.floor(Math.random() * 200);
            var y = 60 + Math.floor(Math.random() * 150);
            var chat = (typeof App.createChatBox === 'function') ? App.createChatBox(x, y, null) : null;
            if (!chat) { if (App.toast) App.toast('创建对话失败'); return; }
            setTimeout(function() {
                try {
                    var input = chat.el.querySelector('textarea');
                    self.addMsg(chat.el, msg, 'user', chat.modelId);
                    self.showQueryPin(chat.el, msg);
                    self.updateChatTitle(chat.el, msg);
                    chat.history.push({ role: 'user', content: msg });
                    Store.addLog('info', chat.id, 'send', '长任务续做: ' + planId + (fromStep ? ' from ' + fromStep : ''));
                    self.sendToModel(chat.el, chat);
                    if (self.closeTaskPanel) self.closeTaskPanel();
                } catch (e) { console.error('[LongPlanPanel]', e); }
            }, 150);
        },

        // 并行分段：选择起点×段数，自动开多个对话分段认领
        _lpShowParallelConfig: function(planId) {
            var self = this;
            var body = document.getElementById('longPlanPanelBody');
            if (!body) return;
            fetch('/api/tools/long_plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'stats', plan_id: planId })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (!data || !data.ok) return;
                var pending = (data.steps || []).filter(function(s) { return s.status === 'pending'; });
                if (!pending.length) { if (App.toast) App.toast('没有待做步骤'); return; }
                var html = '<div style="margin:8px 10px;padding:10px;border:1px dashed var(--border,#bbb);border-radius:8px;">'
                    + '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">⚡ 并行分段执行（把待做步骤拆给多个对话同时做）</div>'
                    + '<div style="font-size:11px;color:var(--text-sub,#888);margin-bottom:6px;">待做 ' + pending.length + ' 步：'
                    + pending.map(function(s) { return s.no; }).join(', ') + '</div>'
                    + '<label style="font-size:11px;">分段数：'
                    + '<select id="lpParallelCount" style="margin:0 6px;">';
                for (var i = 2; i <= 6; i++) html += '<option value="' + i + '">' + i + ' 个对话</option>';
                html += '</select></label>'
                    + '<div style="margin-top:8px;display:flex;gap:6px;">'
                    + '<button id="lpParallelGo" style="font-size:11px;padding:4px 10px;border:none;border-radius:5px;background:#1e88e5;color:#fff;cursor:pointer;">🚀 开始并行执行</button>'
                    + '<button id="lpParallelCancel" style="font-size:11px;padding:4px 10px;border:1px solid var(--border,#ccc);border-radius:5px;background:transparent;cursor:pointer;">取消</button>'
                    + '</div><div id="lpParallelPreview" style="font-size:11px;color:var(--text-sub,#888);margin-top:6px;"></div></div>';
                var holder = document.createElement('div');
                holder.innerHTML = html;
                body.insertBefore(holder.firstChild, body.firstChild.nextSibling);

                var countSel = document.getElementById('lpParallelCount');
                var preview = document.getElementById('lpParallelPreview');
                function updatePreview() {
                    var n = parseInt(countSel.value, 10);
                    var per = Math.ceil(pending.length / n);
                    var parts = [];
                    for (var i = 0; i < n; i++) {
                        var seg = pending.slice(i * per, (i + 1) * per);
                        if (seg.length) parts.push('对话' + (i + 1) + ': 步骤 ' + seg[0].no + '-' + seg[seg.length - 1].no);
                    }
                    preview.textContent = parts.join(' | ');
                }
                updatePreview();
                countSel.addEventListener('change', updatePreview);
                document.getElementById('lpParallelCancel').addEventListener('click', function() { holder.remove(); self._renderLongPlanPanel(); });
                document.getElementById('lpParallelGo').addEventListener('click', function() {
                    var n = parseInt(countSel.value, 10);
                    var per = Math.ceil(pending.length / n);
                    var started = 0;
                    for (var i = 0; i < n; i++) {
                        var seg = pending.slice(i * per, (i + 1) * per);
                        if (!seg.length) continue;
                        (function(seg) {
                            setTimeout(function() {
                                App._lpStartFrom(planId, seg[0].no);
                                started++;
                            }, i * 500);
                        })(seg);
                    }
                });
            });
        },

        _lpEscape: function(s) {
            return String(s || '').replace(/[&<>"]/g, function(c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        }
    });
})();
