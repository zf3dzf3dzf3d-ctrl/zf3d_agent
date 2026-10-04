
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  _dlgAlert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

// ==== 消息内容统一取文本：content 可能是字符串，也可能是数组（多模态/粘贴块消息），
// 直接 String() 会得到 "[object Object]"，导致素材包/守卫等把用户输入序列化丢失。
function _msgText(m) {
    if (!m) return '';
    var c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
        var parts = [];
        for (var i = 0; i < c.length; i++) {
            var p = c[i];
            if (typeof p === 'string') parts.push(p);
            else if (p && typeof p === 'object') {
                if (typeof p.text === 'string') parts.push(p.text);
                else if (typeof p.content === 'string') parts.push(p.content);
            }
        }
        return parts.join('\n');
    }
    if (c && typeof c === 'object' && typeof c.text === 'string') return c.text;
    return c == null ? '' : String(c);
}

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
        // 【任务meta剥离】⏱__TASKMETA__ 消息仅为前端恢复耗时行/撤销按钮用，绝不进模型上下文
        try {
            if (Array.isArray(history) && history.some(function(_hm) { return _hm && _hm.role === 'assistant' && typeof _hm.content === 'string' && _hm.content.indexOf('\u23F1__TASKMETA__') === 0; })) {
                history = history.filter(function(_hm) { return !(_hm && _hm.role === 'assistant' && typeof _hm.content === 'string' && _hm.content.indexOf('\u23F1__TASKMETA__') === 0); });
            }
        } catch (e) {}
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
                    var _vc = _msgText(_vm);
                    if (!(_vm._thinking || _vm._maxDepthRecovery)) _full.push({ role: _vm.role, content: _vc });
                }
                // 验证轮总量上限（JSON 可配：ctxCache.verifyRoundMaxChars，默认 20 万字），超出从最旧开始截
                try {
                    var _vCfg = self._getCtxCacheConfig ? self._getCtxCacheConfig() : { verifyRoundMaxChars: 200000 };
                    var _vTotal = 0;
                    for (var _vj = 0; _vj < _full.length; _vj++) _vTotal += _msgText(_full[_vj]).length;
                    if (_vTotal > _vCfg.verifyRoundMaxChars) {
                        var _vOver = _vTotal - _vCfg.verifyRoundMaxChars;
                        for (var _vk = 0; _vk < _full.length && _vOver > 0; _vk++) {
                            var _vl = _msgText(_full[_vk]).length;
                            if (_vl <= _vOver) { _vOver -= _vl; _full[_vk].content = _full[_vk].role === 'user' ? '【提示】此条较早消息过长，已整体省略。' : ''; }
                            else { _full[_vk].content = _msgText(_full[_vk]).slice(0, _vl - _vOver) + '\n…【前段已省略】'; _vOver = 0; }
                        }
                    }
                } catch (e) {}
                return _full;
            }
        } catch (e) { /* 完整上下文构建异常时降级走正常路径 */ }
        // Keep the live exchange compact, but retain a bounded restart brief from older saved messages.
        // GPT/DeepSeek 默认保留较少轮次，减少重复历史带来的输入成本。
        var modelId = String((model && (model.modelId || model.name)) || '').toLowerCase();
        var defaultRounds = modelId.indexOf('deepseek') >= 0 ? 4 : 6;
        var configuredRounds = model && model.body ? parseInt(model.body.context_rounds, 10) : NaN;
        var contextRounds = isFinite(configuredRounds) ? configuredRounds : defaultRounds;
        contextRounds = Math.max(1, Math.min(12, contextRounds));
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
                var content = _msgText(old).replace(/\s+/g, ' ').trim();
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
                var firstContent = (firstMsg.content === null || firstMsg.content === undefined) ? '' : _msgText(firstMsg).trim();
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
            var currentContent = (current.content === null || current.content === undefined) ? '' : _msgText(current);
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
        // ===== 缓存优化：历史 user 消息里的【当前项目上下文】含 cwd/选中文件等易变内容，
        // 一旦变化，从该消息起整个前缀缓存失效。这里把历史消息中的上下文块替换为稳定
        // 占位文本；只保留最后一个含上下文的 user 消息（它承载最新上下文，且天然在动态尾部）。
        try {
            // 贪婪匹配：从标记起截到注入端固定结束标记（---上下文结束---）、
            // 其他已知标记或消息末尾，避免懒惰匹配误吞正文或残留半截上下文
            // 【v8 上下文后置】新格式：上下文块在消息【末尾】（用户正文在前）。
            // 正则同时兼容旧前缀格式与新的尾部格式，endIdx 无边界时落到 $（消息末尾）
            var _ctxRe = /【当前项目上下文】[\s\S]*?(?:\n---上下文结束---|\n【用户划选的文本】|\n【超长计划提醒】|\n【用户当前选中的画布节点】|$)/;
            var _lastCtxIdx = -1;
            for (var _hi = result.length - 1; _hi >= 0; _hi--) {
                var _hm0 = result[_hi];
                if (_hm0 && _hm0.role === 'user' && typeof _hm0.content === 'string' && _hm0.content.indexOf('【当前项目上下文】') !== -1) { _lastCtxIdx = _hi; break; }
            }
            for (var _hi2 = 0; _hi2 < result.length; _hi2++) {
                if (_hi2 === _lastCtxIdx) continue;
                var _hm = result[_hi2];
                if (_hm && _hm.role === 'user' && typeof _hm.content === 'string' && _hm.content.indexOf('【当前项目上下文】') !== -1) {
                    _hm.content = _hm.content.replace(_ctxRe, '【当前项目上下文】（历史上下文已省略，最新项目/目录信息见最后一条消息）\n');
                }
            }
        } catch (e) {}
        // ===== 【P0 缓存优化】剔除历史中残留的【动态状态】system 消息 =====
        // 该消息由 tools-03-system-prompt.js 每次请求在末尾重新注入（当前模式/档位等易变内容），
        // 若随历史持久化会残留在消息流中段，每次内容变化都会击穿其后整个前缀缓存。
        // 历史中的直接丢弃，信息由末尾新注入的恢复，无损失。
        var _finalResult = [];
        for (var ri = 0; ri < result.length; ri++) {
            var _rm = result[ri];
            if (_rm && _rm.role === 'system' && typeof _rm.content === 'string' && _rm.content.indexOf('【动态状态】') === 0) continue;
            _finalResult.push(_rm);
        }
        result = _finalResult;
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
        var def = { longMsgExemptRounds: 20, longMsgExemptMaxChars: 100000, longMsgTruncateTo: 6000, verifyRoundMaxChars: 200000 };
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
            // 【短对话放宽】对话轮数少（≤6 轮）且用户未手动指定档位时，上下文还很小，
            // 强行压缩反而丢信息导致重查重算，自动升级为全保留
            var roundCount = (chat && Array.isArray(chat.history)) ? chat.history.filter(function(m){ return m && m.role === 'user'; }).length : 0;
            if (roundCount <= 6 && !chat._compressMode && mode === 'minimal') {
                mode = 'full';
            }
            if (mode === 'truncate') {
                // 1 截断：上一轮工具结果全丢
                return [{ role: 'system', content: '【上下文压缩】用户选择了"截断"模式：上一轮任务的工具结果已全部丢弃，仅保留对话消息本身。如需原始数据请重新调用工具获取。' }];
            }
            if (mode === 'minimal') {
                // 2 极简保留：上一轮工具结果压缩为 <2000 字摘要注入
                var parts = [];
                var total = 0;
                for (var i = lastTools.length - 1; i >= 0 && total < 2000; i--) {
                    var c = _msgText(lastTools[i]);
                    var excerpt = c.length > 300 ? (c.slice(0, 200) + '…' + c.slice(-80)) : c;
                    parts.unshift('[' + lastTools[i].tool + '] ' + excerpt);
                    total += excerpt.length;
                }
                return [{ role: 'system', content: '【上下文压缩-极简保留】以下是上一轮任务工具结果的压缩摘要（全文已丢弃，需要详情请重新调用工具）：\n' + parts.join('\n') + this._buildRoundBriefsSuffix(chat) }];
            }
            // 3 全保留：完整注入上一轮工具结果
            var full = [];
            for (var j = 0; j < lastTools.length; j++) {
                full.push('[' + lastTools[j].tool + ']\n' + _msgText(lastTools[j]).slice(0, 6000));
            }
            return [{ role: 'system', content: '【上一轮任务工具结果（全保留模式）】\n' + full.join('\n\n') }];
        } catch (e) { return null; }
    },

    // 【重启记忆增强】生成历史各轮工具结果摘要后缀（追加到极简注入末尾，总预算 1200 字）
    _buildRoundBriefsSuffix: function(chat) {
        try {
            var briefs = (chat && Array.isArray(chat._roundToolBriefs)) ? chat._roundToolBriefs : [];
            if (!briefs.length) return '';
            var lines = [], total = 0;
            for (var i = briefs.length - 1; i >= 0 && total < 1200; i--) {
                var b = briefs[i];
                if (!b || !b.brief) continue;
                lines.unshift('\u7b2c' + b.round + '\u8f6e: ' + b.brief);
                total += b.brief.length + 12;
            }
            if (!lines.length) return '';
            return '\n\u3010\u66f4\u65e9\u8f6e\u6b21\u5de5\u5177\u7ed3\u679c\u6458\u8981\uff08\u91cd\u542f\u524d\u5f52\u6863\uff0c\u4ec5\u4f9b\u5ef6\u7eed\u4e0a\u4e0b\u6587\uff09\u3011\n' + lines.join('\n');
        } catch (e) { return ''; }
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
    // ===== 剔除一条 user 消息文本中的上下文块（行级解析，杜绝正则懒惰匹配吞正文）=====
    // 结束边界（按优先级）：---上下文结束--- 标记（新消息）/【用户划选的文本】等其他注入标记 / 旧消息中上下文块后的空行
    // 返回占位文本；找不到任何可靠边界时保守起见返回原文不动（宁可缓存不优化，不丢用户正文）
    _stripContextBlock: function(text) {
        var lines = text.split('\n');
        if (lines.length && lines[0].indexOf('【当前项目上下文】') === 0) {
            // 旧前缀格式：按原逻辑找边界
        } else {
            // 【v8 上下文后置】新格式：上下文块在消息末尾。从标记行开始截到结束标记为止
            var st = -1;
            for (var s = 0; s < lines.length; s++) {
                if (lines[s].indexOf('【当前项目上下文】') === 0) { st = s; break; }
            }
            if (st === -1) return text; // 无上下文块
            var head = lines.slice(0, st).join('\n').replace(/\n+$/, '');
            return (head ? head + '\n' : '') + '【当前项目上下文】（历史上下文已省略，最新项目/目录信息见最后一条消息）';
        }
        var endIdx = -1;
        for (var i = 1; i < lines.length; i++) {
            var ln = lines[i];
            if (ln.indexOf('---上下文结束---') === 0 ||
                ln.indexOf('【用户划选的文本】') === 0 ||
                ln.indexOf('【超长计划提醒】') === 0 ||
                ln.indexOf('【用户当前选中的画布节点】') === 0) {
                endIdx = i;
                break;
            }
            // 旧格式消息兜底：上下文块内不会有空行，遇到空行即视为块结束
            if (ln.trim() === '') { endIdx = i; break; }
        }
        var tail;
        if (endIdx === -1) return text; // 无法定界，保守不动
        tail = lines.slice(endIdx).join('\n');
        // 去掉边界处的结束标记本身及多余空行
        if (tail.indexOf('---上下文结束---') === 0) {
            tail = tail.replace(/^---上下文结束---\s*\n\n?/, '');
        }
        tail = tail.replace(/^\n+/, '');
        return '【历史消息上下文已省略以优化缓存】\n' + tail;
    },

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
                    var c = _msgText(filtered[k]);
                    filtered[k].content = '【历史答案已截断】本轮次之前的 AI 回复（共' + c.length + '字）已按用户选择丢弃，如需查看历史结论请说明，或调用相关对话记录工具检索。';
                }
            } else if (mode === 'minimal') {
                // 2 极简保留：最近1条全保留，其余每条截断到约500字
                for (var j2 = 0; j2 < idx.length - 1; j2++) {
                    var k2 = idx[j2];
                    var c2 = _msgText(filtered[k2]);
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
            if (!body || !chat) return;
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
                        (curVal === o.id ? 'rgba(79,156,255,.18)' : 'transparent') + ';color:inherit;white-space:nowrap;font-size:11px;';
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
                row._btns = btns;
                return row;
            }

            // A: 上下文处理（上轮工具结果 + 历史答案 合并一排，三个按钮同时作用于两个功能）
            var ctxRow = buildRow('上下文处理：', chat._compressMode || chat._historyMode, [
                { id: 'truncate', name: '截断', tip: '上一轮工具结果全丢只保留对话消息；历史答案仅保留最近1条AI回复，其余替换为占位提示' },
                { id: 'minimal', name: '极简保留', tip: '工具结果压缩为<2000字注入；历史答案最近1条全保留，其余每条截断至约500字' },
                { id: 'full', name: '全保留', tip: '完整保留上一轮工具结果和所有历史AI回复' },
                { id: 'mega', name: '超长任务', tip: '原文一字不删全量归档，发给模型的是索引+最近3轮原文，细节用 archive_search/archive_load 取回；适合超级复杂长任务，默认不开启' }
            ], function(id) {
                chat._compressMode = id;
                chat._historyMode = id;
                self._saveCompressMode(id, chat);
                self._saveHistoryMode(id, chat);
                // 同步上游接口的 ctx_mode（设置面板已去掉挡位，由每对话选择驱动）
                try {
                    fetch('/api/agent/protocol', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ctx_mode: id })
                    }).catch(function () {});
                } catch (e) {}
                Store.addLog('info', chat.id, 'compress-mode', '用户选择上下文处理档位: ' + id + '（同时作用于工具结果和历史答案）');
            });
            ctxRow._btns.style.marginLeft = '0';
            ctxRow.style.justifyContent = 'space-between';

            // A2: 监督师开关：并入「上下文处理」一排，放最左（去掉🛡图标）
            (function() {
                var svBtn = document.createElement('button');
                svBtn.id = 'supervisor-toggle';
                svBtn.textContent = '监督';
                svBtn.title = '监督师（隐形哨兵）开关：开启后从下一轮对话开始生效，实时监督施工过程（范围外修改/批量删除/超长空转），只警报不打断。再点一次关闭。';
                var _svOnCss = 'cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid #f5a623;background:rgba(245,166,35,.25);color:#ffd28a;white-space:nowrap;font-size:11px;';
                // 与组内截断/极简保留按钮完全同款样式（buildRow 内按钮均为 padding:3px 10px + gap:6px），margin 清零，保证监督与截断间距一致
                svBtn.style.cssText = 'cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;white-space:nowrap;font-size:11px;margin:0;flex:0 0 auto;';
                var _svNormalCss = svBtn.style.cssText;
                // 与截断/极简保留/全保留同组插入（该组 gap:6px），放在「截断」左侧
                ctxRow._btns.insertBefore(svBtn, ctxRow._btns.firstChild);
                var _svOn = false;
                fetch('/api/supervisor').then(function(r){return r.json();}).then(function(j){
                    if (j && j.ok && j.enabled) { _svOn = true; svBtn.style.cssText = _svOnCss; }
                }).catch(function(){});
                svBtn.onclick = function() {
                    var turnOn = !_svOn;
                    fetch('/api/supervisor', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled: turnOn}) })
                        .then(function(r){return r.json();})
                        .then(function(j){
                            if (j && j.ok) {
                                _svOn = turnOn;
                                svBtn.style.cssText = turnOn ? _svOnCss : _svNormalCss;
                                try { self._stepToast(turnOn ? '🛡 监督师已开启：下轮对话起生效（只警报、不打断）' : '🛡 监督师已关闭：下轮起不再监督', turnOn); } catch(e) {}
                            }
                        }).catch(function(){});
                };
            })();

// C+D: 三个操作按钮：验证 / 保存git / 撤销本步
            (function() {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:6px;justify-content:center;margin:3px 0;flex-wrap:nowrap;align-items:center;';
                var lbl = document.createElement('span');
                lbl.textContent = '结果增强：';
                lbl.title = '结果增强操作：验证 / 保存git / 撤销';
                lbl.style.cssText = 'opacity:.75;white-space:nowrap;flex:0 0 auto;';
                row.appendChild(lbl);
                var btns = document.createElement('span');
                btns.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:auto;flex:1 1 auto;flex-wrap:nowrap;justify-content:flex-end;min-width:0;';
                row.appendChild(btns);
                var actions = [
                    { id: 'thinker-expand', name: '策划师', tip: '策划师：新开一个对话，附带首问源头+最近问答素材包，通过多轮追问帮你把问题扩展得更清晰、更有广度，最终以【策划师结论】输出，紫色箭头可一键回注原对话执行' },
                    { id: 'race-team', name: '施工队', tip: '施工队：协作开工（多窗共干一活、黑板分片认领），适合把计划派给 AI 分头施工' },
                    { id: 'obj-verify', name: '★审核员', tip: '★审核员：新开一个对话，附带前因后果、工具上下文、修改文件的前后对比（git diff）素材包，让新对话快速客观评价结果并修复 bug。重要问题建议全部开审核员：审核员发现的 bug 复制回原对话修复，做好后再让审核员复查，来回验证几轮，可保证任务 100% 完美完成' },
                    { id: 'summarizer', name: '总结师', tip: '总结师：任务完成后新开一个对话，精选注入任务目标+策划/审核结论+最终完成答复+项目树（不注入全量对话），沉淀可复用经验并落盘 private/记忆/总结-*.md，琥珀色箭头可把沉淀结论回注原对话' },
                    { id: 'verify', name: '自检', tip: '自检之前一次的任务：立即与 AI 再通话一轮，要求检查 bug 并确认彻底完成' }
                ];
                // 【撤销收边】撤销使用频率低，不再占常驻位：收进尾部「⋯」更多按钮
                actions.forEach(function(o) {
                    // 【自检隐藏】verify 按钮不再展示（审核员/自动轻量自检已覆盖其职责），减少用户选项；
                    // 验证轮内部逻辑（_markVerifyButton 等）保留不受影响
                    if (o.id === 'verify' && !(chat && chat._activeAction === 'verify')) return;
                    /* 【v5.5.0】施工队按钮本版本隐藏，以后再开发；点击逻辑（race-team 分支）保留不受影响 */
                    if (o.id === 'race-team') return;
                    var btn = document.createElement('button');
                    btn.textContent = o.name;
                    btn.title = o.tip;
                    /* 【派出角标修复】挂角色 key 后立即设 position:relative（角标 absolute 锚点），
                       并在下方每次重写 cssText 时保留它，否则角标会飘到外层容器右上角 */
                    if (o.id === 'thinker-expand' || o.id === 'obj-verify' || o.id === 'race-team') {
                        btn.setAttribute('data-spawn-role', ({ 'thinker-expand': '策划师', 'obj-verify': '审核员', 'race-team': '施工队' })[o.id]);
                        self._renderSpawnBadge(btn, chat);
                    }
                    var _normalCss = 'position:relative;cursor:pointer;padding:2px 9px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:11px;white-space:nowrap;flex:0 0 auto;text-align:center;';
                    var _activeCss = 'position:relative;cursor:pointer;padding:2px 9px;border-radius:10px;border:1px solid #4da3ff;background:rgba(77,163,255,.25);color:#7fc0ff;font-size:11px;font-weight:bold;box-shadow:0 0 6px rgba(77,163,255,.5);white-space:nowrap;flex:0 0 auto;text-align:center;';
                    if (chat && chat._activeAction === o.id) btn.style.cssText = _activeCss;
                    else btn.style.cssText = _normalCss;
                    if (o.disabled) {
                        btn.disabled = true;
                        btn.style.cssText = 'position:relative;cursor:not-allowed;padding:2px 9px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:rgba(255,255,255,.35);font-size:11px;white-space:nowrap;flex:0 0 auto;text-align:center;';
                        btns.appendChild(btn);
                        return;
                    }
                    btn.style.cssText = 'position:relative;cursor:pointer;padding:2px 9px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:11px;white-space:nowrap;flex:0 0 auto;text-align:center;';
                    /* ===== 监督师开关：审核员前隐形切换按钮，状态存服务端全局 ===== */
                    if (o.id === 'supervisor-toggle') {
                        var _normalCss = btn.style.cssText;
                        var _svOnCss = 'position:relative;cursor:pointer;padding:2px 9px;border-radius:10px;border:1px solid #f5a623;background:rgba(245,166,35,.25);color:#ffd28a;font-size:11px;font-weight:bold;box-shadow:0 0 6px rgba(245,166,35,.5);white-space:nowrap;flex:0 0 auto;text-align:center;';
                        var _svOn = false; // 当前状态标志（避免解析计算样式失败导致无法关闭）
                        fetch('/api/supervisor').then(function(r){return r.json();}).then(function(j){
                            if (j && j.ok && j.enabled) { _svOn = true; btn.style.cssText = _svOnCss; }
                        }).catch(function(){});
                        btn.onclick = function() {
                            var turnOn = !_svOn;
                            fetch('/api/supervisor', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled: turnOn}) })
                                .then(function(r){return r.json();})
                                .then(function(j){
                                    if (j && j.ok) {
                                        _svOn = turnOn;
                                        btn.style.cssText = turnOn ? _svOnCss : _normalCss;
                                        try { self._stepToast(turnOn ? '🛡 监督师已开启：下轮对话起生效（只警报、不打断）' : '🛡 监督师已关闭：下轮起不再监督', turnOn); } catch(e) {}
                                    }
                                }).catch(function(){});
                        };
                        btns.appendChild(btn);
                        return;
                    }
                    btn.onclick = function() {
                        if (o.id === 'thinker-expand') {
                            // 策划师：与审核员一致，仅空闲时强制收尾；新对话独立运行
                            try { if (!chat.isSending && self._onSendComplete) self._onSendComplete(box, chat); } catch (e) {}
                            // 【简化 v2】多角色使用率低，不再单独占一个双选面板：
                            // 直接弹数量选择，「多角色探讨」降级为数量弹窗底部的小入口
                            self._askCount('策划师', function (n) {
                                for (var i = 0; i < n; i++) { (function (i) { setTimeout(function () { self._thinkerExpand(box, chat); }, i * 500); })(i); }
                            }, chat, { extraMode: 'multi', box: box });
                        } else if (o.id === 'summarizer') {
                            // 总结师：与策划师一致，仅空闲时强制收尾；新对话独立运行
                            try { if (!chat.isSending && self._onSendComplete) self._onSendComplete(box, chat); } catch (e) {}
                            self._summarizerPickMenu(btn, box, chat);
                        } else if (o.id === 'obj-verify') {
                            // 【2026 修复】仅在空闲时才做强制收尾（_onSendComplete）：
                            // 运行中强制收尾会打断正在进行的 Agent 循环、弄丢发送状态，
                            // 造成"点了审核员，原对话看似空闲却卡住/状态错乱"的怪象。
                            // 审核员本身开新对话独立运行，不需要原对话先收尾。
                            try { if (!chat.isSending && self._onSendComplete) self._onSendComplete(box, chat); } catch (e) {}
                            // 【防误点】先弹数量选择（1/2/3 或任意数字），再按数量派出（多路=多个审核视角）
                            self._askCount('审核员', function (n) {
                                for (var i = 0; i < n; i++) { (function (i) { setTimeout(function () { self._objectiveVerify(box, chat); }, i * 500); })(i); }
                            }, chat);
                        } else if (o.id === 'race-team') {
                            /* 【v5.5.0】赛马模式暂不开放，点击施工队直接走协作开工（不再弹双选） */
                            try { if (!chat.isSending && self._onSendComplete) self._onSendComplete(box, chat); } catch (e) {}
                            if (!window.ZFCrew || typeof ZFCrew.dispatchCrew !== 'function') { self._stepToast('协作施工队模块未加载（chatbox-crew.js）', false); return; }
                            self._askCount('施工队', function (n) { ZFCrew.dispatchCrew(chat, n); }, chat);
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
                                // 【2026 修复】与审核员一致：仅空闲时才强制收尾，运行中不破坏发送状态
                                try { if (!chat.isSending && self._onSendComplete) self._onSendComplete(box, chat); } catch (e) {}
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
                                    _dlgAlert('没有可验证的 AI 回复，请先让 AI 完成一轮工作。');
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
                    // 【简化】「⋯」更多菜单已移除；撤销改为「本任务总耗时」行尾的小按钮（agent-02-loop-core.js 任务完成时插入）
                wrap.appendChild(ctxRow);
                wrap.appendChild(row);
            })();

            // 二次验证成功过的任务：重建按钮行后补回「✓ 已验证」+ 第二排「查看验证」按钮
            // （此前该按钮只在验证轮成功那一刻动态插入，刷新/重开对话后 renderCompressSelector 重建按钮行就丢了）
            try {
                var _lastAssistant = null;
                var _hist = (chat && Array.isArray(chat.history)) ? chat.history : [];
                for (var _hi = _hist.length - 1; _hi >= 0; _hi--) {
                    if (_hist[_hi] && _hist[_hi].role === 'assistant') { _lastAssistant = _hist[_hi]; break; }
                }
                if ((_lastAssistant && typeof _lastAssistant.content === 'string' &&
                    _lastAssistant.content.indexOf('二次验证成功') >= 0 ||
                    chat._verifiedOnce) &&
                    typeof self._markVerifyButton === 'function') {
                    body.appendChild(wrap);
                    self._markVerifyButton(box);
                    return;
                }
            } catch (_ve) {
                // 【修复】不再静默吞错：之前任何异常都会导致整排按钮不渲染且无任何提示
                try { console.warn('[compress-selector] 重建按钮行异常:', _ve); } catch (_e2) {}
            }

            body.appendChild(wrap);
        } catch (e) {
            // 【修复】不再静默吞错：任何异常导致按钮行不渲染时必须在控制台可见
            try { console.warn('[compress-selector] 渲染失败（按钮行未显示）:', e && e.stack || e); } catch (_e2) {}
        }
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
        var sid = _dlgPrompt('技能英文标识（id，如 code_review）：');
        if (!sid) return;
        sid = String(sid).trim().replace(/\s+/g, '_');
        var name = _dlgPrompt('技能显示名：', sid);
        if (name === null) return;
        var desc = _dlgPrompt('一句话描述（可留空）：', '');
        if (desc === null) return;
        var trg = _dlgPrompt('触发关键词（逗号分隔，可留空）：', name || sid);
        if (trg === null) return;
        var promptText = _dlgPrompt('技能提示词正文（prompt.md 内容）：', defaultPrompt.slice(0, 4000));
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
        // 【并发隔离】保存 git 时记录本对话 chatId，撤销时按对话过滤
        if (toolName === 'git_save_step' && !body.chatId) body.chatId = String(chat && chat.id || '');
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
            // 点击保存时主动刷写所有待存数据（含流式动画中未落库的 AI 消息），确保消息不丢
            try { if (typeof Store !== 'undefined' && Store.flush) Store.flush(); } catch (e) {}
            xhr.send(JSON.stringify(body));
        } catch (e) {
            Store.addLog('error', chat.id, 'step-action', label + '异常: ' + e.message);
        }
    },

    // ===== 策划师：新开对话 + 任务扩展素材包（多轮扩展追问，结论回注原对话） =====
    // 与审核员同套路：新对话独立运行 + 完全继承原对话配置 + 箭头连接。
    // 区别：目的不是验证而是「任务扩展」——用户表达不够清晰时，给出扩展方向与澄清问题；
    // 结论以「【策划师结论】」开头输出，紫色箭头可点击把结论回注原对话。位置默认在原对话左上方。
    /* ==================== 施工队统一入口：双选模式弹窗 ==================== */
    /* 点「施工队」先弹双选：① 赛马开工（单开项目、独立 worktree 各干各的）② 协作开工（同项目共享现场分片共干一活） */
    _askTeamMode: function(box, chat) {
        var self = this;
        if (document.querySelector('._askteam-mask')) return; // 防重复弹窗
        var mask = document.createElement('div');
        mask.className = '_askteam-mask';
        mask.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
        mask.innerHTML =
            '<div style="background:var(--bg1,#1e1e2e);color:var(--text,#eee);border:1px solid rgba(255,255,255,.15);border-radius:12px;min-width:420px;max-width:520px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,.5);">' +
            '<div style="font-size:14px;font-weight:bold;margin-bottom:12px;">🚧 施工队开工模式</div>' +
            '<div style="display:flex;flex-direction:column;gap:10px;">' +
            '<button data-mode="crew" style="text-align:left;padding:12px 14px;cursor:pointer;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:13px;">' +
            '<b>🐝 协作开工（同项目协作）</b><br><span style="font-size:12px;opacity:.75;">多窗共处同一共享现场，黑板分片认领、认领即锁文件，通过总线互相沟通共干一活</span></button>' +
            '<button data-mode="race" style="text-align:left;padding:12px 14px;cursor:pointer;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-size:13px;">' +
            '<b>🏁 赛马开工（单开项目）</b><br><span style="font-size:12px;opacity:.75;">每队独立对话窗 + 物理隔离工作目录，互不干扰各干各的，完成后回收汇总对比择优</span></button>' +
            '</div>' +
            '<div style="text-align:right;margin-top:10px;"><button class="_askteam-cancel" style="padding:4px 12px;cursor:pointer;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font-size:12px;">取消</button></div>' +
            '</div>';
        var done = false;
        function fire(mode) {
            if (done) return; done = true;
            mask.remove();
            if (mode === 'race') {
                /* 赛马：保持原流程，先弹数量选择再逐队派出 */
                self._askCount('施工队', function (n) {
                    if (!window.ZFRace || typeof ZFRace.spawnTeam !== 'function') { self._stepToast('施工队模块未加载（chatbox-race.js）', false); return; }
                    for (var i = 0; i < n; i++) { (function (i) { setTimeout(function () { ZFRace.spawnTeam({ srcChatId: chat.id }); }, i * 800); })(i); }
                }, chat);
            } else if (mode === 'crew') {
                /* 协作：走 ZFCrew 派单（建黑板 → 注入协作协议 → 开协作窗 + 黑板面板） */
                if (!window.ZFCrew || typeof ZFCrew.dispatchCrew !== 'function') { self._stepToast('协作施工队模块未加载（chatbox-crew.js）', false); return; }
                /* 【零输入开工 v3】与赛马一致：先弹数量选择（1/2/3 或任意数字），选中即直接开工，不再二次确认 */
                self._askCount('施工队', function (n) {
                    ZFCrew.dispatchCrew(chat, n);
                }, chat);
            }
        }
        mask.querySelectorAll('button[data-mode]').forEach(function (b) {
            b.onclick = function () { fire(b.getAttribute('data-mode')); };
        });
        mask.querySelector('._askteam-cancel').onclick = function () { done = true; mask.remove(); };
        mask.addEventListener('mousedown', function (e) { if (e.target === mask) { done = true; mask.remove(); } });
        mask.addEventListener('keydown', function (e) { if (e.key === 'Escape') { done = true; mask.remove(); } });
        document.body.appendChild(mask);
    },

    /* ==================== 数量选择弹窗（防误点）：1/2/3 快捷键 + 任意数字输入 ==================== */
    /* 与「多角色选分组」同款的确认步骤：点击按钮后先弹数量选择，用户确认后才真正派单。 */
    /* 【派出角标】确认后把数量累加到 chat._spawnCount[roleKey]，按钮行重建时读取渲染徽标 */
    _askCount: function(roleLabel, cb, chat, opts) {
        var self = this;
        opts = opts || {};
        if (document.querySelector('._askcount-mask')) return; // 已有弹窗时忽略重复点击，防连开多个弹窗
        var mask = document.createElement('div');
        mask.className = '_askcount-mask';
        mask.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
        /* 【弹窗级样式】hover/active 态（内联样式做不到）*/
        var st = document.createElement('style');
        st.textContent =
            '._askcount-mask ._askcount-quick{border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;transition:border-color .15s,background .15s;}' +
            '._askcount-mask ._askcount-quick:hover{border-color:#4da3ff;background:rgba(77,163,255,.15);}' +
            '._askcount-mask ._askcount-quick:active{background:rgba(77,163,255,.3);}' +
            '._askcount-mask ._askcount-go{background:#4da3ff;color:#fff;border:none;transition:background .15s;}' +
            '._askcount-mask ._askcount-go:hover{background:#66b2ff;}' +
            '._askcount-mask ._askcount-go:active{background:#3a8fe6;}' +
            '._askcount-mask ._askcount-cancel{transition:border-color .15s,color .15s;}' +
            '._askcount-mask ._askcount-cancel:hover{border-color:rgba(255,255,255,.5);color:#fff;}';
        mask.appendChild(st);
        var card = document.createElement('div');
        card.style.cssText = 'background:var(--bg1,#1e1e2e);color:var(--text,#eee);border:1px solid rgba(255,255,255,.15);border-radius:12px;min-width:320px;max-width:380px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.5);';
        /* 【记忆上次数量】zf_last_spawn_count，读失败用默认 2 */
        var _lastN = 2;
        try { var _ln = parseInt(localStorage.getItem('zf_last_spawn_count'), 10); if (_ln >= 1 && _ln <= 20) _lastN = _ln; } catch (eN) {}
        card.innerHTML =
            '<div style="font-size:14px;font-weight:bold;margin-bottom:12px;">🚀 派出几名「' + roleLabel + '」？</div>' +
            /* ── 组1：选择数量 ── */
            '<div style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;margin-bottom:10px;">' +
            '<div style="font-size:11px;opacity:.55;margin-bottom:8px;">数量</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<button data-n="1" title="派出 1 名，独立完成任务" class="_askcount-quick" style="flex:1;padding:8px 0;cursor:pointer;border-radius:8px;font-size:15px;"><b>1</b><span style="display:block;font-size:10px;opacity:.6;">单人</span></button>' +
            '<button data-n="2" title="派出 2 名，双方案对照" class="_askcount-quick" style="flex:1;padding:8px 0;cursor:pointer;border-radius:8px;font-size:15px;"><b>2</b><span style="display:block;font-size:10px;opacity:.6;">双视角</span></button>' +
            '<button data-n="3" title="派出 3 名，集思广益" class="_askcount-quick" style="flex:1;padding:8px 0;cursor:pointer;border-radius:8px;font-size:15px;"><b>3</b><span style="display:block;font-size:10px;opacity:.6;">智囊团</span></button>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<span style="font-size:12px;opacity:.7;">任意数量：</span>' +
            '<input type="number" class="_askcount-num" min="1" max="20" value="' + _lastN + '" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;width:70px;">' +
            '<span style="font-size:11px;opacity:.45;">回车派出</span>' +
            '</div>' +
            '</div>' +
            /* ── 组2：回收方式 ── */
            '<div style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;margin-bottom:12px;">' +
            '<div style="font-size:11px;opacity:.55;margin-bottom:8px;">回收</div>' +
            '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#ffe0b2;cursor:pointer;margin-bottom:4px;">' +
            '<input type="checkbox" class="_askcount-auto" style="cursor:pointer;">♻ 自动回收（全员答完自动汇总）</label>' +
            '</div>' +
            /* ── 组2.5：策划师专属——【v5.5.0】施工队相关选项本版本隐藏，以后再开发；逻辑保留不受影响 ── */
            /* (roleLabel === '策划师'
                ? '<div style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;margin-bottom:12px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" class="_zfexec-toggle">' +
                  '<span style="font-size:12px;opacity:.75;">🔧 分组施工（默认关）</span>' +
                  '<span class="_zfexec-arrow" style="font-size:11px;opacity:.5;">展开 ▾</span></div>' +
                  '<div class="_zfexec-panel" style="display:none;margin-top:10px;">' +
                  '<div style="font-size:11px;opacity:.55;margin-bottom:8px;">任务需拆给多个施工组时才用，策划师会按份数提前拆好任务书。</div>' +
                  '<div style="display:flex;gap:8px;align-items:center;">' +
                  '<span style="font-size:12px;opacity:.7;">🐝 分成几份：</span>' +
                  '<input type="number" class="_zfexec-split" min="2" max="20" value="3" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;width:70px;">' +
                  '<span style="font-size:11px;opacity:.45;">不填=不启用</span>' +
                  '</div>' +
                  '</div></div>'
                : '') + */
            ('') +
            /* ── 组3：行动条（取消靠左弱化，派出主按钮靠右） ── */
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            (opts.extraMode === 'multi'
                ? '<span class="_askcount-multi" style="font-size:12px;color:#ffce7a;cursor:pointer;text-decoration:underline;">🎭 多角色探讨</span>'
                : '<span></span>') +
            '<div style="display:flex;gap:8px;">' +
            '<button class="_askcount-cancel" style="padding:6px 14px;cursor:pointer;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font-size:12px;">取消</button>' +
            '<button class="_askcount-go" style="padding:6px 20px;cursor:pointer;border-radius:6px;font-size:13px;font-weight:bold;">🚀 派出</button>' +
            '</div>' +
            '</div>';
        mask.appendChild(card);
        var done = false;
        /* 【自动回收模式】开关状态 localStorage 记忆；勾选则设一次性全局标志，multi-arrow create 时消费 */
        var autoChk = null;
        try {
          autoChk = mask.querySelector('._askcount-auto');
          autoChk.checked = localStorage.getItem('zf_auto_gather') === '1';
          autoChk.addEventListener('change', function () {
            try { localStorage.setItem('zf_auto_gather', autoChk.checked ? '1' : '0'); } catch (e) {}
          });
        } catch (eAuto) {}
        /* 【高级分组施工】默认收起，点击展开/收起 */
        try {
            var _tg = mask.querySelector('._zfexec-toggle');
            if (_tg) _tg.addEventListener('click', function () {
                var panel = mask.querySelector('._zfexec-panel');
                var arrow = mask.querySelector('._zfexec-arrow');
                var open = panel.style.display !== 'none';
                panel.style.display = open ? 'none' : 'block';
                arrow.textContent = open ? '展开 ▾' : '收起 ▴';
            });
        } catch (eTg) {}
        function fire(n) {
            if (done) return; done = true;
            /* 【自动回收 v2】存时间戳而非布尔：三种箭头（策划/审核/施工队）各自读取，60 秒内有效，避免多箭头抢消费或标志永久残留 */
            try { window._zfAutoGatherNext = (autoChk && autoChk.checked) ? Date.now() : 0; window._zfGatherExpireWarned = false; } catch (e) {}
            n = Math.max(1, Math.min(20, parseInt(n, 10) || 1));
            /* 【执行方式】策划师弹窗里选的“后期归谁干”，存一次性标志供 _thinkerExpandSend 消费（60秒有效） */
            try {
                var _splitEl = mask.querySelector('._zfexec-split');
                var _splitN = _splitEl ? Math.max(0, Math.min(20, parseInt(_splitEl.value, 10) || 0)) : 0;
                /* 份数>2 才算启用分组施工；不填/收起=默认单AI直接干 */
                var _panel = mask.querySelector('._zfexec-panel');
                var _opened = _panel && _panel.style.display !== 'none';
                window._zfPlannerExecNext = (roleLabel === '策划师' && _opened && _splitN >= 2) ? { mode: 'crew', n: _splitN, ts: Date.now() } : null;
            } catch (eExec) {}
            mask.remove(); cb(n);
        }
        function fireCount(n) {
            n = Math.max(1, Math.min(20, parseInt(n, 10) || 1));
            try { localStorage.setItem('zf_last_spawn_count', String(n)); } catch (e) {}
            try { self._bumpSpawnCount(roleLabel, n, chat); } catch (e) {}
            fire(n);
        }
        mask.querySelectorAll('button[data-n]').forEach(function (b) {
            b.onclick = function () { fireCount(b.getAttribute('data-n')); };
        });
        mask.querySelector('._askcount-go').onclick = function () { fireCount(mask.querySelector('._askcount-num').value); };
        var inp0 = mask.querySelector('._askcount-num');
        inp0.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fireCount(inp0.value); } });
        mask.querySelector('._askcount-cancel').onclick = function () { done = true; mask.remove(); };
        var multiLink = mask.querySelector('._askcount-multi');
        if (multiLink) {
            multiLink.onclick = function () {
                done = true; mask.remove();
                self._multiRole(opts.box, chat);
            };
        }
        mask.addEventListener('mousedown', function (e) { if (e.target === mask) { done = true; mask.remove(); } });
        mask.addEventListener('keydown', function (e) { if (e.key === 'Escape') { done = true; mask.remove(); } });
        document.body.appendChild(mask);
        setTimeout(function () { var inp = mask.querySelector('._askcount-num'); inp.focus(); inp.select(); }, 30);
    },

    /* ==================== 派出数量累计（按钮右上角徽标数据源） ==================== */
    /* 按角色名累加到当前对话 chat._spawnCount；存 chat 对象而非全局，切换对话各自独立 */
    _spawnRoleKey: function(roleLabel) {
        var s = String(roleLabel || '');
        if (s.indexOf('审核') >= 0 || s.indexOf('质检') >= 0) return '审核员';
        if (s.indexOf('策划') >= 0) return '策划师';
        if (s.indexOf('施工') >= 0) return '施工队';
        return s;
    },
    _bumpSpawnCount: function(roleLabel, n, chat) {
        try {
            var self = this;
            if (!chat) return;
            if (!chat._spawnCount) chat._spawnCount = {};
            var key = self._spawnRoleKey(roleLabel);
            chat._spawnCount[key] = (chat._spawnCount[key] || 0) + n;
            // 徽标刷新：【只刷本对话】只在 chat 自己的弹窗范围内找按钮，严禁 document 全局刷（会串到别的对话）
            self._refreshSpawnBadges(chat);
        } catch (e) {}
    },
    /* 【存活口径】实时统计本对话派出的、当前仍存活的子对话数量：
       策划师=_isThinkerChat+_thinkerSrcId / 审核员=_isQcChat+_qcSrcId / 施工队=_raceSrcId（派出时回填）。
       子对话关闭后自动减一，全部关闭返回 0（角标消失）。返回 -1 表示统计失败（调用方回退累计口径）。 */
    _aliveSpawnCount: function(chat, key) {
        try {
            var n = 0;
            var boxes = (typeof App !== 'undefined' && App.chatBoxes) || [];
            boxes.forEach(function(c) {
                var el = c && c.el;
                if (!el) return;
                if (key === '策划师' && el._isThinkerChat && String(el._thinkerSrcId) === String(chat.id)) n++;
                else if (key === '审核员' && el._isQcChat && String(el._qcSrcId) === String(chat.id)) n++;
                else if (key === '施工队' && el._raceSrcId && String(el._raceSrcId) === String(chat.id)) n++;
            });
            return n;
        } catch (e) { return -1; }
    },
    /* 只刷新本对话弹窗内的派出角标按钮 */
    _refreshSpawnBadges: function(chat) {
        try {
            if (!chat || !chat.el) return;
            var self = this;
            Array.prototype.forEach.call(chat.el.querySelectorAll('button[data-spawn-role]'), function(b) {
                self._renderSpawnBadge(b, chat);
            });
        } catch (e) {}
    },
    _renderSpawnBadge: function(btn, chat) {
        try {
            var key = btn.getAttribute('data-spawn-role');
            /* 【存活口径优先】优先实时统计存活子窗口数；统计失败再回退历史累计数 */
            var alive = this._aliveSpawnCount(chat, key);
            var n = (alive >= 0) ? alive : ((chat && chat._spawnCount && chat._spawnCount[key]) || 0);
            var badge = btn.querySelector('._spawn-badge');
            if (n > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = '_spawn-badge';
                    badge.style.cssText = 'position:absolute;top:-6px;right:-4px;min-width:15px;height:15px;line-height:15px;padding:0 4px;border-radius:8px;background:#e53935;color:#fff;font-size:10px;font-weight:bold;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5);pointer-events:none;';
                    btn.appendChild(badge);
                }
                badge.textContent = n;
                badge.title = key + '：本对话当前存活 ' + n + ' 名子对话（关闭一个减一，全部关闭消失）';
                btn.style.position = 'relative';
            } else if (badge) {
                badge.remove();
            }
        } catch (e) {}
    },
    /* 【关窗联动】子对话（策划师/审核员/施工队）关闭时，刷新其来源对话的角标数字。
       存活口径下无需手动减数——关窗后 App.chatBoxes 里少一个，重刷即自动减一/归零消失。 */
    _installSpawnBadgeCloseHook: function() {
        try {
            if (typeof App === 'undefined' || typeof App.closeChatBox !== 'function') return;
            if (App._zfSpawnBadgeHooked) return;
            App._zfSpawnBadgeHooked = true;
            var self = this;
            var _origClose = App.closeChatBox;
            App.closeChatBox = function (chat) {
                try {
                    var el = chat && chat.el;
                    if (el) {
                        var srcId = el._thinkerSrcId || el._qcSrcId || el._raceSrcId || null;
                        if (srcId != null) {
                            setTimeout(function () {
                                try {
                                    var boxes = (typeof App !== 'undefined' && App.chatBoxes) || [];
                                    for (var i = 0; i < boxes.length; i++) {
                                        if (String(boxes[i].id) === String(srcId)) { self._refreshSpawnBadges(boxes[i]); break; }
                                    }
                                } catch (e2) {}
                            }, 300); /* 等关窗动画/chatBoxes 移除完成后再刷 */
                        }
                    }
                } catch (e) {}
                return _origClose.apply(this, arguments);
            };
        } catch (e) {}
    },

    /* ==================== 探讨模式双选面板：策划师探讨 / 多角色探讨 ==================== */
    _askExploreMode: function (box, chat) {
        var self = this;
        var mask = document.createElement('div');
        mask.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
        var dlg = document.createElement('div');
        dlg.style.cssText = 'background:#1e1533;border:1px solid rgba(171,71,188,.5);border-radius:14px;padding:18px 22px;min-width:300px;max-width:86vw;box-shadow:0 8px 32px rgba(0,0,0,.6);';
        dlg.innerHTML = '<div style="color:#e1bee7;font-size:15px;font-weight:bold;margin-bottom:12px;">选择探讨模式</div>';
        var list = document.createElement('div');
        var opts = [
            {
                name: '🧭 策划师探讨',
                desc: '先选数量（1~3），新开策划师对话多轮追问扩展问题，紫色箭头回注结论',
                go: function () {
                    self._askCount('策划师', function (n) {
                        for (var i = 0; i < n; i++) { (function (i) { setTimeout(function () { self._thinkerExpand(box, chat); }, i * 500); })(i); }
                    }, chat);
                }
            },
            {
                name: '🎭 多角色探讨',
                desc: '选一个角色分组，新开该组每个角色一个对话同时发言；橙金总箭头可来回穿梭汇总/分发，无限多轮',
                go: function () { self._multiRole(box, chat); }
            }
        ];
        opts.forEach(function (op) {
            var item = document.createElement('div');
            item.style.cssText = 'padding:10px 14px;margin:6px 0;border-radius:9px;background:rgba(171,71,188,.12);border:1px solid rgba(171,71,188,.35);color:#fff;font-size:14px;cursor:pointer;';
            item.innerHTML = '<div style="font-weight:bold;">' + op.name + '</div><div style="font-size:11px;opacity:.75;margin-top:3px;">' + op.desc + '</div>';
            item.addEventListener('mouseenter', function () { item.style.background = 'rgba(171,71,188,.28)'; });
            item.addEventListener('mouseleave', function () { item.style.background = 'rgba(171,71,188,.12)'; });
            item.addEventListener('click', function () { mask.remove(); op.go(); });
            list.appendChild(item);
        });
        dlg.appendChild(list);
        var cancel = document.createElement('div');
        cancel.style.cssText = 'text-align:center;color:#999;font-size:12px;margin-top:10px;cursor:pointer;';
        cancel.textContent = '取消';
        cancel.addEventListener('click', function () { mask.remove(); });
        dlg.appendChild(cancel);
        mask.appendChild(dlg);
        document.body.appendChild(mask);
    },

    /* ==================== 多角色探讨：选分组 → N 个角色对话 → 1:N 橙金箭头 ==================== */
    _multiRole: function(box, chat) {
        var self = this;
        /* 1. 拉取角色分组列表 */
        fetch('/api/roles?box=' + encodeURIComponent(chat.id || ''))
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var groups = (res && res.groups) || [];
                var roles = (res && res.roles) || [];
                if (!groups.length) { self._stepToast('没有角色分组，请先在角色面板创建分组并加入角色', false); return; }
                var gid = function (r) { return r.group || r.group_id || ''; };
                /* 2. 弹出分组选择 */
                var mask = document.createElement('div');
                mask.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
                var dlg = document.createElement('div');
                dlg.style.cssText = 'background:#1e1533;border:1px solid rgba(255,183,77,.5);border-radius:14px;padding:18px 22px;min-width:300px;max-width:86vw;box-shadow:0 8px 32px rgba(0,0,0,.6);';
                dlg.innerHTML = '<div style="color:#ffe0b2;font-size:15px;font-weight:bold;margin-bottom:12px;">选择角色分组（多角色探讨）</div>';
                var list = document.createElement('div');
                groups.forEach(function (g) {
                    var cnt = roles.filter(function (r) { return gid(r) === g.id; }).length;
                    var item = document.createElement('div');
                    item.style.cssText = 'padding:9px 14px;margin:6px 0;border-radius:9px;background:rgba(255,183,77,.12);border:1px solid rgba(255,183,77,.35);color:#fff;font-size:14px;cursor:pointer;';
                    item.textContent = (g.name || '未命名分组') + '（' + cnt + ' 个角色）';
                    item.addEventListener('mouseenter', function () { item.style.background = 'rgba(255,183,77,.28)'; });
                    item.addEventListener('mouseleave', function () { item.style.background = 'rgba(255,183,77,.12)'; });
                    item.addEventListener('click', function () {
                        mask.remove();
                        self._multiRoleStart(box, chat, g, roles.filter(function (r) { return gid(r) === g.id; }));
                    });
                    list.appendChild(item);
                });
                dlg.appendChild(list);
                var cancel = document.createElement('div');
                cancel.style.cssText = 'text-align:center;color:#999;font-size:12px;margin-top:10px;cursor:pointer;';
                cancel.textContent = '取消';
                cancel.addEventListener('click', function () { mask.remove(); });
                dlg.appendChild(cancel);
                mask.appendChild(dlg);
                document.body.appendChild(mask);
            })
            .catch(function () { self._stepToast('多角色失败：无法读取角色分组', false); });
    },

    _multiRoleStart: function(box, chat, group, members) {
        var self = this;
        if (!members || !members.length) { self._stepToast('该分组没有角色', false); return; }
        var selfApp = (typeof App !== 'undefined') ? App : null;
        if (!selfApp || typeof selfApp.createChatBox !== 'function') {
            self._stepToast('多角色失败：无法创建新对话', false); return;
        }
        /* 原对话素材包：首问 + 最近问答（复用策划师素材思路，精简版） */
        var firstQ = '';
        var recent = '';
        try {
            var ms = (chat.history && chat.history.length ? chat.history : (chat.messages || []));
            for (var i = 0; i < ms.length; i++) {
                var _c = _msgText(ms[i]);
                if (ms[i].role === 'user' && _c.indexOf('（策划师素材包') !== 0 && _c.indexOf('【多角色探讨素材包】') !== 0 && _c.indexOf('【当前项目上下文】') !== 0) { firstQ = _c; break; }
            }
            var tail = ms.slice(-4);
            recent = tail.map(function (m) { return (m.role === 'user' ? '用户' : 'AI') + '：' + _msgText(m).slice(0, 1200); }).join('\n---\n');
        } catch (e) {}
        /* 模型继承 */
        var _srcMid = '';
        try { _srcMid = (typeof App !== 'undefined' && typeof App._toolMasterResolveModelId === 'function') ? (App._toolMasterResolveModelId(chat) || '') : ''; } catch (e) {}
        if (!_srcMid) _srcMid = chat.modelId || '';
        /* 画布位置：阶梯排布——每个角色相对上一个右移+下移错开，位置保持不旋转 */
        /* 【源坐标修复】优先 rect 反算画布逻辑坐标，style.left 仅兜底（防止历史污染值如95358导致飞窗） */
        var _srcL = NaN, _srcT = NaN;
        try {
            var _sc0 = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc0 > 0)) _sc0 = 1;
            var _cv0 = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
            var _r0 = chat.el.getBoundingClientRect();
            var _caEl0 = document.getElementById('canvasArea');
            var _caR0 = _caEl0 ? _caEl0.getBoundingClientRect() : { left: 0, top: 0 };
            _srcL = Math.round((_r0.left - _caR0.left - (_cv0.x || 0)) / _sc0);
            _srcT = Math.round((_r0.top - _caR0.top - (_cv0.y || 0)) / _sc0);
        } catch (eSrc0) {}
        if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = parseInt(chat.el && chat.el.style.left, 10) || 0;
            _srcT = parseInt(chat.el && chat.el.style.top, 10) || 0;
        }
        /* 【坐标同系】offsetHeight 是渲染像素（含画布缩放），需除以 scale 才能与 style.left/top 逻辑坐标混用；scale!=1 时不除会导致子窗纵向偏移失真 */
        var _srcH = 520;
        try {
            var _sc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc > 0)) _sc = 1;
            if (chat && chat.el && chat.el.offsetHeight) _srcH = chat.el.offsetHeight / _sc;
        } catch (e) {}
        var created = [];
        var groupName = group.name || '多角色';
        /* 【坐标同系】offsetWidth 同 offsetHeight 需除以 scale 换算回逻辑坐标 */
        var _srcW = 420;
        try { if (chat && chat.el && chat.el.offsetWidth) _srcW = chat.el.offsetWidth / _sc; } catch (eW) {}
        /* 【定位统一·右下角10,10】多角色窗固定在源窗右下角外10px，同批依次 x+20/y+20 阶梯错开（右上往左下叠） */
        members.forEach(function (m, idx) {
            var x = _srcL + _srcW + 10 + idx * 20;
            var y = _srcT + _srcH + 10 + idx * 20;
            var nc = selfApp.createChatBox(Math.round(x), Math.round(y), _srcMid || null, true);
            if (!nc) return;
            try {
                nc.el.style.zIndex = 10 + idx;
            } catch (e) {}
            nc.el._isMultiRoleChat = true;
            nc.el._multiRoleName = m.name || ('角色' + (idx + 1));
            try { if (nc.titleEl) nc.titleEl.textContent = '【' + groupName + '】' + nc.el._multiRoleName; } catch (e) {}
            created.push(nc);
            /* 绑定角色并发首问 */
            var q = '【多角色探讨素材包】你被邀请以「' + (m.name || '角色') + '」身份参与一次多角色探讨。请先读取你的角色设定并严格执行。\n\n【原对话首问】\n' + firstQ.slice(0, 2000) + '\n\n【最近对话】\n' + recent.slice(0, 3000) + '\n\n【你的任务】以「' + (m.name || '角色') + '」的视角，针对上述任务给出你的独特看法。要求：\n1. 第一行以【' + (m.name || '角色') + '观点】开头；\n2. 观点要有锐度和差异化，坚持你的角色立场，不要附和其他角色；\n3. 3~6 句话，直击要害，可给一条具体建议。';
            /* 绑定角色：写本地存储 + 通知服务端 + 刷新徽章/标题/皮肤（与策划师/审核员同款），绑定后发首问 */
            var mname = m.name || ('角色' + (idx + 1));
            var doBind = function () {
                var _ok = false;
                try {
                    localStorage.setItem('zf_role_chat_' + nc.id, JSON.stringify({
                        id: m.id, name: mname, avatar: m.avatar || '', prompt: m.prompt || '',
                        chat_skin: m.chat_skin || ''
                    }));
                    _ok = true;
                } catch (e) {}
                try { if (typeof selfApp._refreshRoleBadge === 'function') selfApp._refreshRoleBadge(nc.el); } catch (e) {}
                try {
                    var _titleEl = nc.el && nc.el.querySelector('.title');
                    if (_titleEl) {
                        _titleEl.textContent = mname;
                        _titleEl.title = '多角色探讨对话（角色：' + mname + '）';
                    }
                } catch (e) {}
                try { if (typeof Theme !== 'undefined' && Theme.applyToBox && nc.el) Theme.applyToBox(nc.el, m.chat_skin || ''); } catch (e) {}
                try {
                    fetch('/api/roles', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'select', box: nc.id, role_id: m.id })
                    }).then(function () { self._multiRoleSend(nc, q); }).catch(function () { self._multiRoleSend(nc, q); });
                } catch (e) { self._multiRoleSend(nc, q); }
                if (!_ok) self._multiRoleSend(nc, q);
            };
            setTimeout(doBind, 200 + idx * 150);
        });
        if (!created.length) { self._stepToast('多角色失败：新对话创建被拦截（窗口数量/频率限制）', false); return; }
        /* 等全部创建完 → 生成 1:N 橙金总箭头 */
        setTimeout(function () {
            try {
                if (window.ZFMultiArrow && typeof window.ZFMultiArrow.create === 'function') {
                    window.ZFMultiArrow.create(chat, created, groupName);
                }
                /* 阵型记忆：命中已存预设 → 覆盖阶梯默认位（父动子随/微调即存由 chatbox-group-follow 接管） */
                try {
                    if (window.ZFGroupFollow && typeof window.ZFGroupFollow.applyFormation === 'function') {
                        window.ZFGroupFollow.applyFormation(chat.id);
                    }
                } catch (e) {}
            } catch (e) {}
            self._stepToast('已开启「' + groupName + '」多角色探讨：' + created.length + ' 个角色发言中，橙金箭头可回收/分发', true);
        }, 600 + created.length * 200);
    },

    _multiRoleSend: function(nc, text) {
        /* 与策划师/审核员同款发消息路径：addMsg 展示 + push history + sendToModel 真实调用模型 */
        try {
            var selfApp = (typeof App !== 'undefined') ? App : null;
            if (selfApp && typeof selfApp.addMsg === 'function' && typeof selfApp.sendToModel === 'function' && nc) {
                selfApp.addMsg(nc.el, text, 'user', nc.modelId);
                nc.history.push({ role: 'user', content: text, _multiRound: true });
                selfApp.sendToModel(nc.el, nc);
            } else if (nc && typeof nc.send === 'function') {
                nc.send(text);
            }
        } catch (e) {
            try { if (typeof Store !== 'undefined' && Store.addLog) Store.addLog('error', nc.id, 'multi', '多角色首问发送失败：' + (e && e.message)); } catch (e2) {}
        }
    },

    // ===== 总结师：新开对话 + 五项精选注入（不注入全量对话），沉淀经验落盘 =====
    /* 【总结师三模式菜单】点总结师按钮先弹选项：1工作总结(默认沉淀) 2技能总结(只沉淀技能方法) 3智能体广场(总结发帖到广场) */
    _summarizerPickMenu: function(btn, box, chat) {
        var self = this;
        var old = document.getElementById('zf-summarizer-pick-menu');
        if (old) { old.remove(); return; }
        var menu = document.createElement('div');
        menu.id = 'zf-summarizer-pick-menu';
        menu.style.cssText = 'position:fixed;z-index:99999;background:linear-gradient(160deg,#232b3b,#1a2130);color:#e8ecf3;border:1px solid rgba(120,170,255,.28);border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.3);padding:10px;min-width:280px;font-size:12px;font-family:inherit;';
        // 标题栏
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 10px 8px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:6px;color:#9fb4d8;font-weight:600;letter-spacing:1px;';
        head.innerHTML = '<span style="font-size:14px;">📝</span><span>选择总结模式</span>';
        menu.appendChild(head);
        var items = [
            { icon: '📋', color: '#4da3ff', name: '工作总结', tip: '沉淀整个任务：主题+结论+技能方法+改动清单+git提交+可复用经验，落盘「总结-主题」并 git 提交', fn: function(){ self._summarizerExpand(box, chat); } },
            { icon: '🧠', color: '#7ee0a3', name: '技能总结', tip: '只沉淀「这个任务用什么方法解决的」通用方法论，落盘「技能-主题」，不改代码不强制 git 提交', fn: function(){ self._summarizerExpand(box, chat, 'skill'); } },
            { icon: '🌐', color: '#ffb454', name: '智能体广场', tip: '总结精炼后调用 forum_write 工具发帖到智能体广场（topic=总结），让其他对话/用户可见', fn: function(){ self._summarizerExpand(box, chat, 'forum'); } }
        ];
        items.forEach(function(it) {
            var b = document.createElement('div');
            b.title = it.tip;
            b.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;cursor:pointer;transition:background .15s ease,transform .15s ease;';
            // 【防注入 2026-09-30】改用 textContent 构建，杜绝日后动态数据带来的 XSS 风险
            var _ic = document.createElement('span');
            _ic.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;flex:none;background:' + it.color + '22;border:1px solid ' + it.color + '44;font-size:16px;';
            _ic.textContent = it.icon;
            var _tx = document.createElement('span');
            _tx.style.cssText = 'flex:1;min-width:0;';
            var _nm = document.createElement('span');
            _nm.style.cssText = 'display:block;font-size:13px;font-weight:600;color:' + it.color + ';';
            _nm.textContent = it.name;
            var _tp = document.createElement('span');
            _tp.style.cssText = 'display:block;font-size:11px;color:#8b98ad;margin-top:2px;white-space:normal;line-height:1.45;';
            _tp.textContent = it.tip;
            _tx.appendChild(_nm); _tx.appendChild(_tp);
            b.appendChild(_ic); b.appendChild(_tx);
            b.onmouseenter = function(){ b.style.background = 'rgba(77,163,255,.14)'; b.style.transform = 'translateX(2px)'; };
            b.onmouseleave = function(){ b.style.background = 'transparent'; b.style.transform = 'none'; };
            b.onclick = function(){ menu.remove(); it.fn(); };
            menu.appendChild(b);
        });
        var r = btn.getBoundingClientRect();
        menu.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
        menu.style.top = r.bottom + 6 + 'px';
        document.body.appendChild(menu);
        // 【钳位 2026-09-30】append 后按真实高度钳位，替代固定 260px 估算，极矮视口不裁切
        var _mh = menu.offsetHeight || 260;
        menu.style.top = Math.max(4, Math.min(r.bottom + 6, window.innerHeight - _mh - 4)) + 'px';
        menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 4)) + 'px';
        setTimeout(function() {
            document.addEventListener('mousedown', function _close(ev) {
                if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', _close); }
            });
        }, 0);
    },

    _summarizerExpand: function(box, chat, _mode) {
        try { chat._summarizerMode = _mode || 'work'; } catch (e) {}
        var self = this;
        var _firstQ = '';
        // ① 任务目标（首问）② 策划师回注结论 ③ 审核结论 ④ 最近一条「✅ 任务完成」答复 ⑤ 项目树
        var _thinkerConcls = [], _qcConcls = [];
        var _finalReply = '';
        for (var _i = 0; _i < chat.history.length; _i++) {
            var _h = chat.history[_i];
            if (!_h) continue;
            var _c = _msgText(_h);
            if (_h.role === 'user') {
                if (_h._guardInject || _h._verifyRound || _h._continueRound || _h._thinkerRound || _h._summarizerRound) continue;
        if (_c.indexOf('（策划师素材包') === 0 || _c.indexOf('（总结师素材包') === 0 || _c.indexOf('（审核员素材包') === 0 || _c.indexOf('【审核员任务】') === 0 || _c.indexOf('（质检员素材包') === 0 || _c.indexOf('【质检员任务】') === 0) continue;
                if (!_firstQ) _firstQ = _c; // 首问=任务目标
            } else if (_h.role === 'assistant' && !_h._meta) {
                _finalReply = _c; // 顺序遍历，最后一条 assistant 覆盖 → 兜底=最后一条非工具 assistant
                if (_c.indexOf('✅ 任务完成') !== -1) _finalReply = _c; // 双锚点：命中完成标记优先（若后面还有普通回复会被覆盖，故再记一次）
            }
            // 回注结论提取（复用策划师去重思路；用 trim 后文本做前缀匹配，容忍前导空白）
            if (_h.role === 'user') {
                /* 【前缀归一 2026-09-30】与回注发送方实际前缀对齐：
                   - 策划师箭头回注 = "（策划方案·陈列）\n这是策划师的扩展思考…"（chatbox-thinker-arrow.js）
                   - 审核员箭头回注 = "这是审核员给你的建议你去改一下：…"（chatbox-verify-arrow.js）
                   提取前先剥掉「（策划方案·陈列）」陈列标记，再匹配正文前缀，避免前缀漂移导致漏收/串内容 */
                var _ct = _c.replace(/^\s+/, '');
                if (_ct.indexOf('（策划方案·陈列）') === 0) _ct = _ct.slice('（策划方案·陈列）'.length).replace(/^[\s\r\n]+/, '');
                if (_ct.indexOf('这是策划师给你的扩展结论') === 0 || _ct.indexOf('这是策划师的扩展思考') === 0) {
                    var _b = _ct.slice(_ct.indexOf('\n\n') !== -1 ? _ct.indexOf('\n\n') + 2 : 0);
                    if (_b.trim()) _thinkerConcls.push(_b.trim());
        } else if (_ct.indexOf('这是审核员的复核结论') === 0 || _ct.indexOf('这是质检员的复核结论') === 0 || _ct.indexOf('这是审核员给你的建议你去改一下') === 0) {
                    var _b2 = _ct.slice(_ct.indexOf('\n\n') !== -1 ? _ct.indexOf('\n\n') + 2 : 0);
                    if (_b2.trim()) _qcConcls.push(_b2.trim());
                }
            }
        }
        // 双锚点兜底修正：重新从尾往前找最近一条带「✅ 任务完成」的 assistant，找不到保持最后一条
        for (var _fi = chat.history.length - 1; _fi >= 0; _fi--) {
            var _fh = chat.history[_fi];
            if (_fh && _fh.role === 'assistant' && !_fh._meta && _msgText(_fh).indexOf('✅ 任务完成') !== -1) { _finalReply = _fh.content; break; }
        }
        if (!_firstQ || !_finalReply) {
            Store.addLog('warn', chat.id, 'summarizer', '总结师失败：缺少首问或最终答复');
            self._stepToast('总结师失败：对话需至少有一次提问和一次 AI 答复', false);
            return;
        }
        var _seen = {};
        _thinkerConcls = _thinkerConcls.filter(function (c) { var k = c.slice(0, 80); if (_seen[k]) return false; _seen[k] = 1; return true; }).slice(-3);
        var _seenQ = {};
        _qcConcls = _qcConcls.filter(function (c) { var k = c.slice(0, 80); if (_seenQ[k]) return false; _seenQ[k] = 1; return true; }).slice(-3);
        // 项目路径
        var _projPath = '';
        var _pid = chat.projectId || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || (typeof App !== 'undefined' && App._activeProjectId) || '';
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        var _projTree = '';
        var _finishSend = function () { self._summarizerExpandSend(box, chat, { projPath: _projPath, firstQ: _firstQ, thinkerConcls: _thinkerConcls, qcConcls: _qcConcls, finalReply: _finalReply, projTree: _projTree, mode: chat._summarizerMode || 'work' }); };
        if (_projPath) {
            try {
                fetch('/api/fs/browse?path=' + encodeURIComponent(_projPath) + '&limit=2000')
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        if (j && j.ok) {
                            var _ds = (j.dirs || []).slice(0, 40).map(function (d) { return '[目录] ' + (d.name || '') + '/'; });
                            var _fs = (j.files || []).slice(0, 150).map(function (f) { return '[文件] ' + (f.name || ''); });
                            _projTree = _ds.concat(_fs).join('\n');
                        }
                    })
                    .catch(function () {})
                    .then(_finishSend);
            } catch (e) { _finishSend(); }
        } else { _finishSend(); }
    },

    _summarizerExpandSend: function(box, chat, ctxData) {
        var self = this;
        var lines = [];
        var _smMode = String(ctxData && ctxData.mode || 'work');
        lines.push('（总结师素材包，共见下文）');
        if (_smMode === 'skill') {
            // 【技能总结模式】只沉淀方法论，禁止 git 提交、禁止修改代码
            lines.push('【总结师任务·技能总结模式】你是一个独立的总结师，当前模式为「技能总结」。用户刚在另一个对话中完成了一项任务，你的职责是把这次任务的通用方法论提炼成技能沉淀。⚠️ 本模式硬性禁令：禁止执行任何 git 命令（不 add、不 commit）；禁止修改/创建任何项目代码文件；你的唯一产出是方法论沉淀。你必须：① 从素材包提炼技能主题；② 调用 project_record 工具（action=write，name=技能-<主题>，主题由你从首问提炼）落盘方法论；③ 最后单独一行以「【总结师沉淀】」开头输出 3~5 条编号精华结论（以【技能沉淀】开头，不含 git 信息），供琥珀色箭头一键回注原对话。');
        } else if (_smMode === 'forum') {
            // 【智能体广场模式】精炼成社区帖并调 forum_write 发帖，禁止 git 提交
            lines.push('【总结师任务·智能体广场模式】你是一个独立的总结师，当前模式为「智能体广场」。用户刚在另一个对话中完成了一项任务，你的职责是把这次任务写成一篇面向朱峰社区（智能体广场板块）的分享帖并发布。⚠️ 本模式硬性禁令：禁止执行任何 git 命令；禁止修改/创建任何项目代码文件。你必须：① 从素材包提炼本次任务的亮点（做了什么、效果如何、用了什么巧妙方法）；② 调用 forum_write 工具发帖——topic 固定传「总结」，body 为纯文本，排版格式是硬性要求：第 1 行单独一行放标题（≤20字，吸引人、不加书名号），第 2 行必须空行，正文用「【小节标题】」分 3~5 节（如【干了什么】【怎么解决的】【效果】【可复用经验】），每节之间空一行，节内要点逐行写（一条一行，可用 1. 2. 编号），严禁把全文挤成一段无换行的长文；总字数 ≤1500（工具硬限 5000，留余量）；必须真实调用 forum_write 工具发帖，不调用视为未完成，禁止伪造 post_id；③ 发帖成功后从工具返回结果中取 post_id，并调用 project_record 工具（action=write，name=总结-<主题>）本地落盘，内容含 post_id；若 forum_write 发帖失败（报错/超时），不得伪造 post_id，降级为仅本地落盘并在内容开头注明「发帖失败：<原因>」；④ 最后单独一行以「【总结师沉淀】」开头输出 3~5 条编号精华结论（含帖子链接或发帖状态），供琥珀色箭头一键回注原对话。');
        } else {
            // 【工作总结模式】默认：git 提交 + 本地落盘
            lines.push('【总结师任务】你是一个独立的总结师。用户刚在另一个对话中完成了一项任务（策划→执行→审核闭环），你的职责是「向后看」：把这个任务的经验沉淀下来，而不是策划新任务（那是策划师的职责）。你必须：① 从素材包提炼任务主题；② 总结固定结构的沉淀结论（必须包含「技能方法」：这个问题是依靠什么方法解决的——定位手段、排查路径、关键工具、验证方式，并说明下次遇到同类问题如何复用该方法）；③ 执行 git 保存本次任务改动：cd 到「== 项目路径 ==」给出的目录（禁止在其他目录执行），先 git add -A，再按命名规范提交——标题格式：[答] 改动摘要(涉及文件名)，摘要从最终答复的改动清单提炼，20 字以内，禁止使用 "[session-start]"、"[session-end]" 等无信息量标题；示例：[答] app-quick-create.js下拉加暗色背景；④ 调用 project_record 工具把总结落盘为记录「总结-<任务主题>」（主题由你从首问提炼，不要让用户手填），落盘内容必须包含本次 git 提交的 commit hash 与提交标题；⑤ 最后单独一行以「【总结师沉淀】」开头输出 3~5 条编号精华结论（含 git 提交信息），供琥珀色箭头一键回注原对话。');
        }
        lines.push('');
        lines.push('== 任务目标（原对话首问） ==');
        lines.push(String(ctxData.firstQ || '').replace(/\s+/g, ' ').trim().slice(0, 800));
        lines.push('');
        lines.push('== 项目路径 ==');
        lines.push(ctxData.projPath || '（未提供）');
        if (ctxData.thinkerConcls && ctxData.thinkerConcls.length) {
            lines.push('');
            lines.push('== 策划师结论（最近 ' + ctxData.thinkerConcls.length + ' 条） ==');
            ctxData.thinkerConcls.forEach(function (c, ci) { lines.push('【策划结论 ' + (ci + 1) + '】' + String(c).slice(0, 6000)); });
        }
        if (ctxData.qcConcls && ctxData.qcConcls.length) {
            lines.push('');
            lines.push('== 审核结论（最近 ' + ctxData.qcConcls.length + ' 条） ==');
            ctxData.qcConcls.forEach(function (c, ci) { lines.push('【审核结论 ' + (ci + 1) + '】' + String(c).slice(0, 6000)); });
        }
        lines.push('');
        lines.push('== 最终完成答复（最近一条「✅ 任务完成」） ==');
        lines.push(String(ctxData.finalReply || '').slice(0, 6000));
        if (ctxData.projTree) {
            lines.push('');
            lines.push('== 项目目录概览（浅层） ==');
            lines.push(ctxData.projTree);
        }
        lines.push('');
        lines.push('== 沉淀输出固定结构（落盘内容必须包含） ==');
        if (_smMode === 'skill') {
            lines.push('【技能主题】一句话技能名；【问题场景】这类问题什么情况下出现；【解决方法/工具链】怎么解决的（定位手段、排查路径、关键工具调用、验证方式）；【复用套路】下次遇到同类问题的直接操作步骤；【注意事项】易错点与边界。');
            lines.push('落盘方式：调用 project_record（action=write，name=技能-<主题>）。这是硬性要求，不落盘视为未完成。禁止 git 提交。');
        } else if (_smMode === 'forum') {
            lines.push('【总结主题】一句话任务名；【帖子标题与链接】发帖返回的 post_id 与帖子地址；【帖子要点】发布内容的核心摘要；【发帖状态】成功（含 post_id）或失败（含原因，禁止伪造）；【遗留事项】无或二期项。');
            lines.push('落盘方式：先调用 forum_write（topic=总结）发帖，再调用 project_record（action=write，name=总结-<主题>，含 post_id）。两步都是硬性要求；发帖失败则降级仅落盘并注明失败原因。禁止 git 提交。');
        } else {
            lines.push('【总结主题】一句话任务名；【结论】做了什么、结果如何；【技能方法】这个问题是依靠什么方法/思路/工具链解决的（如：定位手段、排查路径、关键工具调用、验证方式），以及下次遇到同类问题如何直接复用这套方法（注意：写通用方法论「怎么解决的、下次的套路」，不要写本项目具体坑位——那些放【可复用经验】）；【改动清单】涉及哪些文件/记录；【git 提交】commit hash + 提交标题（格式 [答] 改动摘要(文件名)）；【可复用经验】下次同类任务直接可用的做法与坑；【遗留事项】未完成/二期项。');
            lines.push('落盘方式：先完成 git 提交，再调用 project_record（action=write，name=总结-<主题>）。这是硬性要求，不落盘视为未完成。');
        }
        var _prompt = lines.join('\n');
        var selfApp = (typeof App !== 'undefined') ? App : null;
        if (!selfApp || typeof selfApp.createChatBox !== 'function') {
            Store.addLog('error', chat.id, 'summarizer', '总结师失败：无法创建新对话');
            self._stepToast('总结师失败：无法创建新对话', false);
            return;
        }
        var canvasArea = document.getElementById('canvasArea');
        var _cw = canvasArea ? canvasArea.clientWidth : window.innerWidth;
        var _ch = canvasArea ? canvasArea.clientHeight : window.innerHeight;
        // 【坐标修复】与审核员同款：内联 style 无效时改用 getBoundingClientRect 相对 canvasArea
        // 取真实渲染位置，并按画布缩放换算回逻辑坐标。原写法只读内联值 + 不校正缩放，
        // 导致总结师新对话被 clamp 到视口右下角很远的地方。
        var _caOff = { left: 0, top: 0 };
        try { if (canvasArea) { var _smCaR = canvasArea.getBoundingClientRect(); _caOff = { left: _smCaR.left, top: _smCaR.top }; } } catch (eSmCa) {}
        /* 【源坐标修复】不再信任 style.left（可能被历史钉回逻辑写入屏幕像素值如95358导致新窗飞到±20000钳制边缘），
           优先用 getBoundingClientRect 反算画布逻辑坐标：(rect-画布区原点-视图偏移)/缩放，style.left 仅作兜底 */
        var _srcL = NaN, _srcT = NaN;
        try {
            var _sc0 = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc0 > 0)) _sc0 = 1;
            var _cv0 = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
            var _r0 = chat.el.getBoundingClientRect();
            var _caEl0 = document.getElementById('canvasArea');
            var _caR0 = _caEl0 ? _caEl0.getBoundingClientRect() : { left: 0, top: 0 };
            _srcL = Math.round((_r0.left - _caR0.left - (_cv0.x || 0)) / _sc0);
            _srcT = Math.round((_r0.top - _caR0.top - (_cv0.y || 0)) / _sc0);
        } catch (eSrc0) {}
        /* 【v6 交叉校验】rect 反算依赖 canvasGetView 坐标系一致，实测会得出 95350 类垃圾值把新窗钉飞；
           style.left 由拖拽模块直接写入，最可靠。两源相差 >1500 时以 style.left 为准 */
        var _stL = parseFloat(chat.el && chat.el.style.left), _stT = parseFloat(chat.el && chat.el.style.top);
        if (isFinite(_stL) && isFinite(_stT) && (isNaN(_srcL) || isNaN(_srcT) || Math.abs(_srcL - _stL) + Math.abs(_srcT - _stT) > 1500)) {
            console.log('[定位交叉校验] rect反算(', _srcL, _srcT, ') 与 style.left(', _stL, _stT, ') 不符，采用 style.left');
            _srcL = _stL; _srcT = _stT;
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = parseInt(chat.el && chat.el.style.left, 10);
            _srcT = parseInt(chat.el && chat.el.style.top, 10);
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            try {
                var _smSrcR = chat.el.getBoundingClientRect();
                var _smSc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
                // 【平移校正】扣除画布整体平移量(view.x/view.y)，防止平移后子对话跑到0点
                var _smCv = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
                _srcL = Math.round((_smSrcR.left - _caOff.left - (_smCv.x || 0)) / _smSc);
                _srcT = Math.round((_smSrcR.top - _caOff.top - (_smCv.y || 0)) / _smSc);
            } catch (eSmR) { _srcL = 40; _srcT = 40; }
        }
        if (isNaN(_srcL)) _srcL = 40;
        if (isNaN(_srcT)) _srcT = 40;
        /* 【坐标同系修复】画布逻辑坐标可平移到任意值，不能钳制到视口 [_cw-440/_ch-160]——
           否则画布平移后总结师新窗会被视口钳制拉回视口边缘，表现为"飞很远"。
           与策划师/审核员 fan() 修复同口径：只防 NaN/极端值（±20000） */
        var _smScW = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
        /* 【定位·习惯优先】总结师新窗优先放回用户上次拖拽到的位置（SpawnHabit 习惯记忆），无习惯才用源窗右侧默认 */
        var _tX, _tY;
        /* 【定位统一·右下角10,10】弃用习惯记忆（脏数据会致飞窗）：新窗固定在源窗右下角外10px */
        var _smOffW = Math.round((chat.el && chat.el.offsetWidth || 420) / _smScW);
        var _smOffH = Math.round((chat.el && chat.el.offsetHeight || 300) / _smScW);
        var _tX = _srcL + _smOffW + 10;
        var _tY = _srcT + _smOffH + 10;
        /* 【重叠修复】连续快速创建多个总结师时，同源同偏移会算出完全相同坐标导致两窗完全重叠。
           落点已被占用则向右下级联 +48/+48，直到找到空位（最多级联 20 次） */
        try {
            var _occupied = function (x, y) {
                var boxes = (window.App && App.chatBoxes) || [];
                for (var i = 0; i < boxes.length; i++) {
                    var b = boxes[i];
                    if (!b || !b.el || !document.body.contains(b.el)) continue;
                    if (Math.abs((parseFloat(b.el.style.left) || 0) - x) < 40 && Math.abs((parseFloat(b.el.style.top) || 0) - y) < 40) return true;
                }
                return false;
            };
            var _cascade = 0;
            while (_occupied(_tX, _tY) && _cascade < 20) { _tX += 48; _tY += 48; _cascade++; }
        } catch (eCascade) {}
        if (typeof _tX !== 'number' || isNaN(_tX)) _tX = 120;
        if (typeof _tY !== 'number' || isNaN(_tY)) _tY = 120;
        // 【修复】画布逻辑坐标可无限平移，源窗可能在9万+处；钳制±20000会把新窗强行拉离源窗。
        // 只防 NaN/Infinity，不再限制范围。
        if (!isFinite(_tX)) _tX = 120;
        if (!isFinite(_tY)) _tY = 120;
        // 【调试】醒目打印源窗与新窗坐标，便于排查
        var _dbgStr = '%c[总结师坐标调试]%c 源窗(_srcL,_srcT)=(' + _srcL + ',' + _srcT + ')  新窗计算值(_tX,_tY)=(' + _tX + ',' + _tY + ')  源窗宽=' + (chat.el && chat.el.offsetWidth);
        var _srcMid = chat.modelId || '';
        var newChat = selfApp.createChatBox(_tX, _tY, _srcMid || null, true);
        try {
            var _ncL = parseInt(newChat && newChat.el && newChat.el.style.left, 10);
            var _ncT = parseInt(newChat && newChat.el && newChat.el.style.top, 10);
            _dbgStr += '  ⇒ 新窗最终实际落点(left,top)=(' + _ncL + ',' + _ncT + ')';
        } catch (eDbg2) {}
        try {
            console.log(_dbgStr, 'background:#ff5722;color:#fff;font-size:16px;font-weight:bold;padding:4px 8px;', 'font-size:16px;font-weight:bold;color:#ff5722;');
        } catch (eDbg) {}
        if (!newChat) {
            self._stepToast('总结师失败：新对话创建被拦截（窗口数量限制）', false);
            return;
        }
        try { newChat.el._isSummarizerChat = true; newChat.el._summarizerSrcId = chat.id; } catch (e) {}
        /* 【出生保护】标记创建时刻，10s 内 chatbox-relative-restore 不得校正/采集此窗，
           防止陈旧父子偏移基准把新窗拽到远处（"突然飞走"的根源） */
        try { newChat.el._zfFreshSpawn = Date.now(); } catch (e) {}
        // ===== 【角色挂接】总结师新窗优先绑定角色分组里名为「总结师」的角色；找不到则回退用户默认（无角色）=====
        try {
            var _sumApp = selfApp;
            var _sumSrcRole = null;
            try { _sumSrcRole = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null'); } catch (e) {}
            var _sumDoApply = function (role, how) {
                if (!role || !role.id) return false;
                try {
                    localStorage.setItem('zf_role_chat_' + newChat.id, JSON.stringify({
                        id: role.id, name: role.name, avatar: role.avatar, prompt: role.prompt || '',
                        chat_skin: role.chat_skin || ''
                    }));
                    try { if (typeof _sumApp._refreshRoleBadge === 'function') _sumApp._refreshRoleBadge(newChat.el); } catch (e) {}
                    // 【标题同步】把新对话标题改成「头像 角色名」，否则肉眼看不出角色已切换
                    try {
                        var _sTitleEl = newChat.el && newChat.el.querySelector('.title');
                        if (_sTitleEl) {
                            _sTitleEl.textContent = (role.name || '总结师') + ' · 总结';
                            _sTitleEl.title = '总结沉淀对话（角色：' + (role.name || '') + '）';
                        }
                    } catch (e) {}
                    try { if (typeof Theme !== 'undefined' && Theme.applyToBox && newChat.el) Theme.applyToBox(newChat.el, role.chat_skin || ''); } catch (e) {}
                    try {
                        fetch('/api/roles', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'select', box: newChat.id, role_id: role.id })
                        }).catch(function () {});
                    } catch (e) {}
                    Store.addLog('info', newChat.id, 'summarizer', '已绑定角色（' + how + '）：' + (role.name || role.id));
                    return true;
                } catch (e) { return false; }
            };
            // 【兜底无角色】同步直写仅用于 200ms 内抢占绑定权（防包装器继承/沿用覆盖），
            // 200ms 后查列表：找到「总结师」则覆盖绑定；找不到则清除继承角色，回退用户默认（无角色）
            try { newChat._zfRoleDirect = true; } catch (eZF3) {}
            if (_sumSrcRole && _sumSrcRole.id) _sumDoApply(_sumSrcRole, '过渡·' + (_sumSrcRole.name || ''));
            setTimeout(function () {
                try {
                    fetch('/api/roles?box=' + encodeURIComponent(newChat.id))
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            var _sHit = null;
                            ((res && res.roles) || []).forEach(function (r) {
                                if (String(r.name || '').trim() === '总结师') _sHit = r;
                            });
                            if (_sHit && _sHit.id) { _sumDoApply(_sHit, '指定·总结师'); return; }
                            // 角色库无「总结师」：清除过渡继承的角色，回退用户默认（无角色）
                            var _hadInherit = _sumSrcRole && _sumSrcRole.id;
                            try { localStorage.removeItem('zf_role_chat_' + newChat.id); } catch (e) {}
                            try { if (typeof _sumApp._refreshRoleBadge === 'function') _sumApp._refreshRoleBadge(newChat.el); } catch (e) {}
                            try {
                                var _sTitleEl = newChat.el && newChat.el.querySelector('.title');
                                if (_sTitleEl && _hadInherit) { _sTitleEl.textContent = '总结'; _sTitleEl.title = '总结沉淀对话（默认角色）'; }
                            } catch (e) {}
                            try {
                                fetch('/api/roles', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'select', box: newChat.id, role_id: '' })
                                }).catch(function () {});
                            } catch (e) {}
                            if (_hadInherit) Store.addLog('info', newChat.id, 'summarizer', '角色库无「总结师」角色，已回退默认（无角色）');
                        }).catch(function () {});
                } catch (e) {}
            }, 200);
        } catch (e) {}
        // 继承项目
        var _inheritPid = chat.projectId || (typeof App !== 'undefined' && App._activeProjectId) || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || '';
        if (_inheritPid) {
            newChat.projectId = _inheritPid;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) { if (Store.data.chatBoxes[i].id === newChat.id) { Store.data.chatBoxes[i].projectId = _inheritPid; break; } }
            try { if (typeof DB !== 'undefined' && DB.setNodeProject) DB.setNodeProject(newChat.id, _inheritPid).catch(function () {}); } catch (e) {}
        }
        try { Store.saveChatBox(newChat, true); } catch (e) {}
        Store.addLog('info', chat.id, 'summarizer', '总结师已发起：新对话 ' + newChat.id + '，素材包 ' + _prompt.length + ' 字');
        self._stepToast('总结师已发起：新对话已创建并发送沉淀素材包', true);
        // 【琥珀色方向箭头】原始对话 ↔ 总结师对话（沉淀回注通道）
        try { if (window.ZFSummarizerArrow && typeof window.ZFSummarizerArrow.create === 'function') window.ZFSummarizerArrow.create(chat, newChat); } catch (e) {}
        setTimeout(function() {
            try {
                if (typeof selfApp.addMsg === 'function') selfApp.addMsg(newChat.el, '（总结师素材包，共 ' + _prompt.length + ' 字）', 'user', newChat.modelId);
                newChat.history.push({ role: 'user', content: _prompt, _summarizerRound: true });
                Store.addLog('info', newChat.id, 'summarizer', '总结素材包已注入并发送');
                selfApp.sendToModel(newChat.el, newChat);
            } catch (e) {
                Store.addLog('error', newChat.id, 'summarizer', '总结素材包发送异常: ' + e.message);
            }
        }, 400);
    },

    _thinkerExpand: function(box, chat) {
        var self = this;
        // 收集原对话上下文：完整对话全量问答（首问标记为源头，问答按时间正序全量保留）
        // 【死代码清理】旧版同时收集 _lastAssistant/_lastRealUserQ 组装 aiReply/userQ 字段，
        // 经核实 _thinkerExpandSend 已不消费这两个字段，现已移除。
        var _firstQ = '';
        var _allPairs = []; // 全量问答对 {q, a}（a 可能为空：问题还没被回答）
        var _cur = null; // 顺序遍历，构建全量问答序列
        for (var _i = 0; _i < chat.history.length; _i++) {
            var _h = chat.history[_i];
            if (!_h) continue;
            if (_h.role === 'assistant' && !_h._meta) {
                if (_cur) { _cur.a = (_cur.a ? _cur.a + '\n' : '') + (_h.content || ''); }
                continue;
            }
            if (_h.role === 'user' && !_h._guardInject && !_h._verifyRound && !_h._continueRound && !_h._thinkerRound && !_h._summarizerRound && _msgText(_h).indexOf('（策划师素材包') !== 0 && _msgText(_h).indexOf('（总结师素材包') !== 0) {
                _cur = { q: _msgText(_h), a: '' };
                _allPairs.push(_cur);
                _firstQ = _allPairs[0].q; // 第一条真实用户提问就是首问
            }
        }
        if (!_allPairs.length) {
            Store.addLog('warn', chat.id, 'thinker', '策划师失败：原对话没有任何用户问题可扩展');
            self._stepToast('策划师失败：请先在对话里提出一个问题', false);
            return;
        }
        var _srcRoleName = '';
        try {
            var _sr = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null');
            if (_sr && _sr.name) _srcRoleName = String(_sr.name);
        } catch (e) {}
        var _projPath = '';
        var _pid = chat.projectId || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || (typeof App !== 'undefined' && App._activeProjectId) || '';
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        // 素材加厚：异步拉取项目目录浅层树 + 最近修改文件前 20（策划师先调查后策划）
        // 【审核补齐】第三项：原对话任务清单状态
        var _projTree = '', _recentFiles = '', _taskListInfo = '';
        // 【改进①】收集历史策划师结论：从原对话历史中提取「策划师给你的扩展结论/扩展思考」
        // 类回注消息体（均为 user 消息），作为已确认参数锚点注入新素材包，防止跨轮重复追问。
        var _thinkerConcls = [];
        for (var _ti2 = 0; _ti2 < chat.history.length; _ti2++) {
            var _th = chat.history[_ti2];
            if (!_th || !_th.content) continue;
            var _tc = _msgText(_th);
            if (_th.role === 'user' && _tc.indexOf('这是策划师给你的扩展结论') !== -1) {
                // 回注消息体：首个空行之后的全部内容即为结论原文
                var _body = _tc.slice(_tc.indexOf('\n\n') !== -1 ? _tc.indexOf('\n\n') + 2 : 0);
                if (_body.trim()) _thinkerConcls.push(_body.trim());
            } else if (_th.role === 'user' && _tc.indexOf('这是策划师的扩展思考') !== -1) {
                var _body2 = _tc.slice(_tc.indexOf('\n\n') !== -1 ? _tc.indexOf('\n\n') + 2 : 0);
                if (_body2.trim()) _thinkerConcls.push(_body2.trim());
            }
        }
        // 去重（同一结论可能被多次回注）并限制最多保留最近 3 条
        var _seen = {};
        _thinkerConcls = _thinkerConcls.filter(function (c) { var k = c.slice(0, 80); if (_seen[k]) return false; _seen[k] = 1; return true; }).slice(-3);
        var _finishSend = function () {
            self._thinkerExpandSend(box, chat, {
                projPath: _projPath, firstQ: _firstQ,
                allPairs: _allPairs, roleName: _srcRoleName,
                projTree: _projTree, recentFiles: _recentFiles, taskListInfo: _taskListInfo,
                thinkerConcls: _thinkerConcls
            });
        };
        var _pending = 0, _sent = false;
        var _trySend = function () { if (!_sent && _pending <= 0) { _sent = true; _finishSend(); } };
        // 原对话任务清单状态（Tools.execute 异步，失败静默降级为空）
        if (typeof Tools !== 'undefined' && Tools.execute) {
            _pending++;
            try {
                Tools.execute('task_list', { action: 'show' }, { chatId: String(chat.id) })
                    .then(function (r) {
                        try {
                            var _d = (r && r.data) ? r.data : r;
                            var _lists = (_d && (_d.list || _d.lists)) || null;
                            if (_lists) {
                                var _arr = Array.isArray(_lists) ? _lists : [_lists];
                                var _out = [];
                                for (var _li = 0; _li < _arr.length; _li++) {
                                    var _lst = _arr[_li] || {};
                                    var _tasks = _lst.tasks || [];
                                    _out.push('清单「' + (_lst.title || _lst.id || ('#' + (_li + 1))) + '」（' + _tasks.length + ' 项）：');
                                    for (var _ti = 0; _ti < _tasks.length && _ti < 20; _ti++) {
                                        var _tk = _tasks[_ti] || {};
                                        var _st = { pending: '待办', in_progress: '进行中', completed: '已完成', skipped: '已跳过' }[_tk.status] || (_tk.status || '未知');
                                        _out.push('  ' + (_ti + 1) + '. [' + _st + '] ' + (_tk.title || ''));
                                    }
                                    if (_tasks.length > 20) _out.push('  …（共 ' + _tasks.length + ' 项，仅列前 20）');
                                }
                                _taskListInfo = _out.join('\n');
                            }
                        } catch (eTl) {}
                    })
                    .catch(function () {})
                    .then(function () { _pending--; _trySend(); });
            } catch (eTl2) { _pending--; _trySend(); }
        }
        if (_projPath) {
            _pending++;
            try {
                fetch('/api/fs/browse?path=' + encodeURIComponent(_projPath) + '&limit=2000')
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        if (j && j.ok && ((j.files && j.files.length) || (j.dirs && j.dirs.length))) {
                            var _ds = (j.dirs || []).slice(0, 40).map(function (d) { return '[目录] ' + (d.name || '') + '/'; });
                            var _fs = (j.files || []).slice(0, 300).map(function (f) { return { name: f.name || '', size: f.size, mt: f.mtime || f.mtimeMs || f.modified || 0 }; });
                            _projTree = _ds.concat(_fs.map(function (f) { return '[文件] ' + f.name + (f.size ? ' (' + f.size + 'B)' : ''); })).join('\n');
                            _recentFiles = _fs.slice().sort(function (a, b) { return (b.mt || 0) - (a.mt || 0); }).slice(0, 20).map(function (f) {
                                var _t = '';
                                try { if (f.mt) _t = new Date(f.mt > 1e12 ? f.mt : f.mt * 1000).toISOString().slice(0, 16).replace('T', ' '); } catch (eT) {}
                                return _t + '  ' + f.name;
                            }).join('\n');
                        }
                    })
                    .catch(function () {})
                    .then(function () { _pending--; _trySend(); });
            } catch (eFs) { _pending--; _trySend(); }
        } else {
            _trySend();
        }
    },

    _thinkerExpandSend: function(box, chat, ctxData) {
        var self = this;
        var lines = [];
        lines.push('【策划师任务】你是一个独立的策划师。用户在另一个对话中提出了一个任务/问题，你的职责是先调查（阅读项目文件/上下文，弄清现状），再为这个任务做出完整策划。策划内容包括：① 结构化的任务计划（拆解成清晰的步骤/阶段，标注先后依赖）；② 实现方法（每个步骤怎么做、用什么工具/技术、注意什么坑）；③ 愿景（这个任务做完后理想中的最终形态是什么样）；④ 可行性把关（指出风险点与备选方案）。本对话允许使用工具：迭代策划案时优先 read_file 读取已落盘文件，确认定稿后按规则 2.5② 用 write_file 落盘，其余情况不修改文件。');
        lines.push('');
        lines.push('== 任务背景 ==');
        lines.push('项目路径：' + (ctxData.projPath || '（未提供）'));
        if (ctxData.roleName) lines.push('原对话角色：' + ctxData.roleName + '（新对话已继承该角色人设与口吻，请以同一角色身份思考）');
        if (ctxData.firstQ) lines.push('任务最初的问题（源头）：' + String(ctxData.firstQ).replace(/\s+/g, ' ').trim().slice(0, 800));
        var _pairs = ctxData.allPairs || [];
        if (_pairs.length) {
            lines.push('');
            lines.push('== 完整对话记录（原对话全部用户提问与 AI 回答，按时间正序） ==');
            var _PAIR_Q_MAX = 2000, _PAIR_A_HEAD = 1200, _PAIR_A_TAIL = 1200;
            // 【超长对话总预算】全量注入约每轮 3200 字，50+ 轮可能撑爆新对话上下文。
            // 总预算 80000 字：从最新一往前保留完整轮次，更早的轮次只保留用户问题（各截 300 字）+ AI 回答 200 字摘要。
            var _PAIR_TOTAL_BUDGET = 80000;
            var _est = 0;
            _pairs.forEach(function (p) { _est += Math.min(String(p.q || '').length, _PAIR_Q_MAX) + Math.min(String(p.a || '').length, _PAIR_A_HEAD + _PAIR_A_TAIL); });
            var _overBudget = _est > _PAIR_TOTAL_BUDGET;
            if (_overBudget) lines.push('（注：原对话轮次极多，已按预算压缩——较近轮次保留完整内容，更早轮次仅保留摘要）');
            _pairs.forEach(function(p, i) {
                var _q = String(p.q || '').replace(/\s+/g, ' ').trim();
                var _a = String(p.a || '').trim();
                var _over = false;
                if (_overBudget) {
                    // 超预算：前半部分（较早轮次）压缩为摘要
                    var _half = Math.floor(_pairs.length / 2);
                    if (i < _half) {
                        _over = true;
                        _q = _q.slice(0, 300) + (_q.length > 300 ? '…（截断）' : '');
                        _a = _a.slice(0, 200) + (_a.length > 200 ? '…（摘要）' : '');
                    }
                }
                if (!_over && _q.length > _PAIR_Q_MAX) _q = _q.slice(0, _PAIR_Q_MAX) + '…（截断）';
                lines.push('');
                lines.push('【第 ' + (i + 1) + ' 轮 · 用户】' + _q);
                if (_a) {
                    var _cut = _over ? _a : (_a.length > (_PAIR_A_HEAD + _PAIR_A_TAIL) ? (_a.slice(0, _PAIR_A_HEAD) + '\n……（中间省略）……\n' + _a.slice(-_PAIR_A_TAIL)) : _a);
                    lines.push('【第 ' + (i + 1) + ' 轮 · AI】' + _cut);
                } else {
                    lines.push('【第 ' + (i + 1) + ' 轮 · AI】（该问题尚未被回答）');
                }
            });
            lines.push('');
            lines.push('（共 ' + _pairs.length + ' 轮问答，以上为原对话完整脉络，请结合它理解任务演进过程）');
        }
        if (ctxData.thinkerConcls && ctxData.thinkerConcls.length) {
            lines.push('');
            lines.push('== 历史策划师结论（此前策划师已给出并经用户带回原对话的确认口径） ==');
            ctxData.thinkerConcls.forEach(function (c, ci) {
                lines.push('【历史结论 ' + (ci + 1) + '】' + String(c).slice(0, 6000));
            });
            lines.push('（重要：以上结论中已确认的参数/口径视为锁定。严禁重复追问已确认过的信息；本轮只补新的关键缺口或在结论上做增量收敛。若需要修订口径，必须明确说明「覆盖哪条历史结论」。）');
        }
        if (ctxData.projTree) {
            lines.push('');
            lines.push('== 项目目录概览（浅层，节选） ==');
            lines.push(ctxData.projTree);
        }
        if (ctxData.taskListInfo) {
            lines.push('');
            lines.push('== 原对话任务清单状态 ==');
            lines.push(ctxData.taskListInfo);
        }
        if (ctxData.recentFiles) {
            lines.push('');
            lines.push('== 最近修改的文件（前 20，新→旧） ==');
            lines.push(ctxData.recentFiles);
        }
        lines.push('');
        lines.push('== 你的任务 ==');
        lines.push('1. 先调查：阅读项目文件/上下文弄清现状，必要时可向用户追问补充关键信息；');
        lines.push('2. 如果任务存在关键信息缺口（范围、技术选型、验收标准、约束条件等），第一轮回复必须先列出 3 个编号澄清问题（格式：① …… ② …… ③ ……），等用户回答后再出策划案；信息已足够时可跳过澄清直接出案；');
        lines.push('2.5 硬性规则——参数记忆与收敛：①素材包「历史策划师结论」中已确认的参数（规模/预算/周期/形态/城市等）视为锁定，严禁再次向用户追问；②确认过的最终策划必须落盘：调用 write_file 写入 private/记忆/ 目录（如 private/记忆/策划案-<主题>.md），文件开头声明版本号与「覆盖此前版本」；③后续修订只做增量，引用一律以最新落盘文件为准；④若素材包中的项目上下文与用户任务无关（如生活类任务附带软件项目目录），声明一次判定后忽略该噪音，不要反复声明。');
        lines.push('3. 输出完整策划案，必须包含四个部分：');
        lines.push('   【任务计划】结构化拆解：分阶段/分步骤列出，标注先后顺序与依赖关系；');
        lines.push('   【实现方法】每一步具体怎么做：用什么工具/技术、关键实现思路、注意的坑；');
        lines.push('   【愿景】任务完成后理想中的最终形态：效果、体验、可扩展方向；');
        lines.push('   【风险与备选】主要风险点及应对/备选方案；');
        lines.push('4. 用户可能在本对话中继续回答你的追问，请根据回答迭代策划案；本对话允许使用工具（read_file/write_file/ask_user/task_list 等），迭代时优先 read_file 读取已落盘文件，规则 2.5② 的 write_file 落盘为强制要求；');
        lines.push('5. 当策划案足够完整后，最后必须单独一行以「【策划师结论】」开头，输出 3~5 条带优先级的编号行动项（① 最高优先级），单行内完成，供用户一键带回原对话执行。');
        lines.push('   格式示例：【策划师结论】① 先做X（改A文件）；② 再做Y；③ 最后验证Z【策划案路径：private/记忆/策划案-<主题>.md】（这条会被紫色箭头一键带回原对话执行）');
        lines.push('5.5 硬性规则——策划案路径标记：结论行末尾必须附「【策划案路径：<你已 write_file 落盘的 md 完整路径>】」，且该路径必须是本对话真实落盘过的文件（先 write_file 再写结论）；施工队与主对话以此标记定位唯一任务真源 md，缺失或路径未落盘视为策划未完成。');
        /* 【执行规划】用户在数量弹窗选了“后期归谁干”，策划案必须预写对应执行规划章节 */
        try {
            var _pe = window._zfPlannerExecNext;
            /* 只有“分组施工·协作分片”才需要预写执行规划；单AI直接干、赛马对比均无需规划 */
            if (_pe && _pe.mode === 'crew' && (Date.now() - (_pe.ts || 0) < 60000)) {
                window._zfPlannerExecNext = null; // 一次性消费
                lines.push('');
                lines.push('== 强制要求：策划案必须包含【执行规划】章节 ==');
                lines.push('用户已指定本任务后期由 🐝 分组施工·协作分片 执行（将派 ' + _pe.n + ' 名 worker 同项目共干一活）。');
                lines.push('因此策划案定稿时，除四个标准部分外，必须额外写一个【执行规划】章节，按队数拆成 ' + _pe.n + ' 个分片任务书，每个分片严格按以下格式：');
                lines.push('  ### 分片N：<一句话职责>');
                lines.push('  - 允许改动的文件：<明确文件路径清单，分片之间严禁重叠>');
                lines.push('  - 具体任务：<这个 worker 要做的所有事，写清步骤>');
                lines.push('  - 验收标准：<怎样算干完，可检查>');
                lines.push('  - 禁止事项：<不许碰什么、不许越界改什么>');
                lines.push('拆分原则：按文件/模块边界切，两个分片不允许改同一个文件；公共文件（如入口js/配置）只分给其中一个分片，或留给你在结论中标注由主对话统一处理。');
                lines.push('该章节会被施工队直接读取用于派单/施工，务必写成 worker 能独立照办的施工图，不要写抽象描述。');
            }
        } catch (ePE) {}
        var _prompt = lines.join('\n');
        // 【多视角蜂群】第2窗起注入专属视角，要求差异化输出
        var _qSwarmNo = 1;
        try {
            var _qBoxes = (window.App && App.chatBoxes) || [];
            for (var _qi = 0; _qi < _qBoxes.length; _qi++) {
                if (_qBoxes[_qi] && _qBoxes[_qi].el && _qBoxes[_qi].el._isQcChat && String(_qBoxes[_qi].el._qcSrcId) === String(chat.id)) _qSwarmNo++;
            }
        } catch (eQ) {}
        if (_qSwarmNo >= 2) {
            var _QVIEWS = ['严谨性核对（逐条对照需求，专抓口径不一致与遗漏）', '性能视角（性能/内存/卡顿隐患优先）', '安全视角（注入/XSS/权限/敏感信息优先）', '边界情况（空值/极端输入/异常路径优先）', '用户体验视角（交互反馈/提示文案/可恢复性优先）'];
            var _qView = _QVIEWS[(_qSwarmNo - 2) % _QVIEWS.length];
            lines.push('');
            lines.push('== 你的专属视角（多视角蜂群） ==');
            lines.push('你是「审核员#' + _qSwarmNo + '」，同任务已有其他审核员窗并行工作。本窗专属视角：' + _qView + '。');
            lines.push('请优先从这个视角复核，问题必须与其他审核员差异化，不要重复通用检查项。');
        }
        // 【多视角蜂群】第2窗起注入专属视角，要求差异化输出
        var _swarmNo = 1;
        try {
            var _boxes = (window.App && App.chatBoxes) || [];
            for (var _si = 0; _si < _boxes.length; _si++) {
                if (_boxes[_si] && _boxes[_si].el && _boxes[_si].el._isThinkerChat && String(_boxes[_si].el._thinkerSrcId) === String(chat.id)) _swarmNo++;
            }
        } catch (eS) {}
        if (_swarmNo >= 2) {
            var _TVIEWS = ['技术可行性（方案能否真实落地、技术选型的风险与依赖）', '成本与效率（工作量/时间/维护成本最优的路径）', '用户体验导向（以终端体验为最高优先级的方案）', '风险与备选（假设主流方案失败时的Plan B与降级路线）'];
            var _tView = _TVIEWS[(_swarmNo - 2) % _TVIEWS.length];
            lines.push('');
            lines.push('== 你的专属视角（多视角蜂群） ==');
            lines.push('你是「策划师#' + _swarmNo + '」，同任务已有其他策划师窗并行工作。本窗专属视角：' + _tView + '。');
            lines.push('请优先从这个视角策划，观点必须与其他策划师差异化，不要复述通用套话；仍按【策划师结论】格式输出，但在结论中标注你的视角名。');
        }
        var selfApp = (typeof App !== 'undefined') ? App : null;
        if (!selfApp || typeof selfApp.createChatBox !== 'function') {
            Store.addLog('error', chat.id, 'thinker', '策划师失败：无法创建新对话');
            self._stepToast('策划师失败：无法创建新对话', false);
            return;
        }
        var canvasArea = document.getElementById('canvasArea');
        var _cw = canvasArea ? canvasArea.clientWidth : window.innerWidth;
        var _ch = canvasArea ? canvasArea.clientHeight : window.innerHeight;
        var _T_MAX_OFF = 500;
        var _caOff = { left: 0, top: 0 };
        try { if (canvasArea) { var _caR = canvasArea.getBoundingClientRect(); _caOff = { left: _caR.left, top: _caR.top }; } } catch (eCa) {}
        /* 【源坐标修复】不再信任 style.left（可能被历史钉回逻辑写入屏幕像素值如95358导致新窗飞到±20000钳制边缘），
           优先用 getBoundingClientRect 反算画布逻辑坐标：(rect-画布区原点-视图偏移)/缩放，style.left 仅作兜底 */
        var _srcL = NaN, _srcT = NaN;
        try {
            var _sc0 = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc0 > 0)) _sc0 = 1;
            var _cv0 = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
            var _r0 = chat.el.getBoundingClientRect();
            var _caEl0 = document.getElementById('canvasArea');
            var _caR0 = _caEl0 ? _caEl0.getBoundingClientRect() : { left: 0, top: 0 };
            _srcL = Math.round((_r0.left - _caR0.left - (_cv0.x || 0)) / _sc0);
            _srcT = Math.round((_r0.top - _caR0.top - (_cv0.y || 0)) / _sc0);
        } catch (eSrc0) {}
        /* 【v6 交叉校验】rect 反算依赖 canvasGetView 坐标系一致，实测会得出 95350 类垃圾值把新窗钉飞；
           style.left 由拖拽模块直接写入，最可靠。两源相差 >1500 时以 style.left 为准 */
        var _stL = parseFloat(chat.el && chat.el.style.left), _stT = parseFloat(chat.el && chat.el.style.top);
        if (isFinite(_stL) && isFinite(_stT) && (isNaN(_srcL) || isNaN(_srcT) || Math.abs(_srcL - _stL) + Math.abs(_srcT - _stT) > 1500)) {
            console.log('[定位交叉校验] rect反算(', _srcL, _srcT, ') 与 style.left(', _stL, _stT, ') 不符，采用 style.left');
            _srcL = _stL; _srcT = _stT;
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = parseInt(chat.el && chat.el.style.left, 10);
            _srcT = parseInt(chat.el && chat.el.style.top, 10);
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            try {
                var _srcR = chat.el.getBoundingClientRect();
                var _sc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
                var _cv = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
                _srcL = Math.round((_srcR.left - _caOff.left - (_cv.x || 0)) / _sc);
                _srcT = Math.round((_srcR.top - _caOff.top - (_cv.y || 0)) / _sc);
            } catch (eR) { _srcL = 0; _srcT = 0; }
        }
        if (isNaN(_srcL)) _srcL = 0;
        if (isNaN(_srcT)) _srcT = 0;
        var _srcW = (chat.el && chat.el.offsetWidth) || 420;
        /* 【坐标同系】offsetHeight 是渲染像素（含画布缩放），需除以 scale 才能与 style.left/top 逻辑坐标混用；scale!=1 时不除会导致子窗纵向偏移失真 */
        var _srcH = 520;
        try {
            var _sc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc > 0)) _sc = 1;
            if (chat && chat.el && chat.el.offsetHeight) _srcH = chat.el.offsetHeight / _sc;
        } catch (e) {}
        /* 【定位·习惯优先】策划师新窗优先放回用户上次拖拽到的位置（SpawnHabit 习惯记忆），
           无习惯记录才用源窗右下 60px 默认，同批多窗依次 +42px 阶梯错开 */
        var _tIdx = 0;
        try { _tIdx = Math.max(0, ((window.ZFSwarm && window.ZFSwarm.nextIdxFor) ? window.ZFSwarm.nextIdxFor(chat.id, 'thinker') : 1) - 1); } catch (eIdx) {}
        var _tX, _tY;
        /* 【定位统一·右下角10,10】弃用习惯记忆（脏数据会致飞窗）：新窗固定在源窗右下角外10px，同批+42级联 */
        var _tX = _srcL + _srcW + 10 + _tIdx * 20;
        var _tY = _srcT + _srcH + 10 + _tIdx * 20;
        if (typeof _tX !== 'number' || isNaN(_tX)) _tX = 120;
        if (typeof _tY !== 'number' || isNaN(_tY)) _tY = 120;
        // 【修复】画布逻辑坐标可无限平移，钳制±20000会把新窗强行拉离源窗，只防 NaN
        if (!isFinite(_tX)) _tX = 120;
        if (!isFinite(_tY)) _tY = 120;
        /* 【调试打印】策划师新窗定位参数，F12 控制台可见 */
        console.log('[策划师定位] _srcL(源left)=', _srcL, '_srcT(源top)=', _srcT, '_tIdx(批次序号)=', _tIdx, '→ 新窗位置 _tX=', _tX, '_tY=', _tY);
        // 【模型继承】与审核员一致
        var _srcMid = '';
        try {
            _srcMid = (typeof App !== 'undefined' && typeof App._toolMasterResolveModelId === 'function')
                ? (App._toolMasterResolveModelId(chat) || '') : '';
        } catch (e) {}
        if (!_srcMid) _srcMid = chat.modelId || '';
        var newChat = selfApp.createChatBox(_tX, _tY, _srcMid || null, true);
        /* 【定位最终重申·v5】无论中间有多少层包装改动位置，创建后多拍强制钉回目标坐标 */
        try {
            var _pinFn = function () {
                try {
                    if (!newChat.el || !document.body.contains(newChat.el)) return;
                    var _curL = parseFloat(newChat.el.style.left), _curT = parseFloat(newChat.el.style.top);
                    var _dL = Math.abs(_curL - _tX), _dT = Math.abs(_curT - _tY);
                    /* 【v6 只微调不传送】偏差 >400px 说明是其他模块有意放置或目标坐标本身有误，
                       强行钉回就是"飞到很远"的元凶，此时放弃钉回只打日志 */
                    if ((_dL > 1 || _dT > 1) && Math.max(_dL, _dT) < 400) {
                        newChat.el.style.left = _tX + 'px';
                        newChat.el.style.top = _tY + 'px';
                    } else if (_dL > 1 || _dT > 1) {
                        console.log('[策划师定位·放弃钉回] 偏差过大(', _curL, _curT, 'vs', _tX, _tY, ')，尊表现有位置');
                    }
                } catch (ePin) {}
            };
            _pinFn();
            [0, 60, 200, 450, 800].forEach(function (ms) { setTimeout(_pinFn, ms); });
        } catch (ePin0) {}
        if (!newChat) {
            self._stepToast('策划师失败：新对话创建被拦截（窗口数量限制）', false);
            return;
        }
        // 【定位标记】记录源对话，蜂群注册表用于视角固化（不再做位置记忆）
        try {
            newChat.el._isThinkerChat = true;
            newChat.el._thinkerSrcId = chat.id; // 【多视角蜂群】记录源对话
            try { window.ZFSwarm && window.ZFSwarm.register(newChat.id, 'thinker', chat.id, Math.max(0, window.ZFSwarm.thinkerCountFor(chat.id) - 2) % 4); } catch (eReg) {} // 【蜂群持久化】注册表兜底（含视角固化），刷新后可恢复
        } catch (e) {}

        // ===== 配置完全继承（角色/项目/引擎/模型/思考强度/压缩/工具分类），与审核员同款 =====
        try {
            var _srcRole = null;
            try { _srcRole = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null'); } catch (e) {}
            
        // 【角色指定】优先绑定角色分组里名为「策划师」的角色；找不到则回退继承原对话角色
        var _applyRoleNamed = function (roleName, tag, fallbackRole, logTag) {
            var _doApply = function (role, how) {
                if (!role || !role.id) return false;
                try {
                    localStorage.setItem('zf_role_chat_' + newChat.id, JSON.stringify({
                        id: role.id, name: role.name, avatar: role.avatar, prompt: role.prompt || '',
                        chat_skin: role.chat_skin || ''
                    }));
                    try { if (typeof selfApp._refreshRoleBadge === 'function') selfApp._refreshRoleBadge(newChat.el); } catch (e) {}
                    // 【标题同步】把新对话标题改成「头像 角色名」，否则肉眼看不出角色已切换
                    try {
                        var _titleEl = newChat.el && newChat.el.querySelector('.title');
                        if (_titleEl) {
                            var _tLabel = (role.name || '策划师') + ' · 策划';
                            try { if (window.ZFSwarm && window.ZFSwarm.thinkerCountFor(chat.id) >= 2) _tLabel = (role.name || '策划师') + '#' + window.ZFSwarm.thinkerCountFor(chat.id) + ' · ' + window.ZFSwarm.thinkerViewName(chat.id, newChat.id); } catch (eL) {}
                            _titleEl.textContent = _tLabel;
                            _titleEl.title = '策划扩展对话（角色：' + (role.name || '') + '）';
                        }
                    } catch (e) {}
                    try { if (typeof Theme !== 'undefined' && Theme.applyToBox && newChat.el) Theme.applyToBox(newChat.el, role.chat_skin || ''); } catch (e) {}
                    try {
                        fetch('/api/roles', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'select', box: newChat.id, role_id: role.id })
                        }).catch(function () {});
                    } catch (e) {}
                    Store.addLog('info', newChat.id, logTag, '已绑定角色（' + how + '）：' + (role.name || role.id));
                    return true;
                } catch (e) { return false; }
            };
            /* 【派单竞态修复】绑定改同步直写 + 错峰（仿 _multiRoleStart）：
               1) 立即同步写兜底角色，抢占 zf_role_chat_<id> 绑定权，防第三窗退化成无角色；
               2) 打 _zfRoleDirect 信任标记，chatbox-roles 包装器只做复选、不做继承/沿用覆盖；
               3) 指定角色在 200ms 错峰后再查列表覆盖绑定，最终一致。 */
            try { newChat._zfRoleDirect = true; } catch (eZF) {}
            if (fallbackRole && fallbackRole.id) _doApply(fallbackRole, '继承·' + (fallbackRole.name || ''));
            setTimeout(function () {
                try {
                    fetch('/api/roles?box=' + encodeURIComponent(newChat.id))
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            var _hit = null;
                            ((res && res.roles) || []).forEach(function (r) {
                                if (String(r.name || '').trim() === roleName) _hit = r;
                            });
                            if (_hit && _hit.id) { _doApply(_hit, '指定·' + roleName); return; }
                            /* 未命中且无兜底才清空；有兜底时上面已同步写入，保留 */
                        }).catch(function () {});
                } catch (e) {}
            }, 200);
        };

            _applyRoleNamed('策划师', 'thinker', _srcRole, 'thinker');
        } catch (e) {}
        var _inheritPid = chat.projectId
            || (typeof App !== 'undefined' && App._activeProjectId)
            || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId)
            || '';
        if (_inheritPid) {
            newChat.projectId = _inheritPid;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                if (Store.data.chatBoxes[i].id === newChat.id) { Store.data.chatBoxes[i].projectId = _inheritPid; break; }
            }
            try { if (typeof DB !== 'undefined' && DB.setNodeProject) DB.setNodeProject(newChat.id, _inheritPid).catch(function () {}); } catch (e) {}
            try { if (typeof selfApp._updateProjectBtn === 'function') selfApp._updateProjectBtn(newChat); } catch (e) {}
            Store.addLog('info', newChat.id, 'thinker', '已继承原对话项目：' + _inheritPid);
        }
        try {
            if (chat._engine) newChat._engine = String(chat._engine);
            if (chat.modelId && typeof Models !== 'undefined' && Models.get && Models.get(chat.modelId)) {
                newChat.modelId = chat.modelId;
            }
            if (chat._modelIdOverride) newChat._modelIdOverride = String(chat._modelIdOverride);
            if (chat._reasoningEffort !== undefined && chat._reasoningEffort !== null) {
                newChat._reasoningEffort = String(chat._reasoningEffort || '');
            }
            if (chat._compressMode) newChat._compressMode = chat._compressMode;
            if (chat._historyMode) newChat._historyMode = chat._historyMode;
            if (typeof Tools !== 'undefined' && Tools.chatCategories && Tools.chatCategories[chat.id]) {
                Tools.chatCategories[newChat.id] = Tools.chatCategories[chat.id];
            }
            try { if (typeof newChat._refreshModelPickerBtn === 'function') newChat._refreshModelPickerBtn(); } catch (e) {}
            Store.saveChatBox(newChat, true);
        } catch (e) {}
        Store.addLog('info', chat.id, 'thinker', '策划师已发起：新对话 ' + newChat.id + '，素材包 ' + _prompt.length + ' 字');
        self._stepToast('策划师已发起：新对话已创建并发送扩展素材包', true);
        // 【紫色方向箭头】原始对话 ↔ 策划师对话（结论回注通道）
        try {
            if (window.ZFThinkerArrow && typeof window.ZFThinkerArrow.create === 'function') {
                window.ZFThinkerArrow.create(chat, newChat);
            }
        } catch (e) {}
        setTimeout(function() {
            try {
                if (typeof selfApp.addMsg === 'function') selfApp.addMsg(newChat.el, '（策划师素材包，共 ' + _prompt.length + ' 字）', 'user', newChat.modelId);
                newChat.history.push({ role: 'user', content: _prompt, _thinkerRound: true });
                Store.addLog('info', newChat.id, 'thinker', '扩展素材包已注入并发送');
                selfApp.sendToModel(newChat.el, newChat);
            } catch (e) {
                Store.addLog('error', newChat.id, 'thinker', '素材包发送异常: ' + e.message);
            }
        }, 400);
    },

    // ===== 审核员：新开对话 + 注入验证素材包（前因后果/工具上下文/改动前后对比） =====
    _objectiveVerify: function(box, chat, opts) {
        var self = this;
        opts = opts || {};
        var _mode = opts.mode || 'obj';
        // 【2026 修复】审核员基于新对话独立运行，原对话运行中/验证轮中都不再拦截。
        // 原逻辑 chat.isSending || chat._verifyActive 直接 return，导致：
        // 1) 正在跑任务时点审核员被拒（用户希望"随时随地可验证"）；
        // 2) 上轮验证结束后 _verifyActive 残留为 true 时，明明空闲却误报"正在运行"。
        // 现在仅在验证轮进行中给出提示（避免素材包取到半截上下文），但不阻断。
        if (_mode !== 'triple') {
            if (chat._verifyActive && !chat.isSending) {
                Store.addLog('warn', chat.id, 'obj-verify', '上一轮验证尚未结束，本次审核员以上下文可能不完整');
                self._stepToast('上一轮验证尚未结束，审核员素材包可能不完整，已照常发起', false);
            } else if (chat.isSending) {
                Store.addLog('info', chat.id, 'obj-verify', '当前对话运行中发起审核员（新对话独立运行）');
                self._stepToast('当前对话仍在运行，审核员已在新对话独立发起', true);
            }
        }
        // 1. 收集原对话上下文：最近 3 条真实用户问题 + 最近 3 条 AI 回复 + 关键工具调用摘要（取自运行日志，最可靠）
        var _lastAssistant = '', _lastRealUserQ = '', _toolCalls = [];
        var _recentQs = [], _recentAs = [];
        try {
            var _logs = Store.getMessages ? Store.getMessages(chat.id) : [];
            for (var _li = _logs.length - 1; _li >= 0 && _toolCalls.length < 15; _li--) {
                if (_logs[_li].type === 'tool_call') _toolCalls.unshift(_msgText(_logs[_li]).substring(0, 120));
            }
        } catch (e) {}
        for (var _i = chat.history.length - 1; _i >= 0; _i--) {
            var _h = chat.history[_i];
            if (!_h) continue;
            if (_h.role === 'assistant' && !_h._meta) {
                if (_recentAs.length < 3) _recentAs.unshift(_h.content || '');
                if (!_lastAssistant) _lastAssistant = _h.content || '';
            }
        if (_h.role === 'user' && !_h._guardInject && !_h._verifyRound && !_h._continueRound && (_msgText(_h).indexOf('（审核员素材包') === 0 || _msgText(_h).indexOf('【审核员任务】') === 0 || _msgText(_h).indexOf('（质检员素材包') === 0 || _msgText(_h).indexOf('【质检员任务】') === 0 || _msgText(_h).indexOf('（策划师素材包') === 0 || _msgText(_h).indexOf('【策划师任务】') === 0 || _msgText(_h).indexOf('（总结师素材包') === 0 || _msgText(_h).indexOf('【总结师任务】') === 0)) {
                if (_recentQs.length < 3) _recentQs.unshift(_msgText(_h));
                if (!_lastRealUserQ) _lastRealUserQ = _h.content || '';
            }
        }
        // 2. 请求后端素材包（git diff 前后对比 + 步骤日志）
        // 先取原对话绑定的角色（写入素材包 + 供新对话继承）
        var _srcRoleName = '';
        try {
            var _sr = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null');
            if (_sr && _sr.name) _srcRoleName = String(_sr.name);
        } catch (e) {}
        var _projPath = '';
        var _pid = chat.projectId || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId) || (typeof App !== 'undefined' && App._activeProjectId) || '';
        var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
        if (_projSrc && _pid) {
            for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                if (String(_projSrc[_pi].id) === String(_pid)) { _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
            }
        }
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/tools/verify_brief', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 30000;
            xhr.onload = function() {
                var res = {};
                try { res = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
                self._objectiveVerifySend(box, chat, {
                    projPath: _projPath, userQ: _lastRealUserQ, aiReply: _lastAssistant,
                    recentQs: _recentQs, recentAs: _recentAs,
                    toolCalls: _toolCalls, brief: res, roleName: _srcRoleName, mode: _mode
                });
            };
            xhr.onerror = function() {
                // 素材包失败也不阻塞：降级为仅上下文验证
                self._objectiveVerifySend(box, chat, { projPath: _projPath, userQ: _lastRealUserQ, aiReply: _lastAssistant, recentQs: _recentQs, recentAs: _recentAs, toolCalls: _toolCalls, brief: { ok: false }, roleName: _srcRoleName, mode: _mode });
            };
            xhr.send(JSON.stringify({ path: _projPath }));
        } catch (e) {
            self._objectiveVerifySend(box, chat, { projPath: _projPath, userQ: _lastRealUserQ, aiReply: _lastAssistant, recentQs: _recentQs, recentAs: _recentAs, toolCalls: _toolCalls, brief: { ok: false }, roleName: _srcRoleName, mode: _mode });
        }
    },


    _objectiveVerifySend: function(box, chat, ctxData) {
        var self = this;
        var brief = ctxData.brief || {};
        var lines = [];
        var mode = ctxData.mode || 'single'; // 【统一取值】显式从 ctxData 取 mode，缺省 single，供链路内统一使用
        lines.push('【审核员任务】你是一个独立的复核者，请基于下面给出的客观素材，对一个已完成的任务做出快速、客观的评价，并指出可能的 bug 与修复方法。');
        lines.push('');
        lines.push('== 前因后果 ==');
        lines.push('项目路径：' + (ctxData.projPath || '（未提供）'));
        // 【2026 修复】把原对话的角色/项目等配置显式写进素材包：
        // 新对话虽已在底层继承（角色提示词、项目上下文），但复核者需要知道"我是谁、在验哪个项目"，
        // 否则容易用通用助手视角评价，结论跑偏。
        if (ctxData.roleName) lines.push('原对话角色：' + ctxData.roleName + '（新对话已继承该角色人设与口吻，请以同一角色身份复核）');
        // 【增强】注入最近 3 个用户问题 + 3 条 AI 回复，让复核者看到完整多轮脉络
        var _rq = (ctxData.recentQs && ctxData.recentQs.length) ? ctxData.recentQs : (ctxData.userQ ? [ctxData.userQ] : []);
        var _ra = (ctxData.recentAs && ctxData.recentAs.length) ? ctxData.recentAs : (ctxData.aiReply ? [ctxData.aiReply] : []);
        if (_rq.length) {
            lines.push('');
            lines.push('== 最近的用户问题（最多 3 条，按时间正序） ==');
            _rq.forEach(function(q, i) { lines.push('【问题 ' + (i + 1) + '】' + String(q || '').replace(/\s+/g, ' ').trim().slice(0, 800)); });
        }
        if (_ra.length) {
            lines.push('');
            lines.push('== 执行 AI 的答复（最多 3 条，按时间正序） ==');
            _ra.forEach(function(a, i) { lines.push('【AI 回复 ' + (i + 1) + '】' + String(a || '').slice(0, 6000)); });
        }
        var _tc = (ctxData.toolCalls && ctxData.toolCalls.length) ? ctxData.toolCalls : (typeof _toolCalls !== 'undefined' ? _toolCalls : []);
        if (_tc.length) {
            lines.push('');
            lines.push('== 工具上下文（执行过程中 AI 实际调用过的工具，倒序最近15条） ==');
            _tc.forEach(function(t, i) { lines.push((i + 1) + '. ' + t); });
        }
        if (brief.ok) {
            lines.push('');
            lines.push('== 客观数据：git 改动前后对比 ==');
            lines.push('最近提交：' + (brief.last_commit || '（无）'));
            if (brief.files && brief.files.length) { lines.push('改动文件：\n' + brief.files.join('\n')); }
            if (brief.diff_stat) { lines.push('diff 统计：\n' + brief.diff_stat); }
            if (brief.diff_text) { lines.push('diff 内容（前后对比）：\n' + brief.diff_text); }
            if (brief.steps_log && brief.steps_log.length) {
                lines.push('步骤保存记录：');
                brief.steps_log.forEach(function(s) { lines.push('- step ' + s.step + ' @ ' + s.time + (s.nothing_to_commit ? '（无改动）' : ' commit:' + (s.commit || '?'))); });
            }
        } else {
            lines.push('');
            lines.push('（素材包获取失败，请自行用工具检查项目文件验证）');
        }
        lines.push('');
        lines.push('== 你的任务 ==');
        lines.push('1. 对照用户原始问题与最终答复，判断任务是否真正完成；');
        lines.push('2. 核对 diff 前后对比，确认改动是否与答复声称一致、有无遗漏或引入 bug；');
        lines.push('3. 给出结论：✅ 通过 / ⚠️ 有问题（列出问题点与修复建议）。只做评价与指出问题，不改任何文件。');
        lines.push('【最低交付物约束】你的回复必须包含实质核验内容：至少 1 条对素材/diff/代码的独立核实结果或具体问题点。');
        lines.push('仅回传统计信息（如 token 用量、耗时、次数）而无任何核验结论的回复，视为弃权，不占用收口裁决席位。');
        var _prompt = lines.join('\n');

        // 3. 新开对话（沿用 chat_manage create 的创建链路）
        var selfApp = (typeof App !== 'undefined') ? App : null;
        if (!selfApp || typeof selfApp.createChatBox !== 'function') {
            Store.addLog('error', chat.id, 'obj-verify', '审核员失败：无法创建新对话');
            self._stepToast('审核员失败：无法创建新对话', false);
            return;
        }
        var canvasArea = document.getElementById('canvasArea');
        var cx = canvasArea ? canvasArea.clientWidth / 2 : window.innerWidth / 2;
        var cy = canvasArea ? canvasArea.clientHeight / 2 : window.innerHeight / 2;
        /* 【定位简化·v4】审核员新窗固定出现在源对话右下 90px（相对策划师再错开 30px），
           同批多窗依次 +42px 阶梯错开；不再扇形/位置记忆/拖拽继承，位置永远跟随源对话 */
        var _qIdx = 0;
        try { _qIdx = Math.max(0, ((window.ZFSwarm && window.ZFSwarm.nextIdxFor) ? window.ZFSwarm.nextIdxFor(chat.id, 'qc') : 1) - 1); } catch (eQIdx) {}
        // 【2026 修复】_srcL/_srcT 未定义导致 ReferenceError：与 1830 行同口径，从源对话画布位置解析
        /* 【源坐标修复】不再信任 style.left（可能被历史钉回逻辑写入屏幕像素值如95358导致新窗飞到±20000钳制边缘），
           优先用 getBoundingClientRect 反算画布逻辑坐标：(rect-画布区原点-视图偏移)/缩放，style.left 仅作兜底 */
        var _srcL = NaN, _srcT = NaN;
        try {
            var _sc0 = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
            if (!(_sc0 > 0)) _sc0 = 1;
            var _cv0 = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
            var _r0 = chat.el.getBoundingClientRect();
            var _caEl0 = document.getElementById('canvasArea');
            var _caR0 = _caEl0 ? _caEl0.getBoundingClientRect() : { left: 0, top: 0 };
            _srcL = Math.round((_r0.left - _caR0.left - (_cv0.x || 0)) / _sc0);
            _srcT = Math.round((_r0.top - _caR0.top - (_cv0.y || 0)) / _sc0);
        } catch (eSrc0) {}
        /* 【v6 交叉校验】rect 反算依赖 canvasGetView 坐标系一致，实测会得出 95350 类垃圾值把新窗钉飞；
           style.left 由拖拽模块直接写入，最可靠。两源相差 >1500 时以 style.left 为准 */
        var _stL = parseFloat(chat.el && chat.el.style.left), _stT = parseFloat(chat.el && chat.el.style.top);
        if (isFinite(_stL) && isFinite(_stT) && (isNaN(_srcL) || isNaN(_srcT) || Math.abs(_srcL - _stL) + Math.abs(_srcT - _stT) > 1500)) {
            console.log('[定位交叉校验] rect反算(', _srcL, _srcT, ') 与 style.left(', _stL, _stT, ') 不符，采用 style.left');
            _srcL = _stL; _srcT = _stT;
        }
        if (isNaN(_srcL) || isNaN(_srcT)) {
            _srcL = parseInt(chat.el && chat.el.style.left, 10);
            _srcT = parseInt(chat.el && chat.el.style.top, 10);
        }
        var _caOff = { left: 0, top: 0 };
        try { if (canvasArea) { var _caR = canvasArea.getBoundingClientRect(); _caOff = { left: _caR.left, top: _caR.top }; } } catch (eCa) {}
        if (isNaN(_srcL) || isNaN(_srcT)) {
            try {
                var _srcR = chat.el.getBoundingClientRect();
                // 【缩放校正】rect 是屏幕像素，画布可能有 transform scale，需换算回画布逻辑坐标
                var _sc = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1;
                // 【平移校正】画布内容整体被 translate(view.x,view.y) 平移过，必须一并扣除
                var _cv = (window.App && typeof App.canvasGetView === 'function') ? (App.canvasGetView() || { x: 0, y: 0 }) : { x: 0, y: 0 };
                _srcL = Math.round((_srcR.left - _caOff.left - (_cv.x || 0)) / _sc);
                _srcT = Math.round((_srcR.top - _caOff.top - (_cv.y || 0)) / _sc);
            } catch (eR) { _srcL = 0; _srcT = 0; }
        }
        if (isNaN(_srcL)) _srcL = 0;
        if (isNaN(_srcT)) _srcT = 0;
        /* 【定位·习惯优先】审核员新窗优先放回用户上次拖拽到的位置（SpawnHabit 习惯记忆），
           无习惯记录才用源窗右下 90px 默认，同批多窗依次 +42px 阶梯错开 */
        var _qcX, _qcY;
        /* 【定位统一·右下角10,10】弃用习惯记忆（脏数据会致飞窗）：新窗固定在源窗右下角外10px，同批+42级联 */
        var _qcOffW = Math.round((chat.el && chat.el.offsetWidth || 420) / _sc0);
        var _qcOffH = Math.round((chat.el && chat.el.offsetHeight || 300) / _sc0);
        var _qcX = _srcL + _qcOffW + 10 + _qIdx * 20;
        var _qcY = _srcT + _qcOffH + 10 + _qIdx * 20;
        if (typeof _qcX !== 'number' || isNaN(_qcX)) _qcX = 160;
        if (typeof _qcY !== 'number' || isNaN(_qcY)) _qcY = 160;
        if (!isFinite(_qcX)) _qcX = 160;
        if (!isFinite(_qcY)) _qcY = 160;
        // 【模型继承】先解析原对话生效的模型配置 id（本对话 → 用户习惯 → 任意可用），避免新建时落到默认/习惯模型
        var _srcMid = '';
        try {
            _srcMid = (typeof App !== 'undefined' && typeof App._toolMasterResolveModelId === 'function')
                ? (App._toolMasterResolveModelId(chat) || '') : '';
        } catch (e) {}
        if (!_srcMid) _srcMid = chat.modelId || '';
        var newChat = selfApp.createChatBox(_qcX, _qcY, _srcMid || null, true);
        /* 【定位最终重申·v5】无论中间有多少层包装改动位置，创建后多拍强制钉回目标坐标 */
        try {
            var _pinFnQ = function () {
                try {
                    if (!newChat.el || !document.body.contains(newChat.el)) return;
                    var _curL = parseFloat(newChat.el.style.left), _curT = parseFloat(newChat.el.style.top);
                    var _dLq = Math.abs(_curL - _qcX), _dTq = Math.abs(_curT - _qcY);
                    /* 【v6 只微调不传送】偏差 >400px 说明是其他模块有意放置或目标坐标本身有误，放弃钉回 */
                    if ((_dLq > 1 || _dTq > 1) && Math.max(_dLq, _dTq) < 400) {
                        newChat.el.style.left = _qcX + 'px';
                        newChat.el.style.top = _qcY + 'px';
                    } else if (_dLq > 1 || _dTq > 1) {
                        console.log('[审核员定位·放弃钉回] 偏差过大(', _curL, _curT, 'vs', _qcX, _qcY, ')，尊表现有位置');
                    }
                } catch (ePinQ) {}
            };
            _pinFnQ();
            [0, 60, 200, 450, 800].forEach(function (ms) { setTimeout(_pinFnQ, ms); });
        } catch (ePinQ0) {}
        if (!newChat) {
            self._stepToast('审核员失败：新对话创建被拦截（窗口数量限制）', false);
            return;
        }
        // 【审核建议修复】写入移到 newChat 空判之后，避免 null 时抛 TypeError（虽被 try/catch 吞掉但顺序欠佳）
        try {
            newChat.el._isQcChat = true;
            newChat.el._qcSrcId = chat.id; // 【多视角蜂群】记录源对话
            try { window.ZFSwarm && window.ZFSwarm.register(newChat.id, 'qc', chat.id, Math.max(0, window.ZFSwarm.qcCountFor(chat.id) - 2) % 5); } catch (eReg) {} // 【蜂群持久化】注册表兜底（含视角固化），刷新后可恢复
            // 【审核建议修复】把本次原始对话位置存到审核员元素上，
            // 供 saveChatBox 挂钩动态读取（闭包里的 _srcL/_srcT 会随源对话移动/换源而过期）
        } catch (e) {}

        // ===== 【2026 修复】新对话必须「完全继承」原对话，否则验证结论必然跑偏 =====
        // 根因：角色/项目/引擎等配置全部按「对话 id」存储（角色在 localStorage zf_role_chat_<boxId>
        // + 服务端 /api/roles 的 selected 映射，项目在 chat.projectId，引擎在 chat._engine），
        // 而新对话是全新 id，createChatBox 只会归入「当前活动项目」，人设提示词、项目上下文全丢，
        // 新对话退化成通用助手，评价自然偏离原任务语境。
        // 处理：把原对话的角色、项目、引擎、模型覆盖、思考强度、压缩档位、工具分类逐项复制过来。

        // 1) 角色绑定（优先「审核员」角色，回退继承原对话角色）
        try {
            var _srcRole = null;
            try { _srcRole = JSON.parse(localStorage.getItem('zf_role_chat_' + chat.id) || 'null'); } catch (e) {}
            
        // 【角色指定】优先绑定角色分组里名为「审核员」的角色；找不到则回退继承原对话角色
        var _applyRoleNamed = function (roleName, tag, fallbackRole, logTag) {
            var _doApply = function (role, how) {
                if (!role || !role.id) return false;
                try {
                    localStorage.setItem('zf_role_chat_' + newChat.id, JSON.stringify({
                        id: role.id, name: role.name, avatar: role.avatar, prompt: role.prompt || '',
                        chat_skin: role.chat_skin || ''
                    }));
                    try { if (typeof selfApp._refreshRoleBadge === 'function') selfApp._refreshRoleBadge(newChat.el); } catch (e) {}
                    // 【标题同步】把新对话标题改成「头像 角色名」，否则肉眼看不出角色已切换
                    try {
                        var _titleEl = newChat.el && newChat.el.querySelector('.title');
                        if (_titleEl) {
                            var _qLabel = (role.name || '审核员') + ' · 审核';
                            try { if (window.ZFSwarm && window.ZFSwarm.qcCountFor(chat.id) >= 2) _qLabel = (role.name || '审核员') + '#' + window.ZFSwarm.qcCountFor(chat.id) + ' · ' + window.ZFSwarm.qcViewName(chat.id, newChat.id); } catch (eL2) {}
                            _titleEl.textContent = _qLabel;
                            _titleEl.title = '审核扩展对话（角色：' + (role.name || '') + '）';
                        }
                    } catch (e) {}
                    try { if (typeof Theme !== 'undefined' && Theme.applyToBox && newChat.el) Theme.applyToBox(newChat.el, role.chat_skin || ''); } catch (e) {}
                    try {
                        fetch('/api/roles', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'select', box: newChat.id, role_id: role.id })
                        }).catch(function () {});
                    } catch (e) {}
                    Store.addLog('info', newChat.id, logTag, '已绑定角色（' + how + '）：' + (role.name || role.id));
                    return true;
                } catch (e) { return false; }
            };
            /* 【派单竞态修复】绑定改同步直写 + 错峰（仿 _multiRoleStart），见策划师处同款注释 */
            try { newChat._zfRoleDirect = true; } catch (eZF2) {}
            if (fallbackRole && fallbackRole.id) _doApply(fallbackRole, '继承·' + (fallbackRole.name || ''));
            setTimeout(function () {
                try {
                    fetch('/api/roles?box=' + encodeURIComponent(newChat.id))
                        .then(function (r) { return r.json(); })
                        .then(function (res) {
                            var _hit = null;
                            ((res && res.roles) || []).forEach(function (r) {
                                if (String(r.name || '').trim() === roleName) _hit = r;
                            });
                            if (_hit && _hit.id) { _doApply(_hit, '指定·' + roleName); return; }
                        }).catch(function () {});
                } catch (e) {}
            }, 200);
        };

            _applyRoleNamed('审核员', 'qc', _srcRole, 'obj-verify');
        } catch (e) {}

        // 2) 项目继承（原对话项目优先，其次当前活动项目；内存 + Store + DB 三处同步）
        var _inheritPid = chat.projectId
            || (typeof App !== 'undefined' && App._activeProjectId)
            || (typeof Store !== 'undefined' && Store.data && Store.data.activeProjectId)
            || '';
        if (_inheritPid) {
            newChat.projectId = _inheritPid;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                if (Store.data.chatBoxes[i].id === newChat.id) { Store.data.chatBoxes[i].projectId = _inheritPid; break; }
            }
            try { if (typeof DB !== 'undefined' && DB.setNodeProject) DB.setNodeProject(newChat.id, _inheritPid).catch(function () {}); } catch (e) {}
            try { if (typeof selfApp._updateProjectBtn === 'function') selfApp._updateProjectBtn(newChat); } catch (e) {}
            Store.addLog('info', newChat.id, 'obj-verify', '已继承原对话项目：' + _inheritPid);
        }

        // 3) 引擎 / 模型线路 / 模型ID覆盖 / 思考强度 / 压缩档位 / 工具分类 继承
        try {
            if (chat._engine) newChat._engine = String(chat._engine);
            // 【模型继承】原对话的模型线路优先：createChatBox 可能因线路无效回退到习惯/默认模型，
            // 这里强制对齐回原对话的线路，保证审核员用「上一个对话的模型」发起
            if (chat.modelId && typeof Models !== 'undefined' && Models.get && Models.get(chat.modelId)) {
                newChat.modelId = chat.modelId;
            }
            // 模型ID覆盖（模型强度对应的具体模型 ID）：无条件继承，与原对话保持一致
            if (chat._modelIdOverride) {
                newChat._modelIdOverride = String(chat._modelIdOverride);
            }
            // 思考强度（模型强度）：无条件继承（含空值=跟随线路默认，与原对话行为一致），
            // 避免 createChatBox 写入的初始档位与原对话不同
            if (chat._reasoningEffort !== undefined && chat._reasoningEffort !== null) {
                newChat._reasoningEffort = String(chat._reasoningEffort || '');
            }
            if (chat._compressMode) newChat._compressMode = chat._compressMode;
            if (chat._historyMode) newChat._historyMode = chat._historyMode;
            if (typeof Tools !== 'undefined' && Tools.chatCategories && Tools.chatCategories[chat.id]) {
                Tools.chatCategories[newChat.id] = Tools.chatCategories[chat.id];
            }
            // 刷新底部模型选择器/欢迎语，让新对话界面显示继承到的模型与强度
            try {
                if (typeof newChat._refreshModelPickerBtn === 'function') newChat._refreshModelPickerBtn();
            } catch (e) {}
            try {
                if (newChat.el && newChat.el._welcomeCtx) {
                    var _ivm = Models.get(newChat.modelId) || null;
                    if (_ivm) {
                        newChat.el._welcomeCtx.model = _ivm;
                        newChat.el._welcomeCtx.mid = newChat._modelIdOverride || (_ivm.modelId || '');
                        newChat.el._welcomeCtx.re = newChat._reasoningEffort || (_ivm.reasoningEffort || '');
                        var _ivwb = newChat.el.querySelector('[data-welcome]');
                        if (_ivwb && typeof selfApp._welcomeHtml === 'function') _ivwb.innerHTML = selfApp._welcomeHtml(newChat.el);
                    }
                }
            } catch (e) {}
            Store.saveChatBox(newChat, true);
            Store.addLog('info', newChat.id, 'obj-verify',
                '已继承原对话模型：线路=' + (newChat.modelId || '-') +
                '，模型ID=' + (newChat._modelIdOverride || '-') +
                '，思考强度=' + (newChat._reasoningEffort || '默认'));
        } catch (e) {}
        Store.addLog('info', chat.id, 'obj-verify', '审核员已发起' + '：新对话 ' + newChat.id + '，素材包 ' + _prompt.length + ' 字');
        self._stepToast('审核员已发起：新对话已创建并发送验证素材包', true);
        // 【审核员方向箭头】在原始对话与审核员新对话之间生成可点击的来回箭头
        try {
            if (window.ZFVerifyArrow && typeof window.ZFVerifyArrow.create === 'function') {
                window.ZFVerifyArrow.create(chat, newChat);
            }
        } catch (e) {}
        setTimeout(function() {
            try {
                if (typeof selfApp.addMsg === 'function') selfApp.addMsg(newChat.el, '（审核员素材包，共 ' + _prompt.length + ' 字）', 'user', newChat.modelId);
                newChat.history.push({ role: 'user', content: _prompt });
                Store.addLog('info', newChat.id, 'obj-verify', '验证素材包已注入并发送');
                selfApp.sendToModel(newChat.el, newChat);
            } catch (e) {
                Store.addLog('error', newChat.id, 'obj-verify', '素材包发送异常: ' + e.message);
            }
        }, 400);
    },

    // 【修复】批量开始/验证轮的项目路径必须取「该对话自己关联的项目」，
    // 不能回退到全局活动项目——每个对话有自己的项目归属，全局路径对其他对话是错的。
    _resolveChatProjPath: function(chat) {
        var _projPath = '';
        var _pid = (chat && chat.projectId) || '';
        if (_pid) {
            var _projSrc = (typeof App !== 'undefined' && App._projAllProjects) ? App._projAllProjects : (typeof Store !== 'undefined' && Store.data && Store.data.projects ? Store.data.projects : []);
            if (_projSrc) {
                for (var _pi = 0; _pi < _projSrc.length; _pi++) {
                    if (String(_projSrc[_pi].id) === String(_pid)) { _projPath = _projSrc[_pi].folder_path || _projSrc[_pi].path || _projSrc[_pi].folder || ''; break; }
                }
            }
            // 本地列表没命中（如刚刷新）：从 DB 异步结果缓存的 projects 里再试一次由调用方处理；此处同步尽力
            if (!_projPath && typeof DB !== 'undefined' && DB.getProjects) { /* 异步场景由上层刷新后重试 */ }
        }
        return _projPath;
    },

    // ===== 继续轮触发：隐形发送"确认项目路径 + 继续工作"，与验证轮同机制（不进入用户问题） =====
    triggerContinueRound: function(box, chat) {
        var self = this;
        if (chat.isSending || chat._verifyActive) return;
        var _projPath = this._resolveChatProjPath(chat);
        var _contMsg = { role: 'user', content: '继续', _verifyRound: true, _continueRound: true };
        chat.history.push(_contMsg);
        Store.addLog('info', chat.id, 'continue-round', '继续选项已触发，隐形发送继续工作消息');
        chat._verifyActive = true; // 复用验证轮机制：结束后不再二次触发
        try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {} // 事件驱动：排队即变停止按钮
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
        var _projPath = this._resolveChatProjPath(chat);
        var _verifyMsg = { role: 'user', content: '当前项目路径：' + (_projPath || '（本对话未关联项目目录，如需文件操作请先在项目面板关联项目）') + '\n\n你上一次的工作内容是：' + String(lastWork || '').replace(/\s+/g, ' ').trim().slice(0, 500) + '\n\n你确认做好了吗？按以下顺序验证：① 先跑冒烟/自检（Python 文件用 py_compile 或直接运行验证，JS 用 node --check，项目有 self_check.py / _smoke_mustread.py 等脚本则执行它），把真实输出贴出来；② 再复查逻辑是否符合原始需求、有无引入 bug；③ 全部通过后确认彻底完成任务。', _verifyRound: true };
        // 【修复】持久去重：history 会持久化，内存标记 _verifyActive 刷新/重发后会丢，
        // 导致同一条验证消息被重复 push（上下文里出现两条一模一样的注入）。
        // 判断依据：history 中是否已存在内容完全相同的验证消息。
        for (var _di = chat.history.length - 1; _di >= 0; _di--) {
            var _dh = chat.history[_di];
            if (_dh && _dh.role === 'user' && _dh._verifyRound && _dh.content === _verifyMsg.content) {
                Store.addLog('warn', chat.id, 'verify-round', '检测到重复的验证消息，已跳过本次注入');
                return;
            }
        }
        // 【修复】复核计数：同一轮工作最多自动复核 2 次，之后不再注入"确认做好了吗"，
        // 避免 AI 每轮全量重查陷入循环（配合守卫的"疑似陷入循环"报警）。
        chat._verifyCount = (chat._verifyCount || 0) + 1;
        if (chat._verifyCount > 2) {
            Store.addLog('warn', chat.id, 'verify-round', '验证轮已达上限(' + (chat._verifyCount - 1) + '次)，不再注入复核消息');
            return;
        }
        chat.history.push(_verifyMsg);
        Store.addLog('info', chat.id, 'verify-round', '结果验证已开启，自动发送第二轮验证消息');
        chat._verifyActive = true;
        chat._verifyRoundActive = true; // 【修复】持久标记：本次发送是真正的验证轮（区别于继续轮）
        try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {} // 事件驱动：排队即变停止按钮
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
                    _b.textContent = '验证中';
                    _b.disabled = true;
                    _b.blur(); // 【修复】去掉点击后残留的浏览器焦点框（禁用时会出现一个方框）
                    _b.style.outline = 'none';
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
            // @角色名钩子：消息以 @角色 开头时，先把注入角色切到该角色（异步，不阻塞发送）
            try {
                var _lastUser = (chat.messages || []).filter(function (m) { return m.role === 'user'; }).pop();
            } catch (e) {}
            // 健康守护与对话完全解耦：它只是给"人"的报时提醒（弹窗+日志），
            // 不拦截、不等待、不影响任何对话发送与 Agent 循环（2026-09-09 用户定规则）。
            // 设置发送状态
            chat.isSending = true;
            chat._taskStartTime = Date.now();
            try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
            // 重置循环预警状态：每次用户新发送都是新的任务轮
            chat._loopWarned = false;
            chat._loopWarnDepth = 0;
            delete chat._loopEscalated;
            App._loopSignatures = App._loopSignatures || {};
            App._loopSignatures[chat.id] = [];
            chat._stopped = false;
            chat._epoch = (chat._epoch || 0) + 1;   // 【循环代次 2026-09-10】新消息换代：所有老代次的挂起重试链/工具续轮醒来即让位退出（杀僵尸）
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
                // 【修复】真实用户新任务开始，重置验证轮计数，避免上一任务的复核次数影响本任务
                chat._verifyCount = 0;
            // 【工具计数】用户提交新问题后，右下角导航数字清零
            chat._toolUseCount = 0;
            // 同时重置装水动画的预估步数，避免上个任务扩展过的预估值拖慢下个任务的涨水
            chat._waterEst = 0;
            }
            // 【2026 修复】把"本轮是否验证轮"在发送开始时快照到 _roundWasVerify：
            // 即使验证轮进行中用户又发了消息导致 _verifyActive/_verifyRoundActive 被清，
            // 任务结束时的金框判定仍以本轮开始时的快照为准，避免明明验证了却显示绿色。
            chat._roundWasVerify = !!chat._verifyRoundActive;
            // 验证/继续轮的用户消息渲染为正常用户气泡（带「查看答案」按钮）
            if (chat._verifyActive && !chat._verifyBubbleShown) {
                chat._verifyBubbleShown = true;
                var _vTxt = _msgText(chat.history[chat.history.length - 1]);
                this.addMsg(box, _vTxt, 'user', chat.modelId);
                Store.addMessage(box.id, 'user', _vTxt);
            }
            // 重置截断重试状态（新任务不应继承上一次的 max_tokens 覆盖）
            chat._truncRetryCount = 0;
            delete chat._maxTokensOverride;
            // 新任务清零无响应超时计数/重建标记（超时重建上下文每任务最多一次，防循环重建）
            chat._proxyTimeoutCount = 0;
            chat._timeoutRebuilt = false;
            // 新任务开始：递增工具缓存轮次，同轮内同签名工具命中缓存，跨轮不误伤
            // ===== 三档压缩：新任务开始，把刚完成任务的结果归档为“上一轮”，开新一轮记录 =====
            chat._lastTaskToolResults = chat._curTaskToolResults || [];
            chat._curTaskToolResults = [];
            // 【重启记忆增强】把刚完成任务的工具结果摘要归档到 _roundToolBriefs（跨轮次累积，
            // 经 Store.saveChatBox 持久化到 SQLite，重启后由 restoreSession 恢复并注入上下文）
            try {
                if (!Array.isArray(chat._roundToolBriefs)) chat._roundToolBriefs = [];
                var _prevTools = chat._lastTaskToolResults || [];
                if (_prevTools.length) {
                    var _briefParts = [];
                    var _briefTotal = 0;
                    for (var _bi = _prevTools.length - 1; _bi >= 0 && _briefTotal < 400; _bi--) {
                        var _bc = _msgText(_prevTools[_bi]).replace(/\s+/g, ' ').trim();
                        var _bex = _bc.length > 120 ? (_bc.slice(0, 100) + '…' + _bc.slice(-16)) : _bc;
                        _briefParts.unshift('[' + _prevTools[_bi].tool + '] ' + _bex);
                        _briefTotal += _bex.length;
                    }
                    if (_briefParts.length) {
                        chat._roundToolBriefs.push({ round: (chat._roundToolBriefs.length + 1), brief: _briefParts.join(' | ') });
                        // 上限 20 轮，超出丢弃最早的（防上下文无限膨胀）
                        while (chat._roundToolBriefs.length > 20) chat._roundToolBriefs.shift();
                    }
                }
            } catch (_eBrief) {}
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
                function _isChatModel(m){ var t = String((m && m.modelType) || '').toLowerCase(); return !m.imageGen && (t === 'language' || t === 'speech' || t === 'audio' || t === 'omni'); }
                // 【三级降级】官网下发默认 → 本地默认 → 空白（绝不取列表第一个）；任意可用模型 find 仅作 getDefaultFor 之后的最后兜底
                if (typeof Models.getDefaultFor === 'function') auto = auto || Models.getDefaultFor('language');
                if (!auto) auto = Models.list.find(function(m){ return m && m.key && _isChatModel(m); });
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
                // 【API Key 快捷输入】未配置密钥 → 不再只报错，弹出快捷输入框，输入确认后立刻保存并继续发送
                Store.addLog('warn', chat.id, 'no-key-dialog', '模型未配置密钥: ' + model.name + ' → 弹出快捷输入框');
                ApiKeyQuickDialog.open(model, function(newKey) {
                    // 保存到 Models 并持久化
                    var upd = Models.update(model.id, { apiKey: newKey });
                    return Promise.resolve(upd).then(function() {
                        model.key = newKey;
                        chat.modelId = model.id;
                        return Store.saveChatBox(chat);
                    }).then(function() {
                        // Key 已保存，恢复发送状态并重新发送本条消息
                        chat.isSending = false;
                        try { window._notifyWorkStateChange && window._notifyWorkStateChange(); } catch (e) {}
                        self.updateSendButton(box, chat);
                        self.addMsg(box, '✅ API Key 已保存并连接成功，正在继续处理您的消息…', 'ai');
                        setTimeout(function() { self.sendToModel(box, chat); }, 200);
                    });
                });
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
            // ===== @提及场景角色清单：消息含 @角色名 时，注入场景角色列表帮助模型定位 =====
            try {
                var _lastUserMsg = (chat.history || []).filter(function (m) { return m && m.role === 'user'; }).pop();
                var _sceneCtx = (window.App && App.rolesBuildSceneContext) ? App.rolesBuildSceneContext(_lastUserMsg ? (_lastUserMsg.content || '') : '') : '';
                if (_sceneCtx) messages.push({ role: 'system', content: _sceneCtx });
            } catch (e) {}
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
                var _uTxt = _msgText(messages[_uIdx]);
                if (_uTxt.length > _cfg.longMsgTruncateTo) {
                    var _uLock = messages[_uIdx]._truncLock;
                    if (_uLock && String(_uLock._origLen) === String(_uTxt.length)) {
                        // 【缓存优化】截断点锁定：原文未变时复用已锁定的截断内容，保持请求前缀稳定、保护 prompt cache
                        messages[_uIdx] = { role: 'user', content: _uLock.content };
                    } else {
                        var _uCut = _uTxt.slice(0, _cfg.longMsgTruncateTo) + '\n\n【提示】你的消息超过 ' + _cfg.longMsgTruncateTo + ' 字，已被自动截断，仅保留前 ' + _cfg.longMsgTruncateTo + ' 字。如需完整内容请分段发送。';
                        try { messages[_uIdx]._truncLock = { _origLen: _uTxt.length, content: _uCut }; } catch (e) {}
                        messages[_uIdx] = { role: 'user', content: _uCut };
                    }
                }
            }
            // ===== 豁免区总字符上限（JSON 可配：ctxCache.longMsgExemptMaxChars，默认 10 万）=====，超出从最旧开始截
            try {
                var _firstUserIdx = -1;
                for (var _fi = 0; _fi < messages.length; _fi++) { if (messages[_fi] && messages[_fi].role === 'user') { _firstUserIdx = _fi; break; } }
                if (_firstUserIdx >= 0) {
                    var _totalChars = 0;
                    for (var _ti = _firstUserIdx; _ti < messages.length; _ti++) _totalChars += _msgText(messages[_ti] || {}).length;
                    if (_totalChars > _cfg.longMsgExemptMaxChars) {
                        var _over = _totalChars - _cfg.longMsgExemptMaxChars;
                        for (var _oi = _firstUserIdx; _oi < messages.length && _over > 0; _oi++) {
                            var _oc = messages[_oi]; if (!_oc || !_oc.content) continue;
                            var _cl = _msgText(_oc).length;
                            var _tLock = _oc._truncLock;
                            if (_tLock && String(_tLock._origLen) === String(_cl)) {
                                // 【缓存优化】复用已锁定的截断结果，避免总长增长导致截断点前移、反复改写早期消息
                                _oc.content = _tLock.content;
                                _over -= (_cl - _msgText(_tLock).length);
                                if (_over <= 0) break;
                                continue;
                            }
                            if (_cl <= _over) { _over -= _cl; _oc.content = _oc.role === 'user' ? '【提示】此条较早消息过长，已整体省略以控制上下文长度。' : ''; try { _oc._truncLock = { _origLen: _cl, content: _oc.content }; } catch (e) {} }
                            else { var _tCut = _msgText(_oc).slice(0, _cl - _over) + '\n…【前段已省略以控制上下文长度】'; _oc.content = _tCut; try { _oc._truncLock = { _origLen: _cl, content: _tCut }; } catch (e) {} _over = 0; }
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
            /* 【极速模式】关闭风筝测速：不初始化计时起点 */
            if (window.isTurboMode && window.isTurboMode()) {
                chat._prevApiAt = 0; chat._lastGapMs = 0;
            } else {
            chat._prevApiAt = Date.now();   // 风筝测速：本轮起点（首次往返间隔 = 起点 → 首响应）
            chat._lastGapMs = 0;            // 风筝测速：清空上一轮间隔，避免残留旧数据
            }
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
                if (_th.role === 'user' && !_th._maxDepthRecovery && !_th._guardInject && !_th._verifyRound && !_th._continueRound && _msgText(_th).indexOf('🐕【小狗守卫巡查报告】') !== 0) {
                    chat._activeTaskText = _msgText(_th);
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
                retryRounds: 3,
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
                // ===== 对话级覆盖（chat-context-config.js 保存的每对话配置）=====
                if (typeof window.ChatContextConfig !== 'undefined' && typeof window.ChatContextConfig.getOverride === 'function') {
                    var _ccfEng = '';
                    try {
                        if (typeof DB !== 'undefined' && DB._engine !== undefined) _ccfEng = DB._engine || '';
                        else if (typeof Tools !== 'undefined' && Tools.currentChatId && typeof Store !== 'undefined' && Store.getChatBox) {
                            var _ccfChat = Store.getChatBox(Tools.currentChatId);
                            if (_ccfChat && _ccfChat._engine !== undefined) _ccfEng = _ccfChat._engine || '';
                        }
                    } catch (_ce) {}
                    var _ccfOvr = window.ChatContextConfig.getOverride(Tools && Tools.currentChatId ? Tools.currentChatId : null, _ccfEng);
                    if (_ccfOvr && typeof _ccfOvr === 'object') {
                        Object.keys(_ccfOvr).forEach(function (k) {
                            if (k === 'steps') return;
                            fallback[k] = _ccfOvr[k];
                        });
                        if (Array.isArray(_ccfOvr.steps) && _ccfOvr.steps.length) {
                            fallback.steps = (Array.isArray(fallback.steps) ? fallback.steps : []).map(function (s) {
                                var sv = _ccfOvr.steps.find(function (x) { return x && x.id === s.id; });
                                return sv ? Object.assign({}, s, sv) : s;
                            });
                        }
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
            fallback.toolResultMaxChars = Math.max(100, Math.min(50000, parseInt(fallback.toolResultMaxChars, 10) || 12000));
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
            policy.toolResultMaxChars = Math.max(100, Math.min(50000, parseInt(policy.toolResultMaxChars, 10) || 12000));
            policy.provider = provider;
            policy.modelId = mid;
            return policy;
        },
});

/* 【派出角标·关窗联动】挂一次 closeChatBox 钩子：子对话关闭时刷新来源对话角标（存活口径自动减一/归零消失） */
(function () {
    var tries = 0;
    function boot() {
        try {
            var inst = (typeof App !== 'undefined' && App) ? App : null;
            if (inst && typeof inst._installSpawnBadgeCloseHook === 'function') { inst._installSpawnBadgeCloseHook(); return; }
        } catch (e) {}
        if (++tries < 50) setTimeout(boot, 200);
    }
    boot();
})();
