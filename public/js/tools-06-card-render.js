// ==== 拆分自 tools.js：工具图标映射（折叠态左侧显示，区分工具类型）_渲染统一工具卡片_task_lis_HTML 转义_加载出口限额配置_工具结果出口限额_递归截断对象内超_工具选择变更回调 ====
Object.assign(Tools, {
        // ===== 工具图标映射（折叠态左侧显示，区分工具类型） =====
        _toolIcons: {
            'task_complete': '🏁',
            'read_file': '📄',
            'write_file': '✏️',
            'run_code': '▶️',
            'read_lines': '📏',
            'ask_user': '❓',
            'net': '🌐',
            'git_save': '📦',
            'project_record': '📝',
            'chat_manage': '💬',
            'wait': '⏳',
            'schedule': '🔁',
            'search_chat': '🔍',
            'recent_questions': '🔎',
            'query_answers': '💡',
            'chat_context': '📋',
            'chat_summary': '📝',
            'monitor': '🛡️',
            'task_list': '📋',
            'replace_text': '🔄',
            'tree_dir': '🌳',
            'list_dir': '📂',
            'find_files': '🔍',
            'search_in_files': '🔎',
            'file_info': '📊',
            'diff_preview': '📝',
            'git_log': '📋',
            'code_outline': '🗂️',
            'move_file': '📦',
            'send_email': '📧',
            'regex_search': '🔍',
            'work_order': '📋',
            'switch_port': '🔌'
        },

        _toolIcon: function(name) {
            return this._toolIcons[name] || '🔧';
        },

        // ===== 渲染统一工具卡片（可折叠：调用+结果合为一张卡） =====
        // CSS 类名结构（BEM）：
        //   .tool-wrap              基类（统一样式）
        //   .tool-wrap--success     成功变体（绿色左边框）
        //   .tool-wrap--fail        失败变体（红色左边框）
        //   .tool-wrap--collapsed    折叠状态
        //   .tool-wrap--{toolName}   按工具名单独覆盖（个别工具特殊样式）
        renderToolCard: function(name, args, result) {
            var toolIcon = this._toolIcon(name);
            var statusIcon = result.success ? '✅' : '❌';
            var label = this._toolLabel(name);
            var status = result.success ? '成功' : '失败';
            // 如果有 scope 且不是默认值，附加显示
            if (result.scope && result.scope !== '当前任务') {
                status += ' · ' + result.scope;
            }

            // 参数区
            var argsHtml = '';
            for (var k in args) {
                if (args.hasOwnProperty(k)) {
                    argsHtml += '<div class="tool-wrap__arg">' +
                        '<span class="tool-wrap__arg-key">' + this.escapeHtml(k) + '</span>' +
                        '<span class="tool-wrap__arg-sep">: </span>' +
                        '<span class="tool-wrap__arg-val">' + this.escapeHtml(String(args[k])) + '</span>' +
                        '</div>';
                }
            }

            // 类名：基类 + 状态变体 + 工具名变体
            // task_complete 不可折叠（消息必须始终可见）
            // 默认折叠：只有 _defaultExpanded 白名单中的工具才自动展开
            var isTerminal = this.isTerminal(name);
            var cls = 'tool-wrap tool-wrap--' + (result.success ? 'success' : 'fail') + ' tool-wrap--' + name;
            if (isTerminal) cls += ' tool-wrap--nocollapse';
            if (!isTerminal && !this._defaultExpanded[name]) cls += ' tool-wrap--collapsed';

            return '<div class="' + cls + '" data-tool="' + name + '">' +
                // 头部（始终可见，点击折叠/展开——但 task_complete 不可折叠）
                '<div class="tool-wrap__header">' +
                    '<span class="tool-wrap__icon">' + toolIcon + '</span>' +
                    '<span class="tool-wrap__name">' + this.escapeHtml(label) + '</span>' +
                    '<span class="tool-wrap__status">' + status + '</span>' +
                    '<span class="tool-wrap__status-icon">' + statusIcon + '</span>' +
                    (isTerminal ? '' : '<span class="tool-wrap__toggle">▾</span>') +
                '</div>' +
                // 正文（可折叠）
                '<div class="tool-wrap__body">' +
                    (argsHtml ? '<div class="tool-wrap__section"><div class="tool-wrap__section-label">参数</div>' + argsHtml + '</div>' : '') +
                    '<div class="tool-wrap__section"><div class="tool-wrap__section-label">结果</div>' +
                        '<div class="tool-wrap__result">' + (result.html || this.escapeHtml(result.message)) + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        // ===== task_list 富文本渲染 =====
        _renderTaskListHtml: function(data) {
            var statusIcons = {
                'pending': '☐',
                'in_progress': '⟳️',
                'completed': '✅',
                'skipped': '⏭️'
            };
            var statusNames = {
                'pending': '待处理',
                'in_progress': '进行中',
                'completed': '已完成',
                'skipped': '已跳过'
            };

            // Single list mode (create/update/add/delete/show with id)
            var lists = data.lists || (data.list ? [data.list] : []);
            if (!lists.length) return '';

            // If show without id -> overview mode
            var isOverview = !data.id && data.action === 'show' && lists.length > 1;

            if (isOverview) {
                var ovHtml = '<div class="tl-overview">';
                for (var oi = 0; oi < lists.length; oi++) {
                    var tl = lists[oi];
                    var total = tl.tasks.length;
                    var done = 0;
                    for (var ti = 0; ti < tl.tasks.length; ti++) {
                        if (tl.tasks[ti].status === 'completed') done++;
                    }
                    var pct = total > 0 ? Math.round(done / total * 100) : 0;
                    var allDone = done === total && total > 0;
                    ovHtml += '<div class="tl-overview-item">' +
                        '<span class="tl-overview-id">' + this.escapeHtml(tl.id) + '</span>' +
                        '<span class="tl-overview-title">' + this.escapeHtml(tl.title) + '</span>' +
                        '<span class="tl-overview-progress' + (allDone ? ' tl-all-done' : '') + '">' + done + '/' + total + ' (' + pct + '%)</span>' +
                        '</div>';
                }
                ovHtml += '</div>';
                return ovHtml;
            }

            // Single list detail mode
            var tl = lists[0];
            var total = tl.tasks.length;
            var completed = 0, skipped = 0, inProgress = 0, pending = 0;
            for (var i = 0; i < tl.tasks.length; i++) {
                var s = tl.tasks[i].status;
                if (s === 'completed') completed++;
                else if (s === 'skipped') skipped++;
                else if (s === 'in_progress') inProgress++;
                else pending++;
            }
            var pct = total > 0 ? Math.round(completed / total * 100) : 0;
            var allDone = completed === total && total > 0;

            var html = '<div class="tl-detail">';
            // Title
            html += '<div class="tl-title">📋 ' + this.escapeHtml(tl.title) + '</div>';

            // Progress bar
            html += '<div class="tl-progress-bar"><div class="tl-progress-fill' + (allDone ? ' tl-complete' : '') + '" style="width:' + pct + '%"></div></div>';

            // Stats row
            html += '<div class="tl-stats">';
            html += '<span class="tl-stat-item tl-stat-completed">✅ ' + completed + ' 完成</span>';
            if (inProgress > 0) html += '<span class="tl-stat-item tl-stat-progress">⟳️ ' + inProgress + ' 进行中</span>';
            if (pending > 0) html += '<span class="tl-stat-item tl-stat-pending">☐ ' + pending + ' 待处理</span>';
            if (skipped > 0) html += '<span class="tl-stat-item tl-stat-skipped">⏭️ ' + skipped + ' 跳过</span>';
            html += '</div>';

            // Task list
            html += '<ul class="tl-task-list">';
            for (var j = 0; j < tl.tasks.length; j++) {
                var t = tl.tasks[j];
                var icon = statusIcons[t.status] || '☐';
                html += '<li class="tl-task-item tl-status-' + t.status + '">' +
                    '<span class="tl-task-id">#' + t.id + '</span>' +
                    '<span class="tl-task-icon">' + icon + '</span>' +
                    '<div class="tl-task-content"><div class="tl-task-title">' + this.escapeHtml(t.title) + '</div>';
                if (t.detail) {
                    html += '<div class="tl-task-detail">→ ' + this.escapeHtml(t.detail) + '</div>';
                }
                html += '</div></li>';
            }
            html += '</ul>';

            html += '</div>';
            return html;
        },

        // ===== HTML 转义 =====
        escapeHtml: function(str) {
            var div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        // ===== 加载出口限额配置（server 端 private/tool_result_limits.json，GET /api/tool-result-limits） =====
        loadExitLimits: function() {
            var self = this;
            try {
                fetch('/api/tool-result-limits').then(function(r) { return r.json(); }).then(function(cfg) {
                    if (cfg && cfg.exit_limits && typeof cfg.exit_limits === 'object') {
                        var el = cfg.exit_limits;
                        if (el.enabled !== undefined) self.exitLimits.enabled = el.enabled !== false;
                        if (el.defaults && typeof el.defaults === 'object') {
                            for (var dk in el.defaults) {
                                if (Object.prototype.hasOwnProperty.call(el.defaults, dk)) {
                                    self.exitLimits.defaults[dk] = el.defaults[dk];
                                }
                            }
                        }
                        if (el.tools && typeof el.tools === 'object') self.exitLimits.tools = el.tools;
                        if (Array.isArray(el._exempt)) self.exitLimits._exempt = el._exempt;
                        self.exitLimits._loaded = true;
                    }
                }).catch(function() { /* 读失败保持默认 */ });
            } catch (e) { /* ignore */ }
        },

        // ===== 工具结果出口限额：进入上下文前检查+截断（源头拦截） =====
        // 超长结果：原文归档（get_tool_result 可找回）-> message 首尾截断 -> data 冗余字段同步截断
        capResult: function(toolName, result) {
            var self = this;
            try {
                if (!self.exitLimits || self.exitLimits.enabled === false) return result;
                if (!result || typeof result !== 'object') return result;
                // 豁免：找回型/终止型/配置型工具不截断（原文找回是兜底路径）
                var exempt = self.exitLimits._exempt || [];
                if (exempt.indexOf(toolName) >= 0) return result;

                // 限额：工具级配置优先，缺省用 defaults.max_chars
                var rule = self.exitLimits.tools && self.exitLimits.tools[toolName];
                var maxChars = parseInt(rule && rule.max_chars, 10);
                if (!maxChars || maxChars < 0) {
                    maxChars = parseInt(self.exitLimits.defaults && self.exitLimits.defaults.max_chars, 10) || 6000;
                }
                if (maxChars <= 0) return result; // 0 = 不限制

                // 总长检查（含 JSON 结构开销与 data 冗余）
                var msg = (result.message != null) ? String(result.message) : '';
                var total = 0;
                try { total = JSON.stringify(result).length; } catch (e) { total = msg.length; }
                if (total <= maxChars) return result; // 不超限，原样返回

                // 原文归档（get_tool_result 找回）
                var aid = 0;
                var chatId = self.currentChatId || '';
                if (chatId && self.toolResultArchive) {
                    var archive = self.toolResultArchive[chatId] || (self.toolResultArchive[chatId] = []);
                    self._archiveCounter = (self._archiveCounter || 0) + 1;
                    aid = self._archiveCounter;
                    archive.push({ id: aid, toolName: toolName, content: msg, archivedAt: Date.now() });
                }

                // 1) message 首尾截断（尾部常有 exit code / 错误信息，必须保留）
                if (msg.length > maxChars * 0.5) {
                    var headRatio = parseFloat(self.exitLimits.defaults && self.exitLimits.defaults.head_ratio) || 0.7;
                    var tailRatio = parseFloat(self.exitLimits.defaults && self.exitLimits.defaults.tail_ratio) || 0.3;
                    var headLen = Math.floor(maxChars * 0.5 * headRatio / (headRatio + tailRatio));
                    var tailLen = Math.floor(maxChars * 0.5 * tailRatio / (headRatio + tailRatio));
                    result.message = msg.slice(0, headLen)
                        + '\n\n[⚠️ 输出超长已截断：原始 ' + msg.length + ' 字符，保留头 ' + headLen + ' + 尾 ' + tailLen
                        + ' 字符' + (aid ? '，原文已存档 #' + aid + '（可用 get_tool_result 取回）' : '') + ']'
                        + '\n[💡 建议缩小范围重试：加 findstr/关键词过滤、指定行号、减小 max_chars/max_results 等参数]'
                        + '\n\n' + msg.slice(-tailLen);
                }

                // 2) data 内超长字符串字段同步截断（防 run_code 等 stdout/stderr 与 message 重复膨胀）
                if (result.data && typeof result.data === 'object') {
                    result.data = self._capDataFields(result.data, Math.floor(maxChars * 0.3), 0);
                }
                result._exitTruncated = { tool: toolName, originalTotal: total, limit: maxChars, archiveId: aid };
            } catch (e) { /* 拦截失败不影响工具结果 */ }
            return result;
        },

        // ===== 递归截断对象内超长字符串字段（供 capResult 使用） =====
        _capDataFields: function(node, maxField, depth) {
            var self = this;
            if (depth > 5 || maxField <= 0) return node;
            if (typeof node === 'string') {
                if (node.length > maxField) {
                    var fh = Math.floor(maxField * 0.7);
                    var ft = Math.floor(maxField * 0.3);
                    return node.slice(0, fh) + '\n[已截断' + node.length + '字符]' + node.slice(-ft);
                }
                return node;
            }
            if (Array.isArray(node)) {
                return node.map(function(x) { return self._capDataFields(x, maxField, depth + 1); });
            }
            if (node && typeof node === 'object') {
                var out = {};
                for (var k in node) {
                    if (Object.prototype.hasOwnProperty.call(node, k)) {
                        out[k] = self._capDataFields(node[k], maxField, depth + 1);
                    }
                }
                return out;
            }
            return node;
        },

        // ===== 工具选择变更回调（由 tools-settings.js 保存时调用） =====
        // 让工具启用/停用设置立即生效：清空各对话缓存的工具定义，
        // 并触发 UI 侧刷新（若存在 refreshToolDefinitions 接口）。
        onToolSelectionChanged: function(selectedArr) {
            var self = this;
            if (self._toolDefCache && typeof self._toolDefCache === 'object') {
                for (var k in self._toolDefCache) {
                    if (Object.prototype.hasOwnProperty.call(self._toolDefCache, k)) {
                        delete self._toolDefCache[k];
                    }
                }
            }
            // 触发全局刷新事件，供 app-agent.js 等监听（若已定义）
            if (typeof window.dispatchEvent === 'function') {
                try {
                    window.dispatchEvent(new CustomEvent('tools:selection-changed', {
                        detail: { tools: selectedArr || [] }
                    }));
                } catch (e) { /* ignore */ }
            }
        }
});
