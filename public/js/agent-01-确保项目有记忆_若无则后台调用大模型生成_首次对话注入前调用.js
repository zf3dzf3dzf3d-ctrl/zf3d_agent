// ==== 拆分自 app-agent.js：确保项目有记忆：若无则后台调用大模型生成（首次对话注入前调用）_达到执行步数上限_上下文循环配置读_按模型选择上下文 ====
Object.assign(App, {
    // ===== 确保项目有记忆：若无则后台调用大模型生成（首次对话注入前调用） =====
    // 返回生成的记忆文本；生成失败/离线时返回 ''（不阻塞正常对话）
    _ensureProjectMemory: function(pid, model) {
        if (!pid) return '';
        // 已有记忆则直接返回
        var exist = this._getProjectMemory(pid);
        if (exist) return exist;
        // 防重复阻塞：记忆为空（项目未关联文件夹/生成失败）时，60秒内不再同步请求，避免每次发送都卡顿
        if (!this._projMemoCooldown) this._projMemoCooldown = {};
        var _mcd = this._projMemoCooldown[String(pid)];
        if (_mcd && (Date.now() - _mcd) < 60000) return '';
        this._projMemoCooldown[String(pid)] = Date.now();
        // 离线模式无法生成，直接降级
        if (typeof DB === 'undefined' || !DB.online) return '';
        try {
            // 同步请求后端生成（仅首次无记忆时触发一次，可接受短暂等待）
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/project/memory/generate', false); // 同步，保证首条消息带记忆
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 60000;
            xhr.send(JSON.stringify({ proj_id: pid, model: (model ? { endpoint: model.endpoint, key: model.key || '', modelId: model.modelId || '', name: model.name || '', body: model.body || null } : null) }));
            var data = null;
            try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
            var memText = (data && data.ok) ? (data.memory_text || '') : '';
            if (memText) {
                // 回写本地缓存，避免重复生成
                if (typeof App !== 'undefined' && App._projAllProjects) {
                    for (var i = 0; i < App._projAllProjects.length; i++) {
                        if (String(App._projAllProjects[i].id) === String(pid)) {
                            App._projAllProjects[i].memory_text = memText;
                            break;
                        }
                    }
                }
                if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                    for (var j = 0; j < Store.data.projects.length; j++) {
                        if (String(Store.data.projects[j].id) === String(pid)) {
                            Store.data.projects[j].memory_text = memText;
                            break;
                        }
                    }
                }
            }
            return String(memText).trim();
        } catch (e) {
            return '';
        }
    },

    _buildContext: function(history, model, chat) {
        // Keep the live exchange compact, but retain a bounded restart brief from older saved messages.
        // GPT/DeepSeek 默认保留较少轮次，减少重复历史带来的输入成本。
        var modelId = String((model && (model.modelId || model.name)) || '').toLowerCase();
        var defaultRounds = modelId.indexOf('deepseek') >= 0 ? 1 : 2;
        var configuredRounds = model && model.body ? parseInt(model.body.context_rounds, 10) : NaN;
        var contextRounds = isFinite(configuredRounds) ? configuredRounds : defaultRounds;
        contextRounds = Math.max(1, Math.min(4, contextRounds));
        var maxAssistantChars = modelId.indexOf('deepseek') >= 0 ? 4000 : 5000;
        var maxUserChars = modelId.indexOf('deepseek') >= 0 ? 8000 : 10000;
        var filtered = [];
        for (var i = 0; i < history.length; i++) {
            var m = history[i];
            // 工具调用 assistant 消息必须和后续 tool 结果成对发送。
            // 历史重建会主动丢弃 tool 结果，因此也必须丢弃孤立的 tool_calls。
            if (m._thinking || m._maxDepthRecovery || m.role === 'tool' ||
                // 过滤历史中已持久化的"恢复/重试"系统消息（无 _maxDepthRecovery 标记的旧残留）
                (m.role === 'user' && typeof m.content === 'string' &&
                 /^系统检测到上一轮执行达到最大智能体执行步数/.test(m.content)) ||
                (m.role === 'tool' && typeof m.content === 'string' &&
                 /^系统检测到上一轮执行达到最大智能体执行步数/.test(m.content)) ||
                (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)) continue;
            filtered.push(m);
        }

        var userIndexes = [];
        for (var j = 0; j < filtered.length; j++) {
            if (filtered[j].role === 'user') userIndexes.push(j);
        }
        var keepFrom = userIndexes.length > contextRounds ? userIndexes[userIndexes.length - contextRounds] : 0;
        var result = [];

        if (keepFrom > 0) {
            var memoryLines = [];
            var maxLines = 12;
            for (var k = 0; k < keepFrom && memoryLines.length < maxLines; k++) {
                var old = filtered[k];
                var content = String(old.content || '').replace(/\s+/g, ' ').trim();
                if (!content) continue;
                var isTaskResult = old.role === 'assistant' && /task_complete|任务完成|任务失败|已热更新/.test(content);
                if (old.role === 'user' || isTaskResult) {
                    memoryLines.push((old.role === 'user' ? '用户：' : '历史结果：') + content.slice(0, 220));
                }
            }
            if (memoryLines.length) {
                result.push({
                    role: 'system',
                    content: '以下是本对话在重启前保存的早期任务记忆，仅用于延续上下文。优先继续尚未完成的用户任务，不要重复已经完成的工作：\n' + memoryLines.join('\n')
                });
            }
        }

        for (var n = keepFrom; n < filtered.length; n++) {
            var current = filtered[n];
            var currentContent = (current.content === null || current.content === undefined) ? '' : String(current.content);
            if (current.role === 'assistant' && !current.tool_calls && currentContent.length > maxAssistantChars) {
                currentContent = currentContent.slice(0, maxAssistantChars) + '\n[较早回复已压缩]';
            }
            // 超长用户消息截取：保留开头关键内容，尾部保留少量，中间折叠，保证长期留存不撑爆上下文
            if (current.role === 'user' && currentContent.length > maxUserChars) {
                var keepHead = Math.floor(maxUserChars * 0.85);
                var keepTail = maxUserChars - keepHead;
                currentContent = currentContent.slice(0, keepHead) +
                    '\n\n[超长用户消息已截取：原文共 ' + currentContent.length + ' 字，此处省略中间部分]\n\n' +
                    currentContent.slice(currentContent.length - keepTail);
            }
            result.push({
                role: current.role,
                content: currentContent
            });
        }
        // ===== 历史答案压缩：按用户选择档位改写注入副本中的历史 assistant 消息 =====
        // （只影响发给模型的上下文，不改动 chat.history 原始数据）
        try { if (typeof this._applyHistoryAnswerMode === 'function') this._applyHistoryAnswerMode(result, chat); } catch (e) {}
        // ===== 清理可能导致 HTTP 400 的非标准字段 =====
        // 某些模型（如 GLM-5.3）会返回 reasoning_content 字段，如果不清理，
        // 下一次请求时会因 InvalidParameter 被拒绝。
        for (var ci = 0; ci < result.length; ci++) {
            if (result[ci]) {
                delete result[ci].reasoning_content;
                delete result[ci]._thinking;
                delete result[ci]._maxDepthRecovery;
                // 确保 content 不为 null/undefined
                if (result[ci].content === null || result[ci].content === undefined) {
                    result[ci].content = '';
                }
                // 移除 tool_calls 字段（_buildContext 已过滤含 tool_calls 的 assistant 消息，
                // 但保险起见再检查一次）
                if (result[ci].role === 'assistant' && result[ci].tool_calls) {
                    delete result[ci].tool_calls;
                }
            }
        }
        return result;
    },

    // ===== 三档压缩模式：处理上一轮（上次任务）的工具结果，按用户选择的档位注入 =====
    // 返回要 concat 到 messages 的额外消息数组；无内容返回 null
    _applyCompressMode: function(chat) {
        try {
            var mode = chat._compressMode || this._loadCompressMode(); // minimal=极简保留(默认) / full=全保留 / truncate=截断
            var lastTools = chat._lastTaskToolResults || []; // 上一个任务的工具结果 [{tool, content}]
            if (!lastTools.length) return null;
            if (mode === 'truncate') {
                // 1 截断：上一轮工具结果全丢
                return [{ role: 'system', content: '【上下文压缩】用户选择了"截断"模式：上一轮任务的工具结果已全部丢弃，仅保留对话消息本身。如需原始数据请重新调用工具获取。' }];
            }
            if (mode === 'minimal') {
                // 2 极简保留：上一轮工具结果压缩为 <2000 字摘要注入
                var parts = [];
                var total = 0;
                for (var i = lastTools.length - 1; i >= 0 && total < 2000; i--) {
                    var c = String(lastTools[i].content || '');
                    var excerpt = c.length > 300 ? (c.slice(0, 200) + '…' + c.slice(-80)) : c;
                    parts.unshift('[' + lastTools[i].tool + '] ' + excerpt);
                    total += excerpt.length;
                }
                return [{ role: 'system', content: '【上下文压缩-极简保留】以下是上一轮任务工具结果的压缩摘要（全文已丢弃，需要详情请重新调用工具）：\n' + parts.join('\n') }];
            }
            // 3 全保留：完整注入上一轮工具结果
            var full = [];
            for (var j = 0; j < lastTools.length; j++) {
                full.push('[' + lastTools[j].tool + ']\n' + String(lastTools[j].content || '').slice(0, 6000));
            }
            return [{ role: 'system', content: '【上一轮任务工具结果（全保留模式）】\n' + full.join('\n\n') }];
        } catch (e) { return null; }
    },

    // ===== 压缩档位持久化：用户习惯 JSON 为唯一默认值来源 =====
    _getPreferredCompressionModes: function(chatId) {
        try {
            if (window.UserSettings && UserSettings.getChatCompressionModes) {
                return UserSettings.getChatCompressionModes(chatId);
            }
        } catch (e) {}
        return { toolResults: 'minimal', historyAnswers: 'minimal' };
    },
    _loadCompressMode: function(cb, chat) {
        var modes = this._getPreferredCompressionModes(chat && chat.id);
        var mode = modes.toolResults;
        if (cb) cb(mode);
        return mode;
    },
    _saveCompressMode: function(mode, chat) {
        try {
            if (window.UserSettings && UserSettings.setChatPreferences) {
                UserSettings.setChatPreferences(chat && chat.id, null, { toolResults: mode });
            }
        } catch (e) {}
    },

    // ===== 历史答案压缩模式：按用户选择的档位改写 chat.history 中的 assistant 消息 =====
    // mode: truncate=1截断(仅保留最近1条，其余只留占位提示) / minimal=2极简(最近1条全保留，其余每条截断几百字) / full=3全保留
    // 注意：只改写注入上下文的副本（filtered），不改动 chat.history 原始数据
    _applyHistoryAnswerMode: function(filtered, chat) {
        try {
            var mode = chat._historyMode || this._loadHistoryMode();
            if (mode === 'full' || !filtered || !filtered.length) return filtered;
            // 找出所有 assistant 纯文本消息（历史任务答案）的下标
            var idx = [];
            for (var i = 0; i < filtered.length; i++) {
                if (filtered[i] && filtered[i].role === 'assistant' && !filtered[i].tool_calls && filtered[i].content) idx.push(i);
            }
            if (idx.length <= 1) return filtered; // 只有0/1条历史答案，无需压缩
            var last = idx[idx.length - 1]; // 最近一条全保留
            if (mode === 'truncate') {
                // 1 截断：只保留最近1条，其余替换为占位提示（AI 可通过对话记录工具自行查阅）
                for (var j = 0; j < idx.length - 1; j++) {
                    var k = idx[j];
                    var c = String(filtered[k].content || '');
                    filtered[k].content = '【历史答案已截断】本轮次之前的 AI 回复（共' + c.length + '字）已按用户选择丢弃，如需查看历史结论请说明，或调用相关对话记录工具检索。';
                }
            } else if (mode === 'minimal') {
                // 2 极简保留：最近1条全保留，其余每条截断到约500字
                for (var j2 = 0; j2 < idx.length - 1; j2++) {
                    var k2 = idx[j2];
                    var c2 = String(filtered[k2].content || '');
                    if (c2.length > 500) {
                        filtered[k2].content = c2.slice(0, 400) + '\n[历史答案已压缩：原始' + c2.length + '字]';
                    }
                }
            }
            return filtered;
        } catch (e) { return filtered; }
    },

    // ===== 历史答案压缩档位持久化：与工具结果档位一起写入用户习惯 JSON =====
    _loadHistoryMode: function(cb, chat) {
        var modes = this._getPreferredCompressionModes(chat && chat.id);
        var mode = modes.historyAnswers;
        if (cb) cb(mode);
        return mode;
    },
    _saveHistoryMode: function(mode, chat) {
        try {
            if (window.UserSettings && UserSettings.setChatPreferences) {
                UserSettings.setChatPreferences(chat && chat.id, null, { historyAnswers: mode });
            }
        } catch (e) {}
    },

    // ===== 在对话流中渲染压缩选择器（任务完成后调用）=====
    // 两组选项：A) 上一轮工具结果压缩(1截断/2极简保留/3全保留)  B) 历史答案压缩(1截断/2极简保留/3全保留)
    renderCompressSelector: function(box, chat) {
        try {
            var self = this;
            var body = box.querySelector('.chatbox-body');
            if (!body) return;
            if (!chat._compressMode) chat._compressMode = self._loadCompressMode();
            if (!chat._historyMode) chat._historyMode = self._loadHistoryMode();
            var wrap = document.createElement('div');
            wrap.className = 'msg compress-selector';
            wrap.style.cssText = 'padding:6px 10px;margin:4px 0;font-size:12px;background:rgba(255,255,255,.04);border-radius:8px;';

            function buildRow(labelText, curVal, opts, onPick) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:3px 0;';
                var label = document.createElement('span');
                label.textContent = labelText;
                label.style.cssText = 'opacity:.75;white-space:nowrap;flex:0 0 auto;';
                row.appendChild(label);
                // 按钮组整体居右，固定顺序：1截断 -> 2极简保留 -> 3全保留（永不重排）
                var btns = document.createElement('span');
                btns.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:auto;flex:0 0 auto;';
                row.appendChild(btns);
                opts.forEach(function(o) {
                    var btn = document.createElement('button');
                    btn.textContent = o.name;
                    btn.title = o.tip;
                    btn.style.cssText = 'cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid ' +
                        (curVal === o.id ? 'var(--accent,#4f9cff)' : 'rgba(255,255,255,.18)') + ';background:' +
                        (curVal === o.id ? 'rgba(79,156,255,.18)' : 'transparent') + ';color:inherit;white-space:nowrap;';
                    btn.addEventListener('click', function() {
                        onPick(o.id);
                        row.querySelectorAll('button').forEach(function(b) {
                            b.style.borderColor = 'rgba(255,255,255,.18)';
                            b.style.background = 'transparent';
                        });
                        btn.style.borderColor = 'var(--accent,#4f9cff)';
                        btn.style.background = 'rgba(79,156,255,.18)';
                    });
                    btns.appendChild(btn);
                });
                return row;
            }

            // A: 上一轮工具结果压缩
            wrap.appendChild(buildRow('上轮工具结果：', chat._compressMode, [
                { id: 'truncate', name: '1 截断', tip: '上一轮工具结果全丢，只保留对话消息' },
                { id: 'minimal', name: '2 极简保留', tip: '工具结果压缩为<2000字注入' },
                { id: 'full', name: '3 全保留', tip: '完整保留上一轮工具结果' }
            ], function(id) {
                chat._compressMode = id;
                self._saveCompressMode(id, chat);
                Store.addLog('info', chat.id, 'compress-mode', '用户选择工具结果压缩档位: ' + id);
            }));

            // B: 历史答案压缩
            wrap.appendChild(buildRow('历史答案：', chat._historyMode, [
                { id: 'truncate', name: '1 截断', tip: '仅保留最近1条AI回复，其余替换为占位提示' },
                { id: 'minimal', name: '2 极简保留', tip: '最近1条全保留，其余每条截断至约500字' },
                { id: 'full', name: '3 全保留', tip: '完整保留所有历史AI回复' }
            ], function(id) {
                chat._historyMode = id;
                self._saveHistoryMode(id, chat);
                Store.addLog('info', chat.id, 'history-mode', '用户选择历史答案压缩档位: ' + id);
            }));

            body.appendChild(wrap);
        } catch (e) {}
    },

    sendToModel: function(box, chat) {
            var self = this;
            // 健康守护检查：强制锁定时不允许发送
            if (typeof HealthGuard !== 'undefined' && HealthGuard.isLocked()) {
                var remain = Math.ceil(HealthGuard.getLockRemaining() / 60);
                this.addMsg(box, '🔒 健康守护：强制休息中，剩余 ' + remain + ' 分钟。请先休息！', 'error');
                Store.addLog('warn', chat.id, 'health-lock', '发送被拦截：强制休息中');
                return;
            }
            // 设置发送状态
            chat.isSending = true;
            chat._taskStartTime = Date.now();
            chat._stopped = false;
            // 重置截断重试状态（新任务不应继承上一次的 max_tokens 覆盖）
            chat._truncRetryCount = 0;
            delete chat._maxTokensOverride;
            // 新任务开始：递增工具缓存轮次，同轮内同签名工具命中缓存，跨轮不误伤
            // ===== 三档压缩：新任务开始，把刚完成任务的结果归档为“上一轮”，开新一轮记录 =====
            chat._lastTaskToolResults = chat._curTaskToolResults || [];
            chat._curTaskToolResults = [];
            // 新任务开始，清除上一次任务的结果标记（避免旧的 success/fail 影响导航箭头颜色）
            chat._taskStatus = null;
            chat._sendCompleteCalled = false;
            chat.abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            self.updateSendButton(box, chat);
            this.updateMinimap();

            if (!chat.modelId) {
                // 未选择模型 → 优先自动选择"用户最后使用的大模型"，否则回退到第一个可用模型（优先有 key 的预置线路）
                var _lu = window._lastUsedModel || null;
                var auto = null;
                if (_lu && _lu.endpoint && _lu.modelId) {
                    auto = Models.list.find(function(m){
                        return m && m.key && m.endpoint === _lu.endpoint && m.modelId === _lu.modelId;
                    });
                }
                if (!auto) auto = Models.list.find(function(m){ return m && m.key; });
                if (!auto) auto = Models.list[0];
                if (auto) {
                    chat.modelId = auto.id;
                    Store.saveChatBox(chat);
                } else {
                    this.addMsg(box, '请先在上方下拉列表选择一个模型。', 'error');
                    Store.addLog('error', chat.id, 'no-model', '未选择模型');
                    self._onSendComplete(box, chat);
                    return;
                }
            }

            var model = Models.get(chat.modelId);
            if (!model) {
                // 模型配置不存在（可能被删除/损坏）→ 已禁用自动切换，直接提示用户手动选择
                this.addMsg(box, '⚠️ 原模型配置不存在，请在下拉框手动选择模型。', 'error');
                Store.addLog('error', chat.id, 'model-missing', '模型配置不存在: ' + chat.modelId + ' → 自动切换已禁用，等待手动选择');
                self._onSendComplete(box, chat);
                return;
            }
            if (!model.key) {
                // 当前模型未配置密钥 → 已禁用自动切换，直接提示用户手动配置/切换
                this.addMsg(box, '⚠️ 模型「' + model.name + '」尚未配置 API 密钥（已禁用自动切换）。请点击右上角⚙️设置 → 输入密钥 → 保存密钥，或在对话标题栏手动切换模型。', 'error');
                Store.addLog('error', chat.id, 'no-key', '模型未配置密钥: ' + model.name + ' → 自动切换已禁用，等待手动处理');
                self._onSendComplete(box, chat);
                return;
            }

            // ===== 记住用户最后使用的大模型（每次发消息异步上报，不阻塞对话） =====
            try {
                var _rpt = new XMLHttpRequest();
                _rpt.open('POST', '/api/chat/last-model', true);
                _rpt.setRequestHeader('Content-Type', 'application/json');
                _rpt.send(JSON.stringify({ model: { endpoint: model.endpoint, key: model.key || '', modelId: model.modelId || '', name: model.name || '', body: model.body || null } }));
            } catch (e) {}

            // 设置当前对话 ID，供 getSystemPrompt/getDefinitions 使用（每个对话独立分类）
            Tools.currentChatId = chat.id;
            // 构造消息：系统提示 + 最近3轮历史（只保留最近3个user消息及其回复，避免上下文膨胀）
            var messages = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }];
            // ===== 注入项目记忆（每次用户发送都注入，保证每条上下文都带项目目录和 python 路径） =====
            var _projMemo = self._ensureProjectMemory(chat.projectId, model);
            if (_projMemo) {
                messages.push({ role: 'system', content: '【项目背景记忆】' + _projMemo });
                chat._projMemoInjectedFor = String(chat.projectId || '');
            }
            messages = messages.concat(self._buildContext(chat.history, model, chat));

            // ===== 用户消息自动截断：发往模型的用户文字超过 2000 字自动截断（完全自动，无档位） =====
            // 只改注入副本，chat.history 原始数据不动；截断时附加提示让模型知道有省略
            var _uIdx = messages.length - 1;
            for (var _ui = messages.length - 1; _ui >= 0; _ui--) {
                if (messages[_ui] && messages[_ui].role === 'user' && messages[_ui].content) { _uIdx = _ui; break; }
            }
            if (messages[_uIdx] && messages[_uIdx].role === 'user') {
                var _uTxt = String(messages[_uIdx].content || '');
                if (_uTxt.length > 2000) {
                    messages[_uIdx] = { role: 'user', content: _uTxt.slice(0, 2000) + '\n\n【提示】你的消息超过 2000 字，已被自动截断，仅保留前 2000 字。如需完整内容请分段发送。' };
                }
            }

            // ===== 三档压缩模式（用户手选）：截断 / 极简保留 / 全保留，控制上一轮工具结果注入 =====
            var _ctxExtra = self._applyCompressMode(chat);
            if (_ctxExtra) messages = messages.concat(_ctxExtra);

            // ===== 初始化深度进度提示标记（每 30 步出现一次：30/60/90...） =====
            chat._depthNoticeStep = 0;
            // ===== 初始化 token 统计 =====
            chat._tokenCount = 0;
            chat._rebuild400Count = 0;   // HTTP 400 上下文自愈重建计数（每次用户发送时重置）
            chat._apiCalls = 0;
            chat._tokenStartTime = Date.now();
            // ===== 初始化缓存命中统计 =====
            chat._cacheHitTokens = 0;   // 缓存命中的 prompt token
            chat._cacheMissTokens = 0;   // 缓存未命中的 prompt token
            chat._promptTokens = 0;      // 总 prompt token
            if (!Number.isFinite(Number(chat._completionTokens))) chat._completionTokens = 0;   // 会话累计 completion token
            // ===== 会话级累计统计（整个对话历史累计，跨任务不清零） =====
            if (!Number.isFinite(Number(chat._sessionTotalTokens))) chat._sessionTotalTokens = 0;
            if (!Number.isFinite(Number(chat._sessionTotalApiCalls))) chat._sessionTotalApiCalls = 0;
            if (!Number.isFinite(Number(chat._sessionTotalDuration))) chat._sessionTotalDuration = 0;
            if (!Number.isFinite(Number(chat._sessionTotalPromptTokens))) chat._sessionTotalPromptTokens = 0;
            if (!Number.isFinite(Number(chat._sessionTotalCompletionTokens))) chat._sessionTotalCompletionTokens = 0;
            if (!Number.isFinite(Number(chat._sessionTotalCacheHitTokens))) chat._sessionTotalCacheHitTokens = 0;
            if (!Number.isFinite(Number(chat._sessionTotalCacheMissTokens))) chat._sessionTotalCacheMissTokens = 0;
            // 记录本次发送的原始用户任务，供达到步数上限后重规划使用。
            for (var taskIndex = chat.history.length - 1; taskIndex >= 0; taskIndex--) {
                if (chat.history[taskIndex].role === 'user' && !chat.history[taskIndex]._maxDepthRecovery) {
                    chat._activeTaskText = chat.history[taskIndex].content || '';
                    break;
                }
            }
            chat._maxDepthRetryCount = 0;
            // 启动 Agent 循环
            self._agentLoop(box, chat, model, messages, 0);
        },

        // ===== 达到执行步数上限后的自动重规划 =====
        _recoverFromMaxDepth: function(box, chat, model, depth) {
            var MAX_DEPTH_RETRIES = (this._getContextLoopConfig().maxDepthRetries != null ? this._getContextLoopConfig().maxDepthRetries : 5);
            var retry = chat._maxDepthRetryCount || 0;
            var task = chat._activeTaskText || '';
            if (retry >= MAX_DEPTH_RETRIES) {
                try { this.addMsg(box, '❌ 该任务彻底无法完成：已连续 ' + MAX_DEPTH_RETRIES + ' 次达到最大执行步数。', 'error'); } catch(e){}
                try { Store.addLog('error', chat.id, 'agent-max-depth-failed', 'Max depth recovery exhausted: ' + MAX_DEPTH_RETRIES); } catch(e){}
                this._onSendComplete(box, chat);
                return;
            }
            retry += 1;
            chat._maxDepthRetryCount = retry;
            var recoveryPrompt = '系统检测到上一轮执行达到最大智能体执行步数（' + this._getContextLoopConfig().maxRounds + '）。请先重新规划工具调用和执行步骤，减少无效循环，然后继续完成原始用户任务。\\n\\n原始用户任务：\\n' + task;
            var self = this;
            // ===== 隐形发送：恢复消息不写入 chat.history、不显示用户气泡、不持久化到 DB =====
            // 仅作为本次请求的一次性 user 消息传给模型，避免污染后续对话的"用户提问质量"。
            // （addMsg 会 Store.addMessage 落库、chat.history.push 会被 _buildContext 反复发送，
            //   均会污染上下文，故此处不再调用。）
            try { Store.addLog('warn', chat.id, 'agent-max-depth-retry', '重规划并重试第 ' + retry + '/' + MAX_DEPTH_RETRIES + '（隐形恢复）'); } catch(e){}
            chat._depthNoticeStep = 0;
            chat._rebuild400Count = 0;
            chat._sendCompleteCalled = false;

            // 恢复消息必须作为本次请求的最后一条 user 消息显式发送。
            // 仅写入 history 后立即递归进入循环，可能被上下文裁剪或被未捕获的
            // 异步异常中断，最终只显示提示而没有真正发给模型。
            var nextMessages = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }].concat(this._buildContext(chat.history, model));
            // ===== 项目记忆注入（每次请求都带，保证模型知道项目目录和 python 路径） =====
            var _pmRecover = this._getProjectMemory(chat.projectId);
            if (_pmRecover) {
                nextMessages.splice(1, 0, { role: 'system', content: '【项目背景记忆】' + _pmRecover });
            }
            nextMessages = nextMessages.filter(function(message) {
                return !(message && message.role === 'user' && message.content === recoveryPrompt);
            });
            nextMessages.push({ role: 'user', content: recoveryPrompt });
            var recoveryLoop = this._agentLoop(box, chat, model, nextMessages, 0, 0, 0);
            if (recoveryLoop && typeof recoveryLoop.catch === 'function') {
                recoveryLoop.catch(function(error) {
                    try { Store.addLog('error', chat.id, 'agent-max-depth-recovery-failed', error && error.message ? error.message : String(error)); } catch(e){}
                    try { self.addMsg(box, '自动继续失败：' + (error && error.message ? error.message : '未知错误') + '。请点击发送按钮重试。', 'error'); } catch(e2){}
                    self._onSendComplete(box, chat);
                });
            }
        },

        // ===== 上下文循环配置读取 =====
        // 设置面板由 context-loop.js 提供；未加载或配置损坏时使用同一套默认值。
        _getContextLoopConfig: function() {
            var fallback = {
                enabled: true,
                maxRounds: 200,
                compressAfterMessages: 40,
                keepRecentMessages: 20,
                observationDelayMs: 300,
                loopBreakLimit: 50,
                retryMaxPerRound: 5,
                retryIntervalMs: 3000,
                retryRounds: 1,
                retryRounds429: 2,
                retryRoundIntervalMs: 300000,
                retryStatusCodes: '0,400,429,500,502,503,504',
                retryBackoff429Ms: '5000,15000,40000,90000,180000',
                rebuild400Max: 10,
                maxDepthRetries: 5,
                loopArgMaxChars: 50,
                loopSigWindow: 200,
                loopMinSigCount: 3,
                loopConsecutiveThreshold: 30,
                loopPatternThreshold: 25,
                loopFreqWindowSteps: 30,
                loopFreqMinSteps: 20,
                loopReadOnlyThreshold: 15,
                loopWriteThreshold: 40,
                loopReReadWindow: 50,
                loopReReadMinSteps: 8,
                loopReReadThreshold: 99,
                steps: [
                    { id: 'read', enabled: true, maxExecutions: 1 },
                    { id: 'think', enabled: true, maxExecutions: 20 },
                    { id: 'tools', enabled: true, maxExecutions: 40 },
                    { id: 'observe', enabled: true, maxExecutions: 20 },
                    { id: 'compress', enabled: true, maxExecutions: 1 }
                ]
            };
            try {
                if (typeof ContextLoopConfig !== 'undefined') {
                    var configured = typeof ContextLoopConfig.get === 'function'
                        ? ContextLoopConfig.get()
                        : (typeof ContextLoopConfig.load === 'function' ? ContextLoopConfig.load() : null);
                    if (configured && typeof configured === 'object') {
                        fallback = Object.assign(fallback, configured);
                        if (Array.isArray(configured.steps)) fallback.steps = configured.steps;
                    }
                }
            } catch (e) {
                try { Store.addLog('warn', null, 'context-loop-config', '上下文循环配置读取失败，已使用默认值'); } catch (ignore) {}
            }
            // ===== 对话模式限制规则覆盖（private/chat_mode_rules.json -> modes.<当前模式>.loop）=====
            // 当前对话模式 = 对话级配置优先，否则全局默认；规则缺失/为 null 的字段保持系统默认。
            try {
                var _mrMode = null;
                if (typeof Tools !== 'undefined' && Tools.currentChatId && typeof DB !== 'undefined' && DB.getLoopModeForChat) {
                    _mrMode = DB.getLoopModeForChat(Tools.currentChatId);
                } else if (typeof DB !== 'undefined' && DB._loopMode) {
                    _mrMode = DB._loopMode;
                }
                if (typeof DB !== 'undefined' && DB.getModeLoopRules) {
                    var _mrLoop = DB.getModeLoopRules(_mrMode);
                    if (_mrLoop && typeof _mrLoop === 'object') {
                        var _KEYMAP = {
                            enabled: 'enabled',
                            max_agent_rounds: 'maxRounds',
                            compress_after_messages: 'compressAfterMessages',
                            keep_recent_messages: 'keepRecentMessages',
                            observation_delay_ms: 'observationDelayMs',
                            loop_break_limit: 'loopBreakLimit',
                            retry_max_per_round: 'retryMaxPerRound',
                            retry_interval_ms: 'retryIntervalMs',
                            retry_rounds: 'retryRounds',
                            retry_rounds_429: 'retryRounds429',
                            retry_round_interval_ms: 'retryRoundIntervalMs',
                            context_token_budget: 'contextTokenBudget',
                            tool_result_max_chars: 'toolResultMaxChars',
                            tool_result_keep_recent: 'toolResultKeepRecent',
                            tool_result_max_keep: 'toolResultMaxKeep',
                            avoid_redundant_reply: 'avoidRedundantReply',
                            rebuild_400_max: 'rebuild400Max',
                            max_depth_retries: 'maxDepthRetries'
                        };
                        Object.keys(_KEYMAP).forEach(function(rk) {
                            if (_mrLoop[rk] !== null && _mrLoop[rk] !== undefined) {
                                fallback[_KEYMAP[rk]] = _mrLoop[rk];
                            }
                        });
                        // steps 子规则（read/think/tools/observe/compress 的 enabled + max_executions）
                        if (_mrLoop.steps && typeof _mrLoop.steps === 'object' && Array.isArray(fallback.steps)) {
                            fallback.steps = fallback.steps.map(function(step) {
                                var s = _mrLoop.steps[step.id];
                                if (s && typeof s === 'object') {
                                    var cp = Object.assign({}, step);
                                    if (s.enabled !== null && s.enabled !== undefined) cp.enabled = !!s.enabled;
                                    if (s.max_executions !== null && s.max_executions !== undefined) cp.maxExecutions = parseInt(s.max_executions, 10);
                                    return cp;
                                }
                                return step;
                            });
                        }
                    }
                }
            } catch (e) {
                try { Store.addLog('warn', null, 'chat-mode-rules', '模式规则读取失败，使用系统默认'); } catch (ignore) {}
            }
            fallback.maxRounds = Math.max(1, Math.min(1000, parseInt(fallback.maxRounds, 10) || 200));
            fallback.compressAfterMessages = Math.max(2, parseInt(fallback.compressAfterMessages, 10) || 20);
            fallback.keepRecentMessages = Math.max(1, parseInt(fallback.keepRecentMessages, 10) || 8);
            fallback.observationDelayMs = Math.max(0, parseInt(fallback.observationDelayMs, 10) || 0);
            fallback.loopBreakLimit = Math.max(1, Math.min(50, parseInt(fallback.loopBreakLimit, 10) || 50));
            fallback.contextTokenBudget = Math.max(0, Math.min(200000, parseInt(fallback.contextTokenBudget, 10) || 0));
            fallback.toolResultMaxChars = Math.max(100, Math.min(50000, parseInt(fallback.toolResultMaxChars, 10) || 3000));
            if (!Array.isArray(fallback.steps) || !fallback.steps.length) fallback.steps = [];
            return fallback;
        },

        // ===== 按模型选择上下文/Prompt Cache 策略 =====
        // cacheMode 只描述供应商能力：当前 chat/completions 端点默认依赖供应商自动前缀缓存，
        // 不注入未经确认的专用字段，避免 OpenAI-compatible 接口因未知参数返回 400。
        _getModelCachePolicy: function(model, loopConfig) {
            var mid = String((model && (model.modelId || model.version || '')) || '').toLowerCase();
            var provider = String((model && model.provider) || '').toLowerCase();
            var configured = model && model.cachePolicy;
            var policy = (configured && typeof configured === 'object') ? Object.assign({}, configured) : {};
            if (!policy.cacheMode) policy.cacheMode = 'prefix-auto';
            if (!policy.contextWindow) {
                if (mid.indexOf('claude') >= 0) policy.contextWindow = 200000;
                else if (mid.indexOf('glm') >= 0 || mid.indexOf('gpt-4') >= 0 || mid.indexOf('gpt-5') >= 0) policy.contextWindow = 128000;
                else if (mid.indexOf('gpt-3.5') >= 0) policy.contextWindow = 16000;
                else policy.contextWindow = 64000;
            }
            // Explicit model setting wins; global setting remains the final override.
            if (!policy.toolResultMaxChars) policy.toolResultMaxChars = (policy.contextWindow >= 128000 ? 5000 : 3000);
            if (loopConfig && parseInt(loopConfig.toolResultMaxChars, 10) > 0) {
                policy.toolResultMaxChars = parseInt(loopConfig.toolResultMaxChars, 10);
            }
            policy.contextWindow = Math.max(8000, parseInt(policy.contextWindow, 10) || 64000);
            policy.toolResultMaxChars = Math.max(100, Math.min(50000, parseInt(policy.toolResultMaxChars, 10) || 3000));
            policy.provider = provider;
            policy.modelId = mid;
            return policy;
        },
});
