// agent-02b-message-sanitize.js — 消息清洗（从 agent-02-loop-core.js 拆分）
// 功能单一：发送前消息格式清洗，避免严格 API（GLM/litellm 等）返回 400。
Object.assign(App, {
        // ===== 消息格式清洗：移除孤立 tool 消息 / 孤立 tool_calls =====
        // 压缩/重建后可能产生 tool 角色消息没有对应的 assistant tool_calls，
        // 或 assistant tool_calls 没有对应的 tool 结果，严格 API 会返回 400。
        _sanitizeMessages: function(messages) {
            var validToolCallIds = new Set();
            var validToolResultIds = new Set();
            // 第一遍：收集所有 tool_call_id
            for (var si = 0; si < messages.length; si++) {
                var sm = messages[si];
                if (!sm) continue;
                if (sm.role === 'assistant' && Array.isArray(sm.tool_calls)) {
                    for (var sc = 0; sc < sm.tool_calls.length; sc++) {
                        if (sm.tool_calls[sc] && sm.tool_calls[sc].id) {
                            validToolCallIds.add(sm.tool_calls[sc].id);
                        }
                    }
                }
                if (sm.role === 'tool' && sm.tool_call_id) {
                    validToolResultIds.add(sm.tool_call_id);
                }
            }
            // 第二遍：移除不配对的消息
            for (var ri = messages.length - 1; ri >= 0; ri--) {
                var rm = messages[ri];
                if (!rm) { messages.splice(ri, 1); continue; }
                // tool 消息必须有对应的 assistant tool_calls
                if (rm.role === 'tool' && rm.tool_call_id && !validToolCallIds.has(rm.tool_call_id)) {
                    messages.splice(ri, 1);
                    continue;
                }
                // assistant tool_calls 必须有对应的 tool 结果（如果中间有缺失就移除 tool_calls）
                if (rm.role === 'assistant' && Array.isArray(rm.tool_calls) && rm.tool_calls.length > 0) {
                    var allResultsPresent = true;
                    for (var rc = 0; rc < rm.tool_calls.length; rc++) {
                        var tcid = rm.tool_calls[rc] && rm.tool_calls[rc].id;
                        if (tcid && !validToolResultIds.has(tcid)) {
                            allResultsPresent = false;
                            break;
                        }
                    }
                    if (!allResultsPresent) {
                        // 保留 content 但移除 tool_calls（如果 content 为空则整个移除）
                        if (rm.content && String(rm.content).trim()) {
                            rm.tool_calls = undefined;
                            delete rm.tool_calls;
                        } else {
                            messages.splice(ri, 1);
                        }
                    }
                }
            }
        },

        // ===== 发送前清洗 messages：移除 reasoning_content 等非标准字段，防止 HTTP 400 =====
        _cleanNonStandardFields: function(messages) {
            for (var _ci = 0; _ci < messages.length; _ci++) {
                if (messages[_ci]) {
                    delete messages[_ci].reasoning_content;
                    delete messages[_ci]._thinking;
                    delete messages[_ci]._maxDepthRecovery;
                    if (messages[_ci].content === null || messages[_ci].content === undefined) {
                        messages[_ci].content = '';
                    }
                }
            }
        },
});
