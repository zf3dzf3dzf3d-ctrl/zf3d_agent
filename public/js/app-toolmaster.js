// ========== app-toolmaster.js - 🧙 工具大师：一键打包本对话的工具执行过程/统计/上下文占用/错误，发到新对话进行 bug 排查 ==========
// 实现方式：
//   1. 对话框右上角（🔧 按钮旁）新增 🧙 按钮
//   2. 点击后收集本对话工具面板内的全部工具卡片结果 + 统计（复用 project-toolstats.js 的收集逻辑）+ 上下文占用 + 错误明细
//   3. 打包成一份诊断报告，写入 localStorage 暂存
//   4. 新建一个对话，报告全文作为首条用户消息自动发送，并附带"找出错误和bug并修复"的分析指令
Object.assign(App, {
    // ===== 🧙 工具大师：入口 =====
    toolMaster: function(srcBox) {
        var self = this;
        try {
            var chat = self._toolMasterFindChat(srcBox);
            if (!chat) { self._toolMasterToast('未找到对话数据'); return; }
            var report = self._toolMasterBuildReport(srcBox, chat);
            if (!report) { self._toolMasterToast('本对话暂无工具调用数据'); return; }
            // 暂存报告，新建对话后自动发出
            try {
                var pend = {};
                try { pend = JSON.parse(localStorage.getItem('toolmaster_pending') || '{}'); } catch (e) {}
                pend['chat_' + Date.now()] = report;
                // 只保留最近 5 份
                var keys = Object.keys(pend);
                if (keys.length > 5) keys.slice(0, keys.length - 5).forEach(function(k) { delete pend[k]; });
                localStorage.setItem('toolmaster_pending', JSON.stringify(pend));
            } catch (e) { console.warn('[ToolMaster] 暂存失败', e); }
            // 新建对话（同引擎/同模型继承走 createChatBox 内部逻辑）
            // 修复：createChatBox 第三参需要的是「模型配置 id」（如 火山方舟），不是「模型ID」（如 glm-5.3）。
            // 之前误传 chat._modelIdOverride（模型ID字符串）→ Models.get() 查不到 → 新对话 modelId 无效，
            // 发送时报「原模型配置不存在」且 _modelIdOverride 丢失。
                        // 【修复】源对话 modelId 失效（配置被删/为空）时逐级回退：用户习惯 → 任意可用模型，
                        // 避免新对话发送时报「原模型配置不存在」。
                        var srcModelId = this._toolMasterResolveModelId(chat);
                        var srcModelIdOverride = (chat._modelIdOverride && this._toolMasterOverrideExists(chat._modelIdOverride)) ? chat._modelIdOverride : '';
            var srcReasoningEffort = chat._reasoningEffort || '';
            var r = srcBox.getBoundingClientRect();
            var newBox = self.createChatBox(Math.round(r.left + 40), Math.round(r.top + 40), srcModelId);
            if (!newBox) { self._toolMasterToast('新建对话失败（可能触发防风暴限制）'); return; }
            // 回填源对话的模型ID/思考强度快照，防止新对话丢失
            try {
                var _tmChat = (newBox.el) ? newBox : null;
                if (_tmChat) {
                    if (srcModelIdOverride) _tmChat._modelIdOverride = srcModelIdOverride;
                    if (srcReasoningEffort) _tmChat._reasoningEffort = srcReasoningEffort;
                }
            } catch (e) {}
            // 兼容：createChatBox 返回的是 chat 对象（含 .el），统一转成 DOM 元素，避免 box.querySelector is not a function
            if (newBox.el) newBox = newBox.el;
            self._toolMasterToast('🧙 已打包 ' + report.stats.totalCalls + ' 次工具调用（出错 ' + report.stats.failCalls + ' 处），正在发送到新对话分析…');
            // 等新对话完全初始化后，自动把报告作为用户消息发出
            var attempts = 0;
            (function trySend() {
                attempts++;
                var newChat = null;
                for (var i = 0; i < (self.chatBoxes || []).length; i++) {
                    if (self.chatBoxes[i].id === newBox.id) { newChat = self.chatBoxes[i]; break; }
                }
                if (newChat && !newChat.isSending && attempts < 20) {
                    // 把报告直接注入历史并发送（绕过输入框，走标准发送链路保证工具/日志齐全）
                    var prompt = report.text +
                        '\n\n=====\n' +
                        '以上是另一个对话的「工具执行过程完整诊断报告」（含调用统计、上下文占用、错误明细和各工具完整结果）。\n' +
                        '请你仔细分析这份报告：找出其中的错误、bug、异常模式和可疑行为，逐条定位原因，并给出具体修复方案（涉及代码的给出修改位置和内容）。';
                    try { self.addMsg(newBox, prompt.substring(0, 120) + '…', 'user', newChat.modelId); } catch (e) {}
                    newChat.history.push({ role: 'user', content: prompt });
                    try { Store.addLog('info', newChat.id, 'toolmaster', '工具大师诊断报告已发送: ' + prompt.length + ' 字符'); } catch (e) {}
                    try { self.updateChatTitle(newBox, '🧙 工具诊断'); } catch (e) {}
                    self.sendToModel(newBox, newChat);
                    // 切到新对话让用户看到
                    try { self.activate(newBox); } catch (e) {}
                } else if (attempts < 20) {
                    setTimeout(trySend, 300);
                }
            })();
        } catch (e) {
            console.error('[ToolMaster]', e);
            self._toolMasterToast('工具大师执行出错: ' + e.message);
        }
    },

    _toolMasterFindChat: function(box) {
        var boxes = this.chatBoxes || [];
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].id === box.id) return boxes[i];
        }
        return null;
    },

    // ===== 打包诊断报告 =====
    _toolMasterBuildReport: function(box, chat) {
        var self = this;
        var tp = box.querySelector('.chatbox-toolpanel');
        var body = tp ? (tp.querySelector('.chatbox-toolpanel-body') || box.querySelector('.chatbox-body')) : box.querySelector('.chatbox-body');
        if (!body) return null;
        var cards = body.querySelectorAll('.tool-wrap');
        if (!cards.length) return null;

        var lines = [];
        var counts = {}, context = {}, order = [], fails = [];
        var total = 0, failTotal = 0, contextTotal = 0;
        var cardDetails = [];

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var name = card.getAttribute('data-tool') || 'unknown';
            if (!counts[name]) { counts[name] = 0; context[name] = 0; order.push(name); }
            counts[name]++;
            var bodyEl = card.querySelector('.tool-wrap__body');
            var raw = bodyEl ? String(bodyEl.textContent || '') : '';
            var chars = raw.replace(/\s+/g, ' ').trim().length;
            var tokens = Math.ceil(chars / 4);
            context[name] += tokens;
            contextTotal += tokens;
            total++;
            var isFail = card.classList.contains('tool-wrap--fail');
            var resEl = card.querySelector('.tool-wrap__result');
            var resText = resEl ? String(resEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
            if (isFail) {
                failTotal++;
                fails.push({ name: name, msg: resText });
            }
            // 每个工具的完整结果（截断单条至 1200 字，防报告爆表）
            cardDetails.push({
                idx: i + 1, name: name, ok: !isFail,
                tokens: tokens,
                text: (raw.length > 1200 ? raw.slice(0, 1200) + '…[截断]' : raw).trim()
            });
        }

        // ---- 统计概览 ----
        lines.push('===== 🧙 工具执行过程诊断报告 =====');
        lines.push('对话: ' + (box.querySelector('.title') ? box.querySelector('.title').textContent : box.id));
        lines.push('生成时间: ' + new Date().toLocaleString());
        lines.push('总调用: ' + total + ' 次 | 工具种类: ' + order.length + ' 种 | 出错: ' + failTotal + ' 处 | 上下文总占用: ~' + contextTotal.toLocaleString() + ' tokens');
        lines.push('');

        // ---- 上下文占用排行 ----
        lines.push('【上下文占用排行】(按工具参数+结果文本估算，约4字符=1 token)');
        var ctxSorted = order.map(function(n) { return { name: n, tokens: context[n], count: counts[n] }; });
        ctxSorted.sort(function(a, b) { return b.tokens - a.tokens; });
        ctxSorted.forEach(function(it, idx) {
            var pct = contextTotal ? (it.tokens * 100 / contextTotal) : 0;
            lines.push((idx + 1) + '. ' + it.name + ' — ' + it.tokens.toLocaleString() + ' tokens (' + pct.toFixed(1) + '%，调用 ' + it.count + ' 次)');
        });
        lines.push('');

        // ---- 调用频率排行 ----
        lines.push('【调用频率排行】');
        var cntSorted = order.map(function(n) { return { name: n, count: counts[n] }; });
        cntSorted.sort(function(a, b) { return b.count - a.count; });
        cntSorted.forEach(function(it, idx) {
            lines.push((idx + 1) + '. ' + it.name + ' — ' + it.count + ' 次 (~' + context[it.name].toLocaleString() + ' tokens)');
        });
        lines.push('');

        // ---- 错误明细 ----
        lines.push('【错误明细】(' + fails.length + ' 处)');
        if (fails.length) {
            fails.forEach(function(f, idx) {
                lines.push((idx + 1) + '. [' + f.name + '] ' + (f.msg || '(无错误文本)'));
            });
        } else {
            lines.push('（无失败的工具调用）');
        }
        lines.push('');

        // ---- 全部工具完整结果 ----
        lines.push('【工具完整执行过程】(单条结果超 1200 字已截断)');
        cardDetails.forEach(function(d) {
            lines.push('--- #' + d.idx + ' ' + d.name + (d.ok ? '' : ' [失败]') + ' (~' + d.tokens.toLocaleString() + ' tokens) ---');
            lines.push(d.text || '(空结果)');
            lines.push('');
        });

        return {
            text: lines.join('\n'),
            stats: { totalCalls: total, kinds: order.length, failCalls: failTotal, contextTokens: contextTotal }
        };
    },

    // 【修复】解析有效模型配置 id：源对话 → 用户习惯 → 第一个可用模型
    _toolMasterResolveModelId: function(chat) {
        try {
            if (chat.modelId && typeof Models !== 'undefined' && Models.get(chat.modelId)) return chat.modelId;
        } catch (e) {}
        try {
            var h = (window.UserSettings && UserSettings.get) ? UserSettings.get('lastModelSelection', null) : null;
            if (h && h.modelId && typeof Models !== 'undefined' && Models.get(h.modelId)) return h.modelId;
        } catch (e2) {}
        try {
            if (typeof Models !== 'undefined' && Array.isArray(Models.list)) {
                for (var i = 0; i < Models.list.length; i++) { if (Models.list[i] && Models.list[i].id) return Models.list[i].id; }
            }
        } catch (e3) {}
        return null;
    },
    // 【修复】校验 override 的模型 ID 是否存在于任一模型配置，防止无效 override 导致发送失败
    _toolMasterOverrideExists: function(oid) {
        try {
            if (!oid) return false;
            if (typeof Models !== 'undefined' && Array.isArray(Models.list)) {
                for (var i = 0; i < Models.list.length; i++) {
                    var m = Models.list[i];
                    if (m && (m.modelId === oid || (m.modelIdOptions || []).indexOf(oid) >= 0)) return true;
                }
            }
            return false;
        } catch (e) { return false; }
    },
    _toolMasterToast: function(msg) {
        try {
            if (typeof this._showStormToast === 'function') { this._showStormToast(msg); return; }
        } catch (e) {}
        try { if (typeof this.addMsg === 'function' && this.chatBoxes && this.chatBoxes[0]) { this.addMsg(this.chatBoxes[0].el, msg, 'system'); } } catch (e) { console.log('[ToolMaster]', msg); }
    },

    // ===== 注入 🧙 按钮（对话框创建后调用；bindChatBox 里也做兜底） =====
    injectToolMasterButton: function(box) {
        if (!box) return;
        var existing = box.querySelector('.chatbox-header-row1 .toolmaster-btn, .chatbox-toolpanel-header .toolmaster-btn');
        if (existing) {
            // 旧位置（工具面板头部）残留的搬到 header 第一排
            if (!box.querySelector('.chatbox-header-row1 .toolmaster-btn')) {
                try { existing.remove(); } catch (e) {}
            } else return;
        }
        box.querySelectorAll('.chatbox-header .toolmaster-btn').forEach(function(b) { b.remove(); });
        var btn = document.createElement('button');
        btn.className = 'hd-btn toolmaster-btn master-icon';
        btn.title = '工具大师：打包本对话全部工具结果/统计/上下文占用/错误，发送到新对话进行 bug 分析';
        btn.textContent = '🧙';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            App.toolMaster(box);
        });
        // header 第一排：… 📜 🧙 🎓 ✕（工具大师插在关闭按钮左侧，与导师图标同行）
        var row1 = box.querySelector('.chatbox-header-row1');
        var closeBtn = row1 ? row1.querySelector('.hd-btn.close') : null;
        if (row1 && closeBtn && closeBtn.parentNode) {
            closeBtn.parentNode.insertBefore(btn, closeBtn);
        } else if (row1) {
            row1.appendChild(btn);
        } else {
            var hdr2 = box.querySelector('.chatbox-toolpanel-header') || box.querySelector('.chatbox-header');
            if (hdr2) hdr2.appendChild(btn);
        }
    },
});

// ===== 自动给已存在的对话框注入按钮 =====
try {
    (function initToolMaster() {
        function injectAll() {
            try {
                document.querySelectorAll('.chatbox').forEach(function(b) { App.injectToolMasterButton(b); });
            } catch (e) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectAll);
        else setTimeout(injectAll, 0);
        // 动态新建的对话框：钩住 createChatBox 之后自动注入
        var _origCreate = App.createChatBox;
        if (typeof _origCreate === 'function') {
            App.createChatBox = function() {
                var b = _origCreate.apply(this, arguments);
                if (b) { try { App.injectToolMasterButton(b); } catch (e) {} }
                return b;
            };
        }
        // 兜底：bindChatBox 后再补一次（防 createChatBox 钩子被其他模块覆盖）
        var _origBind = App.bindChatBox;
        if (typeof _origBind === 'function') {
            App.bindChatBox = function(box, chat) {
                var r = _origBind.apply(this, arguments);
                try { App.injectToolMasterButton(box); } catch (e) {}
                return r;
            };
        }
    })();
} catch (e) { console.warn('[ToolMaster] init failed', e); }
