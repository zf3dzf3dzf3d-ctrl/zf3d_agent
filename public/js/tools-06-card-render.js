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

        // ===== 【2026-11-23 新增】read_file/read_lines 工具卡：把 path 参数渲染成可点击链接 =====
        // 点击 → 复用文件树的 _openTextPreview（文本走工作台多标签查看器 WBFileViewer；图片/视频走对应查看器）
        _PATH_TOOLS: { 'read_file': 1, 'read_lines': 1, 'write_file': 1 },
        _pathLinkHtml: function(name, args) {
            if (!this._PATH_TOOLS[name]) return '';
            var p = args && args.path ? String(args.path) : '';
            if (!p) return '';
            var fname = p.split(/[\\/]/).pop() || p;
            return '<div class="tool-wrap__section tool-path-link-section">' +
                '<span class="tool-path-link" data-ftpath="' + this.escapeHtml(p) + '" ' +
                    'title="点击在工作区查看器中打开该文件">' +
                    '📂 在工作区查看：' + this.escapeHtml(fname) + '</span>' +
                '</div>';
        },
        // 事件委托：点击 .tool-path-link → 打开文件（文档级一次性绑定）
        bindPathLinkClicks: function() {
            if (this._pathLinkBound) return;
            this._pathLinkBound = true;
            var self = this;
            document.addEventListener('click', function(e) {
                var el = e.target.closest('.tool-path-link');
                if (!el) return;
                e.stopPropagation();
                var p = el.getAttribute('data-ftpath');
                if (!p) return;
                var fname = p.split(/[\\/]/).pop() || p;
                var ft = (window.App && App.FileTree) || window.FileTree;
                try {
                    /* 【2026-11-23 多对话】按点击所在聊天框路由工作台抽屉（viewer 三参 hostBox），
                       文本文件直开工作台；非文本(图/视频)仍走 _openTextPreview 原路 */
                    var box = null;
                    try { box = el.closest('.chatbox, .chat-box, .chat-node'); } catch (e0) {}
                    var isText = !(ft && typeof ft._isTextFile === 'function') || ft._isTextFile(fname);
                    if (isText && window.WBFileViewer && typeof window.WBFileViewer.open === 'function') {
                        window.WBFileViewer.open(p, fname, box); return;
                    }
                    if (ft && typeof ft._openTextPreview === 'function') {
                        if (ft._isTextFile && ft._isTextFile(fname)) { ft._openTextPreview(p, fname); return; }
                    }
                    if (window.WBFileViewer && typeof window.WBFileViewer.open === 'function') { window.WBFileViewer.open(p, fname, box); return; }
                } catch (err) { console.debug('[tool-path-link] 主查看器打开失败，走回退：', err); }
                // 非文本或查看器不可用 → 打开文件树面板定位到所在目录
                try {
                    if (ft && typeof ft.openFileTreePanel === 'function') {
                        ft.openFileTreePanel('', '');
                        if (typeof ft._navigate === 'function') {
                            var dir = p.replace(/[\\/][^\\/]+$/, '') || p;
                            setTimeout(function() { ft._navigate(dir); }, 200);
                        }
                    }
                } catch (err2) { console.debug('[tool-path-link] 文件树定位回退也失败：', err2); }
            });
        },

        // ===== 渲染"执行中"占位卡片（工具调用瞬间立即显示，完成后原地替换为结果卡） =====
        renderPendingCard: function(name, args) {
            var toolIcon = this._toolIcon(name);
            var label = this._toolLabel(name);
            // 【修复】工具名模型可控：esc 后再进 class/data-tool（防 attribute/class 注入）
            return '<div class="tool-wrap tool-wrap--running tool-wrap--' + this.escapeHtml(name) + '" data-tool="' + this.escapeHtml(name) + '" data-pending="1">' +
                '<div class="tool-wrap__header">' +
                    '<span class="tool-wrap__icon">' + toolIcon + '</span>' +
                    '<span class="tool-wrap__name">' + this.escapeHtml(label) + '</span>' +
                    '<span class="tool-wrap__status tool-wrap__progress" style="color:#5b8cff;">⏳ 执行中…</span>' +
                '</div>' +
                '<div style="padding:6px 12px 8px;font-size:12px;opacity:.65;">正在执行，结果返回后本卡片自动更新…</div>' +
            '</div>';
        },

        // ===== 渲染统一工具卡片（可折叠：调用+结果合为一张卡） =====
        // CSS 类名结构（BEM）：
        //   .tool-wrap              基类（统一样式）
        //   .tool-wrap--success     成功变体（绿色左边框）
        //   .tool-wrap--fail        失败变体（红色左边框）
        //   .tool-wrap--collapsed    折叠状态
        //   .tool-wrap--{toolName}   按工具名单独覆盖（个别工具特殊样式）
        // ===== 提取工具结果的"一句话简述"（AI 返回的简短中文描述，头部可见） =====
        // 取 message 的第一个非空行，去掉常见标记前缀，截前 60 字；失败/无内容时返回空串
        _briefOf: function(result) {
            try {
                if (!result) return '';
                var m = (result.message != null) ? String(result.message) : (result.error != null ? String(result.error) : '');
                if (!m) return '';
                // 取第一个非空行（跳过 ``` 代码围栏行）
                var line = '';
                var lines = m.split(/\r?\n/);
                for (var i = 0; i < lines.length; i++) {
                    var l = lines[i].trim();
                    if (l && !/^```/.test(l)) { line = l; break; }
                }
                if (!line) return '';
                // 去掉常见标记前缀（存档标记/截断提示/emoji 状态符保留图标但去掉重复括注）
                line = line.replace(/^\[存档#\d+\]\s*/, '').replace(/^✅\s*任务完成[:：]?\s*/, '✅ ');
                if (line.length > 60) line = line.slice(0, 60) + '…';
                return line;
            } catch (e) { return ''; }
        },

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
                        '<span class="tool-wrap__arg-val">' + this.escapeHtml(String(args[k])) + '</span>' +  // 入参刻意原文转义（展示 AI 传入的原始参数，不做 md 解析）
                        '</div>';
                }
            }

            // 类名：基类 + 状态变体 + 工具名变体
            // task_complete 不可折叠（消息必须始终可见）
            // 默认折叠：只有 _defaultExpanded 白名单中的工具才自动展开
            var isTerminal = this.isTerminal(name);
            // AI 返回的一句话简述（头部常驻可见，与对话内工具返回描述一致）
            var brief = this._briefOf(result);
            // 悬停 title 存原文全文（截断前），便于看完整描述
            var fullBrief = '';
            try {
                if (result) {
                    fullBrief = (result.message != null) ? String(result.message) : (result.error != null ? String(result.error) : '');
                }
            } catch (e) { fullBrief = ''; }
            // 【修复】工具名模型可控：esc 后再进 class（防 class 注入）
            var cls = 'tool-wrap tool-wrap--' + (result.success ? 'success' : 'fail') + ' tool-wrap--' + this.escapeHtml(name);
            if (isTerminal) cls += ' tool-wrap--nocollapse';
            if (!isTerminal && !this._defaultExpanded[name]) cls += ' tool-wrap--collapsed';

            return '<div class="' + cls + '" data-tool="' + this.escapeHtml(name) + '">' +
                // 头部（始终可见，点击折叠/展开——但 task_complete 不可折叠）
                '<div class="tool-wrap__header">' +
                    '<span class="tool-wrap__icon">' + toolIcon + '</span>' +
                    '<span class="tool-wrap__name">' + this.escapeHtml(label) + '</span>' +
                    '<span class="tool-wrap__status">' + status + '</span>' +
                    (brief ? '<span class="tool-wrap__brief" title="' + this.escapeHtml(fullBrief || brief) + '">' + (window.ZFMD ? ZFMD.inline(brief, { breaks: false }) : this.escapeHtml(brief)) + '</span>' : '') +
                    '<span class="tool-wrap__status-icon">' + statusIcon + '</span>' +
                    (isTerminal ? '' : '<span class="tool-wrap__toggle">▾</span>') +
                '</div>' +
                // 正文（可折叠）
                '<div class="tool-wrap__body">' +
                    (argsHtml ? '<div class="tool-wrap__section"><div class="tool-wrap__section-label">参数</div>' + argsHtml + '</div>' : '') +
                    '<div class="tool-wrap__section"><div class="tool-wrap__section-label">结果</div>' +
                        '<div class="tool-wrap__result">' + (result.html || (window.ZFMD ? ZFMD.render(result.message, { wrap: 'zfmd', media: true, tags: 'rich' }) : this.escapeHtml(result.message))) + '</div>' +
                    '</div>' +
                    // 【文件路径可点击】read_file/read_lines 等工具的 path 参数 → 点击直接在工作区文件树打开该文件
                    (typeof this._pathLinkHtml === 'function' ? this._pathLinkHtml(name, args) : '') +
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

        // ===== HTML 转义（统一走 ZFMD.escapeHtml 全站唯一实现，ZFMD 未加载时 DOM 兜底） =====
        escapeHtml: function(str) {
            if (window.ZFMD && ZFMD.escapeHtml) return ZFMD.escapeHtml(str);
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
                        if (Array.isArray(el._exempt)) {
                            // 合并而非覆盖，且找回/终止型工具强制保底：
                            // 若配置漏掉 get_tool_result，取回的原文会被二次截断，
                            // 诱发「取回→截断→再取回」死循环（历史 keepRecent=3 事故的变体）
                            var mustKeep = ['get_tool_result', 'task_complete', 'ask_user'];
                            var merged = [];
                            for (var ei = 0; ei < el._exempt.length; ei++) {
                                if (merged.indexOf(el._exempt[ei]) < 0) merged.push(el._exempt[ei]);
                            }
                            for (var mi = 0; mi < mustKeep.length; mi++) {
                                if (merged.indexOf(mustKeep[mi]) < 0) merged.push(mustKeep[mi]);
                            }
                            self.exitLimits._exempt = merged;
                        }
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
                    // maxKeep 上限安全阀：超出时丢弃最旧条目，防止存档无界增长
                    var _mk = parseInt(self.toolResultConfig && self.toolResultConfig.maxKeep, 10);
                    if (!isNaN(_mk) && _mk > 0 && archive.length > _mk) {
                        archive.splice(0, archive.length - _mk);
                    }
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
