// ========== app-synthmaster.js - 🧩 对话综合大师 ==========
// 功能：一次性打包本对话的「工具执行过程完整报告 + 运行日志 + 最后一次完整上下文 + 对话消息历史」，
//       发送到新对话，让 AI 综合评判：
//       ① 工具调用是否合理 ② 上下文构成是否合理 ③ 对话流程有无问题 ④ 智能体整体 bug 与水平
// 实现方式参照 app-toolmaster.js：新建对话（继承引擎/模型）→ 报告作为首条用户消息自动发送
(function () {
    'use strict';

    var MAX_CTX_CHARS = 150000;   // 完整上下文最大携带字符（防请求爆表）
    var MAX_MSG_CHARS = 4000;     // 对话历史单条最大字符
    var MAX_LOGS_CHARS = 60000;   // 日志部分最大字符

    function findChat(box) {
        var boxes = App.chatBoxes || [];
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].id === box.id) return boxes[i];
        }
        return null;
    }

    function toast(msg) {
        try {
            if (typeof App._showStormToast === 'function') { App._showStormToast(msg); return; }
        } catch (e) {}
        try { console.log('[SynthMaster]', msg); } catch (e) {}
    }

    // ---- Part A：工具执行过程（复用工具大师报告） ----
    function buildToolPart(box) {
        try {
            if (typeof App._toolMasterBuildReport !== 'function') return '(工具大师不可用，无法打包工具执行过程)';
            var r = App._toolMasterBuildReport(box, findChat(box) || {});
            return r ? r.text : '(本对话没有工具调用记录)';
        } catch (e) { return '(工具报告生成失败: ' + e.message + ')'; }
    }

    // ---- Part B：运行日志（统计+全部错误） ----
    function buildLogPart() {
        var lines = [];
        var logs = [];
        try { logs = Store.getLogs() || []; } catch (e) {}
        if (!logs.length) return '(没有任何日志)';
        var byLevel = {}, byAction = {};
        logs.forEach(function (l) {
            var lv = l.level || 'unknown';
            byLevel[lv] = (byLevel[lv] || 0) + 1;
            var ac = l.action || 'unknown';
            byAction[ac] = (byAction[ac] || 0) + 1;
        });
        lines.push('总日志: ' + logs.length + ' 条 | 错误: ' + (byLevel.error || 0) + ' | 警告: ' + (byLevel.warn || 0));
        lines.push('');
        lines.push('【按类别统计】');
        Object.keys(byAction).map(function (k) { return { a: k, c: byAction[k] }; })
            .sort(function (x, y) { return y.c - x.c; })
            .forEach(function (it, i) { lines.push((i + 1) + '. ' + it.a + ' — ' + it.c + ' 条'); });
        lines.push('');
        lines.push('【全部错误日志】');
        var errLogs = logs.filter(function (l) { return l && l.level === 'error'; });
        if (!errLogs.length) lines.push('(无错误日志)');
        errLogs.forEach(function (l, i) {
            lines.push('--- 错误#' + (i + 1) + ' [' + new Date(l.ts || 0).toLocaleString() + '] ' + (l.action || '') + ' ---');
            lines.push(l.detail || '(无详情)');
        });
        var text = lines.join('\n');
        if (text.length > MAX_LOGS_CHARS) text = text.slice(0, MAX_LOGS_CHARS) + '\n…[日志过长已截断，原长 ' + lines.join('\n').length + ']';
        return text;
    }

    // ---- Part C：最后一次完整上下文（原样快照） ----
    function buildContextPart(chat) {
        var ctx = (chat && chat._lastContext) ? String(chat._lastContext) : '';
        if (!ctx) return '(本对话还没有发送过请求，无 _lastContext 快照)';
        var note = '（原样完整快照，共 ' + ctx.length + ' 字符）';
        if (ctx.length > MAX_CTX_CHARS) {
            return note + '\n' + ctx.slice(0, MAX_CTX_CHARS) + '\n…[超出 ' + MAX_CTX_CHARS + ' 字符上限已截断，原长 ' + ctx.length + ']';
        }
        return note + '\n' + ctx;
    }

    // ---- Part D：对话消息历史（用户可见对话流） ----
    function buildHistoryPart(chat) {
        var h = (chat && Array.isArray(chat.history)) ? chat.history : [];
        if (!h.length) return '(对话历史为空)';
        var lines = ['共 ' + h.length + ' 条消息'];
        h.forEach(function (m, i) {
            var t = '';
            try {
                if (typeof m.content === 'string') t = m.content;
                else if (m.content) t = JSON.stringify(m.content);
            } catch (e) { t = '(序列化失败)'; }
            if (m.tool_calls && m.tool_calls.length) {
                try { t += '\n[tool_calls] ' + JSON.stringify(m.tool_calls); } catch (e) {}
            }
            if (t.length > MAX_MSG_CHARS) t = t.slice(0, MAX_MSG_CHARS) + '…[截断]';
            lines.push('--- #' + (i + 1) + ' [' + (m.role || '?') + '] ---');
            lines.push(t || '(空)');
        });
        return lines.join('\n');
    }

    // ===== 🧩 对话综合大师：入口 =====
    App.synthMaster = function (srcBox) {
        try {
            var chat = findChat(srcBox);
            if (!chat) { toast('未找到对话数据'); return; }

            var lines = [];
            lines.push('===== 🧩 对话综合评判请求 =====');
            lines.push('源对话: ' + (srcBox.querySelector('.title') ? srcBox.querySelector('.title').textContent : srcBox.id));
            lines.push('生成时间: ' + new Date().toLocaleString());
            lines.push('');
            lines.push('【第一部分 · 工具执行过程完整报告】');
            lines.push(buildToolPart(srcBox));
            lines.push('');
            lines.push('【第二部分 · 运行日志（统计+全部错误）】');
            lines.push(buildLogPart());
            lines.push('');
            lines.push('【第三部分 · 最后一次发送给 AI 的完整上下文】');
            lines.push(buildContextPart(chat));
            lines.push('');
            lines.push('【第四部分 · 对话消息历史】');
            lines.push(buildHistoryPart(chat));
            lines.push('');
            lines.push('=====');
            lines.push('以上四部分是另一个对话（同一个智能体）的完整运行资料。请你扮演「对话综合大师」，做一次综合评判，逐项输出：');
            lines.push('1. 工具调用是否合理：有没有冗余/重复调用、失败模式、参数错误、本该用 A 工具却用了 B 工具的情况；');
            lines.push('2. 上下文是否合理：各部分占比是否失衡、有没有无用信息膨胀、system 提示词是否过长或缺失关键约束、工具结果注入方式是否合理；');
            lines.push('3. 对话流程有没有问题：有没有原地打转、重复提问、答非所问、任务没完成就停止等迹象；');
            lines.push('4. 综合评判这个智能体的 bug 和水平：列出疑似 bug（按严重度排序，给出原因和修复方向），并整体评价其能力水位（工具使用、上下文管理、任务完成度），最后给出最值得优先修复的 3 件事。');

            var prompt = lines.join('\n');

            // 新建对话（模型解析/回退与工具大师一致）
            var srcModelId = null;
            try { srcModelId = App._toolMasterResolveModelId ? App._toolMasterResolveModelId(chat) : chat.modelId; } catch (e) { srcModelId = chat.modelId; }
            if (!srcModelId) { toast('没有可用模型，无法新建对话'); return; }
            var srcModelIdOverride = '';
            try {
                srcModelIdOverride = (chat._modelIdOverride && App._toolMasterOverrideExists && App._toolMasterOverrideExists(chat._modelIdOverride)) ? chat._modelIdOverride : '';
            } catch (e) {}
            var srcReasoningEffort = chat._reasoningEffort || '';

            var r = srcBox.getBoundingClientRect();
            var newBox = App.createChatBox(Math.round(r.left + 40), Math.round(r.top + 40), srcModelId);
            if (!newBox) { toast('新建对话失败（可能触发防风暴限制）'); return; }
            try {
                var c = (newBox.el) ? newBox : null;
                if (c) {
                    if (srcModelIdOverride) c._modelIdOverride = srcModelIdOverride;
                    if (srcReasoningEffort) c._reasoningEffort = srcReasoningEffort;
                }
            } catch (e) {}
            if (newBox.el) newBox = newBox.el;

            toast('🧩 已打包完整资料（' + prompt.length + ' 字符），正在发送到新对话综合评判…');

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
                    try { Store.addLog('info', newChat.id, 'synthmaster', '对话综合大师报告已发送: ' + prompt.length + ' 字符'); } catch (e) {}
                    try { App.updateChatTitle(newBox, '🧩 对话综合评判'); } catch (e) {}
                    App.sendToModel(newBox, newChat);
                    // 切到新对话让用户看到
                    try { App.activate(newBox); } catch (e) {}
                } else if (attempts < 20) {
                    setTimeout(trySend, 300);
                }
            })();
        } catch (e) {
            console.error('[SynthMaster]', e);
            toast('对话综合大师执行出错: ' + e.message);
        }
    };
})();
