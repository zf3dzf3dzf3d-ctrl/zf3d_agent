// ==== 拆分自 app-agent.js：工具结果管理（每次循环都执行）_上下文 toke_仅截断超长工具结_上下文自动压缩（_添加工具卡片消息 ====
Object.assign(App, {
        // ===== 工具结果管理（每次循环都执行）=====
        // 【2025 按用户要求】已移除工具结果丢弃规则：保留所有 tool 结果全文，不再替换为 [已丢弃]。
        _manageToolResults: function(messages, chatId) {
            // 【2025 按用户要求】已移除工具结果丢弃规则：保留所有 tool 结果全文，不再替换为 [已丢弃]。
            return;
        },

        // ===== 上下文 token 估算 =====
        // 粗略估算：中文约2字符/token，英文约4字符/token，JSON结构开销约+10%
        _estimateTokens: function(messages) {
            if (!messages || !messages.length) return 0;
            var totalChars = 0;
            for (var i = 0; i < messages.length; i++) {
                var msg = messages[i];
                // role 等结构开销
                totalChars += 4;
                if (msg.content) {
                    totalChars += String(msg.content).length;
                }
                if (msg.tool_calls) {
                    // tool_calls 的 JSON 序列化
                    try {
                        totalChars += JSON.stringify(msg.tool_calls).length;
                    } catch(e) {}
                }
                if (msg.tool_call_id) {
                    totalChars += String(msg.tool_call_id).length + 4;
                }
            }
            // 混合估算：取中文/英文平均，约3字符/token，再加10%结构开销
            return Math.ceil(totalChars / 3 * 1.1);
        },

        // ===== 仅截断超长工具结果（不删除消息、不做摘要，避免失忆→重复搜索→恶性循环） =====
        _truncateToolResultsOnly: function(messages, model, depth, loopConfig, cachePolicy) {
            var self = this;
            var result = { compressed: false, beforeTokens: self._estimateTokens(messages), afterTokens: 0, removedCount: 0 };
            var policy = cachePolicy || self._getModelCachePolicy(model, loopConfig);
            var MAX_TOOL_CONTENT_CHARS = parseInt(policy.toolResultMaxChars, 10);
            if (!MAX_TOOL_CONTENT_CHARS || MAX_TOOL_CONTENT_CHARS < 100) MAX_TOOL_CONTENT_CHARS = 3000;
            MAX_TOOL_CONTENT_CHARS = Math.min(50000, MAX_TOOL_CONTENT_CHARS);

            var truncatedCount = 0;
            for (var i = 1; i < messages.length; i++) {
                var msg = messages[i];
                if (msg.role === 'tool' && msg.content) {
                    var c = String(msg.content);
                    if (c.length > MAX_TOOL_CONTENT_CHARS) {
                        var head = c.substring(0, MAX_TOOL_CONTENT_CHARS * 0.7);
                        var tail = c.substring(c.length - MAX_TOOL_CONTENT_CHARS * 0.2);
                        msg.content = head + '\n\n...[已截断，原始' + c.length + '字符]...\n\n' + tail;
                        truncatedCount++;
                    }
                }
                if (msg.role === 'assistant' && msg.content) {
                    var ac = String(msg.content);
                    if (ac.length > MAX_TOOL_CONTENT_CHARS * 2) {
                        msg.content = ac.substring(0, MAX_TOOL_CONTENT_CHARS) + '\n\n...[已截断，原始' + ac.length + '字符]...';
                        truncatedCount++;
                    }
                }
            }
            result.afterTokens = self._estimateTokens(messages);
            result.removedCount = truncatedCount;
            result.compressed = truncatedCount > 0;
            return result;
        },

        // ===== 上下文自动压缩（已禁用，保留代码备用） =====
        // 原策略会移除中间消息并用摘要替代，导致智能体失忆→重复搜索→上下文膨胀→再次压缩的恶性循环。
        // 现已替换为 _truncateToolResultsOnly，仅截断超长工具结果，不删除任何消息。
        _compressContext: function(messages, model, depth, loopConfig) {
            var self = this;
            var result = { compressed: false, beforeTokens: 0, afterTokens: 0, removedCount: 0 };

            // 模型上下文窗口（默认 64000，DeepSeek=64000，GLM=128000）
            var contextWindow = 64000;
            if (model && model.contextWindow) {
                contextWindow = model.contextWindow;
            } else if (model && model.modelId) {
                var mid = model.modelId.toLowerCase();
                if (mid.indexOf('glm') >= 0 || mid.indexOf('4-flash') >= 0) contextWindow = 128000;
                else if (mid.indexOf('deepseek') >= 0) contextWindow = 64000;
                else if (mid.indexOf('gpt-4') >= 0) contextWindow = 128000;
                else if (mid.indexOf('gpt-3.5') >= 0) contextWindow = 16000;
                else if (mid.indexOf('claude') >= 0) contextWindow = 200000;
            }
            // ===== 省钱模式：单次请求上下文 token 预算 =====
            // 默认预算按模型窗口自适应；模型配置可显式覆盖。
            var defaultTokenBudget = contextWindow >= 128000 ? 32000 : (contextWindow >= 64000 ? 16000 : 8000);
            // 设置面板中的 0 表示继续使用模型自适应预算。
            var configuredTokenBudget = loopConfig && parseInt(loopConfig.contextTokenBudget, 10);
            var tokenBudget = configuredTokenBudget > 0
                ? configuredTokenBudget
                : ((model && model.tokenBudget) ? model.tokenBudget : defaultTokenBudget);
            // 硬上限：模型窗口的 70%（保留输出空间），与预算取较小者
            var threshold = Math.min(Math.floor(contextWindow * 0.7), tokenBudget);
            // 单条 tool 结果的最大字符数（超过则截断）
            var MAX_TOOL_CONTENT_CHARS = loopConfig && parseInt(loopConfig.toolResultMaxChars, 10);
            if (!MAX_TOOL_CONTENT_CHARS || MAX_TOOL_CONTENT_CHARS < 100) MAX_TOOL_CONTENT_CHARS = 3000;
            MAX_TOOL_CONTENT_CHARS = Math.min(50000, MAX_TOOL_CONTENT_CHARS);

            var beforeTokens = self._estimateTokens(messages);
            result.beforeTokens = beforeTokens;

            if (beforeTokens <= threshold) {
                result.afterTokens = beforeTokens;
                return result;
            }

            // ===== 第一轮：截断超长的 tool 结果 =====
            // 降低激进度：读取类工具（read_file/read_lines）的结果往往是后续写文件所需的关键代码，
            // 必须保留更多内容，否则 AI 刚读完就被压缩丢掉，会反复重读导致死循环。
            var truncatedCount = 0;
            var recentReadGuard = 0; // 统计"刚读取过的代码"保留条数（最多保留最近2次读取）
            for (var i = 1; i < messages.length; i++) {
                var msg = messages[i];
                if (msg.role === 'tool' && msg.content) {
                    var c = String(msg.content);
                    // 识别读取类工具结果（tool_call_id 对应的工具名在前面 assistant 的 tool_calls 里）
                    var isReadTool = false;
                    for (var ri = i - 1; ri >= 0 && ri >= i - 4; ri--) {
                        var pm = messages[ri];
                        if (pm && pm.role === 'assistant' && pm.tool_calls) {
                            for (var rc = 0; rc < pm.tool_calls.length; rc++) {
                                var tcall = pm.tool_calls[rc];
                                if (tcall && tcall.id === msg.tool_call_id && tcall.function) {
                                    var tn = tcall.function.name || '';
                                    if (tn.indexOf('read_') === 0 || tn === 'read' || tn.indexOf('search_') === 0 || tn === 'find_files' || tn === 'list_dir' || tn === 'tree_dir' || tn === 'file_info') {
                                        isReadTool = true;
                                    }
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    // 读取类工具：放宽到 3 倍上限，且保留中间完整内容（不截断为头尾省略）
                    var cap = isReadTool ? Math.min(50000, MAX_TOOL_CONTENT_CHARS * 3) : MAX_TOOL_CONTENT_CHARS;
                    if (isReadTool && recentReadGuard < 2) recentReadGuard++;
                    if (c.length > cap) {
                        // 原始结果先归档，供 get_tool_result 在当前任务中按需取回。
                        if (typeof Tools !== 'undefined' && Tools.toolResultArchive && Tools.currentChatId) {
                            var archive = Tools.toolResultArchive[Tools.currentChatId] || (Tools.toolResultArchive[Tools.currentChatId] = []);
                            if (!archive.some(function(item) { return item && item.content === c; })) {
                                archive.push({ toolCallId: msg.tool_call_id || '', content: c });
                            }
                        }
                        if (isReadTool && recentReadGuard <= 2) {
                            // 最近读取的代码：保留中间 60% 完整内容，只裁掉最头尾
                            var rdHead = c.substring(0, cap * 0.35);
                            var rdTail = c.substring(c.length - cap * 0.15);
                            var rdMid = c.substring(Math.floor(c.length * 0.3), Math.min(c.length, Math.floor(c.length * 0.3) + cap * 0.5));
                            msg.content = rdHead + '\n\n...[保留代码片段，原始' + c.length + '字符]...\n\n' + rdMid + '\n\n...[尾部省略]...\n\n' + rdTail;
                        } else {
                            // 保留头部 + 尾部，中间省略
                            var head = c.substring(0, cap * 0.7);
                            var tail = c.substring(c.length - cap * 0.2);
                            msg.content = head + '\n\n...[已截断，原始' + c.length + '字符]...\n\n' + tail;
                        }
                        truncatedCount++;
                    }
                }
                // 也截断超长的 assistant content
                if (msg.role === 'assistant' && msg.content) {
                    var ac = String(msg.content);
                    if (ac.length > MAX_TOOL_CONTENT_CHARS * 2) {
                        msg.content = ac.substring(0, MAX_TOOL_CONTENT_CHARS) + '\n\n...[已截断，原始' + ac.length + '字符]...';
                        truncatedCount++;
                    }
                }
            }

            var afterTruncTokens = self._estimateTokens(messages);

            if (afterTruncTokens <= threshold) {
                result.compressed = true;
                result.afterTokens = afterTruncTokens;
                result.removedCount = truncatedCount;
                return result;
            }

            // ===== 第二轮：移除中间旧消息，用摘要替代 =====
            // 保留：messages[0]（system）+ 最近N条（自适应：仍超预算则递减）
            var keepRecent = loopConfig && loopConfig.keepRecentMessages ? loopConfig.keepRecentMessages : 20;
            var _initKeepRecent = keepRecent;
            var _compressIter = 0;
            while (true) {
                _compressIter++;
                if (_compressIter > 50) {
                    result.afterTokens = self._estimateTokens(messages);
                    return result;
                }
                if (messages.length <= keepRecent + 1) {
                    result.afterTokens = self._estimateTokens(messages);
                    return result; // 太少，没法再压
                }

                // 找到需要保留的最近 N 条（确保 tool/assistant 配对完整）
                var keepStart = messages.length - keepRecent;
                // 向前调整：不要让保留区从一组 tool 结果或其 tool_calls assistant 中间开始。
                while (keepStart > 1 && messages[keepStart] && messages[keepStart].role === 'tool') {
                    keepStart--;
                }
                if (keepStart > 1 && messages[keepStart] && messages[keepStart].role === 'assistant' &&
                    messages[keepStart].tool_calls && messages[keepStart].tool_calls.length > 0) {
                    keepStart++;
                    while (keepStart < messages.length && messages[keepStart].role === 'tool') keepStart++;
                }
                // ===== 降低激进度：若中间区含"最近的读取类工具结果"，前移 keepStart 保留它 =====
                // 场景：AI 刚 read_file 拿到代码，准备 write_file，此时压缩若把读取结果丢进摘要，
                // AI 就失去代码内容 → 反复重读 → 死循环。所以最多额外保留最近 1 组读取结果。
                (function protectRecentRead() {
                    var extraKeep = 0;
                    var inReadTool = false;
                    // 从 keepStart-1 往前找最近的读取类工具调用（至多向前 30 条）
                    for (var scan = keepStart - 1; scan > 1 && scan > keepStart - 30; scan--) {
                        var sm = messages[scan];
                        if (!sm) break;
                        if (sm.role === 'tool') {
                            // 该 tool 对应的调用是否为读取类
                            var isRd = false;
                            for (var sk = scan - 1; sk >= 0 && sk >= scan - 4; sk--) {
                                var pm2 = messages[sk];
                                if (pm2 && pm2.role === 'assistant' && pm2.tool_calls) {
                                    for (var tc2 = 0; tc2 < pm2.tool_calls.length; tc2++) {
                                        var tcN = pm2.tool_calls[tc2];
                                        if (tcN && tcN.id === sm.tool_call_id && tcN.function) {
                                            var tn2 = tcN.function.name || '';
                                            if (tn2.indexOf('read_') === 0 || tn2 === 'read' || tn2 === 'file_info') isRd = true;
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                            if (isRd) {
                                // 遇到最近的读取结果：计算它及配对 assistant 需保留的条数
                                var pairStart = scan;
                                while (pairStart > 1 && messages[pairStart].role === 'tool') pairStart--;
                                if (messages[pairStart] && messages[pairStart].role === 'assistant' &&
                                    messages[pairStart].tool_calls && messages[pairStart].tool_calls.length > 0) pairStart--;
                                // 前移 keepStart 保留这组读取
                                if (pairStart < keepStart) {
                                    extraKeep = keepStart - pairStart;
                                    keepStart = pairStart;
                                }
                                break; // 只保留最近一组读取
                            }
                        }
                    }
                    if (extraKeep > 0) {
                        keepRecent = Math.min(_initKeepRecent + extraKeep, keepRecent + extraKeep);
                    }
                })();

                // 中间部分（1 ~ keepStart-1）用摘要替代
                var middleMessages = messages.slice(1, keepStart);
                var summaryParts = [];
                var removedCount = 0;
                var toolNameByCallId = {};

                for (var j = 0; j < middleMessages.length; j++) {
                    var mm = middleMessages[j];
                    if (mm.role === 'assistant') {
                        if (mm.tool_calls && mm.tool_calls.length > 0) {
                            var toolNames = mm.tool_calls.map(function(tc) {
                                if (tc.id) toolNameByCallId[tc.id] = tc.function ? tc.function.name : 'unknown';
                                return tc.function ? tc.function.name : 'unknown';
                            }).join(', ');
                            summaryParts.push('[assistant调用工具: ' + toolNames + ']');
                        } else if (mm.content) {
                            var preview = String(mm.content).substring(0, 80);
                            summaryParts.push('[assistant: ' + preview + '…]');
                        }
                        removedCount++;
                    } else if (mm.role === 'tool') {
                        // 尝试提取工具名和成功/失败
                        var tc = String(mm.content || '');
                        var isSuccess = tc.indexOf('"success":true') >= 0 || tc.indexOf('"success": true') >= 0;
                        var isFail = tc.indexOf('"success":false') >= 0 || tc.indexOf('"success": false') >= 0;
                        var status = isSuccess ? '成功' : (isFail ? '失败' : '完成');
                        var toolName = toolNameByCallId[mm.tool_call_id] || 'unknown';
                        // ===== 降低激进度：被压缩的读取类工具结果，摘要里保留内容预览 =====
                        // 否则 AI 刚读过的代码被摘要成"[工具 read_file: 成功]"后完全丢失，
                        // 只能反复重读 → 死循环。这里对读取类结果保留 200 字预览供后续参考。
                        var isReadLike = toolName.indexOf('read_') === 0 || toolName === 'read' ||
                            toolName === 'file_info' || toolName === 'search_in_files' ||
                            toolName === 'regex_search' || toolName === 'search';
                        if (isReadLike && tc.length > 20) {
                            var cleanTc = tc.replace(/\\n/g, '\n').substring(0, 200);
                            summaryParts.push('[工具 ' + toolName + ': ' + status + '，内容预览: ' + cleanTc + '…]');
                        } else {
                            summaryParts.push('[工具 ' + toolName + ': ' + status + ']');
                        }
                        removedCount++;
                    } else if (mm.role === 'user') {
                        var userPreview = String(mm.content || '').substring(0, 100);
                        summaryParts.push('[用户: ' + userPreview + '…]');
                        removedCount++;
                    }
                }

                // 构建压缩后的 messages
                var compressedMessages = [Object.assign({}, messages[0])]; // system
                if (summaryParts.length > 0) {
                    compressedMessages[0].content = String(compressedMessages[0].content || '') +
                        '\n\n【上下文摘要】以下是之前' + removedCount + '条对话的压缩摘要：\n' + summaryParts.join('\n');
                }
                // 保留最近的消息
                for (var k = keepStart; k < messages.length; k++) {
                    compressedMessages.push(messages[k]);
                }

                // ===== 自适应检查：压缩后是否仍在预算内 =====
                var afterTokens = self._estimateTokens(compressedMessages);
                if (afterTokens <= threshold || keepRecent <= 2) {
                    // 已达标（或已到下限），提交压缩结果
                    messages.length = 0;
                    for (var m = 0; m < compressedMessages.length; m++) {
                        messages.push(compressedMessages[m]);
                    }
                    result.compressed = true;
                    result.afterTokens = afterTokens;
                    result.removedCount = removedCount + truncatedCount;
                    return result;
                }
                // 仍超预算：减少保留条数，再压一轮
                keepRecent = Math.max(2, keepRecent - 2);
            }
        },

        // ===== 添加工具卡片消息（平铺模式：无折叠组，一行一个工具，面板可滚动） =====
        addToolCard: function(box, html) {
            var body = box.querySelector('.chatbox-toolpanel-body') || box.querySelector('.chatbox-body');

            // 直接将工具卡片追加到面板（不再套 tool-group 折叠层）
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            var cardEl = tempDiv.firstElementChild;
            body.appendChild(cardEl);

            // 【2026 修复】工具面板 DOM 裁剪：工具卡片只增不减，长会话中面板越来越卡
            try {
                var _cards = body.querySelectorAll('.tool-wrap');
                if (_cards.length > 200) {
                    for (var _ci = 0; _ci < _cards.length - 180; _ci++) {
                        var _oldCard = _cards[_ci];
                        if (_oldCard && _oldCard.parentNode) _oldCard.parentNode.removeChild(_oldCard);
                    }
                }
            } catch (e) {}

            // 自动滚动到底部
            var _tc = this.chatBoxes.find(function(c) { return c.el === box; });
            if (!_tc || _tc.autoFollowBottom) {
                body.scrollTop = body.scrollHeight;
            }

            // 绑定单个工具卡片的折叠/展开事件
            var wrap = (cardEl.classList && cardEl.classList.contains('tool-wrap')) ? cardEl : cardEl.querySelector('.tool-wrap');
            var noCollapse = wrap && wrap.classList.contains('tool-wrap--nocollapse');
            var cardHeader = cardEl.querySelector('.tool-wrap__header');
            if (cardHeader && !noCollapse) {
                cardHeader.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (wrap) wrap.classList.toggle('tool-wrap--collapsed');
                });
            }

            // 更新工具按钮徽章
            var _badge = box.querySelector('.tool-badge');
            if (_badge) {
                var _totalCount = body.querySelectorAll('.tool-wrap').length;
                _badge.textContent = _totalCount;
                _badge.style.display = _totalCount > 0 ? '' : 'none';
                var _tpBtn = box.querySelector('.tool-panel-btn');
                if (_tpBtn) {
                    _tpBtn.classList.add('tool-panel-btn--pulse');
                    setTimeout(function() { _tpBtn.classList.remove('tool-panel-btn--pulse'); }, 700);
                }
            }

            // ===== 工具统计面板实时刷新（面板已注入统计区时才刷新，避免无谓开销）=====
            try { if (box.querySelector('.chatbox-toolstats') && this.renderToolStats) this.renderToolStats(box); } catch (e) {}

            return cardEl;
        },
});
