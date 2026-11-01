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

        // ===== 整理最终消息（查看答案优化）：审核报告标准化 + 正文兜底 =====
        // 输入 task_complete 的 message；输出标准化版本：
        // 1) 找报告起点（「—— 审核报告 ——」或 AI 变体如「① 逐条核验清单」），
        //    统一改写为渲染层 _foldSelfGateReport 已识别的标准标记「—— 审核报告 ——」
        // 2) 若没有正文（整条都是报告，用户点「查看答案」只见报告不见答案），
        //    在最前面补一条引导语
        _formatFinalMessage: function(message) {
            var msg = String(message || '');
            if (!msg) return msg;
            if (msg.indexOf('—— 审核报告 ——') !== -1) {
                // 已有标准标记，只做正文兜底检查
                var a0 = msg.split('—— 审核报告 ——')[0].replace(/^✅ 任务完成\s*/, '').trim();
                return a0 ? msg : '（本次回复只包含审核报告，未附答案正文。如需答案请追问。）\n\n' + msg;
            }
            var marks = ['—— 审官报告 ——', '【逐条核验清单】', '① 逐条核验清单', '**【逐条核验清单】**'];
            var idx = -1;
            for (var i = 0; i < marks.length; i++) {
                var p = msg.indexOf(marks[i]);
                if (p >= 0 && (idx < 0 || p < idx)) idx = p;
            }
            if (idx < 0) return msg; // 没有报告，原样返回
            if (idx > 0 && msg[idx - 1] === '【') idx -= 1; // 变体匹配吃掉了前置「【」，回退一格保证完整切分
            var answer = msg.slice(0, idx).trim();
            var report = '—— 审核报告 ——\n' + msg.slice(idx).trim();
            if (!answer) {
                answer = '（本次回复只包含审核报告，未附答案正文。如需答案请追问。）';
            }
            return answer + '\n\n' + report;
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
