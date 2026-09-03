// ========== app-logmaster.js - 📊 日志大师 & 🧠 上下文大师 ==========
// 功能：
//   1. 对话日志面板（chatbox-logpanel）右上角 Tab 栏内新增两个按钮：
//      📊 日志大师 —— 打包本对话日志统计 + 全部错误日志，发送到新对话让 AI 检查有没有问题/bug 并优化
//      🧠 上下文大师 —— 打包本对话最后一次发送给 AI 的完整上下文，发送到新对话让 AI 找出上下文不合理/bug 的地方并修复
//   2. 实现方式参照 app-toolmaster.js：报告写入 localStorage 暂存 → 新建对话（继承引擎/模型）→ 报告作为首条用户消息自动发送
Object.assign(App, {
    // ===== 📊 日志大师：入口 =====
    logMaster: function(srcBox) {
        var self = this;
        try {
            var chat = self._logMasterFindChat(srcBox);
            var logs = [];
            try { logs = Store.getLogs() || []; } catch (e) {}
            var errLogs = logs.filter(function(l) { return l && l.level === 'error'; });
            if (!logs.length) { self._logMasterToast('当前没有任何日志可分析'); return; }

            // ---- 组装报告：统计概览 + 错误明细 + 全部日志（截断）----
            var lines = [];
            lines.push('===== 📊 运行日志诊断报告 =====');
            lines.push('生成时间: ' + new Date().toLocaleString());
            // 统计概览
            var byLevel = {}, byAction = {};
            logs.forEach(function(l) {
                var lv = l.level || 'unknown'; byLevel[lv] = (byLevel[lv] || 0) + 1;
                var ac = l.action || 'unknown'; byAction[ac] = (byAction[ac] || 0) + 1;
            });
            lines.push('总日志: ' + logs.length + ' 条 | 错误: ' + (byLevel.error || 0) + ' | 警告: ' + (byLevel.warn || 0));
            lines.push('');
            lines.push('【按类别统计】');
            Object.keys(byAction).map(function(k) { return { a: k, c: byAction[k] }; })
                .sort(function(x, y) { return y.c - x.c; })
                .forEach(function(it, i) { lines.push((i + 1) + '. ' + it.a + ' — ' + it.c + ' 条'); });
            lines.push('');
            // 错误明细（重点，逐条完整）
            lines.push('【全部错误日志】共 ' + errLogs.length + ' 条');
            errLogs.forEach(function(l, i) {
                lines.push('--- 错误#' + (i + 1) + ' [' + new Date(l.ts || 0).toLocaleString() + '] ' + (l.action || '') + ' ---');
                lines.push(l.detail || '(无详情)');
            });
            lines.push('');
            // 全部日志（截断到最近 200 条，单条详情截 300 字）
            var recent = logs.slice(-200);
            lines.push('【最近日志】(最多 200 条，单条截断 300 字)');
            recent.forEach(function(l) {
                var d = String(l.detail || '');
                if (d.length > 300) d = d.slice(0, 300) + '…[截断]';
                lines.push('[' + (l.level || '') + '] ' + (l.action || '') + (d ? ' — ' + d : ''));
            });

            var reportText = lines.join('\n');
            var prompt = reportText + '\n\n=====\n' +
                '以上是本系统的「运行日志诊断报告」（含统计概览、全部错误日志明细和最近日志）。' +
                '请你仔细检查这些日志有没有问题：逐条分析错误/警告的含义，定位可能的 bug 或异常模式，判断哪些是偶发、哪些是系统性问题，并给出具体的检查结论和优化修复建议（涉及代码的给出修改位置和内容）。';

            self._logMasterSendToNewChat(srcBox, chat, prompt, '📊 日志诊断', 'logmaster');
            self._logMasterToast('📊 已打包 ' + logs.length + ' 条日志（含 ' + errLogs.length + ' 条错误），正在发送到新对话分析…');
        } catch (e) {
            console.error('[LogMaster]', e);
            self._logMasterToast('日志大师执行出错: ' + e.message);
        }
    },

    // ===== 🧠 上下文大师：入口 =====
    contextMaster: function(srcBox) {
        var self = this;
        try {
            var chat = self._logMasterFindChat(srcBox);
            var ctx = (chat && chat._lastContext) ? chat._lastContext : '';
            if (!ctx) { self._logMasterToast('本对话还没有发送过请求，暂无上下文可分析'); return; }

            // 解析并组装报告
            var lines = [];
            lines.push('===== 🧠 上下文诊断报告 =====');
            lines.push('生成时间: ' + new Date().toLocaleString());
            var parsed = null;
            try { parsed = JSON.parse(ctx); } catch (e) {}
            if (parsed && parsed.messages) {
                var msgs = parsed.messages;
                // 构成统计
                var byRole = { system: 0, user: 0, assistant: 0, tool: 0, other: 0 };
                var charByRole = { system: 0, user: 0, assistant: 0, tool: 0, other: 0 };
                var totalChars = 0;
                msgs.forEach(function(m) {
                    if (!m || !m.role) return;
                    var t = '';
                    if (typeof m.content === 'string') t = m.content;
                    else if (m.content) { try { t = JSON.stringify(m.content); } catch (e) {} }
                    if (m.tool_calls && m.tool_calls.length) { try { t += '\n' + JSON.stringify(m.tool_calls); } catch (e) {} }
                    var r = byRole[m.role] !== undefined ? m.role : 'other';
                    byRole[r]++; charByRole[r] += t.length; totalChars += t.length;
                });
                var toolDefs = 0, toolDefChars = 0;
                if (parsed.tools && parsed.tools.length) {
                    toolDefs = parsed.tools.length;
                    try { toolDefChars = JSON.stringify(parsed.tools).length; } catch (e) {}
                    totalChars += toolDefChars;
                }
                lines.push('消息总数: ' + msgs.length + ' 条 | 工具定义: ' + toolDefs + ' 个 | 总字符: ' + totalChars.toLocaleString());
                lines.push('');
                lines.push('【上下文构成】');
                ['system', 'user', 'assistant', 'tool', 'other'].forEach(function(r) {
                    if (byRole[r] > 0) {
                        var pct = totalChars ? (charByRole[r] * 100 / totalChars).toFixed(1) : '0';
                        lines.push('- ' + r + ': ' + byRole[r] + ' 条 / ' + charByRole[r] + ' 字符 (' + pct + '%)');
                    }
                });
                lines.push('');
                // 完整消息序列（单条截 800 字防爆表）
                lines.push('【完整消息序列】(单条截断 800 字)');
                msgs.forEach(function(m, i) {
                    if (!m || !m.role) return;
                    var t = '';
                    if (typeof m.content === 'string') t = m.content;
                    else if (m.content) { try { t = JSON.stringify(m.content); } catch (e) {} }
                    if (m.tool_calls && m.tool_calls.length) {
                        try { t += '\n[tool_calls] ' + JSON.stringify(m.tool_calls); } catch (e) {}
                    }
                    if (t.length > 800) t = t.slice(0, 800) + '…[截断]';
                    lines.push('--- #' + (i + 1) + ' [' + m.role + '] ---');
                    lines.push(t || '(空内容)');
                });
            } else {
                // 非标准 JSON，原文截断给出
                lines.push('(上下文非标准 JSON，以下为原文前 20000 字)');
                lines.push(ctx.length > 20000 ? ctx.slice(0, 20000) + '…[截断]' : ctx);
            }

            var reportText = lines.join('\n');
            var prompt = reportText + '\n\n=====\n' +
                '以上是本系统「最后一次发送给 AI 的完整上下文」（含构成统计和完整消息序列）。' +
                '请你仔细检查这份上下文：找出其中不合理的地方（如重复内容、冗余消息、顺序错乱、角色错配、超长未截断、缺失关键信息等）和可能的 bug，逐条定位原因，并给出具体的修复方案（涉及代码的给出修改位置和内容）。';

            self._logMasterSendToNewChat(srcBox, chat, prompt, '🧠 上下文诊断', 'contextmaster');
            self._logMasterToast('🧠 已打包上下文报告（' + prompt.length + ' 字符），正在发送到新对话分析…');
        } catch (e) {
            console.error('[ContextMaster]', e);
            self._logMasterToast('上下文大师执行出错: ' + e.message);
        }
    },

    // ===== 公共：新建对话并发送报告（复用工具大师的链路思路）=====
    _logMasterSendToNewChat: function(srcBox, chat, prompt, title, tag) {
        var self = this;
        // 修复：createChatBox 第三参需要「模型配置 id」而非「模型ID」字符串（详见 app-toolmaster.js 同款修复）
        // 【修复】源模型失效时逐级回退（用户习惯 → 任意可用模型）
                var srcModelId = (typeof App._toolMasterResolveModelId === 'function') ? App._toolMasterResolveModelId(chat || {}) : null;
        var srcModelIdOverride = chat ? (chat._modelIdOverride || '') : '';
        var srcReasoningEffort = chat ? (chat._reasoningEffort || '') : '';
        var r = srcBox.getBoundingClientRect();
        var newBox = self.createChatBox(Math.round(r.left + 40), Math.round(r.top + 40), srcModelId);
        if (!newBox) { self._logMasterToast('新建对话失败（可能触发防风暴限制）'); return; }
        // 回填源对话的模型ID/思考强度快照，防止新对话丢失
        try {
            var _lmChat = (newBox.el) ? newBox : null;
            if (_lmChat) {
                if (srcModelIdOverride) _lmChat._modelIdOverride = srcModelIdOverride;
                if (srcReasoningEffort) _lmChat._reasoningEffort = srcReasoningEffort;
            }
        } catch (e) {}
        // 兼容：createChatBox 返回的是 chat 对象（含 .el），统一转成 DOM 元素，避免 box.querySelector is not a function
        if (newBox.el) newBox = newBox.el;
        var attempts = 0;
        (function trySend() {
            attempts++;
            var newChat = null;
            for (var i = 0; i < (self.chatBoxes || []).length; i++) {
                if (self.chatBoxes[i].id === newBox.id) { newChat = self.chatBoxes[i]; break; }
            }
            if (newChat && !newChat.isSending && attempts < 20) {
                try { self.addMsg(newBox, prompt.substring(0, 120) + '…', 'user', newChat.modelId); } catch (e) {}
                newChat.history.push({ role: 'user', content: prompt });
                try { Store.addLog('info', newChat.id, tag, tag + ' 诊断报告已发送: ' + prompt.length + ' 字符'); } catch (e) {}
                try { self.updateChatTitle(newBox, title); } catch (e) {}
                self.sendToModel(newBox, newChat);
                try { self.activate(newBox); } catch (e) {}
            } else if (attempts < 20) {
                setTimeout(trySend, 300);
            }
        })();
    },

    _logMasterFindChat: function(box) {
        var boxes = this.chatBoxes || [];
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].el === box || boxes[i].id === box.id) return boxes[i];
        }
        return null;
    },

    _logMasterToast: function(msg) {
        try {
            if (typeof this._showStormToast === 'function') { this._showStormToast(msg); return; }
        } catch (e) {}
        try { if (typeof this.addMsg === 'function' && this.chatBoxes && this.chatBoxes[0]) { this.addMsg(this.chatBoxes[0].el, msg, 'system'); } } catch (e) { console.log('[LogMaster]', msg); }
    },

    // ===== 往 header 第一排注入 📊 日志大师 / 🧠 上下文大师 按钮（原日志面板内按钮迁移到右上角）=====
    injectLogMasterButtons: function(box) {
        try {
            var row1 = box && box.querySelector('.chatbox-header-row1');
            if (!row1) return;
            var closeBtn = row1.querySelector('.hd-btn.close');
            var insertBefore = closeBtn || row1.firstChild;
            if (!insertBefore) return;
            if (!row1.querySelector('.logmaster-btn')) {
                var btn1 = document.createElement('button');
                btn1.className = 'hd-btn logmaster-btn master-icon';
                btn1.title = '日志大师：打包日志统计+全部错误日志发送给 AI，检查有没有问题/bug 并优化';
                btn1.textContent = '📊';
                btn1.addEventListener('click', function(e) {
                    e.stopPropagation(); e.preventDefault();
                    App.logMaster(box);
                });
                row1.insertBefore(btn1, insertBefore);
            }
            if (!row1.querySelector('.contextmaster-btn')) {
                var btn2 = document.createElement('button');
                btn2.className = 'hd-btn contextmaster-btn master-icon';
                btn2.title = '上下文大师：把最后一次发送给 AI 的完整上下文发给 AI，找出不合理/bug 的地方并修复';
                btn2.textContent = '🧠';
                btn2.addEventListener('click', function(e) {
                    e.stopPropagation(); e.preventDefault();
                    App.contextMaster(box);
                });
                row1.insertBefore(btn2, row1.querySelector('.hd-btn.close') || insertBefore);
            }
            // 兼容：旧位置（日志面板 actions）残留的同名按钮移除，避免双入口
            var lp = box.querySelector('.chatbox-logpanel');
            if (lp) lp.querySelectorAll('.logmaster-btn, .contextmaster-btn').forEach(function(b) { b.remove(); });
        } catch (e) {}
    },
});

// ===== 渲染钩子：renderLogPanel 后自动注入按钮（含动态新建/恢复的对话）=====
try {
    (function () {
        // 每次渲染后补挂（logpanel 内部 innerHTML 每次重建，按钮会消失，需重挂）
        var _origRender = App.renderLogPanel;
        if (typeof _origRender === 'function') {
            App.renderLogPanel = function(box) {
                var r = _origRender.apply(this, arguments);
                try { App.injectLogMasterButtons(box); } catch (e) {}
                return r;
            };
        }
        // 兜底：MutationObserver 监听 logpanel 打开时的重渲染（renderLogPanel 被其他模块覆盖时）
        var _origToggle = App.toggleLogPanel;
        if (typeof _origToggle === 'function') {
            App.toggleLogPanel = function(box) {
                var r = _origToggle.apply(this, arguments);
                try { setTimeout(function() { App.injectLogMasterButtons(box); }, 50); } catch (e) {}
                return r;
            };
        }
        // 兜底2：对话创建/绑定时直接注入到 header 第一排（不依赖日志面板打开）
        var _origCreate2 = App.createChatBox;
        if (typeof _origCreate2 === 'function') {
            App.createChatBox = function() {
                var b = _origCreate2.apply(this, arguments);
                if (b) { try { App.injectLogMasterButtons(b); } catch (e) {} }
                return b;
            };
        }
        var _origBind2 = App.bindChatBox;
        if (typeof _origBind2 === 'function') {
            App.bindChatBox = function(box, chat) {
                var r = _origBind2.apply(this, arguments);
                try { App.injectLogMasterButtons(box); } catch (e) {}
                return r;
            };
        }
    })();
} catch (e) { console.warn('[LogMaster] init failed', e); }
