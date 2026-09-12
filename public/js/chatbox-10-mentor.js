// ==== 导师功能：对话右上角"导师"图标 ====
// 作用：把当前对话框的全部内容（用户问题 / AI 回复 / 工具调用结果）收集起来，
//      创建一个新对话框，把内容整体发给导师 AI，请它评论这个任务处理得怎么样、有没有 bug。
Object.assign(App, {

    // ===== 收集某个对话的完整内容（对话记录 + 工具调用结果 + 日志） =====
    _mentorCollectChatText: function(chat) {
        var lines = [];
        var cid = chat ? chat.id : '';
        var msgs = [];
        try { msgs = Store.getMessages(cid) || []; } catch (e) {}

        // 1) 对话记录（含工具消息：role=tool_call / type=tool 的也会被 Store.getMessages 返回）
        lines.push('===== 对话记录（对话 ' + cid + '，共 ' + msgs.length + ' 条） =====');
        msgs.forEach(function(m, i) {
            if (!m) return;
            var role = m.role === 'user' ? '用户' :
                       (m.role === 'tool_call' || m.role === 'tool' || m.type === 'tool_call' || m.type === 'tool' ? '工具' :
                       (m.role === 'error' ? '错误' : (m.role === 'ai' || m.role === 'assistant' ? 'AI' : m.role)));
            var tag = (m.action ? '（' + m.action + '）' : '');
            lines.push('--- 第' + (i + 1) + '条 [' + role + ']' + tag + ' ---');
            lines.push(String(m.content == null ? '' : m.content));
            lines.push('');
        });

        // 2) 本对话相关日志（含出错日志，方便导师发现 bug 线索）
        try {
            var logs = Store.getLogs() || [];
            var mine = logs.filter(function(L) {
                return L && String(L.boxId || L.chatId || L.chat || L.cid || '') === String(cid);
            });
            if (mine.length) {
                lines.push('===== 本对话相关日志（共 ' + mine.length + ' 条，含错误线索） =====');
                mine.forEach(function(L) {
                    lines.push('[' + (L.ts || '') + '] [' + (L.level || '') + '] ' + (L.action || '') +
                               (L.detail ? ' - ' + L.detail : ''));
                });
            }
        } catch (e) {}

        // 3) 工具执行结果（工具面板卡片 + 工具结果仓库，旧代码完全没收集）
        try {
            var toolLines = [];
            var cards = chat.el ? chat.el.querySelectorAll('.chatbox-toolpanel .tool-wrap, .chatbox-toolpanel-body .tool-wrap') : [];
            for (var ti = 0; ti < cards.length; ti++) {
                var card = cards[ti];
                var tname = card.getAttribute('data-tool') || 'unknown';
                var tbody = card.querySelector('.tool-wrap__body');
                var traw = tbody ? String(tbody.textContent || '').replace(/\s+/g, ' ').trim() : '';
                if (traw.length > 1200) traw = traw.slice(0, 1200) + '…[截断]';
                toolLines.push('--- [' + tname + (card.classList.contains('tool-wrap--fail') ? ' 失败' : '') + '] ' + traw);
            }
            if (!toolLines.length && typeof Tools !== 'undefined' && Tools.toolResultArchive && Tools.toolResultArchive[cid]) {
                var arch = Tools.toolResultArchive[cid];
                Object.keys(arch).forEach(function(k) {
                    var v = arch[k];
                    var vs = '';
                    try { vs = (typeof v === 'string') ? v : JSON.stringify(v); } catch (e2) { vs = String(v); }
                    if (vs.length > 1200) vs = vs.slice(0, 1200) + '…[截断]';
                    toolLines.push('--- [' + k + '] ' + vs);
                });
            }
            if (toolLines.length) {
                lines.push('===== 工具执行结果（共 ' + toolLines.length + ' 条） =====');
                lines.push.apply(lines, toolLines);
            }
        } catch (e) {}

        return lines.join('\n');
    },

    // ===== 点击导师图标：新建对话并发送全部内容请求点评 =====
    _mentorReviewChat: function(chat) {
        var self = this;
        if (!chat || !chat.el) return;
        if (chat.isSending) {
            self.addMsg(chat.el, '当前对话正在回复中，请等 AI 回复结束后再让导师点评。', 'error');
            return;
        }
        // 内容为空（除欢迎语外没有任何消息）则不浪费一次点评
        var msgs = [];
        try { msgs = Store.getMessages(chat.id) || []; } catch (e) {}
        if (msgs.length <= 1) {
            self.addMsg(chat.el, '本对话还没有实质内容，先和 AI 聊出任务过程，再点导师 🎓 点评。', 'error');
            return;
        }

        var srcTitle = '';
        try {
            var tEl = chat.el.querySelector('.title');
            srcTitle = tEl ? (tEl.textContent || '').trim() : ('对话' + (chat.chatNum || ''));
        } catch (e) {}

        var transcript = self._mentorCollectChatText(chat);
        // 安全长度限制：过长的转录截断（与上下文豁免上限同量级，防止 400）
        var MAX_CHARS = 90000;
        if (transcript.length > MAX_CHARS) {
            transcript = transcript.slice(0, MAX_CHARS) +
                '\n\n【提示】转录内容过长（' + transcript.length + ' 字），已截断保留前 ' + MAX_CHARS + ' 字。';
        }

        var prompt =
            '🎓【导师点评请求】\n' +
            '下面是另一个对话框「' + srcTitle + '」（ID: ' + chat.id + '）的完整任务过程转录，' +
            '包含用户的原始问题、AI 的全部回复、工具调用与工具返回结果，以及相关运行日志。\n\n' +
            '请你扮演一位严格的资深技术导师，对这个任务的处理过程做出点评：\n' +
            '1. 任务理解是否到位？解决方案是否合理？\n' +
            '2. 有没有 bug、错误逻辑、遗漏的边界情况？（请结合日志中的报错线索具体指出）\n' +
            '3. 工具的使用是否恰当、有没有冗余或低效的调用？\n' +
            '4. 给出总体评分（1-10）和最需要改进的 1-3 点建议。\n\n' +
            '===== 任务过程转录开始 =====\n' + transcript + '\n===== 任务过程转录结束 =====\n';

        // 在源对话旁创建新对话框（右侧偏移，不遮挡原对话）
        var rect = chat.el.getBoundingClientRect();
        var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
        var cRect = canvas ? canvas.getBoundingClientRect() : null;
        var nx = cRect ? (rect.right - cRect.left + 40) : rect.right + 40;
        var ny = cRect ? (rect.top - cRect.top + 24) : rect.top + 24;
        if (cRect && nx + 360 > cRect.width) nx = Math.max(0, rect.left - cRect.left - 380);
        // 【修复】源模型失效时逐级回退，避免导师点评新对话报「原模型配置不存在」
                var _mentorModelId = (typeof self._toolMasterResolveModelId === 'function') ? self._toolMasterResolveModelId(chat) : chat.modelId;
                var newChat = self.createChatBox(nx, ny, _mentorModelId);
        if (!newChat) {
            try { self.addMsg(chat.el, '创建导师对话框失败（可能触发了防风暴保护），请稍后再试。', 'error'); } catch (e) {}
            return;
        }

        // 改标题
        try {
            var ntEl = newChat.el.querySelector('.title');
            if (ntEl) ntEl.textContent = '🎓 导师点评 · ' + srcTitle;
            newChat.title = '🎓 导师点评 · ' + srcTitle;
        } catch (e) {}

        // 填入 textarea 并走标准发送流程（addMsg + history + sendToModel，
        // 与用户手动输入完全一致的链路，工具/守卫/日志全部生效）
        setTimeout(function() {
            try {
                var ta = newChat.el.querySelector('textarea');
                if (ta) {
                    ta.value = prompt;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                }
                // 写入聊天状态并发送
                newChat.history.push({ role: 'user', content: prompt, ts: Date.now() });
                self.addMsg(newChat.el, prompt, 'user', newChat.modelId, true);
                Store.addLog('info', newChat.id, 'mentor', '导师点评请求已发出（源对话: ' + chat.id + '，转录 ' + prompt.length + ' 字）');
                self.sendToModel(newChat.el, newChat);
            } catch (e) {
                console.error('[mentor] 发送失败:', e);
                try { self.addMsg(newChat.el, '导师点评发送失败：' + (e && e.message ? e.message : e), 'error'); } catch (e2) {}
            }
        }, 250);
    }
});
