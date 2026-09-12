// ========== app-relaymaster.js - 🔗 对话接力大师 ==========
// 功能：把源对话的「用户提问 + AI 回答」问答清单打包发给新对话，并附上【最后一个问题】的
//       完整资料（问题原文 + AI 当前回答进度 + 该问题触发的全部工具执行结果原样）。
//       让新对话的 AI：接着最后一个问题继续完成任务（而不是重新开始）；同时根据问答清单
//       判断前面哪些问题可能没回答完整；如果全部已完成则输出前因后果收尾总结。
// 设计要点：旧轮次的工具结果全部丢弃（避免上下文膨胀），只保留最后一问的工具结果。
// 实现方式参照 app-synthmaster.js：新建对话（继承引擎/模型/思考强度）→ 报告作为首条用户消息自动发送
(function () {
    'use strict';

    var MAX_QA_CHARS = 4000;      // 历史问答单条最大字符
    var MAX_LASTQ_CHARS = 20000;  // 最后一问问题原文最大字符
    var MAX_LASTANS_CHARS = 8000; // 最后一问的 AI 回答进度最大字符
    var MAX_TOOL_CHARS = 120000;  // 最后一问工具结果总最大字符
    var MAX_TOOL_ITEM_CHARS = 20000; // 单条工具结果最大字符

    function findChat(box) {
        var boxes = App.chatBoxes || [];
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].el === box || boxes[i].id === box.id) return boxes[i];
        }
        return null;
    }

    function toast(msg) {
        try {
            if (typeof App._showStormToast === 'function') { App._showStormToast(msg); return; }
        } catch (e) {}
        try { console.log('[RelayMaster]', msg); } catch (e) {}
    }

    function msgText(m) {
        var t = '';
        try {
            if (typeof m.content === 'string') t = m.content;
            else if (m.content) t = JSON.stringify(m.content);
        } catch (e) { t = '(序列化失败)'; }
        return t;
    }

    // ---- Part A：历史问答清单（问 + 答，工具轮只记工具名） ----
    function buildQAPart(chat) {
        var h = (chat && Array.isArray(chat.history)) ? chat.history : [];
        if (!h.length) return '(对话历史为空)';
        var pairs = [];
        for (var i = 0; i < h.length; i++) {
            var m = h[i];
            if (!m) continue;
            if (m.role === 'user') {
                pairs.push({ q: msgText(m), a: '', tools: [] });
            } else if (m.role === 'assistant' && pairs.length) {
                var t = msgText(m);
                if (m.tool_calls && m.tool_calls.length) {
                    var names = m.tool_calls.map(function (tc) { return (tc.function && tc.function.name) || '?'; }).join(', ');
                    pairs[pairs.length - 1].tools.push(names);
                    t += (t ? '\n' : '') + '[本轮 AI 调用了工具: ' + names + '，工具结果见后文/已省略]';
                }
                if (t) pairs[pairs.length - 1].a += (pairs[pairs.length - 1].a ? '\n' : '') + t;
            }
            // role==='tool' 的旧轮次结果：按要求直接丢弃
        }
        var lines = ['共 ' + pairs.length + ' 轮问答'];
        pairs.forEach(function (p, i) {
            var q = p.q || '(空)';
            if (q.length > MAX_QA_CHARS) q = q.slice(0, MAX_QA_CHARS) + '…[截断]';
            var a = p.a || '';
            if (a.length > MAX_QA_CHARS) a = a.slice(0, MAX_QA_CHARS) + '…[截断]';
            lines.push('--- 第 ' + (i + 1) + ' 轮 ---');
            lines.push('[用户] ' + q);
            if (p.tools.length) lines.push('(该轮调用工具: ' + p.tools.join(' → ') + ')');
            lines.push('[AI] ' + (a || '【未回答 / 未回答完整】'));
        });
        return lines.join('\n');
    }

    // ---- Part B-1：最后一个问题原文 + AI 回答进度 ----
    function buildLastQPart(chat) {
        var h = (chat && Array.isArray(chat.history)) ? chat.history : [];
        var lastUserIdx = -1;
        for (var i = h.length - 1; i >= 0; i--) { if (h[i] && h[i].role === 'user') { lastUserIdx = i; break; } }
        if (lastUserIdx < 0) return '(对话里没有用户提问)';
        var q = msgText(h[lastUserIdx]) || '(空)';
        if (q.length > MAX_LASTQ_CHARS) q = q.slice(0, MAX_LASTQ_CHARS) + '…[截断]';
        var ansParts = [];
        for (var j = lastUserIdx + 1; j < h.length; j++) {
            var m = h[j];
            if (!m) continue;
            if (m.role === 'user') break; // 后面又有新提问（理论上不会，防御）
            var t = msgText(m);
            if (m.tool_calls && m.tool_calls.length) {
                var names = m.tool_calls.map(function (tc) { return (tc.function && tc.function.name) || '?'; }).join(', ');
                t += (t ? '\n' : '') + '[调用了工具: ' + names + ']';
            }
            if (t) ansParts.push(t);
        }
        var ans = ansParts.join('\n');
        if (ans.length > MAX_LASTANS_CHARS) ans = ans.slice(0, MAX_LASTANS_CHARS) + '…[截断]';
        var lines = ['【问题原文】', q, '', '【AI 当前回答进度】'];
        lines.push(ans || '（还没有任何回答 → 该问题大概率没回答完整，需要接力完成）');
        return lines.join('\n');
    }

    // ---- Part B-2：最后一个问题触发的全部工具执行结果（从 _lastContext 提取，原样） ----
    function buildLastToolPart(chat) {
        var ctx = (chat && chat._lastContext) ? String(chat._lastContext) : '';
        if (!ctx) return '(本对话还没有发送过请求，无工具结果)';
        var parsed = null;
        try { parsed = JSON.parse(ctx); } catch (e) {}
        var msgs = (parsed && Array.isArray(parsed.messages)) ? parsed.messages : null;
        if (!msgs) return '(上下文非标准 JSON，无法提取工具结果。最后一次上下文原文前 20000 字：\n' + ctx.slice(0, 20000) + ')';

        // 只保留最后一问之后的 assistant(tool_calls) 与 tool 结果对；更早轮次一律丢弃
        var lastUserIdx = -1;
        for (var i = msgs.length - 1; i >= 0; i--) { if (msgs[i] && msgs[i].role === 'user') { lastUserIdx = i; break; } }
        var lines = [];
        var total = 0;
        var toolCount = 0;
        for (var k = Math.max(lastUserIdx, 0); k < msgs.length; k++) {
            var m = msgs[k];
            if (!m) continue;
            if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
                var names = m.tool_calls.map(function (tc) {
                    var s = (tc.function && tc.function.name) || '?';
                    var args = '';
                    try { args = (tc.function && tc.function.arguments) ? String(tc.function.arguments) : ''; } catch (e) {}
                    if (args.length > 600) args = args.slice(0, 600) + '…[截断]';
                    return s + '(' + args + ')';
                }).join('\n  ');
                lines.push('--- 工具调用 #' + (++toolCount) + ' ---');
                lines.push('[assistant tool_calls]\n  ' + names);
            } else if (m.role === 'tool') {
                var t = '';
                try { t = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content); } catch (e) { t = '(序列化失败)'; }
                if (t.length > MAX_TOOL_ITEM_CHARS) t = t.slice(0, MAX_TOOL_ITEM_CHARS) + '…[单条截断，原长 ' + t.length + ']';
                lines.push('[tool 结果' + (m.tool_call_id ? ' · ' + m.tool_call_id : '') + ']');
                lines.push(t);
            }
            if (lines.join('\n').length > MAX_TOOL_CHARS) { lines.push('…[工具结果总体已截断，上限 ' + MAX_TOOL_CHARS + ' 字符]'); break; }
        }
        if (!toolCount) return '(最后一次请求中没有工具调用与工具结果)';
        return '共 ' + toolCount + ' 次工具调用（更早轮次的工具结果已按接力规则丢弃）\n' + lines.join('\n');
    }

    // ===== 🔗 对话接力大师：入口 =====
    App.relayMaster = function (srcBox) {
        try {
            var chat = findChat(srcBox);
            if (!chat) { toast('未找到对话数据'); return; }

            var lines = [];
            lines.push('===== 🔗 对话接力请求 =====');
            lines.push('源对话: ' + (srcBox.querySelector('.title') ? srcBox.querySelector('.title').textContent : srcBox.id));
            lines.push('生成时间: ' + new Date().toLocaleString());
            lines.push('');
            lines.push('【第一部分 · 历史问答清单】（前因后果，旧轮次工具结果已丢弃）');
            lines.push(buildQAPart(chat));
            lines.push('');
            lines.push('【第二部分 · 最后一个问题的完整资料】');
            lines.push(buildLastQPart(chat));
            lines.push('');
            lines.push('【第三部分 · 最后一个问题触发的全部工具执行结果】（原样快照）');
            lines.push(buildLastToolPart(chat));
            lines.push('');
            lines.push('=====');
            lines.push('以上是另一个对话（同一个智能体）的接力资料。请你扮演「对话接力大师」，目标只有一个：接着源对话继续把任务做完。请按以下规则工作：');
            lines.push('1. 先通读【历史问答清单】，理清前因后果；标记出哪些问题可能没回答完整、答非所问或被中断（如果后面用户又继续追问，说明之前没答完）；');
            lines.push('2. 重点处理【最后一个问题】：这是当前待完成任务，资料里已附上它触发的全部工具执行结果。如果它还没有得到完整回答/任务没做完，你必须直接接着做（充分利用已有工具结果，不要重新调查、不要重复已完成的步骤），把任务完成；');
            lines.push('3. 如果最后一个问题已经完成、且之前所有问题都已回答完整，则不要画蛇添足，输出一段简要的收尾总结（前因后果 + 最终结论 + 遗留事项）；');
            lines.push('4. 输出格式：先用 2~3 行说明你的接力判断（哪些问题没答完/最后一问状态），然后直接给出接续完成的工作内容。');

            var prompt = lines.join('\n');

            // 新建对话（模型解析/回退与工具大师一致）
            var srcModelId = null;
            try { srcModelId = App._toolMasterResolveModelId ? App._toolMasterResolveModelId(chat) : chat.modelId; } catch (e) { srcModelId = chat.modelId; }
            if (!srcModelId) { toast('没有可用模型，无法新建对话'); return; }
            var srcModelIdOverride = chat ? (chat._modelIdOverride || '') : '';
            var srcReasoningEffort = chat ? (chat._reasoningEffort || '') : '';
            var r = srcBox.getBoundingClientRect();
            var newBox = App.createChatBox(Math.round(r.left + 40), Math.round(r.top + 40), srcModelId);
            if (!newBox) { toast('新建对话失败（可能触发防风暴限制）'); return; }
            // 回填源对话的模型ID/思考强度快照
            try {
                var _rmChat = (newBox.el) ? newBox : null;
                if (_rmChat) {
                    if (srcModelIdOverride) _rmChat._modelIdOverride = srcModelIdOverride;
                    if (srcReasoningEffort) _rmChat._reasoningEffort = srcReasoningEffort;
                }
            } catch (e) {}
            if (newBox.el) newBox = newBox.el;
            var attempts = 0;
            (function trySend() {
                attempts++;
                var newChat = null;
                for (var i = 0; i < (App.chatBoxes || []).length; i++) {
                    if (App.chatBoxes[i].id === newBox.id) { newChat = App.chatBoxes[i]; break; }
                }
                if (newChat && !newChat.isSending && attempts < 20) {
                    try { App.addMsg(newBox, prompt.substring(0, 120) + '…', 'user', newChat.modelId); } catch (e) {}
                    newChat.history.push({ role: 'user', content: prompt });
                    try { Store.addLog('info', newChat.id, 'relaymaster', '对话接力报告已发送: ' + prompt.length + ' 字符'); } catch (e) {}
                    try { App.updateChatTitle(newBox, '🔗 对话接力'); } catch (e) {}
                    App.sendToModel(newBox, newChat);
                    try { App.activate(newBox); } catch (e) {}
                } else if (attempts < 20) {
                    setTimeout(trySend, 300);
                }
            })();
            toast('🔗 已打包 ' + ((chat.history || []).filter(function (m) { return m && m.role === 'user'; }).length) + ' 轮问答 + 最后一问完整资料，正在发送到新对话接力…');
        } catch (e) {
            console.error('[RelayMaster]', e);
            toast('对话接力大师执行出错: ' + e.message);
        }
    };
})();
