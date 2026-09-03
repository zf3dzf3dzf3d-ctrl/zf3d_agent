// ==== 拆分自 app-agent.js：确保项目有记忆：若无则后台调用大模型生成（首次对话注入前调用）_达到执行步数上限_上下文循环配置读_按模型选择上下文 ====
Object.assign(App, {
    // ===== 确保项目有记忆：若无则后台调用大模型生成（首次对话注入前调用） =====
    // 返回生成的记忆文本；生成失败/离线时返回 ''（不阻塞正常对话）
    _ensureProjectMemory: function(pid, model) {
        if (!pid) return '';
        // 已有记忆则直接返回
        var exist = this._getProjectMemory(pid);
        if (exist) return exist;
        // 防重复阻塞：记忆为空（项目未关联文件夹/生成失败）时，60秒内不再请求，避免每次发送都卡顿
        if (!this._projMemoCooldown) this._projMemoCooldown = {};
        var _mcd = this._projMemoCooldown[String(pid)];
        if (_mcd && (Date.now() - _mcd) < 60000) return '';
        this._projMemoCooldown[String(pid)] = Date.now();
        // 离线模式无法生成，直接降级
        if (typeof DB === 'undefined' || !DB.online) return '';
        // 【2026 修复】原实现用同步 XHR（open(..., false), timeout=60s）阻塞 UI 主线程，
        // 导致"点发送后整个页面卡住一两分钟"。改为异步请求：本轮先不带记忆直接发送，
        // 记忆生成完成后缓存到项目对象，下一条消息自动注入，观感零阻塞。
        var self2 = this;
        try {
            fetch('/api/project/memory/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proj_id: pid, model: (model ? { endpoint: model.endpoint, key: model.key || '', modelId: model.modelId || '', name: model.name || '', body: model.body || null } : null) })
            }).then(function(r){ return r.json(); }).then(function(data) {
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
            }).catch(function(){});
        } catch (e) {}
        return '';
    },

    _buildContext: function(history, model, chat) {
        // ===== 【验证轮完整上下文】=====
        // 验证轮（最后一条用户消息带 _verifyRound 且非 _continueRound）时，
        // 不做轮次裁剪、不做消息截断，把之前的完整工具执行过程全带给模型，
        // 让验证直接基于已做过的工具结果核验，避免重新跑一遍工具 → 验证更快。
        // 注意：_continueRound（继续轮）不在此列——继续干活走正常压缩路径。
        try {
            var _lastMsg = history && history.length ? history[history.length - 1] : null;
            if (chat && _lastMsg && _lastMsg.role === 'user' && _lastMsg._verifyRound && !_lastMsg._continueRound) {
                var _full = [];
                for (var _vi = 0; _vi < history.length; _vi++) {
                    var _vm = history[_vi];
                    if (!_vm) continue;
                    // 【400 修复】验证轮全量上下文同样剔除孤立代理项消息，防止坏字符触发 400
                    var _vBad = false;
                    try { _vBad = typeof _vm.content === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(_vm.content); } catch(e){}
                    if (_vBad) continue;
                    var _vc = String(_vm.content || '');
                    if (!(_vm._thinking || _vm._maxDepthRecovery)) _full.push({ role: _vm.role, content: _vc });
                }
                // 验证轮总量上限（JSON 可配：ctxCache.verifyRoundMaxChars，默认 20 万字），超出从最旧开始截
                try {
                    var _vCfg = self._getCtxCacheConfig ? self._getCtxCacheConfig() : { verifyRoundMaxChars: 200000 };
                    var _vTotal = 0;
                    for (var _vj = 0; _vj < _full.length; _vj++) _vTotal += String(_full[_vj].content || '').length;
                    if (_vTotal > _vCfg.verifyRoundMaxChars) {
                        var _vOver = _vTotal - _vCfg.verifyRoundMaxChars;
                        for (var _vk = 0; _vk < _full.length && _vOver > 0; _vk++) {
                            var _vl = String(_full[_vk].content || '').length;
                            if (_vl <= _vOver) { _vOver -= _vl; _full[_vk].content = _full[_vk].role === 'user' ? '【提示】此条较早消息过长，已整体省略。' : ''; }
                            else { _full[_vk].content = String(_full[_vk].content).slice(0, _vl - _vOver) + '\n…【前段已省略】'; _vOver = 0; }
                        }
                    }
                } catch (e) {}
                return _full;
            }
        } catch (e) { /* 完整上下文构建异常时降级走正常路径 */ }
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
                // 【400 修复】丢弃历史里 400 自愈时插入的重建提示语（否则会反复堆积并再次触发 400）
                (m.role === 'user' && typeof m.content === 'string' &&
                 /^\（系统自动恢复/.test(m.content)) ||
                (m.role === 'user' && typeof m.content === 'string' &&
                 /^（系统自动恢复/.test(m.content)) ||
                // 【400 修复】content 含孤立 Unicode 代理项（半截 emoji/私用区字符）的消息整条丢弃：
                // 400 "surrogates not allowed / invalid" 的主要来源，一条坏字符毁掉整个请求
                (function(){ try { return typeof m.content === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(m.content); } catch(e){ return false; } })() ||
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
                    // 第一条用户消息不进 220 字记忆摘要（其完整原文会在下方轮次保留区内完整发送）
                    if (old.role === 'user' && k === userIndexes[0]) continue;
                    memoryLines.push((old.role === 'user' ? '用户：' : '历史结果：') + content.slice(0, 220));
                }
            }
            if (memoryLines.length) {
                result.push({
                    role: 'system',
                    content: '以下是本对话在重启前保存的早期任务记忆，仅用于延续上下文。优先继续尚未完成的用户任务，不要重复已经完成的工作：\n' + memoryLines.join('\n')
                });
            }
            // 第一条用户消息若已被划出轮次保留区，以完整原文注入（用户第一次提问永远不截断）
            if (userIndexes.length && userIndexes[0] < keepFrom) {
                var firstMsg = filtered[userIndexes[0]];
                var firstContent = (firstMsg.content === null || firstMsg.content === undefined) ? '' : String(firstMsg.content).trim();
                if (firstContent) {
                    result.push({
                        role: 'user',
                        content: '【本对话最早的用户提问（完整原文，未截断）】\n' + firstContent
                    });
                }
            }
        }

        for (var n = keepFrom; n < filtered.length; n++) {
            var current = filtered[n];
            var currentContent = (current.content === null || current.content === undefined) ? '' : String(current.content);
            if (current.role === 'assistant' && !current.tool_calls && currentContent.length > maxAssistantChars) {
                currentContent = currentContent.slice(0, maxAssistantChars) + '\n[较早回复已压缩]';
            }
            // 超长用户消息截取：保留开头关键内容，尾部保留少量，中间折叠，保证长期留存不撑爆上下文
            // （第一条用户消息永远不截取：用户第一次提问是任务源头，必须完整传给模型）
            var isFirstUserMsg = (n === userIndexes[0]);
            if (current.role === 'user' && !isFirstUserMsg && currentContent.length > maxUserChars) {
                var keepHead = Math.floor(maxUserChars * 0.85);
                var keepTail = maxUserChars - keepHead;
                currentContent = currentContent.slice(0, keepHead) +
                    '\n\n[超长用户消息已截取：原文共 ' + currentContent.length + ' 字，此处省略中间部分]\n\n' +
                    currentContent.slice(currentContent.length - keepTail);
            }
            // 数组型 content（含识图图片 image_url parts）必须原样保留，否则图片会被 String() 序列化丢失
            if (current.role === 'user' && Array.isArray(current.content)) {
                // 【识图修复】不再在此处按 model.visionInput 提前剥离图片：
                // _agentLoop 发请求前会检测消息含图片且当前模型不支持识图 → 自动切换默认识图模型。
                // 若在这里剥掉，_agentLoop 永远检测不到图片，识图接管不会触发，模型收到的只是文字。
                // （无可用识图模型时 _agentLoop 会明确报错提示，比静默丢图更合理）
                result.push({ role: 'user', content: current.content });
                continue;
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

    // ===== 上下文缓存配置：从 /api/user-preferences 的 ctxCache 节读取，全部可通过 JSON 调整 =====
    _getCtxCacheConfig: function() {
        if (this._ctxCacheCfg) return this._ctxCacheCfg;
        var def = { longMsgExemptRounds: 20, longMsgExemptMaxChars: 100000, longMsgTruncateTo: 2000, verifyRoundMaxChars: 200000 };
        try {
            var cfg = (window.__USER_PREFERENCES__ && window.__USER_PREFERENCES__.ctxCache) || null;
            if (cfg) { for (var k in def) { if (typeof cfg[k] === 'number' && cfg[k] > 0) def[k] = cfg[k]; } }
        } catch (e) {}
        this._ctxCacheCfg = def;
        return def;
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

            // A: 上下文处理（上轮工具结果 + 历史答案 合并一排，三个按钮同时作用于两个功能）
            wrap.appendChild(buildRow('上下文处理：', chat._compressMode || chat._historyMode, [
                { id: 'truncate', name: '截断', tip: '上一轮工具结果全丢只保留对话消息；历史答案仅保留最近1条AI回复，其余替换为占位提示' },
                { id: 'minimal', name: '极简保留', tip: '工具结果压缩为<2000字注入；历史答案最近1条全保留，其余每条截断至约500字' },
                { id: 'full', name: '全保留', tip: '完整保留上一轮工具结果和所有历史AI回复' }
            ], function(id) {
                chat._compressMode = id;
                chat._historyMode = id;
                self._saveCompressMode(id, chat);
                self._saveHistoryMode(id, chat);
                Store.addLog('info', chat.id, 'compress-mode', '用户选择上下文处理档位: ' + id + '（同时作用于工具结果和历史答案）');
            }));

            // C+D: 三个操作按钮：验证 / 保存git / 撤销本步
            (function() {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:3px 0;flex-wrap:wrap;';
                var lbl = document.createElement('span');
                lbl.textContent = '结果增强：';
                lbl.title = '结果增强操作：验证 / 保存git / 撤销';
                lbl.style.cssText = 'opacity:.75;white-space:nowrap;flex:0 0 auto;';
                row.appendChild(lbl);
                var btns = document.createElement('span');
                btns.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:auto;flex:0 0 auto;flex-wrap:wrap;';
                row.appendChild(btns);
                var actions = [
                    { id: 'verify', name: '验证', tip: '验证之前一次的任务：立即与 AI 再通话一轮，要求检查 bug 并确认彻底完成' },
                    { id: 'save-step', name: '保存git', tip: '保存本步：先 git add -A + commit，再由大模型总结本步工作并沉淀到 MD 日志（追加写入）' },
                    { id: 'undo-step', name: '撤销', tip: '撤销本次的更改：git 回退到最后一次「保存」之前，所有文件改动一键零成本撤销' }
                ];
                actions.forEach(function(o) {
                    var btn = document.createElement('button');
                    btn.textContent = o.name;
                    btn.title = o.tip;
                    var _normalCss = 'cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:12px;';
                    var _activeCss = 'cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid #4da3ff;background:rgba(77,163,255,.25);color:#7fc0ff;font-size:12px;font-weight:bold;box-shadow:0 0 6px rgba(77,163,255,.5);';
                    if (chat && chat._activeAction === o.id) btn.style.cssText = _activeCss;
                    else btn.style.cssText = _normalCss;
                    if (o.disabled) {
                        btn.disabled = true;
                        btn.style.cssText = 'cursor:not-allowed;padding:3px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:transparent;color:rgba(255,255,255,.35);font-size:12px;';
                        btns.appendChild(btn);
                        return;
                    }
                    btn.style.cssText = 'cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:12px;';
                    btn.onclick = function() {
                        if (o.id === 'save-step') {
                            self._postStepAction(box, chat, 'git_save_step', {}, '保存本步');
                        } else if (o.id === 'undo-step') {
                            var _doUndo = function() {
                                self._postStepAction(box, chat, 'undo_step', {}, '撤销');
                            };
                            var _cancelUndo = function() {
                                Store.addLog('info', chat.id, 'undo-step', '用户取消撤销');
                            };
                            // 【改】使用系统自定义确认弹窗（App._confirmDialog），替代浏览器原生 confirm
                            if (window.App && typeof App._confirmDialog === 'function') {
                                App._confirmDialog({
                                    title: '确认撤销本次更改？',
                                    icon: '↩️',
                                    confirmText: '撤销',
                                    html: '<p>将安全回退最后一次「保存」的改动（脏工作区自动 stash 保护，后续提交用 revert 反向回退，<b>不删历史</b>）。</p>' +
                                          '<p style="color:#f57c00;">⚠️ 回退后如需找回，可让 AI 通过时间线工具（timeline）查询回滚点。</p>'
                                }).then(function(ok) { ok ? _doUndo() : _cancelUndo(); });
                            } else if (window.confirm('撤销：将安全回退最后一次「保存」的改动（revert/stash，不删历史），确认继续？')) {
                                _doUndo();
                            } else {
                                _cancelUndo();
                            }
                        } else if (o.id === 'verify') {
                            // 取最近一条 AI 回复作为"上一次的工作内容"
                            var _lastAssistant = '';
                            var _lastRealUserQ = '';
                            for (var _vi = chat.history.length - 1; _vi >= 0; _vi--) {
                                var _vh = chat.history[_vi];
                                if (!_vh) continue;
                                if (_vh.role === 'assistant' && !_vh._meta && !_lastAssistant) _lastAssistant = _vh.content || '';
                                if (_vh.role === 'user' && !_vh._guardInject && !_vh._verifyRound && !_vh._continueRound && !_lastRealUserQ) {
                                    _lastRealUserQ = _vh.content || '';
                                }
                                if (_lastAssistant && _lastRealUserQ) break;
                            }
                            // 【修复】AI 上次回复如果是守卫提示触发的，把真实用户提问拼进验证内容，保证验证有据可依
                            if (_lastRealUserQ) {
                                _lastAssistant = '用户的问题是：' + String(_lastRealUserQ).replace(/\s+/g, ' ').trim().slice(0, 400) + '\n\nAI 上次回复：' + _lastAssistant;
                            }
                            if (_lastAssistant) {
                                try { self._onSendComplete && self._onSendComplete(box, chat); } catch (e) {}
                                self.triggerVerifyRound(box, chat, _lastAssistant);
                            } else {
                                Store.addLog('warn', chat.id, 'verify-round', '没有可验证的 AI 回复');
                                // 【改】使用系统自定义提示弹窗替代浏览器原生 alert
                                if (window.App && typeof App._confirmDialog === 'function') {
                                    App._confirmDialog({
                                        title: '无法验证',
                                        icon: 'ℹ️',
                                        confirmText: '知道了',
                                        cancelText: '',
                                        html: '<p>没有可验证的 AI 回复，请先让 AI 完成一轮工作。</p>'
                                    });
                                } else {
                                    window.alert('没有可验证的 AI 回复，请先让 AI 完成一轮工作。');
                                }
                                return;
                            }
                        }
                        Store.addLog('info', chat.id, 'step-action', '用户点击按钮: ' + o.id);
                        // 高亮当前点击的按钮（记录到 chat，切换对话后仍保留）
                        try {
                            if (chat) chat._activeAction = o.id;
                            Array.prototype.forEach.call(btns.children, function(b) {
                                if (b._actionId === o.id) b.style.cssText = _activeCss;
                                else b.style.cssText = _normalCss;
                            });
                        } catch (e) {}
                    };
                    btn._actionId = o.id;
                    btns.appendChild(btn);
                });
                wrap.appendChild(row);
            })();

            // 二次验证成功过的任务：重建按钮行后补回「✓ 已验证」+ 第二排「查看验证结果」按钮
            // （此前该按钮只在验证轮成功那一刻动态插入，刷新/重开对话后 renderCompressSelector 重建按钮行就丢了）
            try {
                var _lastAssistant = null;
                for (var _hi = chat.history.length - 1; _hi >= 0; _hi--) {
                    if (chat.history[_hi] && chat.history[_hi].role === 'assistant') { _lastAssistant = chat.history[_hi]; break; }
                }
                if ((_lastAssistant && typeof _lastAssistant.content === 'string' &&
                    _lastAssistant.content.indexOf('二次验证成功') >= 0 ||
                    chat._verifiedOnce) &&
                    typeof self._markVerifyButton === 'function') {
                    body.appendChild(wrap);
                    self._markVerifyButton(box);
                    return;
                }
            } catch (_ve) {}

            body.appendChild(wrap);
        } catch (e) {}
    },

    // ===== 保存技能：收集信息 → 调用后端 save_skill 工具 =====
    _saveSkillFlow: function(box, chat) {
        var self = this;
        var _pid = chat && chat.projectId || (Store.data && Store.data.activeProjectId) || '';
        var defaultPrompt = '';
        // 取最近一条 AI 回复作为默认提示词内容（可自行修改）
        try {
            for (var i = chat.history.length - 1; i >= 0; i--) {
                var h = chat.history[i];
                if (h && h.role === 'assistant' && !h._meta && h.content) { defaultPrompt = h.content; break; }
            }
        } catch (e) {}
        var sid = window.prompt('技能英文标识（id，如 code_review）：');
        if (!sid) return;
        sid = String(sid).trim().replace(/\s+/g, '_');
        var name = window.prompt('技能显示名：', sid);
        if (name === null) return;
        var desc = window.prompt('一句话描述（可留空）：', '');
        if (desc === null) return;
        var trg = window.prompt('触发关键词（逗号分隔，可留空）：', name || sid);
        if (trg === null) return;
        var promptText = window.prompt('技能提示词正文（prompt.md 内容）：', defaultPrompt.slice(0, 4000));
        if (!promptText) return;
        var triggers = trg.split(/[,，]/).map(function(s) { return s.trim(); }).filter(Boolean);
        self._postStepAction(box, chat, 'save_skill', {
            id: sid, name: name, description: desc, prompt: promptText, triggers: triggers
        }, '保存技能');
        try { Store.addLog('info', _pid, 'save-skill', '保存技能: ' + sid); } catch (e) {}
    },

    // ===== 自定义 Toast 提示（不用 window.alert）=====
    _stepToast: function(text, ok) {
        try {
            // 提示音（WebAudio 生成，无需音频文件）
            try {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (AC) {
                    var ac = _stepToast._ac || (_stepToast._ac = new AC());
                    var notes = ok ? [880, 1174] : [440, 330]; // 成功上行两音 / 失败下行
                    notes.forEach(function(freq, i) {
                        var osc = ac.createOscillator(), g = ac.createGain();
                        osc.type = 'sine'; osc.frequency.value = freq;
                        g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.12);
                        g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + i * 0.12 + 0.02);
                        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.12 + 0.18);
                        osc.connect(g); g.connect(ac.destination);
                        osc.start(ac.currentTime + i * 0.12); osc.stop(ac.currentTime + i * 0.12 + 0.2);
                    });
                }
            } catch (e) {}
            var el = document.createElement('div');
            el.className = 'toast-item';
            el.style.cssText = 'background:' + (ok ? 'rgba(34,197,94,0.92)' : 'rgba(192,57,43,0.92)') +
                ';color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;' +
                'box-shadow:0 4px 14px rgba(0,0,0,0.3);max-width:100%;word-break:break-all;';
            el.textContent = text;
            if (window.ToastStack) ToastStack.show(el, ok ? 3500 : 5000);
            else document.body.appendChild(el);
        } catch (e) { console.warn('[step-action] toast失败', e); }
    },

    // ===== 保存git成功后：让大模型总结本步工作，追加写入项目 MD 日志 =====
    _aiSummarizeStep: function(chat, saveRes) {
        var self = this;
        try {
            var _pid = chat && chat.projectId || (Store.data && Store.data.activeProjectId) || '';
            // 找项目路径
            var _projPath = '';
            var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (Store.data && Store.data.projects ? Store.data.projects : []);
            if (_projSrc && _pid) {
                for (var i = 0; i < _projSrc.length; i++) {
                    if (String(_projSrc[i].id) === String(_pid)) { _projPath = _projSrc[i].path || _projSrc[i].folder || ''; break; }
                }
            }
            // 取最近一条 AI 回复作为总结素材
            var _lastAi = '';
            if (chat && chat.history) {
                for (var j = chat.history.length - 1; j >= 0; j--) {
                    if (chat.history[j].role === 'assistant' && chat.history[j].content) { _lastAi = chat.history[j].content; break; }
                }
            }
            // 找当前对话模型
            var model = null;
            try { model = Models.get(chat.modelId); } catch (e) {}
            if (!model || !model.endpoint || !_lastAi) {
                Store.addLog('warn', chat.id, 'step-log', '大模型日志总结跳过：缺少模型配置或无AI回复');
                return;
            }
            var prompt = '你是项目日志管理员。以下是刚刚完成的本次工作内容（AI回复）和git提交信息。\n' +
                '请用中文总结本次做了什么：改动内容、涉及文件、结果。要求简洁（200字内）、避免冗余。\n' +
                '不要输出任何多余解释，只输出日志正文（Markdown 格式，以二级标题开头，标题含日期时间）。\n\n' +
                'git提交：' + (saveRes.commit || '') + '，步骤号：' + (saveRes.step || '') + '\n\n' +
                '本次AI回复内容：\n' + _lastAi.slice(0, 6000);
            var payload = {
                model: model.modelId || model.model || model.id || '',
                messages: [{ role: 'user', content: prompt }],
                stream: false, temperature: 0.3, max_tokens: 800
            };
            var headers = { 'Content-Type': 'application/json' };
            try { var _k = model.apiKey || model.key; if (_k) headers['Authorization'] = 'Bearer ' + _k; } catch (e) {}
            var useProxy = false;
            try { useProxy = /^https?:/.test(model.endpoint || '') && model.endpoint.indexOf(location.origin) !== 0; } catch (e) { useProxy = true; }
            var url = useProxy ? '/api/proxy' : model.endpoint;
            if (useProxy) payload = { _target_url: model.endpoint, _method: 'POST', _headers: headers, _body: payload };
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 120000;
            xhr.onload = function() {
                var summary = '';
                try {
                    var r = JSON.parse(xhr.responseText || '{}');
                    summary = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || r.content || '';
                } catch (e) {}
                summary = String(summary || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                if (!summary) { Store.addLog('warn', chat.id, 'step-log', '日志总结失败：模型返回为空'); return; }
                // 交给后端追加写入 MD 日志（有则追加、无则创建，不替换）
                try {
                    var x2 = new XMLHttpRequest();
                    x2.open('POST', '/api/tools/append_worklog_md', true);
                    x2.setRequestHeader('Content-Type', 'application/json');
                    x2.onload = function() {
                        var ok2 = false, info = '';
                        try { var r2 = JSON.parse(x2.responseText || '{}'); ok2 = !!r2.ok; info = r2.log_file || r2.error || ''; } catch (e) {}
                        Store.addLog(ok2 ? 'info' : 'error', chat.id, 'step-log', ok2 ? '工作日志已沉淀: ' + info : '工作日志写入失败: ' + info);
                    };
                    x2.send(JSON.stringify({ path: _projPath, summary: summary, step: saveRes.step || '', commit: saveRes.commit || '' }));
                } catch (e) { Store.addLog('error', chat.id, 'step-log', '日志写入请求异常: ' + e.message); }
            };
            xhr.onerror = function() { Store.addLog('warn', chat.id, 'step-log', '日志总结请求失败（网络错误）'); };
            xhr.send(JSON.stringify(payload));
        } catch (e) { console.warn('[step-action] 日志总结异常', e); }
    },

    // ===== 保存/撤销：调用后端工具接口 =====
    _postStepAction: function(box, chat, toolName, extraBody, label) {
        var self = this;
        var _pid = chat && chat.projectId || (Store.data && Store.data.activeProjectId) || '';
        var body = extraBody || {};
        if (_pid) body.path = '';
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/tools/' + toolName, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 60000;
            xhr.onload = function() {
                var res = {};
                try { res = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
                if (xhr.status === 200 && res.ok) {
                    var msg = label + '成功';
                    if (toolName === 'git_save_step') {
                        msg += (res.nothing_to_commit ? '（无文件改动，已记录步骤 ' + res.step + '）' : '，提交 ' + (res.commit || '') + '，步骤 ' + res.step);
                    } else if (toolName === 'undo_step') {
                        msg += '：已撤销步骤 ' + res.undone_step + '（' + (res.undone_message || '') + '），当前 HEAD ' + (res.head_now || '');
                    }
                    Store.addLog('info', chat.id, 'step-action', msg);
                    self._stepToast(msg, true);
                    // 保存git成功后：让大模型总结本步工作并沉淀 MD 日志
                    if (toolName === 'git_save_step') self._aiSummarizeStep(chat, res);
                } else {
                    var err = label + '失败: ' + (res.error || ('HTTP ' + xhr.status));
                    Store.addLog('error', chat.id, 'step-action', err);
                    self._stepToast(err, false);
                }
                try { self._onSendComplete && self._onSendComplete(box, chat); } catch (e) {}
            };
            xhr.onerror = function() {
                var err = label + '请求失败（网络错误）';
                Store.addLog('error', chat.id, 'step-action', err);
                self._stepToast(err, false);
            };
            xhr.send(JSON.stringify(body));
        } catch (e) {
            Store.addLog('error', chat.id, 'step-action', label + '异常: ' + e.message);
        }
    },

    // ===== 继续轮触发：隐形发送"确认项目路径 + 继续工作"，与验证轮同机制（不进入用户问题） =====
    triggerContinueRound: function(box, chat) {
        var self = this;
        if (chat.isSending || chat._verifyActive) return;
        var _projPath = '';
        var _pid = chat.projectId;
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        var _contMsg = { role: 'user', content: '当前项目路径：' + (_projPath || '（未关联项目目录）') + '\n\n请确认项目路径无误，然后继续工作，彻底完成未完成的任务。', _verifyRound: true, _continueRound: true };
        chat.history.push(_contMsg);
        Store.addLog('info', chat.id, 'continue-round', '继续选项已触发，隐形发送继续工作消息');
        chat._verifyActive = true; // 复用验证轮机制：结束后不再二次触发
        chat._verifyBubbleShown = false; // 新一轮开始，允许本轮问题气泡（带「查看答案」按钮）重新渲染
        setTimeout(function() {
            if (chat._stopped) return;
            self.sendToModel(box, chat);
        }, 600);
    },

    // ===== 结果验证（第二轮验证）触发：构建验证消息并立即发送 =====
    // lastWork: 上一次 AI 的工作内容摘要；_verifyActive 防死循环，验证轮自身结束不再二次验证
    triggerVerifyRound: function(box, chat, lastWork) {
        var self = this;
        if (chat.isSending || chat._verifyActive) return; // 正在发送中或已在验证轮，不重复触发
        var _projPath = '';
        var _pid = chat.projectId;
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        var _verifyMsg = { role: 'user', content: '当前项目路径：' + (_projPath || '（未关联项目目录）') + '\n\n你上一次的工作内容是：' + String(lastWork || '').replace(/\s+/g, ' ').trim().slice(0, 500) + '\n\n你确认做好了吗？检查一下bug，然后确认无误，彻底完成任务。', _verifyRound: true };
        chat.history.push(_verifyMsg);
        Store.addLog('info', chat.id, 'verify-round', '结果验证已开启，自动发送第二轮验证消息');
        chat._verifyActive = true;
        chat._verifyRoundActive = true; // 【修复】持久标记：本次发送是真正的验证轮（区别于继续轮）
        try { self._setVerifyInProgress(box); } catch (e) {}
        setTimeout(function() {
            if (chat._stopped) return;
            self.sendToModel(box, chat);
        }, 600);
    },

    // ===== 验证轮进行中：把「验证」按钮变为蓝色「⏳ 验证中…」并禁用 =====
    _setVerifyInProgress: function(box) {
        try {
            box.querySelectorAll('button').forEach(function(_b) {
                if (_b.textContent.trim() === '验证' || _b.textContent.indexOf('验证中') >= 0) {
                    _b.textContent = '⏳ 验证中…';
                    _b.disabled = true;
                    _b.style.borderColor = 'rgba(77,163,255,.65)';
                    _b.style.color = '#7fc0ff';
                    _b.style.background = 'rgba(77,163,255,.12)';
                    _b.style.cursor = 'wait';
                    _b.title = '验证正在进行中，请稍候';
                }
            });
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
            // 重置循环预警状态：每次用户新发送都是新的任务轮
            chat._loopWarned = false;
            chat._loopWarnDepth = 0;
            delete chat._loopEscalated;
            App._loopSignatures = App._loopSignatures || {};
            App._loopSignatures[chat.id] = [];
            chat._stopped = false;
            // ===== 结果验证：本次发送是否为验证轮 =====
            // 【修复】验证轮判定改用持久标记 _verifyRoundActive（由 triggerVerifyRound/triggerContinueRound 置位），
            // 不再单纯依赖"最后一条用户消息"的临时标记——中途被守卫注入/问题队列插入普通 user 消息时不会误清除。
            var _lastUserMsg = null;
            for (var _vi = chat.history.length - 1; _vi >= 0; _vi--) {
                if (chat.history[_vi] && chat.history[_vi].role === 'user') { _lastUserMsg = chat.history[_vi]; break; }
            }
            if (_lastUserMsg && (_lastUserMsg._verifyRound || _lastUserMsg._guardInject || _lastUserMsg._maxDepthRecovery || _lastUserMsg._continueRound)) {
                // 验证/继续/守卫/恢复类隐形消息：保留 trigger 阶段设置的持久标记
                if (_lastUserMsg._continueRound) chat._verifyRoundActive = false; // 继续轮不算验证
                chat._verifyActive = true;
            } else {
                // 真实用户新输入：清除标记，走普通任务通道
                chat._verifyActive = false;
                chat._verifyRoundActive = false;
            }
            // 【2026 修复】把"本轮是否验证轮"在发送开始时快照到 _roundWasVerify：
            // 即使验证轮进行中用户又发了消息导致 _verifyActive/_verifyRoundActive 被清，
            // 任务结束时的金框判定仍以本轮开始时的快照为准，避免明明验证了却显示绿色。
            chat._roundWasVerify = !!chat._verifyRoundActive;
            // 验证/继续轮的用户消息渲染为正常用户气泡（带「查看答案」按钮）
            if (chat._verifyActive && !chat._verifyBubbleShown) {
                chat._verifyBubbleShown = true;
                var _vTxt = String(chat.history[chat.history.length - 1].content || '');
                this.addMsg(box, _vTxt, 'user', chat.modelId);
                Store.addMessage(box.id, 'user', _vTxt);
            }
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
                if (!auto) auto = Models.list.find(function(m){ return m && m.key && _isChatModel(m); });
                function _isChatModel(m){ var t = String((m && m.modelType) || '').toLowerCase(); return !m.imageGen && (t === 'language' || t === 'speech' || t === 'audio' || t === 'omni'); }
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
            // 豁免：① 第一轮（第一条用户消息）永远不截断；② 上下文轮数 ≤ 20 轮内不截断；超过 20 轮后才启用截断
            // 只改注入副本，chat.history 原始数据不动；截断时附加提示让模型知道有省略
            var _uIdx = messages.length - 1;
            var _uCount = 0; // 历史中的用户消息条数（即上下文轮数）
            for (var _hi = 0; _hi < chat.history.length; _hi++) {
                if (chat.history[_hi] && chat.history[_hi].role === 'user') _uCount++;
            }
            for (var _ui = messages.length - 1; _ui >= 0; _ui--) {
                if (messages[_ui] && messages[_ui].role === 'user' && messages[_ui].content) { _uIdx = _ui; break; }
            }
            // _uCount 为 1 表示这是第一条用户消息（第一轮），永远不截断
            // _uCount > 20 表示来回对话已超过 20 轮，此时才对超长消息启用截断
            var _cfg = self._getCtxCacheConfig();
            if (_uCount > _cfg.longMsgExemptRounds && messages[_uIdx] && messages[_uIdx].role === 'user') {
                var _uTxt = String(messages[_uIdx].content || '');
                if (_uTxt.length > _cfg.longMsgTruncateTo) {
                    messages[_uIdx] = { role: 'user', content: _uTxt.slice(0, _cfg.longMsgTruncateTo) + '\n\n【提示】你的消息超过 ' + _cfg.longMsgTruncateTo + ' 字，已被自动截断，仅保留前 ' + _cfg.longMsgTruncateTo + ' 字。如需完整内容请分段发送。' };
                }
            }
            // ===== 豁免区总字符上限（JSON 可配：ctxCache.longMsgExemptMaxChars，默认 10 万）=====，超出从最旧开始截
            try {
                var _firstUserIdx = -1;
                for (var _fi = 0; _fi < messages.length; _fi++) { if (messages[_fi] && messages[_fi].role === 'user') { _firstUserIdx = _fi; break; } }
                if (_firstUserIdx >= 0) {
                    var _totalChars = 0;
                    for (var _ti = _firstUserIdx; _ti < messages.length; _ti++) _totalChars += String(messages[_ti] && messages[_ti].content || '').length;
                    if (_totalChars > _cfg.longMsgExemptMaxChars) {
                        var _over = _totalChars - _cfg.longMsgExemptMaxChars;
                        for (var _oi = _firstUserIdx; _oi < messages.length && _over > 0; _oi++) {
                            var _oc = messages[_oi]; if (!_oc || !_oc.content) continue;
                            var _cl = String(_oc.content).length;
                            if (_cl <= _over) { _over -= _cl; _oc.content = _oc.role === 'user' ? '【提示】此条较早消息过长，已整体省略以控制上下文长度。' : ''; }
                            else { _oc.content = String(_oc.content).slice(0, _cl - _over) + '\n…【前段已省略以控制上下文长度】'; _over = 0; }
                        }
                    }
                }
            } catch (e) {}

            // ===== 三档压缩模式（用户手选）：截断 / 极简保留 / 全保留，控制上一轮工具结果注入 =====
            var _ctxExtra = self._applyCompressMode(chat);
            if (_ctxExtra) messages = messages.concat(_ctxExtra);

            // ===== 请求末尾注入动态内容（保护稳定前缀 → 提升 prompt cache 命中） =====
            if (chat._extSkillPrompt) {
                messages.push({ role: 'system', content: '【技能激活】\n' + chat._extSkillPrompt });
            }
            try {
                var _dynMsg = (window.Tools && Tools.getDynamicContextMessage) ? Tools.getDynamicContextMessage(chat.id) : '';
                if (_dynMsg) messages.push({ role: 'system', content: _dynMsg });
            } catch (e) {}

            // ===== 初始化深度进度提示标记（每 30 步出现一次：30/60/90...） =====
            chat._depthNoticeStep = 0;
            // ===== 初始化 token 统计 =====
            chat._tokenCount = 0;
            chat._statsShown = false; // 本轮统计只显示一次：显示过后不再重复显示「单条/总共」
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
            // 【修复】跳过守卫注入消息(_guardInject/巡查报告前缀)和验证/继续轮，避免守卫守护后任务文本被污染
            for (var taskIndex = chat.history.length - 1; taskIndex >= 0; taskIndex--) {
                var _th = chat.history[taskIndex];
                if (_th.role === 'user' && !_th._maxDepthRecovery && !_th._guardInject && !_th._verifyRound && !_th._continueRound && String(_th.content || '').indexOf('🐕【小狗守卫巡查报告】') !== 0) {
                    chat._activeTaskText = _th.content || '';
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
            var nextMessages = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }].concat(this._buildContext(chat.history, model, chat));
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
            var mid = String((model && (model.modelId || model.id || '')) || '').toLowerCase();
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
