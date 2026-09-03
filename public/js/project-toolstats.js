// ========== project-toolstats.js - 工具统计面板（使用频率/出错明细） ==========
// 拆分自 app-chatbox-projects.js（原 435~692 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 🔧 工具面板 =====
        toggleToolPanel: function(box) {
            var tp = box.querySelector('.chatbox-toolpanel');
            var body = box.querySelector('.chatbox-body');
            var btn = box.querySelector('.tool-panel-btn');
            if (!tp) return;
            if (tp.classList.contains('open')) {
                tp.classList.remove('open');
                if (body) body.style.display = '';
                if (btn) btn.innerHTML = '🔧<span class="tool-badge" style="display:none">0</span>';
            } else {
                var _lp = box.querySelector('.chatbox-logpanel');
                if (_lp) _lp.classList.remove('open');
                tp.classList.add('open');
                if (body) body.style.display = 'none';
                var tpBody = tp.querySelector('.chatbox-toolpanel-body');
                if (tpBody) tpBody.scrollTop = tpBody.scrollHeight;
                if (btn) btn.innerHTML = '💬<span class="tool-badge" style="display:none">0</span>';
                // ===== 工具统计面板：打开面板时渲染使用频率图表 + 错误汇总 =====
                try { this.renderToolStats(box); } catch (e) { console.error('[toolstats]', e); }
            }
        },

        // ===== 📊 工具统计（使用频率图表 + 出错明细 + 一键复制）=====
        _toolStatsPalette: ['#5b8cff', '#8f6bff', '#35c296', '#e8a851', '#e8657a', '#4ec3e0', '#c66bd4', '#7f95b8'],

        // 收集面板内工具卡片：调用次数、上下文文本估算（约4字符=1 token）和失败明细
        _toolStatsCollect: function(box) {
            var tp = box.querySelector('.chatbox-toolpanel');
            var body = tp ? (tp.querySelector('.chatbox-toolpanel-body') || box.querySelector('.chatbox-body')) : null;
            var counts = {}, context = {}, order = [], fails = [], total = 0, failTotal = 0, contextTotal = 0;
            if (body) {
                var cards = body.querySelectorAll('.tool-wrap');
                for (var i = 0; i < cards.length; i++) {
                    var card = cards[i];
                    var name = card.getAttribute('data-tool') || 'unknown';
                    if (!counts[name]) { counts[name] = 0; context[name] = 0; order.push(name); }
                    counts[name]++;
                    var bodyEl = card.querySelector('.tool-wrap__body');
                    var chars = bodyEl ? String(bodyEl.textContent || '').replace(/\s+/g, ' ').trim().length : 0;
                    var tokens = Math.ceil(chars / 4);
                    context[name] += tokens;
                    contextTotal += tokens;
                    total++;
                    if (card.classList.contains('tool-wrap--fail')) {
                        failTotal++;
                        var resEl = card.querySelector('.tool-wrap__result');
                        var msg = resEl ? String(resEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
                        fails.push({ name: name, msg: msg });
                    }
                }
            }
            var sorted = order.map(function(n) { return { name: n, count: counts[n] }; });
            var contextSorted = order.map(function(n) { return { name: n, tokens: context[n], count: counts[n] }; });
            sorted.sort(function(a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
            contextSorted.sort(function(a, b) { return b.tokens - a.tokens || (a.name < b.name ? -1 : 1); });
            return { total: total, failTotal: failTotal, sorted: sorted, contextSorted: contextSorted, contextTotal: contextTotal, fails: fails, kinds: order.length };
        },

        _toolStatsEsc: function(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        // 渲染统计区（不存在则注入到 header 与 body 之间）
        renderToolStats: function(box) {
            var self = this;
            var tp = box.querySelector('.chatbox-toolpanel');
            var tpBody = tp ? tp.querySelector('.chatbox-toolpanel-body') : null;
            if (!tp || !tpBody) return;

            var st = this._toolStatsCollect(box);
            var statsEl = tp.querySelector('.chatbox-toolstats');
            if (!statsEl) {
                statsEl = document.createElement('div');
                statsEl.className = 'chatbox-toolstats';
                tp.insertBefore(statsEl, tpBody);
            }
            var collapsed = statsEl.classList.contains('toolstats-collapsed');

            // ---- 频率条形图（Top 10，其余折叠为"其他"）----
            var barHtml = '';
            var show = st.sorted.slice(0, 10);
            var rest = st.sorted.length - show.length;
            var maxCount = show.length ? show[0].count : 0;
            for (var i = 0; i < show.length; i++) {
                var it = show[i];
                var pct = st.total ? (it.count * 100 / st.total) : 0;
                var width = maxCount ? Math.max(4, Math.round(it.count * 100 / maxCount)) : 4;
                var color = this._toolStatsPalette[i % this._toolStatsPalette.length];
                var icon = (typeof Tools !== 'undefined' && Tools._toolIcon) ? Tools._toolIcon(it.name) : '🔧';
                barHtml += '<div class="toolstats-row">' +
                    '<span class="toolstats-name" title="' + this._toolStatsEsc(it.name) + '">' + icon + ' ' + this._toolStatsEsc(it.name) + '</span>' +
                    '<div class="toolstats-bar"><div class="toolstats-fill" style="width:' + width + '%;background:' + color + '"></div></div>' +
                    '<span class="toolstats-count">' + it.count + '次 ' + pct.toFixed(1) + '%</span>' +
                '</div>';
            }
            if (rest > 0) barHtml += '<div class="toolstats-more">… 还有 ' + rest + ' 种工具未列出（复制可见全部）</div>';

            // ---- 上下文占用排行（按工具卡片参数+结果文本估算）----
            var contextHtml = '';
            var contextShow = st.contextSorted.slice(0, 10);
            var contextRest = st.contextSorted.length - contextShow.length;
            var maxTokens = contextShow.length ? contextShow[0].tokens : 0;
            for (var j = 0; j < contextShow.length; j++) {
                var ctx = contextShow[j];
                var contextPct = st.contextTotal ? (ctx.tokens * 100 / st.contextTotal) : 0;
                var contextWidth = maxTokens ? Math.max(4, Math.round(ctx.tokens * 100 / maxTokens)) : 4;
                var contextColor = this._toolStatsPalette[j % this._toolStatsPalette.length];
                var contextIcon = (typeof Tools !== 'undefined' && Tools._toolIcon) ? Tools._toolIcon(ctx.name) : '🔧';
                contextHtml += '<div class="toolstats-row">' +
                    '<span class="toolstats-name" title="' + this._toolStatsEsc(ctx.name) + '">' + contextIcon + ' ' + this._toolStatsEsc(ctx.name) + '</span>' +
                    '<div class="toolstats-bar"><div class="toolstats-fill" style="width:' + contextWidth + '%;background:' + contextColor + '"></div></div>' +
                    '<span class="toolstats-count">' + ctx.tokens.toLocaleString() + ' ~tok ' + contextPct.toFixed(1) + '%</span>' +
                '</div>';
            }
            if (contextRest > 0) contextHtml += '<div class="toolstats-more">… 还有 ' + contextRest + ' 种工具未列出（复制可见全部）</div>';

            // ---- 出错摘要（按工具聚合，展示最近一次错误内容）----
            var failHtml = '';
            if (st.failTotal > 0) {
                var byName = {}, failOrder = [];
                st.fails.forEach(function(f) {
                    if (!byName[f.name]) { byName[f.name] = []; failOrder.push(f.name); }
                    byName[f.name].push(f.msg);
                });
                failOrder.sort(function(a, b) { return byName[b].length - byName[a].length; });
                failHtml += '<div class="toolstats-fail-title">❌ 出错 ' + st.failTotal + ' 处 · 涉及 ' + failOrder.length + ' 个工具</div>';
                failOrder.forEach(function(n) {
                    var msgs = byName[n];
                    var last = msgs[msgs.length - 1] || '(无错误详情)';
                    failHtml += '<div class="toolstats-fail-row">' +
                        '<span class="toolstats-fail-name">' + self._toolStatsEsc(n) + ' ×' + msgs.length + '</span>' +
                        '<span class="toolstats-fail-msg" title="' + self._toolStatsEsc(msgs.join('\n---\n')) + '">' +
                            self._toolStatsEsc(last.length > 140 ? last.slice(0, 140) + '…' : last) + '</span>' +
                    '</div>';
                });
            }

            var activeView = statsEl.getAttribute('data-view') || 'usage';
            statsEl.innerHTML =
                '<div class="toolstats-header">' +
                    '<span class="toolstats-title">📊 工具统计</span>' +
                    '<span class="toolstats-sum">' + (activeView === 'context' ? '上下文约 <b>' + st.contextTotal.toLocaleString() + '</b> tokens' : '调用 <b>' + st.total + '</b> 次') + ' · <b>' + st.kinds + '</b> 种工具 · ' +
                        (st.failTotal > 0 ? '<b class="toolstats-failnum">出错 ' + st.failTotal + '</b>' : '<b>无错误</b>') + '</span>' +
                    '<span class="toolstats-tabs" role="tablist">' +
                        '<button class="toolstats-tab' + (activeView === 'usage' ? ' is-active' : '') + '" data-view="usage">调用统计</button>' +
                        '<button class="toolstats-tab' + (activeView === 'context' ? ' is-active' : '') + '" data-view="context">上下文占用</button>' +
                    '</span>' +
                    '<button class="toolstats-copy" title="复制调用统计、上下文占用排行和错误明细">📋 复制统计+错误</button>' +
                    '<button class="toolstats-toggle" title="展开 / 收起统计">' + (collapsed ? '▸' : '▾') + '</button>' +
                '</div>' +
                '<div class="toolstats-body"' + (collapsed ? ' style="display:none"' : '') + '>' +
                    (st.total === 0 ? '<div class="toolstats-empty">暂无工具调用数据，执行任务后自动统计</div>' : (activeView === 'context' ? contextHtml : barHtml + failHtml)) +
                '</div>';

            statsEl.querySelectorAll('.toolstats-tab').forEach(function(tab) {
                tab.addEventListener('click', function(e) {
                    e.stopPropagation();
                    statsEl.setAttribute('data-view', tab.getAttribute('data-view') || 'usage');
                    self.renderToolStats(box);
                });
            });
            var copyBtn = statsEl.querySelector('.toolstats-copy');
            if (copyBtn) copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                self._toolStatsCopy(box, copyBtn);
            });
            var toggleBtn = statsEl.querySelector('.toolstats-toggle');
            if (toggleBtn) toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                statsEl.classList.toggle('toolstats-collapsed');
                self.renderToolStats(box);
            });
        },

        // 复制：使用频率排行（文本条形图）+ 出错工具及具体错误内容
        _toolStatsCopy: function(box, btn) {
            var st = this._toolStatsCollect(box);
            var lines = [];
            lines.push('===== 工具使用统计 =====');
            lines.push('总调用: ' + st.total + ' 次 | 工具种类: ' + st.kinds + ' 种 | 出错: ' + st.failTotal + ' 处');
            lines.push('');
            lines.push('【上下文占用排行】（按工具参数+结果文本估算，约4字符=1token）');
            if (st.contextSorted.length === 0) {
                lines.push('（暂无工具调用）');
            } else {
                st.contextSorted.forEach(function(it, idx) {
                    var pct = st.contextTotal ? (it.tokens * 100 / st.contextTotal) : 0;
                    lines.push((idx + 1) + '. ' + it.name + ' ' + it.tokens.toLocaleString() + ' tokens (' + pct.toFixed(1) + '%，调用' + it.count + '次)');
                });
            }
            lines.push('');
            lines.push('【工具使用频率排行】');
            if (st.sorted.length === 0) {
                lines.push('（暂无工具调用）');
            } else {
                var maxC = st.sorted[0].count;
                for (var i = 0; i < st.sorted.length; i++) {
                    var it = st.sorted[i];
                    var pct = st.total ? (it.count * 100 / st.total) : 0;
                    var blocks = maxC > 0 ? Math.max(1, Math.round(it.count * 30 / maxC)) : 1;
                    var nm = it.name;
                    var pad = (nm + '                        ').slice(0, 22);
                    lines.push((i + 1) + '. ' + pad + ' ' + new Array(blocks + 1).join('█') + ' ' + it.count + '次 (' + pct.toFixed(1) + '%)');
                }
            }
            lines.push('');
            if (st.failTotal > 0) {
                lines.push('【出错工具明细】共 ' + st.failTotal + ' 处失败（成功工具不列入）');
                var byName = {}, failOrder = [];
                st.fails.forEach(function(f) {
                    if (!byName[f.name]) { byName[f.name] = []; failOrder.push(f.name); }
                    byName[f.name].push(f.msg);
                });
                failOrder.sort(function(a, b) { return byName[b].length - byName[a].length; });
                failOrder.forEach(function(n) {
                    var msgs = byName[n];
                    lines.push('');
                    lines.push('● ' + n + '（失败 ' + msgs.length + ' 次）');
                    msgs.forEach(function(m, idx) {
                        var mm = m || '(无错误详情)';
                        if (mm.length > 500) mm = mm.slice(0, 500) + ' …[已截断]';
                        lines.push('  [' + (idx + 1) + '] ' + mm);
                    });
                });
            } else {
                lines.push('【出错工具明细】本次无工具错误');
            }
            var text = lines.join('\n');

            var done = function(ok) {
                if (!btn) return;
                btn.textContent = ok ? '✅ 已复制' : '❌ 复制失败';
                setTimeout(function() { btn.textContent = '📋 复制统计+错误'; }, 1600);
            };
            var fb = function(t) {
                var ta = document.createElement('textarea');
                ta.value = t;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                var ok = false;
                try { ok = document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
                done(ok);
            };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() { done(true); }, function() { fb(text); });
                    return;
                }
            } catch (e) {}
            fb(text);
        },
});
