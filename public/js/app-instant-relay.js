// ========== app-instant-relay.js - 忙碌时新消息「无感接力」 ==========
// 功能：AI 正在回复（isSending）时用户发来的新消息，不再进入排队队列等待，
//       而是立刻新建一个对话框，把原对话的全部历史内容 + 该条新消息一并注入，
//       然后直接开始发送。原对话保持原样（继续跑完当前任务）。
// 依赖：App.chatBoxes / App.createChatBox / App.addMsg / App.sendToModel / App.activate / Store
// 注意：需在 chatbox-03-chat-interaction.js 的排队逻辑【之前】加载（见 index.html 顺序）。
(function () {
    'use strict';
    if (typeof App === 'undefined') {
        console.warn('[InstantRelay] App 未定义，未加载');
        return;
    }

    function toast(msg) {
        try { if (typeof App._showStormToast === 'function') { App._showStormToast(msg); return; } } catch (e) {}
        try { console.log('[InstantRelay]', msg); } catch (e) {}
    }

    function esc(s) {
        try {
            var d = document.createElement('div');
            d.textContent = String(s);
            return d.innerHTML;
        } catch (e) { return String(s); }
    }

    function fmtContent(m) {
        try {
            if (typeof m.content === 'string') return m.content;
            if (m.content) return JSON.stringify(m.content);
        } catch (e) {}
        return '';
    }

    /**
     * 构建接力注入 prompt：原对话完整历史（user/assistant/工具纪要）+ 本次新消息
     */
    function buildRelayPrompt(srcChat, newText) {
        var h = (srcChat && Array.isArray(srcChat.history)) ? srcChat.history : [];
        var lines = [];
        lines.push('===== 🔄 对话接力（原对话仍在运行，你继承其全部上下文）=====');
        lines.push('以下【原对话完整记录】是此前全部沟通内容，请视为你自己经历过的对话：');
        lines.push('');
        for (var i = 0; i < h.length; i++) {
            var m = h[i];
            if (!m || !m.role) continue;
            if (m.role === 'tool') continue;          // 工具原始结果太长，跳过
            if (m.role === '_thinking') continue;
            var who = m.role === 'user' ? '用户' : 'AI';
            var t = fmtContent(m);
            if (!t) continue;
            if (t.length > 4000) t = t.substring(0, 4000) + '…[已截断]';
            lines.push('【' + who + '】' + t);
            lines.push('');
        }
        lines.push('===== 接力记录结束 =====');
        lines.push('');
        lines.push('【本次新消息】（用户在你继承原对话上下文后发出，请直接处理，不要重复已完成的工作）：');
        lines.push(newText);
        return lines.join('\n');
    }

    /**
     * 忙碌时接力：新建对话框 + 注入全部历史 + 立刻开始
     * 返回 true 表示已接管（调用方不再入队）
     */
    App.instantRelay = function (srcBox, srcChat, newText, extra) {
        try {
            extra = extra || {};
            if (!srcChat || !newText) return false;

            // 解析源模型（与接力大师/工具大师一致）
            var srcModelId = null;
            try { srcModelId = App._toolMasterResolveModelId ? App._toolMasterResolveModelId(srcChat) : srcChat.modelId; } catch (e) { srcModelId = srcChat.modelId; }
            if (!srcModelId) { toast('没有可用模型，无法接力新对话'); return true; }

            var srcModelIdOverride = srcChat._modelIdOverride || '';
            var srcReasoningEffort = srcChat._reasoningEffort || '';

            var r = srcBox.getBoundingClientRect();
            var newBox = App.createChatBox(Math.round(r.left + 46), Math.round(r.top + 46), srcModelId);
            if (!newBox) { toast('新建对话失败（可能达到画布上限）'); return true; }
            try {
                var _chat = newBox.el ? newBox : null;
                if (_chat) {
                    if (srcModelIdOverride) _chat._modelIdOverride = srcModelIdOverride;
                    if (srcReasoningEffort) _chat._reasoningEffort = srcReasoningEffort;
                }
            } catch (e) {}
            if (newBox.el) newBox = newBox.el;

            var prompt = buildRelayPrompt(srcChat, newText);

            var attempts = 0;
            (function trySend() {
                attempts++;
                var newChat = null;
                for (var i = 0; i < (App.chatBoxes || []).length; i++) {
                    if (App.chatBoxes[i].id === newBox.id) { newChat = App.chatBoxes[i]; break; }
                }
                if (newChat && !newChat.isSending && attempts < 20) {
                    // UI 上只展示本次新消息原文，完整注入在后台完成
                    try {
                        App.addMsg(newBox, esc(newText), 'user', newChat.modelId);
                    } catch (e) {
                        try { App.addMsg(newBox, newText, 'user', newChat.modelId); } catch (e2) {}
                    }
                    // 附加图片/audio 到 history（如有）——与正常发送一致，直接构造
                    // 数组型 content（image_url/input_audio parts），不依赖暂存字段
                    //（旧实现存 _pendingRelayImages/_pendingRelayAudio，但发送流程不读，图会被丢）
                    var content = prompt;
                    if ((extra.images && extra.images.length) || extra.audio) {
                        var parts = [];
                        if (extra.images && extra.images.length) {
                            for (var pi = 0; pi < extra.images.length; pi++) {
                                parts.push({ type: 'image_url', image_url: { url: extra.images[pi].dataUrl } });
                            }
                        }
                        if (extra.audio) parts.push(extra.audio);
                        parts.push({ type: 'text', text: content });
                        content = parts;
                    }
                    newChat.history.push({ role: 'user', content: content });
                    try { Store.addLog('info', newChat.id, 'instant-relay', '无感接力：已注入原对话 ' + ((srcChat.history || []).length) + ' 条历史 + 新消息，立即开始'); } catch (e) {}
                    try {
                        var srcTitle = srcBox.querySelector('.title') ? srcBox.querySelector('.title').textContent : '';
                        App.updateChatTitle(newBox, '🔗 ' + (srcTitle || '接力') + ' · 接力');
                    } catch (e) {}
                    App.sendToModel(newBox, newChat);
                    try { App.activate(newBox); } catch (e) {}
                    toast('🔄 原对话忙碌，已在【新对话框】注入全部上下文并立即开始（原对话不受影响）');
                } else if (attempts < 20) {
                    setTimeout(trySend, 300);
                } else {
                    toast('接力启动超时，请手动发送一次');
                }
            })();
            return true;
        } catch (e) {
            console.error('[InstantRelay]', e);
            toast('无感接力失败: ' + e.message);
            return false;
        }
    };
})();
