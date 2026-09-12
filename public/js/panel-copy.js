// ========== panel-copy.js - 一键复制/导出对话与日志 ==========
// 拆分自 app-panels.js（原 297~493 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 一键复制工具函数 =====
        _copyToClipboard: function(text, label) {
            // 优先用 execCommand('copy')，HTTP 环境下 navigator.clipboard 会挂起
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            if (ok) {
                this._toast('✅ ' + label + '已复制到剪贴板', 'ok');
                return;
            }
            // execCommand 失败才尝试 clipboard API（加 2 秒超时保护）
            if (navigator.clipboard && navigator.clipboard.writeText) {
                var self = this;
                var done = false;
                var timer = setTimeout(function() {
                    if (!done) { done = true; self._toast('❌ 复制超时', 'err'); }
                }, 2000);
                navigator.clipboard.writeText(text).then(function() {
                    if (!done) { done = true; clearTimeout(timer); self._toast('✅ ' + label + '已复制到剪贴板', 'ok'); }
                }).catch(function() {
                    if (!done) { done = true; clearTimeout(timer); self._toast('❌ 复制失败', 'err'); }
                });
            } else {
                this._toast('❌ 复制失败', 'err');
            }
        },
        _toast: function(msg, type) {
            var el = document.createElement('div');
            el.textContent = msg;
            var bg = type === 'ok' ? '#28a745' : type === 'err' ? '#f44336' : '#3b82f6';
            el.style.cssText =
                'padding:8px 20px;border-radius:6px;font-size:13px;font-weight:bold;' +
                'background:' + bg + ';color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.3);';
            // 使用全局 ToastStack（左下角堆叠排列）
            if (window.ToastStack) {
                window.ToastStack.show(el, 2000);
            } else {
                el.style.cssText += 'position:fixed;bottom:16px;left:16px;z-index:99999;transition:opacity .3s;';
                document.body.appendChild(el);
                setTimeout(function() { el.style.opacity = '0'; }, 1500);
                setTimeout(function() { if(el.parentNode) el.parentNode.removeChild(el); }, 1800);
            }
        },

        // ===== 复制日志 =====
        copyLogs: function() {
            var logs = Store.getLogs();
            if (logs.length === 0) { this._toast('暂无日志', 'err'); return; }
            var text = logs.map(function(l) {
                var d = new Date(l.ts);
                return d.toLocaleString('zh-CN', { hour12: false }) + ' | ' + l.level + ' | ' + l.boxId + ' | ' + l.action + ' | ' + l.detail;
            }).join('\n');
            this._copyToClipboard(text, '日志(' + logs.length + '条) ');
            Store.addLog('info', '', 'copy', '复制日志 ' + logs.length + ' 条');
        },

        // ===== 格式化消息列表用于导出（连续工具调用折叠为一个块） =====
        _formatMsgsForExport: function(msgs) {
            var text = '';
            var toolGroup = [];  // 收集连续的工具调用

            function flushToolGroup() {
                if (toolGroup.length === 0) return;
                var firstTs = new Date(toolGroup[0].ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
                text += '[' + firstTs + '] 🔧 工具调用 (' + toolGroup.length + '次):\n';
                toolGroup.forEach(function(m) {
                    text += '  ' + (m.content || '') + '\n';
                });
                text += '\n';
                toolGroup = [];
            }

            msgs.forEach(function(m) {
                var isTool = (m.type === 'tool' || m.type === 'tool_call' || m.role === 'tool_call');
                if (isTool) {
                    toolGroup.push(m);
                } else {
                    flushToolGroup();
                    var role = m.role === 'user' ? '🧑 用户' : (m.role === 'error' ? '❌ 错误' : '🤖 AI');
                    text += '[' + new Date(m.ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + role + ':\n' + (m.content || '') + '\n\n';
                }
            });
            flushToolGroup();
            return text;
        },

        // ===== 复制全部（对话+日志 一键完整调试报告） =====
        copyAll: function() {
            var self = this;
            var logs = Store.getLogs();
            var totalMsgs = 0;

            var text = '╔══════════════════════════════════════════╗\n';
            text += '║  朱峰社区无限智能体 - 完整调试报告          ║\n';
            text += '╚══════════════════════════════════════════╝\n';
            text += '导出时间: ' + new Date().toLocaleString('zh-CN', { hour12: false }) + '\n';
            text += '对话框数: ' + this.chatBoxes.length + '\n';
            text += '日志条数: ' + logs.length + '\n';
            text += '════════════════════════════════════════════\n\n';

            // ---- 第一部分：全部对话 ----
            text += '【一】对话记录\n';
            text += '────────────────────────────────────────────\n\n';
            if (this.chatBoxes.length === 0) {
                text += '（暂无对话框）\n\n';
            } else {
                this.chatBoxes.forEach(function(chat) {
                    var msgs = Store.getMessages(chat.id);
                    totalMsgs += msgs.length;
                    var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
                    text += '── 对话框: ' + chat.id + ' | 模型: ' + modelName + ' | 消息数: ' + msgs.length + ' ──\n\n';
                    if (msgs.length === 0) {
                        text += '（空）\n\n';
                    } else {
                        text += self._formatMsgsForExport(msgs);
                    }
                });
            }

            // ---- 第二部分：全部日志 ----
            text += '════════════════════════════════════════════\n';
            text += '【二】运行日志\n';
            text += '────────────────────────────────────────────\n\n';
            if (logs.length === 0) {
                text += '（暂无日志）\n';
            } else {
                logs.forEach(function(l) {
                    var d = new Date(l.ts);
                    text += d.toLocaleString('zh-CN', { hour12: false }) + ' | ' + l.level + ' | ' + (l.boxId || '-') + ' | ' + l.action + ' | ' + (l.detail || '') + '\n';
                });
            }

            text += '\n════════════════════════════════════════════\n';
            text += '报告结束 · 对话' + totalMsgs + '条 · 日志' + logs.length + '条\n';

            this._copyToClipboard(text, '完整报告(对话' + totalMsgs + '+日志' + logs.length + '条) ');
            Store.addLog('info', '', 'copy', '复制全部: 对话' + totalMsgs + '条 + 日志' + logs.length + '条');
        },

        // ===== 复制单个对话框对话 =====
        copyChat: function(chatId) {
            var chat = this.chatBoxes.find(function(c) { return c.id === chatId; });
            if (!chat) return;
            var msgs = Store.getMessages(chatId);
            if (msgs.length === 0) { this._toast('暂无对话内容', 'err'); return; }
            var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
            var text = '=== 朱峰社区无限智能体 - 对话记录 ===\n';
            text += '对话框ID: ' + chatId + '\n';
            text += '模型: ' + modelName + '\n';
            text += '时间: ' + new Date().toLocaleString('zh-CN') + '\n';
            text += '消息数: ' + msgs.length + '\n';
            text += '=========================================\n\n';
            text += this._formatMsgsForExport(msgs);
            this._copyToClipboard(text, '对话(' + msgs.length + '条) ');
            Store.addLog('info', chatId, 'copy', '复制对话 ' + msgs.length + ' 条');
        },

        // ===== 复制全部对话 =====
        copyAllChats: function() {
            var self = this;
            if (this.chatBoxes.length === 0) { this._toast('暂无对话框', 'err'); return; }
            var text = '=== 朱峰社区无限智能体 - 全部对话记录 ===\n';
            text += '时间: ' + new Date().toLocaleString('zh-CN') + '\n';
            text += '对话框数: ' + this.chatBoxes.length + '\n';
            text += '=========================================\n\n';
            this.chatBoxes.forEach(function(chat) {
                var msgs = Store.getMessages(chat.id);
                var modelName = chat.modelId ? (Models.get(chat.modelId) ? Models.get(chat.modelId).name : chat.modelId) : '未选择模型';
                text += '--- 对话框: ' + chat.id + ' | 模型: ' + modelName + ' | 消息数: ' + msgs.length + ' ---\n\n';
                text += self._formatMsgsForExport(msgs);
                text += '\n';
            });
            this._copyToClipboard(text, '全部对话(' + this.chatBoxes.length + '框) ');
            Store.addLog('info', '', 'copy', '复制全部对话 ' + this.chatBoxes.length + ' 框');
        },

        renderImageModelSelect: function() {
            var select = document.getElementById('image-model-select');
            if (!select || typeof Models === 'undefined') return;
            var selected = UserSettings.get('zf3d_image_model') || '';
            var list = (Models.list || []).filter(function(m) { return m.imageGen; });
            select.innerHTML = '<option value="">默认 pollinations（免费，不自动切换）</option>' + list.map(function(m) {
                var value = m.modelId || m.id || '';
                return '<option value="' + String(value).replace(/"/g, '&quot;') + '">' + String(m.name || value).replace(/[<>&]/g, function(c) { return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]; }) + '</option>';
            }).join('');
            select.value = selected;
            select.onchange = function() { UserSettings.set('zf3d_image_model', this.value || ''); };
            // 渲染渠道状态卡片
            this.renderImageChannels();
        },
});
