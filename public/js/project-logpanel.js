// ========== project-logpanel.js - 日志面板（日志/上下文/统计图表） ==========
// 拆分自 app-chatbox-projects.js（原 693~1237 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 日志面板（日志 | 上下文）=====
        toggleLogPanel: function(box) {
            var lp = box.querySelector('.chatbox-logpanel');
            var body = box.querySelector('.chatbox-body');
            if (!lp) return;
            if (lp.classList.contains('open')) {
                lp.classList.remove('open');
                if (body) body.style.display = '';
            } else {
                var tp = box.querySelector('.chatbox-toolpanel');
                if (tp && tp.classList.contains('open')) this.toggleToolPanel(box);
                lp.classList.add('open');
                if (body) body.style.display = 'none';
                this.renderLogPanel(box);
            }
        },

        _getChatByBoxEl: function(box) {
            for (var i = 0; i < this.chatBoxes.length; i++) {
                if (this.chatBoxes[i].el === box) return this.chatBoxes[i];
            }
            return null;
        },

        renderLogPanel: function(box) {
            var lp = box.querySelector('.chatbox-logpanel');
            if (!lp) return;
            var self = this;
            if (!lp._tab) lp._tab = 'logs';
            var tab = lp._tab;
            var chat = this._getChatByBoxEl(box);
            var esc = function(s) {
                return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            };
            var fmtTs = function(ts) {
                var d = new Date(ts);
                function p(n) { return n < 10 ? '0' + n : '' + n; }
                return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
            };
            var html =
                '<div class="logpanel-tabs">' +
                    '<span class="logpanel-tab' + (tab === 'logs' ? ' active' : '') + '" data-tab="logs">日志</span>' +
                    '<span class="logpanel-tab' + (tab === 'ctx' ? ' active' : '') + '" data-tab="ctx">上下文</span>' +
                    '<span class="logpanel-actions">' +
                        '<button class="lp-btn" data-lp-act="copy" title="复制对话和日志">📋 复制</button>' +
                        '<button class="lp-btn" data-lp-act="clear" title="清空对话和日志">🗑 清空</button>' +
                    '</span>' +
                '</div>';
            if (tab === 'logs') {
                var logs = [];
                try { logs = Store.getLogs() || []; } catch (e) {}
                html += '<div class="logpanel-body logpanel-logs">';
                // ===== 出错统计表（置顶展示） =====
                html += this._renderLogErrorStats(logs);
                if (!logs.length) {
                    html += '<div class="lp-empty">暂无日志</div>';
                } else {
                    var start = Math.max(0, logs.length - 500);
                    for (var j = logs.length - 1; j >= start; j--) {
                        var L = logs[j];
                        html += '<div class="lp-log lp-' + esc(L.level) + '">[' + fmtTs(L.ts) + '] [' + esc(L.level) + '] ' + esc(L.action) +
                            (L.detail ? ' — ' + esc(L.detail) : '') + '</div>';
                    }
                }
                html += '</div>';
            } else {
                var ctx = (chat && chat._lastContext) ? chat._lastContext : '';
                html += '<div class="logpanel-body logpanel-ctx">';
                if (ctx) {
                    // ===== 上下文分类占比统计（可视化） =====
                    var statsHtml = '';
                    try {
                        var parsed = JSON.parse(ctx);
                        var groups = [
                            { key: 'system', name: '🧠 系统提示', color: '#7c5cff', count: 0, chars: 0 },
                            { key: 'user', name: '💬 用户对话', color: '#4caf50', count: 0, chars: 0 },
                            { key: 'assistant', name: '🤖 AI 回复', color: '#2196f3', count: 0, chars: 0 },
                            { key: 'tool', name: '🛠 工具结果', color: '#ff9800', count: 0, chars: 0 }
                        ];
                        var totalChars = 0;
                        var toolDefs = 0, toolDefChars = 0;
                        var msgs = parsed && parsed.messages ? parsed.messages : [];
                        msgs.forEach(function(m) {
                            if (!m || !m.role) return;
                            var g = null;
                            for (var gi = 0; gi < groups.length; gi++) if (groups[gi].key === m.role) { g = groups[gi]; break; }
                            var text = '';
                            if (typeof m.content === 'string') text = m.content;
                            else if (m.content) { try { text = JSON.stringify(m.content); } catch (e) { text = ''; } }
                            if (m.tool_calls && m.tool_calls.length) {
                                try { text += '\n' + JSON.stringify(m.tool_calls); } catch (e) {}
                            }
                            var len = text ? text.length : 0;
                            if (g) { g.count++; g.chars += len; } else {
                                groups[0].count++; groups[0].chars += len;
                            }
                            totalChars += len;
                        });
                        if (parsed && parsed.tools && parsed.tools.length) {
                            toolDefs = parsed.tools.length;
                            try { toolDefChars = JSON.stringify(parsed.tools).length; } catch (e) {}
                            totalChars += toolDefChars;
                        }
                        var shown = groups.filter(function(g) { return g.count > 0 || g.chars > 0; });
                        if (toolDefs > 0) {
                            shown.push({ key: 'tools', name: '🔧 工具定义', color: '#00bcd4', count: toolDefs, chars: toolDefChars, total: toolDefs });
                        }
                        if (shown.length) {
                            var total = 0;
                            shown.forEach(function(g) { total += g.chars; });
                            var totalCount = 0;
                            shown.forEach(function(g) { if (g.key !== 'tools') totalCount += g.count; });
                            statsHtml += '<div class="lp-ctx-stats">' +
                                '<div class="lp-ctx-stats-title">📊 上下文构成（' + total + ' 字符 / ' + totalCount + ' 条消息' + (toolDefs > 0 ? ' + ' + toolDefs + ' 个工具定义' : '') + '）</div>' +
                                '<div class="lp-ctx-stats-bar">';
                            shown.forEach(function(g) {
                                var pct = total > 0 ? (g.chars / total * 100) : 0;
                                statsHtml += '<div class="lp-ctx-stats-seg" style="width:' + pct.toFixed(2) + '%;background:' + g.color + ';" title="' + g.name + ' ' + pct.toFixed(1) + '%"></div>';
                            });
                            statsHtml += '</div><div class="lp-ctx-stats-legend">';
                            shown.forEach(function(g) {
                                var pct = total > 0 ? (g.chars / total * 100) : 0;
                                var sub = (g.key === 'tools' ? g.count + ' 个' : g.count + ' 条 / ' + g.chars + ' 字符');
                                statsHtml += '<span class="lp-ctx-stat-item"><span class="lp-ctx-stat-dot" style="background:' + g.color + ';"></span>' +
                                    '<span class="lp-ctx-stat-name">' + g.name + '</span>' +
                                    '<span class="lp-ctx-stat-pct">' + pct.toFixed(1) + '%</span>' +
                                    '<span class="lp-ctx-stat-sub">' + sub + '</span></span>';
                            });
                            statsHtml += '</div></div>';
                        } else {
                            statsHtml = '<div class="lp-ctx-stats"><div class="lp-ctx-stats-empty">上下文为空</div></div>';
                        }
                    } catch (e) {}
                    html += statsHtml;
                    html += '<div class="lp-ctx-bar"><span class="lp-ctx-tip">最后一次发送给 AI 的完整请求（仅内存展示，不留痕迹，新请求直接覆盖）</span>' +
                        '</div>' +
                        '<pre>' + esc(ctx) + '</pre>';
                } else {
                    html += '<div class="lp-empty">暂无上下文。发送消息后，这里原封不动展示最后一次发送给 AI 的完整请求（只保留最后一条）。</div>';
                }
                html += '</div>';
            }
            lp.innerHTML = html;

            lp.querySelectorAll('.logpanel-tab').forEach(function(t) {
                t.addEventListener('click', function(e) {
                    e.stopPropagation();
                    lp._tab = this.dataset.tab;
                    self.renderLogPanel(box);
                });
            });
            var copyBtn = lp.querySelector('[data-lp-act="copy"]');
            if (copyBtn) copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (lp._tab === 'ctx') {
                    if (chat && chat._lastContext) self._lpCopyText(chat._lastContext);
                    return;
                }
                var cid = chat ? chat.id : box.id;
                var msgs = [];
                try { msgs = Store.getMessages(cid) || []; } catch (e2) {}
                var logs2 = [];
                try { logs2 = Store.getLogs() || []; } catch (e3) {}
                // ===== 出错统计（最前） =====
                var text = self._logErrorStatsText(logs2);
                // ===== 出错日志（优先，在前） =====
                var errLogs = logs2.filter(function(L) { return L && L.level === 'error'; });
                var normalLogs = logs2.filter(function(L) { return !L || L.level !== 'error'; });
                if (errLogs.length) {
                    text += '\n===== 出错日志(' + errLogs.length + '条，优先展示) =====\n';
                    errLogs.forEach(function(L) {
                        text += '[' + fmtTs(L.ts) + '] [' + L.level + '] ' + L.action + (L.detail ? ' - ' + L.detail : '') + '\n';
                    });
                } else {
                    text += '\n===== 出错日志(0条) =====\n(无出错日志)\n';
                }
                // ===== 普通日志（在后） =====
                text += '\n===== 普通日志(' + normalLogs.length + '条) =====\n';
                normalLogs.forEach(function(L) {
                    text += '[' + fmtTs(L.ts) + '] [' + L.level + '] ' + L.action + (L.detail ? ' - ' + L.detail : '') + '\n';
                });
                // ===== 对话记录（最后） =====
                text += '\n===== 对话记录 (' + cid + ') =====\n';
                msgs.forEach(function(m) {
                    text += '[' + (m.role === 'user' ? '用户' : (m.role === 'ai' ? 'AI' : m.role)) + '] ' + (m.content || '') + '\n\n';
                });
                self._lpCopyText(text);
            });
            var clearBtn = lp.querySelector('[data-lp-act="clear"]');
            if (clearBtn) clearBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                ConfirmDialog.confirm({
                    title: '清空对话',
                    message: '确定清空本对话和历史日志吗？',
                    okText: '清空', danger: true
                }).then(function(ok) {
                    if (!ok) return;
                    var body2 = box.querySelector('.chatbox-body');
                    if (body2) body2.innerHTML = '';
                    try { Store.clearMessages(chat ? chat.id : box.id); } catch (e4) {}
                    try { Store.clearLogs(); } catch (e5) {}
                    self.addMsg(box, '对话和日志已清空。', 'ai');
                    self.renderLogPanel(box);
                });
            });
        },

        // ===== 出错日志统计（表格 + 简易条形图，返回 HTML） =====
        _renderLogErrorStats: function(logs) {
            logs = logs || [];
            var errLogs = logs.filter(function(l) { return l && l.level === 'error'; });
            var total = logs.length;
            var errCount = errLogs.length;
            var errPct = total > 0 ? (errCount / total * 100) : 0;
            var s = '<div class="lp-err-stats">';
            s += '<div class="lp-err-stats-title">📊 出错统计（共 ' + total + ' 条日志 · 出错 ' + errCount + ' 条 · 占比 ' + errPct.toFixed(1) + '%）</div>';
            if (!errCount) {
                s += '<div class="lp-err-stats-empty">🎉 没有出错日志</div></div>';
                return s;
            }
            // 按 action 分组统计出错次数
            var groups = {};
            errLogs.forEach(function(l) {
                var k = l.action || '(unknown)';
                if (!groups[k]) groups[k] = { count: 0, boxIds: {} };
                groups[k].count++;
                if (l.boxId) groups[k].boxIds[l.boxId] = true;
            });
            var arr = Object.keys(groups).map(function(k) {
                return { action: k, count: groups[k].count, boxes: Object.keys(groups[k].boxIds).length };
            });
            arr.sort(function(a, b) { return b.count - a.count; });
            var maxCount = arr[0].count;
            s += '<div class="lp-err-table">';
            s += '<div class="lp-err-row lp-err-head"><span class="lp-err-c1">出错类型(action)</span><span class="lp-err-c2">次数</span><span class="lp-err-c3">占比</span><span class="lp-err-c4">图示</span></div>';
            arr.forEach(function(it, idx) {
                var pct = errCount > 0 ? (it.count / errCount * 100) : 0;
                var barW = maxCount > 0 ? (it.count / maxCount * 100) : 0;
                var rank = idx === 0 ? ' 🔴最多' : (idx === 1 && arr.length > 1 ? ' 🟠次多' : '');
                s += '<div class="lp-err-row' + (idx === 0 ? ' lp-err-top' : '') + '">' +
                    '<span class="lp-err-c1">' + this._lpEsc(it.action) + rank + '</span>' +
                    '<span class="lp-err-c2">' + it.count + '</span>' +
                    '<span class="lp-err-c3">' + pct.toFixed(1) + '%</span>' +
                    '<span class="lp-err-c4"><span class="lp-err-bar" style="width:' + barW.toFixed(1) + '%;"></span></span>' +
                '</div>';
            }, this);
            s += '</div></div>';
            return s;
        },

        // ===== 出错统计的纯文本版（复制时用） =====
        _logErrorStatsText: function(logs) {
            var self = this;
            logs = logs || [];
            var errLogs = logs.filter(function(l) { return l && l.level === 'error'; });
            var total = logs.length;
            var errCount = errLogs.length;
            var errPct = total > 0 ? (errCount / total * 100) : 0;
            var s = '===== 出错统计 =====\n';
            s += '共 ' + total + ' 条日志 · 出错 ' + errCount + ' 条 · 占比 ' + errPct.toFixed(1) + '%\n';
            if (!errCount) {
                s += '没有出错日志\n';
                return s;
            }
            var groups = {};
            errLogs.forEach(function(l) {
                var k = l.action || '(unknown)';
                if (!groups[k]) groups[k] = 0;
                groups[k]++;
            });
            var arr = Object.keys(groups).map(function(k) { return { action: k, count: groups[k] }; });
            arr.sort(function(a, b) { return b.count - a.count; });
            var maxCount = arr[0].count;
            var maxBar = 24;
            s += '出错类型(action)              次数    占比      图示\n';
            arr.forEach(function(it, idx) {
                var pct = errCount > 0 ? (it.count / errCount * 100) : 0;
                var barLen = maxCount > 0 ? Math.round(it.count / maxCount * maxBar) : 0;
                if (idx === 0 && arr.length > 1 && it.count === arr[0].count) barLen = maxBar;
                var bar = '';
                for (var i = 0; i < barLen; i++) bar += '█';
                var name = String(it.action || '(unknown)');
                if (name.length > 24) name = name.substring(0, 24);
                var rankTag = (idx === 0 && arr.length > 1) ? ' ←最多' : '';
                s += self._lpPad(name, 26) + self._lpPad(String(it.count), 5, true) + '  ' + self._lpPad(pct.toFixed(1) + '%', 7, true) + '  ' + bar + rankTag + '\n';
            });
            return s;
        },

        _lpEsc: function(s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },

        // 文本对齐辅助：padRight / padLeft（中文按 2 宽度计）
        _lpStrWidth: function(s) {
            var w = 0;
            for (var i = 0; i < s.length; i++) {
                w += s.charCodeAt(i) > 255 ? 2 : 1;
            }
            return w;
        },
        _lpPad: function(s, width, left) {
            s = String(s == null ? '' : s);
            var pad = width - this._lpStrWidth(s);
            if (pad <= 0) return s;
            var spaces = '';
            for (var i = 0; i < pad; i++) spaces += ' ';
            return left ? spaces + s : s + spaces;
        },

        _lpCopyText: function(text) {
            var fb = function(t) {
                var ta = document.createElement('textarea');
                ta.value = t;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
            };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() {}, function() { fb(text); });
                    return;
                }
            } catch (e) {}
            fb(text);
        },

        refreshLogPanelCtx: function(box) {
            try {
                var lp = box.querySelector('.chatbox-logpanel');
                if (lp && lp.classList.contains('open') && lp._tab === 'ctx') this.renderLogPanel(box);
            } catch (e) {}
        },

        // [已移除] 旧的 toggleProjectPanel — 已由 app-project.js 的独立侧边栏版本替代
        // 保留 loadProjectNodes 等方法供 app-project.js 调用
                loadProjectNodes: function(panel, chat) {
            var self = this;
            if (!panel._sortMode) panel._sortMode = 'time';
            if (!panel._sortDir) panel._sortDir = 'desc';
            var sortMode = panel._sortMode;
            var sortDir = panel._sortDir;
            var sortArrow = sortDir === 'desc' ? '\u25bc' : '\u25b2';

            panel.innerHTML =
                '<div class="project-panel-head">' +
                '<span class="pp-head-title">📁 关联文件夹</span>' +
                '<span class="pp-head-actions">' +
                '<span class="pp-new-btn" title="新建一段对话">➕ 新建</span>' +
                '<span class="pp-close" title="关闭">✕</span>' +
                '</span></div>' +
                '<div class="pp-toolbar">' +
                '<span class="pp-sort-btn' + (sortMode === 'time' ? ' active' : '') + '" data-sort="time">⏱ 时间 <span class="sort-arrow">' + (sortMode === 'time' ? sortArrow : '') + '</span></span>' +
                '<span class="pp-sort-btn' + (sortMode === 'title' ? ' active' : '') + '" data-sort="title">📖 标题 <span class="sort-arrow">' + (sortMode === 'title' ? sortArrow : '') + '</span></span>' +
                '<span class="pp-sort-btn' + (sortMode === 'count' ? ' active' : '') + '" data-sort="count">📊 消息数 <span class="sort-arrow">' + (sortMode === 'count' ? sortArrow : '') + '</span></span>' +
                '<span class="pp-count-badge" id="pp-count"></span>' +
                '</div>' +
                '<div class="pp-search-wrap"><input type="text" class="pp-search" placeholder="🔍 搜索对话..." /></div>' +
                '<div class="pp-body">加载中…</div>';

            panel.querySelector('.pp-new-btn').addEventListener('click', function(e2) {
                e2.stopPropagation();
                self.openNewSessionModal(chat, panel);
            });
            panel.querySelector('.pp-close').addEventListener('click', function(e) {
                e.stopPropagation();
                panel.classList.remove('open');
            });

            panel.querySelectorAll('.pp-sort-btn').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var mode = this.dataset.sort;
                    if (panel._sortMode === mode) {
                        panel._sortDir = panel._sortDir === 'desc' ? 'asc' : 'desc';
                    } else {
                        panel._sortMode = mode;
                        panel._sortDir = 'desc';
                    }
                    self.loadProjectNodes(panel, chat);
                });
            });

            var allNodes = [];
            var searchInput = panel.querySelector('.pp-search');
            searchInput.addEventListener('input', function() {
                var q = this.value.trim().toLowerCase();
                var filtered = allNodes.filter(function(n) {
                    if (!q) return true;
                    var title = (n.title || n.id || '').toLowerCase();
                    var mid = n.modelId || n.model_id || '';
                    var m = mid ? Models.get(mid) : null;
                    var mName = m ? m.name.toLowerCase() : (mid ? mid.toLowerCase() : '未选择模型');
                    return title.indexOf(q) >= 0 || mName.indexOf(q) >= 0;
                });
                render(filtered);
            });

            function render(nodes) {
                allNodes = nodes;
                var countEl = panel.querySelector('#pp-count');
                if (countEl) countEl.textContent = nodes.length + ' 个对话';

                if (!nodes.length) {
                    panel.querySelector('.pp-body').innerHTML =
                        '<div class="pp-empty">' +
                        '<div class="pp-empty-icon">📂</div>' +
                        '<div class="pp-empty-text">暂无历史对话</div>' +
                        '<div class="pp-empty-hint">点击「新建」开始一段新对话</div>' +
                        '</div>';
                    return;
                }

                var pinnedIds = self.getPinnedIds();
                nodes.sort(function(a, b) {
                    var aPin = pinnedIds.indexOf(a.id) >= 0 ? 1 : 0;
                    var bPin = pinnedIds.indexOf(b.id) >= 0 ? 1 : 0;
                    if (aPin !== bPin) return bPin - aPin;
                    var dir = panel._sortDir === 'asc' ? 1 : -1;
                    if (panel._sortMode === 'title') {
                        var ta = (a.title || a.id || '').toLowerCase();
                        var tb = (b.title || b.id || '').toLowerCase();
                        return ta < tb ? -dir : ta > tb ? dir : 0;
                    } else if (panel._sortMode === 'count') {
                        return (self.countMsgs(a.id) - self.countMsgs(b.id)) * dir;
                    } else {
                        return ((b.updated_at || 0) - (a.updated_at || 0)) * dir;
                    }
                });

                var html = '';
                nodes.forEach(function(n) {
                    var title = (n.title && n.title.indexOf('💬') === 0) ? n.title : ('💬 ' + (n.title || n.id));
                    var mid = n.modelId || n.model_id || '';
                    var m = mid ? Models.get(mid) : null;
                    var mName = m ? m.name : (mid ? mid : '未选择模型');
                    var cnt = self.countMsgs(n.id);
                    var t = n.updated_at || n.updatedAt || n.createdAt || 0;
                    var timeStr = t ? (new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : '';
                    var isPinned = pinnedIds.indexOf(n.id) >= 0;
                    var pinIcon = isPinned ? '📌' : '🔽';
                    html += '<div class="pp-item' + (isPinned ? ' pinned' : '') + '" data-id="' + n.id + '" title="点击恢复该对话">' +
                        '<div class="pp-item-row">' +
                        '<span class="pp-item-title">' + title + '</span>' +
                        '<span class="pp-item-pin" data-pin-id="' + n.id + '" title="' + (isPinned ? '取消置顶' : '置顶') + '">' + pinIcon + '</span>' +
                        '<span class="pp-item-ren" data-ren-id="' + n.id + '" title="重命名">✏️</span>' +
                        '<span class="pp-item-del" data-del-id="' + n.id + '" title="删除此对话">🗑</span>' +
                        '</div>' +
                        '<div class="pp-item-meta">' +
                        '<span class="pp-item-model">' + mName + '</span>' +
                        '<span class="pp-item-dot">·</span>' +
                        '<span>' + cnt + '条</span>' +
                        '<span class="pp-item-dot">·</span>' +
                        '<span>' + timeStr + '</span>' +
                        '</div>' +
                        '</div>';
                });
                panel.querySelector('.pp-body').innerHTML = html;

                panel.querySelectorAll('.pp-item').forEach(function(item) {
                    item.addEventListener('click', function(e) {
                        if (e.target.classList.contains('pp-item-del') ||
                            e.target.classList.contains('pp-item-pin') ||
                            e.target.classList.contains('pp-item-ren')) return;
                        e.stopPropagation();
                        var nid = this.dataset.id;
                        for (var i = 0; i < nodes.length; i++) {
                            if (nodes[i].id === nid) { self.restoreHistoryNode(nodes[i]); break; }
                        }
                    });
                });
                panel.querySelectorAll('.pp-item-del').forEach(function(delBtn) {
                    delBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var nid = this.dataset.delId;
                        ConfirmDialog.confirm({
                            title: '删除对话',
                            message: '确定删除此对话？删除后不可恢复。',
                            okText: '删除', danger: true
                        }).then(function(ok) {
                            if (ok) self.deleteHistoryNode(nid, panel, chat);
                        });
                    });
                });
                panel.querySelectorAll('.pp-item-pin').forEach(function(pinBtn) {
                    pinBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var nid = this.dataset.pinId;
                        self.togglePin(nid);
                        self.loadProjectNodes(panel, chat);
                    });
                });
                panel.querySelectorAll('.pp-item-ren').forEach(function(renBtn) {
                    renBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var nid = this.dataset.renId;
                        var item = this.closest('.pp-item');
                        var titleEl = item.querySelector('.pp-item-title');
                        var oldTitle = titleEl.textContent.replace(/^💬s*/, '');
                        var input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'pp-rename-input';
                        input.value = oldTitle;
                        titleEl.replaceWith(input);
                        input.focus();
                        input.select();
                        function saveRename() {
                            var newTitle = input.value.trim();
                            if (newTitle && newTitle !== oldTitle) {
                                self.renameNode(nid, newTitle);
                            }
                            self.loadProjectNodes(panel, chat);
                        }
                        input.addEventListener('blur', saveRename);
                        input.addEventListener('keydown', function(ev) {
                            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                            if (ev.key === 'Escape') { input.value = oldTitle; input.blur(); }
                        });
                    });
                });
            }

            var local = [];
            if (Store.data && Store.data.chatBoxes) {
                local = Store.data.chatBoxes.map(function(b) {
                    return { id: b.id, title: b.title, modelId: b.modelId, x: b.x, y: b.y, w: b.w, h: b.h, z: b.z, collapsed: b.collapsed, scrollPos: b.scrollPos, createdAt: b.createdAt, updated_at: b.createdAt };
                });
            }
            function fallback() { self.mergeAndRender(panel, local, render); }

            if (typeof DB !== 'undefined' && DB.online) {
                DB.getNodes().then(function(res) {
                    var remote = (res && res.data) ? res.data.map(function(r) {
                        return { id: r.id, title: r.title, modelId: r.model_id, model_id: r.model_id, x: r.x, y: r.y, w: r.w, h: r.h, z: r.z_index, collapsed: r.collapsed, scrollPos: r.scroll_pos, createdAt: r.created_at, updated_at: r.updated_at };
                    }) : [];
                    self.mergeAndRender(panel, remote.concat(local), render);
                }).catch(fallback);
            } else {
                fallback();
            }
        },
});
