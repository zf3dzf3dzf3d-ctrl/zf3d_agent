// ==== 拆分自 app-agent.js：Agent 循环核心 ====
Object.assign(App, {
        // ===== 循环任务早期预警 =====
        // 思路：把每轮工具调用做成签名（工具名+参数摘要），滚动保留最近 N 个。
        // - 重复率 ≥ 60% 且至少重复 4 次 → 第一阶段：对话内警告（黄色），不打断，给模型自我纠正机会；
        // - 警告后仍继续重复 → 第二阶段：打 chat._loopEscalated 标记，小狗守卫巡逻到它时提前介入（停止+注入），不用等 10 分钟超时。
        _loopWarnThreshold: 16,  // 最少重复次数才警告（已再翻倍，减少误报）
        _loopWarnRatio: 0.6,     // 重复率阈值
        _loopSignatures: {},     // {chatId: [sig, ...]} 最近签名，滚动窗口

        _detectAgentLoop: function(box, chat, toolCalls, depth) {
            var sigs = (this._loopSignatures[chat.id] = this._loopSignatures[chat.id] || []);
            var parts = [];
            for (var i = 0; i < toolCalls.length; i++) {
                var tc = toolCalls[i];
                var args = '';
                try { args = JSON.stringify(tc.function.arguments || ''); } catch(e) { args = '?'; }
                if (args.length > 120) args = args.substring(0, 120); // 参数截断，容忍微小变化
                parts.push(tc.function.name + ':' + args);
            }
            var sig = parts.join('|');
            // 终止类调用不算循环
            if (typeof Tools !== 'undefined' && Tools.isTerminal) {
                for (var j = 0; j < toolCalls.length; j++) {
                    if (Tools.isTerminal(toolCalls[j].function.name)) { sigs.length = 0; return; }
                }
            }
            sigs.push(sig);
            if (sigs.length > 48) sigs.shift(); // 滚动窗口 48（已再翻倍）
            if (sigs.length < this._loopWarnThreshold) return;

            // 统计最近 24 个签名中最高重复次数（已再翻倍：12→24）
            var win = sigs.slice(-24);
            var counts = {};
            var maxName = '', maxCnt = 0;
            for (var w = 0; w < win.length; w++) {
                counts[win[w]] = (counts[win[w]] || 0) + 1;
                if (counts[win[w]] > maxCnt) { maxCnt = counts[win[w]]; maxName = win[w]; }
            }
            var ratio = maxCnt / win.length;
            var looping = maxCnt >= this._loopWarnThreshold && ratio >= this._loopWarnRatio;
            if (!looping) return;

            var firstTool = maxName.split(':')[0] || '?';
            if (!chat._loopWarned) {
                // ===== 第一阶段：温和警告，不打断 =====
                chat._loopWarned = true;
                chat._loopWarnDepth = depth;
                try { this.addMsg(box, '⚠️ 循环预警：检测到近几步在重复调用「' + firstTool + '」且结果无进展（疑似原地打转）。请立即停下来检查：是不是在反复用同样的参数调用同一个工具？如果是，请换一种方法，或用 task_complete 结束并说明卡点。', 'warning'); } catch(e) {}
                try { Store.addLog('warn', chat.id, 'loop-detect', '循环预警 depth=' + depth + ' 重复工具=' + firstTool + ' 重复率=' + Math.round(ratio*100) + '%'); } catch(e) {}
            } else if (depth > (chat._loopWarnDepth || 0) + 12) { // 升级缓冲已再翻倍：+6→+12
                // ===== 第二阶段：警告后仍无改变 → 升级标记，交给小狗守卫 =====
                chat._loopEscalated = Date.now();
                this._loopSignatures[chat.id] = []; // 清空，避免升级后立刻又触发
                try { Store.addLog('warn', chat.id, 'loop-detect', '循环未纠正，升级交给小狗守卫处理 depth=' + depth); } catch(e) {}
            }
        },

        // ===== Agent 循环核心 =====
        _agentLoop: async function(box, chat, model, messages, depth, retryCount, retryRound) {
            // ===== 【2026 修复】循环入口守卫：用户已点"停止"则不再继续 =====
            // 修复问题：切换模型后对话无法停止。
            // 根因：用户切换模型 / 模型ID覆盖时，stopSending() 因 isSending=false 直接 return，
            // chat._stopped 永远不会置 true；而旧一轮 _agentLoop 的重试链仍在挂起
            // （setTimeout 重试 / 工具执行），入口没有任何停止检查，导致循环"永动"、无法终止。
            if (chat._stopped) {
                Store.addLog('info', chat.id, 'loop-stopped', '_agentLoop 入口检测到 _stopped，终止残留循环 | depth=' + depth);
                if (!chat._sendCompleteCalled) {
                    this._onSendComplete(box, chat);
                }
                return;
            }

            // ===== 【线路切换即时生效】每轮循环按 chat.modelId 重新解析模型 =====
            // 根因：重试/递归链层层传参沿用首轮的旧 model 对象，用户发送中切换线路后，
            // 挂起的重试链仍打旧线路（如火山方舟 429 重试跑满 10 分钟）。现在每轮入口
            // 检测 chat.modelId 与当前 model 不一致时自动换道，切换线路立即生效。
            try {
                // 【修复】识图接管期间不换道：接管后 model 已切到识图引擎且 messages 仍含图片，
                // 若此处按 chat.modelId 换回对话模型，下方图片接管逻辑会再切回识图引擎，
                // 造成每个 depth "GLM→识图→GLM" 来回翻转（vision-takeover / model-switch-adopted 刷屏）。
                var _stillHasImg = messages.some(function (msg) {
                    return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                        return part && (part.type === 'image_url' || part.type === 'input_image');
                    });
                });
                var _visionHold = model && model._vision接管Of && _stillHasImg;
                if (chat.modelId && model && chat.modelId !== model.id && !_visionHold) {
                    var _freshModel = Models.get(chat.modelId);
                    if (_freshModel && _freshModel.endpoint) {
                        if (depth > 0 || retryCount > 0 || retryRound > 0) {
                            Store.addLog('info', chat.id, 'model-switch-adopted', '重试链换道: ' + (model.name || model.modelId) + ' → ' + (_freshModel.name || _freshModel.modelId) + ' | depth=' + depth);
                        }
                        model = _freshModel;
                    }
                }
            } catch (eMS) {}

            // ===== 深度限制（用户要求：不限制，已禁用）====
            // 仅读取配置供重试逻辑使用，不再因步数上限拦截任务。
            var loopConfig = this._getContextLoopConfig();
            var MAX_AGENT_DEPTH = Infinity;

            var self = this;

            // ===== 请求失败自动重试（含上游 400 消息参数错误）=====
            retryCount = retryCount || 0;
            retryRound = retryRound || 0;
            // 网络/限流错误只做少量退避重试，避免失败时重复消耗大量 token。
var MAX_RETRY = (loopConfig.retryMaxPerRound != null ? loopConfig.retryMaxPerRound : 5);
var MAX_RETRY_ROUNDS = (loopConfig.retryRounds != null ? loopConfig.retryRounds : 1);
var MAX_RETRY_ROUNDS_429 = (loopConfig.retryRounds429 != null ? loopConfig.retryRounds429 : 2); // 429 限流专用轮次数（普通错误仍 1 轮；429 可等多轮恢复，避免直接判死）
var RETRY_INTERVAL = (loopConfig.retryIntervalMs != null ? loopConfig.retryIntervalMs : 3000);
var RETRY_ROUND_INTERVAL = (loopConfig.retryRoundIntervalMs != null ? loopConfig.retryRoundIntervalMs : 300000);
// 0=网络错误；400=上游请求/消息格式错误；429=限流（需更长退避）；5xx=服务端错误（可配置）
var RETRY_STATUS = (typeof loopConfig.retryStatusCodes === 'string' ? loopConfig.retryStatusCodes.split(',') : (Array.isArray(loopConfig.retryStatusCodes) ? loopConfig.retryStatusCodes : [0, 400, 429, 500, 502, 503, 504])).map(function(x){ return parseInt(x,10); });
RETRY_STATUS = RETRY_STATUS.filter(function(n){ return !isNaN(n); });
if (!RETRY_STATUS.length) RETRY_STATUS = [0, 400, 429, 500, 502, 503, 504];
// 429 用单独的退避策略，给上游留出充足恢复时间，避免重试雪崩（毫秒，可配置）
var RETRY_BACKOFF_429 = (typeof loopConfig.retryBackoff429Ms === 'string' ? loopConfig.retryBackoff429Ms.split(',') : (Array.isArray(loopConfig.retryBackoff429Ms) ? loopConfig.retryBackoff429Ms : [5000, 15000, 40000, 90000, 180000])).map(function(x){ return parseInt(x,10); });
RETRY_BACKOFF_429 = RETRY_BACKOFF_429.filter(function(n){ return !isNaN(n) && n >= 0; });
if (!RETRY_BACKOFF_429.length) RETRY_BACKOFF_429 = [5000, 15000, 40000, 90000, 180000];

            // 柔和进度提示：每 30 步出现一次（30/60/90...），不中断、不催促、不落库（临时提示）
            if (depth >= 30 && depth >= (chat._depthNoticeStep || 0) + 30) {
                chat._depthNoticeStep = depth;
                try { this.addMsg(box, '已执行 ' + depth + ' 步，继续执行中…', 'notice', null, false, true); } catch(e){}
                try { Store.addLog('info', chat.id, 'depth-notice', 'Agent depth=' + depth + ' (progress notice)'); } catch(e){}
            }

            // 深度硬限制已移除（用户要求去掉），仅保留 depth>=30 的软警告

            // ===== 工具结果管理（每次循环都执行）=====
            if (typeof App !== 'undefined' && App._manageToolResults) { App._manageToolResults(messages, chat.id); } else { try { self._manageToolResults(messages, chat.id); } catch(e) {} }

            // ===== 防卡死(1.6)：上下文长度检查 + 截断超长工具结果（不再做压缩摘要，避免失忆→重复搜索→恶性循环） =====
            var cachePolicy = self._getModelCachePolicy(model, loopConfig);
            // 保存本轮策略，便于日志和供应商返回的缓存统计对照。
            chat._cachePolicy = cachePolicy;
            var _compressed = { compressed: false, beforeTokens: self._estimateTokens(messages), afterTokens: self._estimateTokens(messages), removedCount: 0 };
            var compressStep = loopConfig.steps.find(function(step) { return step.id === 'compress'; });
            if (loopConfig.enabled && (!compressStep || compressStep.enabled !== false)) {
                // 仅截断超长 tool 结果，不删除消息、不做摘要替换
                _compressed = self._truncateToolResultsOnly(messages, model, depth, loopConfig, cachePolicy);
            }
            if (_compressed.compressed) {
                try { Store.addLog('info', chat.id, 'context-compress',
                    '上下文压缩 | depth=' + depth +
                    ' | 压缩前~' + _compressed.beforeTokens + 'tokens' +
                    ' → 压缩后~' + _compressed.afterTokens + 'tokens' +
                    ' | 压缩了' + _compressed.removedCount + '条消息'); } catch(e){}
            }

            // 移除上一轮残留的 typing 指示器，避免闪烁
            var _oldTypings = box.querySelectorAll('.msg.typing');
            _oldTypings.forEach(function(t) { t.remove(); });
            var typing = this.addMsg(box, depth === 0 ? '正在调用 ' + model.name + ' …' : '正在思考下一步…', 'typing');

            // ===== 免费生图模型拦截（imageGen 标记）→ 逻辑已拆分至 agent-02a-imagegen-direct.js =====
            if (model.imageGen) {
                var _handled = self._handleImageGenDirect(box, chat, model, messages);
                if (_handled) return;
            }

            // 请求头
            var headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + model.key
            };
            if (model.headers) {
                for (var hk in model.headers) if (model.headers.hasOwnProperty(hk)) headers[hk] = model.headers[hk];
            }

            // ===== 消息格式清洗 → 逻辑已拆分至 agent-02b-message-sanitize.js =====
            self._sanitizeMessages(messages);

            // 图片理解：对话模型未配置 visionInput 时，自动切换到用户默认识图大模型（models.json 中 vision 类型 isDefault）。
            // imageGen 仅表示生图，不等于识图。
            var _hasImageInput = messages.some(function (msg) {
                return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                    return part && (part.type === 'image_url' || part.type === 'input_image');
                });
            });
            if (_hasImageInput && !model.visionInput) {
                var _visionModel = null;
                try {
                    if (typeof Models !== 'undefined' && Models && typeof Models.getDefaultFor === 'function') {
                        _visionModel = Models.getDefaultFor('vision');
                    }
                } catch (e) {}
                if (_visionModel && _visionModel.visionInput && _visionModel.endpoint) {
                    // 用默认识图引擎接管本次（含后续工具循环轮次）：endpoint/key/headers/modelId 全部切换
                    var _vOrigName = model.name || model.modelId || '当前模型';
                    model = Object.assign({}, _visionModel, { key: _visionModel.key || _visionModel.apiKey || '', _vision接管Of: _vOrigName });
                    // 【修复识图401】headers 在上方已用原模型 key 构建完毕，此处必须重建，
                    // 否则继续携带原模型（如火山方舟）的 key 打识图端点 → 401 令牌已过期
                    headers['Authorization'] = 'Bearer ' + (model.key || '');
                    if (model.headers) { for (var _vhk in model.headers) if (model.headers.hasOwnProperty(_vhk)) headers[_vhk] = model.headers[_vhk]; }
                    try { if (!chat._visionTakeoverLogged) { chat._visionTakeoverLogged = true; Store.addLog('info', chat.id, 'vision-takeover', '当前模型不支持识图，已自动切换默认识图引擎「' + _visionModel.name + '」'); } } catch (e) {}
                    try { if (depth === 0) this.addMsg(box, '👁️ 当前模型不支持识图，已自动调用默认识图引擎「' + _visionModel.name + '」…', 'info'); } catch (e) {}
                } else {
                    var _visionError = '当前模型「' + (model.name || model.modelId || '未命名') + '」不支持识图，且未找到可用的默认识图大模型。请在「⚙️ 模型配置」→ 识图模型 中添加支持图片输入的模型并设为默认。';
                    try { this.addMsg(box, _visionError, 'error'); this._onSendComplete(box, chat); } catch (e) {}
                    try { Store.addLog('warn', chat.id, 'vision-input-rejected', _visionError); } catch (e) {}
                    return;
                }
            }

            // 音频理解：消息含 input_audio 且当前模型不支持音频输入时，自动切换到默认语音/音频大模型。
            var _hasAudioInput = messages.some(function (msg) {
                return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                    return part && part.type === 'input_audio';
                });
            });
            var _audioOk = !!(model.audioInput || /^(audio|omni|speech|asr)$/i.test(String(model.modelType || '')));
            if (_hasAudioInput && !_audioOk) {
                var _audioModel = null;
                try {
                    if (typeof Models !== 'undefined' && Models && typeof Models.getDefaultFor === 'function') {
                        _audioModel = Models.getDefaultFor('audio');
                    }
                } catch (e) {}
                if (_audioModel && _audioModel.endpoint && (_audioModel.audioInput || /^(audio|omni|speech|asr)$/i.test(String(_audioModel.modelType || '')))) {
                    var _aOrigName = model.name || model.modelId || '当前模型';
                    model = Object.assign({}, _audioModel, { key: _audioModel.key || _audioModel.apiKey || '', _audio接管Of: _aOrigName });
                    // 【修复】同识图接管：切换模型后必须重建 Authorization，否则带旧模型 key 打新端点必 401
                    headers['Authorization'] = 'Bearer ' + (model.key || '');
                    if (model.headers) { for (var _ahk in model.headers) if (model.headers.hasOwnProperty(_ahk)) headers[_ahk] = model.headers[_ahk]; }
                    try { Store.addLog('info', chat.id, 'audio-takeover', '当前模型不支持音频输入，已自动切换默认语音引擎「' + _audioModel.name + '」'); } catch (e) {}
                    try { this.addMsg(box, '🎧 当前模型不支持音频输入，已自动调用默认语音引擎「' + _audioModel.name + '」…', 'info'); } catch (e) {}
                } else {
                    var _audioError = '当前模型「' + (model.name || model.modelId || '未命名') + '」不支持音频输入，且未找到可用的默认语音大模型。请在「⚙️ 模型配置」→ 语音模型 中添加支持音频输入的模型并设为默认。';
                    try { this.addMsg(box, _audioError, 'error'); this._onSendComplete(box, chat); } catch (e) {}
                    try { Store.addLog('warn', chat.id, 'audio-input-rejected', _audioError); } catch (e) {}
                    return;
                }
            }

            // ===== 图片/视频生成：用户表达生图/生视频意图时，自动调用默认生成模型（models.json 中 vision/video 类型 isDefault）=====
            var _genIntent = ''; // '' | 'image' | 'video'
            var _lastUserText = '';
            (function () {
                for (var _gi = messages.length - 1; _gi >= 0; _gi--) {
                    if (messages[_gi] && messages[_gi].role === 'user') {
                        var _gc = messages[_gi].content;
                        _lastUserText = typeof _gc === 'string' ? _gc : (Array.isArray(_gc) ? _gc.map(function (p) { return (p && p.text) || ''; }).join(' ') : '');
                        break;
                    }
                }
                if (/(文生视频|生成|制作|创建|画|来)(一)?[个段张幅]?(视频|短片)/i.test(_lastUserText) || /generate\s+(a\s+)?video/i.test(_lastUserText)) { _genIntent = 'video'; return; }
                // 排除"流程图/架构图"等图表类词，避免误触发生图
                if (/(流程图|架构图|思维导图|拓扑图|图表|示意图|函数图|曲线图|线框图)/i.test(_lastUserText)) return;
                if (/(文生图|生图|画|绘制|生成|创建|制作|来)(一)?[张幅个]?(图|图片|图画|插画|海报|照片)/i.test(_lastUserText) || /generate\s+(a\s+)?(image|picture|photo)/i.test(_lastUserText)) { _genIntent = 'image'; return; }
            })();
            if (_genIntent && !model.imageGen && (depth || 0) === 0) {
                var _genModel = null;
                try { _genModel = Models.getDefaultFor(_genIntent === 'video' ? 'video' : 'vision'); } catch (e) {}
                var _genValid = !!(_genModel && _genModel.endpoint && (_genIntent === 'video'
                    ? (_genModel.modelType === 'video' || /videos\/generations|generations\/tasks/i.test(_genModel.endpoint || '') || /cogvideox|seedance/i.test(_genModel.modelId || ''))
                    : (/images\/generations/i.test(_genModel.endpoint || '') || _genModel.modelType === 'image' || /seedream|dall-e|flux|sd3|stable-diffusion|irag|seededit/i.test(_genModel.modelId || ''))));
                if (_genValid) {
                    var self3 = this;
                    var _prompt = String(_lastUserText || '').trim() || (_genIntent === 'video' ? 'a short video' : 'a beautiful picture');
                    // 图生图/图生视频：本条用户消息附带图片时，取第一张图片 URL/ DataURL 作为参考图
                    var _refImage = '';
                    (function () {
                        for (var _ri = messages.length - 1; _ri >= 0; _ri--) {
                            var _rc = messages[_ri];
                            if (_rc && _rc.role === 'user' && Array.isArray(_rc.content)) {
                                for (var _rj = 0; _rj < _rc.content.length; _rj++) {
                                    var _rp = _rc.content[_rj];
                                    if (_rp && (_rp.type === 'image_url' || _rp.type === 'input_image')) {
                                        _refImage = (_rp.image_url && _rp.image_url.url) || _rp.url || _rp.image || '';
                                        if (_refImage) return;
                                    }
                                }
                            }
                        }
                    })();
                    var _szM = _prompt.match(/(\d{3,4})\s*[xX×]\s*(\d{3,4})/);
                    var _apiPath = _genIntent === 'video' ? '/api/video-gen' : '/api/image-gen';
                    var _apiBody = _genIntent === 'video'
                        ? { action: 'generate', prompt: _prompt, size: _szM ? (_szM[1] + 'x' + _szM[2]) : '832x480', model: _genModel.modelId || '', duration: 5, key: _genModel.key || _genModel.apiKey || '', image_url: _refImage || '' }
                        : { action: _refImage ? 'edit' : 'generate', prompt: _prompt, size: _szM ? (_szM[1] + 'x' + _szM[2]) : '1024x1024', model: _genModel.modelId || '', image_url: _refImage || '' };
                    try { Store.addLog('info', chat.id, 'gen-takeover', '已自动调用默认' + (_genIntent === 'video' ? '视频' : '图片') + '生成引擎「' + _genModel.name + '」' + (_refImage ? '（' + (_genIntent === 'video' ? '图生视频' : '图生图') + '模式）' : '')); } catch (e) {}
                    try { this.addMsg(box, (_genIntent === 'video' ? '🎬' : '🎨') + ' 已调用默认' + (_genIntent === 'video' ? '视频' : '图片') + '生成引擎「' + _genModel.name + '」' + (_refImage ? '（' + (_genIntent === 'video' ? '图生视频' : '图生图') + '）' : '') + '，正在生成…', 'typing'); } catch (e) {}
                    fetch(_apiPath, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(_apiBody)
                    }).then(function (r) { return r.json(); }).then(function (j) {
                        var d = j.data || {};
                        var out = '';
                        if (j.ok) {
                            if (_genIntent === 'video') {
                                var vurl = (d.videos && d.videos[0] && d.videos[0].url) || d.url || '';
                                out = vurl ? ('✅ 视频已生成\n\n🎬 [点击播放/下载视频](' + vurl + ')' + (d.provider ? '\n\n- **引擎**: ' + d.provider : '')) : '❌ 视频生成失败';
                                if (vurl && typeof window.KiteCanvas !== 'undefined' && window.KiteCanvas.addVideoNode) {
                                    try { window.KiteCanvas.addVideoNode({ url: vurl, prompt: _prompt, connectToChat: chat.id || null }); } catch (ve) {}
                                }
                            } else {
                                var iurl = d.url || '';
                                out = iurl ? ('✅ 已生成\n\n![' + _prompt.slice(0, 30).replace(/[\[\]()]/g, '') + '](' + iurl + ')' + (d.model ? '\n\n- **模型**: ' + d.model : '') + (d.size ? '\n- **尺寸**: ' + d.size : '')) : '❌ 图片生成失败';
                                if (iurl && typeof App !== 'undefined' && App.createImageCanvasNode) {
                                    try { App.createImageCanvasNode(box, iurl, _prompt, { model: d.model || '', channel: d.channel_name || d.channel || '' }); } catch (ie) {}
                                }
                            }
                        } else {
                            out = '❌ 生成失败: ' + (d.error || '未知错误');
                        }
                        try { self3.addMsg(box, out, 'ai', chat.modelId, true); } catch (e2) {}
                        try { self3._onSendComplete(box, chat); } catch (e3) {}
                    }).catch(function (e) {
                        try { self3.addMsg(box, '❌ 生成请求异常: ' + e.message, 'ai', chat.modelId, true); } catch (e2) {}
                        try { self3._onSendComplete(box, chat); } catch (e3) {}
                    });
                    return;
                } else {
                    // 未配置默认生成模型：提示但不中断，继续走正常对话流程（AI 仍可调 image_gen 工具）
                    var _genTip = '检测到' + (_genIntent === 'video' ? '视频' : '图片') + '生成需求，但未配置默认' + (_genIntent === 'video' ? '视频' : '图片') + '生成模型。可在「⚙️ 模型配置」→ ' + (_genIntent === 'video' ? '视频模型' : '图片模型') + ' 中添加并设为默认。';
                    try { Store.addLog('warn', chat.id, 'gen-takeover-missing', _genTip); } catch (e) {}
                    try { this.addMsg(box, 'ℹ️ ' + _genTip, 'info'); } catch (e) {}
                }
            }

            // ===== per-chat 覆盖生效（底部选择器设置）=====
            // _modelIdOverride: 本对话覆盖模型 ID（不改全局配置）
            // _reasoningEffort: 本对话覆盖思考强度（档位由 config/reasoning_levels.json 定义，如 disable/low/medium/high/ultra）
            if (chat._modelIdOverride) {
                model = Object.assign({}, model, { modelId: chat._modelIdOverride });
            }
            if (chat._reasoningEffort) {
                // 校验 chat._reasoningEffort 是否为当前模型的合法值，防止旧 session 保存的
                // 无效值（如 GLM 不支持的 "medium"）覆盖 models.json 的正确配置导致 400 错误
                // 仅当 ReasoningLevels 已加载（ready）且值在当前模型的合法列表中时才覆盖
                if (typeof ReasoningLevels !== 'undefined' && ReasoningLevels && ReasoningLevels.ready) {
                    var _validEfforts = ReasoningLevels.listFor(model.modelId, model).map(function(l) { return l.value; });
                    if (_validEfforts.indexOf(chat._reasoningEffort) >= 0) {
                        model = Object.assign({}, model, { reasoningEffort: chat._reasoningEffort });
                    }
                }
            }

            // 请求体（加入 tools 定义）
            // maxTokens=null 时不注入 max_tokens，但 GLM 等模型不传 max_tokens 会用很小的默认值(4096)
            // 启用思考模式的模型尤其需要更大预算，null 时默认给 32768
            var _effMaxTokens = chat._maxTokensOverride || model.maxTokens;
            if (!_effMaxTokens && model.reasoningEffort && model.reasoningEffort !== 'off' && model.reasoningEffort !== 'disable') {
                _effMaxTokens = 32768;
            }
            var payload = {
                model: model.modelId,
                messages: messages,
                stream: false,
                tools: Tools.getDefinitions(null, chat.id),
                tool_choice: 'auto',
                _box_id: String(chat.id || '')
            };
            // 对话级底层引擎（server/engines/ 可插拔，空 = 服务端默认 zf_core）
            if (chat._engine) {
                payload._engine = String(chat._engine);                // own_tools 风格引擎（codex/pi/deepseek/hermes/claude/openclaw）：
                // 只用引擎自有工具集（服务端 agent_loop 注入），清掉前端全局工具分类的工具
                var _engMeta = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines().filter(function(x){return x.id===chat._engine;})[0] : null;
                if (_engMeta && _engMeta.own_tools) {
                    delete payload.tools;
                    delete payload.tool_choice;
                }
            }
            if (_effMaxTokens) {
                payload.max_tokens = _effMaxTokens;
            }
            if (model.body) {
                for (var bk in model.body) {
                    if (!model.body.hasOwnProperty(bk)) continue;
                    // Local-only context setting. Sending it to OpenAI-compatible APIs can cause 400 errors.
                    if (bk === 'context_rounds') continue;
                    // maxTokens 已由上方 _effMaxTokens 处理，不重复注入
                    if (bk === 'maxTokens') continue;
                    payload[bk] = model.body[bk];
                }
            }
            // 注入思考强度（reasoning_effort），支持火山方舟等模型的深度思考切换
            // off/disable 均视为关闭思考，不注入该字段
            if (model.reasoningEffort && model.reasoningEffort !== 'off' && model.reasoningEffort !== 'disable') {
                payload.reasoning_effort = model.reasoningEffort;
            }
            // ===== 注入项目路径：后端据此替换提示词模板中的 {PROJECT_ROOT} =====
            // 优先用 chat._cachedFolderPath（首次查到后缓存到对话对象上，后续直接复用）
            // 缓存未命中时：先查 Store.data.projects / App._projAllProjects，都没有则 fetch /projects 从服务端拿
            if (chat.projectId) {
                var _projPath = chat._cachedFolderPath || '';
                if (!_projPath) {
                    // 1) 查 Store.data.projects
                    if (typeof Store !== 'undefined' && Store.data && Store.data.projects) {
                        for (var _pi = 0; _pi < Store.data.projects.length; _pi++) {
                            if (Store.data.projects[_pi].id === chat.projectId && Store.data.projects[_pi].folder_path) {
                                _projPath = Store.data.projects[_pi].folder_path;
                                break;
                            }
                        }
                    }
                    // 2) 查 App._projAllProjects（含服务端 folder_path）
                    if (!_projPath && typeof App !== 'undefined' && App._projAllProjects) {
                        for (var _pj = 0; _pj < App._projAllProjects.length; _pj++) {
                            if (App._projAllProjects[_pj].id === chat.projectId && App._projAllProjects[_pj].folder_path) {
                                _projPath = App._projAllProjects[_pj].folder_path;
                                break;
                            }
                        }
                    }
                    // 3) 本地缓存都没有，直接从服务端拉取（linkFolder 更新了 DB 但本地缓存可能没同步）
                    if (!_projPath && typeof DB !== 'undefined' && DB.getProjects) {
                        try {
                            var _projRes = await DB.getProjects();
                            if (_projRes && _projRes.ok && _projRes.data) {
                                for (var _pk = 0; _pk < _projRes.data.length; _pk++) {
                                    if (_projRes.data[_pk].id === chat.projectId && _projRes.data[_pk].folder_path) {
                                        _projPath = _projRes.data[_pk].folder_path;
                                        break;
                                    }
                                }
                                // 同步更新本地缓存，后续不用再 fetch
                                if (typeof Store !== 'undefined' && Store.data) {
                                    Store.data.projects = _projRes.data;
                                }
                            }
                        } catch (e) {
                            console.warn('[Agent] 获取项目路径失败:', e);
                        }
                    }
                    if (_projPath) chat._cachedFolderPath = _projPath;
                }
                if (_projPath) payload._project_path = _projPath;
            }

            // ===== 上下文展示（仅内存，不留痕迹）：原封不动保存最后一次发送给 AI 的完整请求体，新请求直接覆盖上一条 =====
            try {
                chat._lastContext = JSON.stringify(payload, null, 2);
                if (typeof App !== 'undefined' && App.refreshLogPanelCtx) App.refreshLogPanelCtx(box);
            } catch (e) {}

            var reqStart = Date.now();
            Store.addLog('info', chat.id, 'api-request', '→ ' + model.name + ' (depth=' + depth + ') | model=' + model.modelId);

            // ===== 发送前清洗 messages：移除 reasoning_content 等非标准字段 → 拆分至 agent-02b-message-sanitize.js =====
            self._cleanNonStandardFields(messages);

            var _proxyP;
            chat._realStreamDiv = null;
            chat._realStreamBuf = '';
            if (typeof DB.proxyStream === 'function' && payload.stream === true) {
                // ===== 真实流式：最终回复轮走 /api/proxy_stream，逐块增量渲染（失败自动回退聚合代理）=====
                // 注意：不新增 abort 计时器（沿用上方唯一 330 秒 Promise.race 超时），避免双计时器复发「自动停止」
                _proxyP = DB.proxyStream(model.endpoint, headers, payload,
                    chat.abortController ? chat.abortController.signal : null,
                    function(chunk) {                        if (!chunk || !chunk.content) return;
                        if (!chat._realStreamDiv || !chat._realStreamDiv.parentNode) {
                            var _elsS = box.querySelectorAll('.msg.typing');
                            _elsS.forEach(function(t) { t.remove(); });
                            chat._realStreamDiv = App.addMsg(box, '', 'ai', chat.modelId, false, true);
                            chat._realStreamBuf = '';
                        }
                        chat._realStreamBuf += chunk.content;
                        var _cEl = chat._realStreamDiv.querySelector('.msg-content') || chat._realStreamDiv;
                        // 流式阶段只更新 textContent（半截 HTML 不能过 markdown 管道），完成后统一渲染
                        _cEl.textContent = chat._realStreamBuf;
                        var _bEl = box.querySelector('.chatbox-body');
                        if (_bEl) _bEl.scrollTop = _bEl.scrollHeight;
                    },
                    null,
                    // 【新增】tool_event 事件回调：敏感工具（鼠标/键盘控制）提示弹 toast
                    function(ev) {
                        try {
                            if (!ev || ev.type !== 'tool_event') return;
                            var d = ev.data || {};
                            var msg = d.msg || '';
                            if (ev.kind === 'sensitive_tool' && msg) {
                                var t = document.createElement('div');
                                t.style.cssText = 'background:rgba(140,20,20,0.94);color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,0.35);max-width:100%;';
                                t.textContent = msg;
                                if (window.ToastStack && ToastStack.show) ToastStack.show(t, 6000);
                                else document.body.appendChild(t), setTimeout(function(){ t.remove(); }, 6000);
                                try { Store.addLog('warn', chat.id, 'sensitive-tool', msg + ' | args=' + JSON.stringify(d.args || {})); } catch (e2) {}
                            }
                        } catch (e) { console.warn('[Agent] tool_event 处理失败', e); }
                    }
                ).catch(function(err) {
                    if (err && err.name === 'AbortError') throw err;  // 用户停止不回退
                    console.warn('[Agent] 流式代理失败，回退聚合模式:', err);
                    try { Store.addLog('warn', chat.id, 'stream-fallback', 'proxyStream failed, fallback to aggregated proxy | ' + ((err && err.message) || err)); } catch (e) {}
                    chat._realStreamDiv = null;
                    return DB.proxy(model.endpoint, headers, payload, chat.abortController ? chat.abortController.signal : null);
                });
            } else {
                // 工具选择轮保持原聚合代理路径
                _proxyP = DB.proxy(model.endpoint, headers, payload, chat.abortController ? chat.abortController.signal : null);
            }
            var _proxyAbortTimer = null;
            var _timeoutP = new Promise(function(_, reject) {
                _proxyAbortTimer = setTimeout(function() {
                    _proxyTimedOut = true;
                    reject(new Error('代理请求超时（330 秒未响应），已自动停止以避免卡死。请检查网络/后端服务后重试。'));
                }, 330000);
            });
            Promise.race([_proxyP, _timeoutP]).then(async function(res) {
                if (_proxyAbortTimer) { clearTimeout(_proxyAbortTimer); _proxyAbortTimer = null; }
                // 不在此处移除 typing：工具执行期间保持显示，避免闪烁
                var elapsed = Date.now() - reqStart;

                if (!res.ok || !res.data) {
                    var errMsg = _translateApiError(res.status, res.error || res.raw);
                    // 孤立 Unicode 代理项是本地上下文编码问题，原样重试不会改变输入。
                    var isUnicodeEncodingError = /surrogates not allowed|codec can't encode character/i.test(errMsg);
                    // ===== 400 自愈重建：400 是确定性错误（上游拒绝当前 messages），原样重发必然继续失败 =====
                    // 参照"用户手动发『继续』就能恢复"的成功路径：从 chat.history 重建干净 messages
                    //（_buildContext 自动过滤 tool/思考消息），追加恢复指令后接着干活。最多重建 3 次，超出则直接失败。
                    if (res.status === 400 && !chat._stopped && (chat._rebuild400Count || 0) < loopConfig.rebuild400Max) {
                        chat._rebuild400Count = (chat._rebuild400Count || 0) + 1;
                        var _cleanMsgs = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }].concat(self._buildContext(chat.history, model, chat));
                        // ===== 项目记忆注入（400 自愈重建后同样带上，保证模型知道项目目录和 python 路径） =====
                        var _pm400 = self._getProjectMemory(chat.projectId);
                        if (_pm400) {
                            _cleanMsgs.splice(1, 0, { role: 'system', content: '【项目背景记忆】' + _pm400 });
                        }
                        _cleanMsgs.push({ role: 'user', content: '（系统自动恢复：上一次请求因消息格式被 API 拒绝而中断，以上是有效对话记录。请继续完成刚才未完成的任务，已完成的部分不要重复执行。）' });
                        messages.length = 0;
                        for (var _mi = 0; _mi < _cleanMsgs.length; _mi++) messages.push(_cleanMsgs[_mi]);
                        var _typingElsFix = box.querySelectorAll('.msg.typing');
                        _typingElsFix.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '⚠ 请求被 API 拒绝（消息格式问题），已自动重建对话上下文（第' + chat._rebuild400Count + '/' + loopConfig.rebuild400Max + '次），' + RETRY_INTERVAL / 1000 + '秒后继续未完成的任务…', 'warning');
                        Store.addLog('warn', chat.id, 'retry-400-rebuild', 'HTTP 400 → rebuild messages from history #' + chat._rebuild400Count + ' | ' + errMsg);
                        setTimeout(function() {
                            self._agentLoop(box, chat, model, messages, depth + 1, retryCount, retryRound);
                        }, RETRY_INTERVAL);
                        return;
                    }
                    // ===== 请求失败自动重试（400 已由上方自愈分支处理；重建耗尽时不再盲目重发，直接走失败提示）=====
                    if (!isUnicodeEncodingError && res.status !== 400 && RETRY_STATUS.indexOf(res.status) >= 0 && !chat._stopped) {
                        if (retryCount < MAX_RETRY) {
                            retryCount++;
                            // 🔄 429 限流专用指数退避（5s/15s/40s/90s/180s），避免重试雪崩
                            var _isRateLimit = (res.status === 429);
                            var _backoffDelay = _isRateLimit
                                ? (RETRY_BACKOFF_429[Math.min(retryCount - 1, RETRY_BACKOFF_429.length - 1)])
                                : RETRY_INTERVAL;
                            var _waitSec = Math.round(_backoffDelay / 1000);
                            var _maxRoundsDisp = _isRateLimit ? MAX_RETRY_ROUNDS_429 : MAX_RETRY_ROUNDS;
                            var _retryMsg = '⚠ 请求失败（' + errMsg + '），' + _waitSec + '秒后自动重试…（第' + retryCount + '/' + MAX_RETRY + '次，第' + (retryRound + 1) + '/' + _maxRoundsDisp + '轮）';
                            var _typingEls6 = box.querySelectorAll('.msg.typing');
                            _typingEls6.forEach(function(t) { t.remove(); });
                            self.addMsg(box, _retryMsg, 'warning');
                            Store.addLog('warn', chat.id, 'retry' + (_isRateLimit ? '-429' : ''), 'retry round ' + (retryRound + 1) + '/' + _maxRoundsDisp + ', attempt ' + retryCount + '/' + MAX_RETRY + ' | ' + errMsg + ' | backoff=' + _waitSec + 's');
                            setTimeout(function() {
                                self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound);
                            }, _backoffDelay);
                            return;
                        }
                        // 429 用专用多轮（MAX_RETRY_ROUNDS_429），普通错误仍 1 轮，避免限流长冷却期直接判死
                        var _maxRounds = (res.status === 429) ? MAX_RETRY_ROUNDS_429 : MAX_RETRY_ROUNDS;
                        if (retryRound + 1 < _maxRounds) {
                            var _nextRound = retryRound + 1;
                            var _roundMsg = '⚠ 本轮已重试 ' + MAX_RETRY + ' 次仍失败，5分钟后开始第' + (_nextRound + 1) + '/' + _maxRounds + '轮重试…';
                            var _typingElsRound = box.querySelectorAll('.msg.typing');
                            _typingElsRound.forEach(function(t) { t.remove(); });
                            self.addMsg(box, _roundMsg, 'warning');
                            Store.addLog('warn', chat.id, 'retry-round-wait', 'wait 300s before retry round ' + (_nextRound + 1) + '/' + _maxRounds);
                            setTimeout(function() {
                                self._agentLoop(box, chat, model, messages, depth, 0, _nextRound);
                            }, RETRY_ROUND_INTERVAL);
                            return;
                        }
                    }
                    // ===== 降级逻辑已禁用：保持上下文稳定，不允许模型间自动切换 =====
                    // 所有重试轮次用尽，显示提示
                    var _typingEls5 = box.querySelectorAll('.msg.typing');
                    _typingEls5.forEach(function(t) { t.remove(); });
                    if (retryCount >= MAX_RETRY) {
                        // 仅真正重试满 30 次才显示该消息；否则下面显示单次失败原因。
                        // 原条件 || retryRound >= MAX_RETRY_ROUNDS - 1 在 MAX_RETRY_ROUNDS=1 时恒真，
                        // 导致 0 次重试也误报"已完成最多 30 次重试仍失败"
                        self.addMsg(box, '❌ 已完成最多 ' + MAX_RETRY + ' 次重试仍失败，请检查网络连接或 API 服务后手动重试。\n\n最后错误：' + errMsg, 'error');
                    } else {
                        self.addMsg(box, '调用失败：' + errMsg, 'error');
                    }
                    Store.addLog('error', chat.id, 'api-error', model.name + '  ' + errMsg + (retryCount > 0 ? ' (retried ' + retryCount + 'x)' : ''));
                    self._onSendComplete(box, chat);
                    return;
                }

                var choice = res.data.choices && res.data.choices[0];
                if (!choice) {
                    var _typingEls4 = box.querySelectorAll('.msg.typing');
                    _typingEls4.forEach(function(t) { t.remove(); });
                    self.addMsg(box, 'AI 返回格式异常', 'error');
                    self._onSendComplete(box, chat);
                    return;
                }

                var msg = choice.message || {};
                // ===== 提取 token 使用量 + 缓存命中统计 =====
                if (res.data.usage) {
                    var u = res.data.usage;
                    var promptTokens = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0) || 0;
                    var completionTokens = Number(u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0) || 0;
                    // Providers expose prompt-cache usage under several OpenAI-compatible names.
                    var promptDetails = u.prompt_tokens_details || u.promptTokensDetails || u.input_tokens_details || {};
                    var cacheHit = Number(
                        u.prompt_cache_hit_tokens ?? u.prompt_cache_read_tokens ?? u.prompt_cache_hit ??
                        u.cached_tokens ?? u.cache_read_input_tokens ?? u.cache_read_tokens ??
                        promptDetails.cached_tokens ?? promptDetails.cache_read_input_tokens ??
                        promptDetails.cache_read_tokens ?? 0
                    ) || 0;
                    var cacheMiss = Number(
                        u.prompt_cache_miss_tokens ?? u.prompt_cache_write_tokens ?? u.prompt_cache_miss ??
                        promptDetails.cache_miss_tokens ?? promptDetails.cache_write_tokens ?? 0
                    ) || 0;
                    // Some providers report only hits; the rest of the prompt is uncached.
                    cacheHit = Math.max(0, Math.min(cacheHit, promptTokens));
                    cacheMiss = Math.max(0, Math.min(cacheMiss, promptTokens - cacheHit));
                    if (!cacheMiss && promptTokens > cacheHit) cacheMiss = promptTokens - cacheHit;
                    chat._promptTokens += promptTokens;
                    chat._completionTokens += completionTokens;
                    chat._cacheHitTokens += cacheHit;
                    chat._cacheMissTokens += cacheMiss;
                    chat._tokenCount += (u.total_tokens || (promptTokens + completionTokens));
                    chat._apiCalls++;
                    // 同步累加到会话级累计统计（整个对话历史累计，跨任务不清零）
                    chat._sessionTotalTokens += (u.total_tokens || (promptTokens + completionTokens));
                    chat._sessionTotalApiCalls++;
                    chat._sessionTotalPromptTokens += promptTokens;
                    chat._sessionTotalCompletionTokens += completionTokens;
                    chat._sessionTotalCacheHitTokens += cacheHit;
                    chat._sessionTotalCacheMissTokens += cacheMiss;
                    // 日志记录缓存命中详情
                    var cacheInfo = cacheHit > 0 ? ' | cache: ✅' + cacheHit + '/miss:' + cacheMiss : ' | cache: ❌miss';
                    Store.addLog('info', chat.id, 'token-usage',
                        'prompt:' + promptTokens + ' | completion:' + completionTokens +
                        cacheInfo + ' | cumul: ' + chat._tokenCount + ' | calls: ' + chat._apiCalls);
                }
                Store.addLog('info', chat.id, 'api-response', '← ' + model.name + ' | ' + elapsed + 'ms' + (msg.tool_calls ? ' | tool_calls=' + msg.tool_calls.length : ''));

                // ===== GLM思考模式截断检测：finish_reason=length 且无 content 且无 tool_calls =====
                // 思考过程耗尽了 max_tokens 预算，导致实际回复为空。自动倍增 max_tokens 重试。
                var _finishReason = choice.finish_reason || '';
                var _isEmptyReply = !(msg.content && msg.content.trim()) && !(msg.tool_calls && msg.tool_calls.length);
                if ((_finishReason === 'length' || res.data._truncated) && _isEmptyReply) {
                    var _truncRetry = chat._truncRetryCount || 0;
                    var _curMax = payload.max_tokens || model.maxTokens || 16384;  // null 时从 16384 起步倍增
                    var _newMax = Math.min(_curMax * 2, 65536);
                    var _reasoningText = msg.reasoning_content || msg.reasoning || msg.thinking || '';
                    Store.addLog('warn', chat.id, 'truncation', 'finish_reason=length, content empty, reasoning_len=' + _reasoningText.length + ', max_tokens=' + _curMax + (msg.reasoning_content ? ' (has reasoning_content)' : ''));

                    if (_truncRetry < 3 && _newMax > _curMax) {
                        chat._truncRetryCount = _truncRetry + 1;
                        chat._maxTokensOverride = _newMax;
                        var _typingElsTrunc = box.querySelectorAll('.msg.typing');
                        _typingElsTrunc.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '⚠ 模型思考耗尽输出额度（finish_reason=length），自动提升 max_tokens ' + _curMax + '→' + _newMax + '，重试第' + chat._truncRetryCount + '/3次…', 'warning');
                        setTimeout(function() {
                            self._agentLoop(box, chat, model, messages, depth + 1);
                        }, 1000);
                        return;
                    } else {
                        var _typingElsTrunc2 = box.querySelectorAll('.msg.typing');
                        _typingElsTrunc2.forEach(function(t) { t.remove(); });
                        // 【星号残留修复】截断兜底回复前同样清掉流式占位 div
                        if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                        chat._realStreamDiv = null;
                        if (_reasoningText) {
                            self.addMsgStreaming(box, '⚠ 模型思考耗尽了输出额度，未能生成最终回复。以下是思考过程：\n\n' + _reasoningText, 'ai', chat.modelId, true, function() {
                                self._onSendComplete(box, chat);
                            });
                            chat.history.push({ role: 'assistant', content: '模型思考耗尽了输出额度，思考过程：\n' + _reasoningText });
                        } else {
                            self.addMsg(box, '⚠ 模型输出被截断（finish_reason=length），思考过程耗尽了全部输出额度，未生成最终回复。建议降低思考强度或增大 max_tokens。', 'error');
                        }
                        chat._truncRetryCount = 0;
                        delete chat._maxTokensOverride;
                        self._onSendComplete(box, chat);
                        return;
                    }
                }

                // 情况1：AI 调用了工具
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    // ===== 循环任务早期预警：签名重复检测（先警告，再升级交小狗守卫）=====
                    try { self._detectAgentLoop(box, chat, msg.tool_calls, depth); } catch(e) {}
                    // 检测输出被截断（tool_calls 的 JSON 参数可能不完整）
                    if (choice.finish_reason === 'length' || res.data._truncated) {
                        var _typingElsTrunc = box.querySelectorAll('.msg.typing');
                        _typingElsTrunc.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '⚠ AI 输出因达到模型最大 token 上限被截断（finish_reason=length），工具调用参数可能不完整。请简化任务后重试。', 'warning');
                        Store.addLog('warn', chat.id, 'truncated', 'AI 输出因 finish_reason=length 被截断（tool_calls 阶段）');
                    }
                    // ===== 终止轮正文去重（代码级兜底）：本轮含 task_complete 时，正文会与 message 重复显示，直接跳过 =====
                    var _roundHasTerminal = false;
                    for (var _rti = 0; _rti < msg.tool_calls.length; _rti++) {
                        if (msg.tool_calls[_rti].function && Tools.isTerminal(msg.tool_calls[_rti].function.name)) { _roundHasTerminal = true; break; }
                    }
                    // 如果有文本内容，先显示并记录（终止轮跳过，避免与 task_complete 的 message 重复）
                    if (msg.content && !_roundHasTerminal) {
                        // 清洗正文残留的伪工具调用标签（<...task_complete...> 等）
                        msg.content = self._stripFakeToolTags(msg.content);
                        if (msg.content) {
                        // 显示AI文本前移除 typing
                        var _typingEls2 = box.querySelectorAll('.msg.typing');
                        _typingEls2.forEach(function(t) { t.remove(); });
                        // 【星号残留修复】工具轮附带的思考/说明文本也要先清掉流式占位 div
                        if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                        chat._realStreamDiv = null;
                        self.addMsgStreaming(box, msg.content, 'ai', chat.modelId);
                        // 【本地保留全部】思考文字存入 history，但标记 _thinking，_buildContext 发给模型时会过滤掉
                        chat.history.push({ role: 'assistant', content: msg.content, _thinking: true });
                        }
                    }

                    // 将 assistant 的 tool_calls 消息加入 messages
                    // 注意：content 兜底为空字符串而非 null（litellm 等严格校验的中转不接受 null，会返回 400 messages 参数非法）
                    var assistantMsg = {
                        role: 'assistant',
                        content: msg.content || '',
                        tool_calls: msg.tool_calls.map(function(tc) {
                            return { id: tc.id, type: 'function', function: tc.function };
                        })
                    };
                    messages.push(assistantMsg);

                    // 设置当前对话 ID，供工具（如 task_list）关联使用
                    Tools.currentChatId = chat.id;

                    // 逐个执行工具（支持异步工具）
                    var lastResult = null;  // 记录最后一个工具的结果（终止判断用）
                    var lastToolName = '';
                    for (var ti = 0; ti < msg.tool_calls.length; ti++) {
                        var tc = msg.tool_calls[ti];
                        var toolName = tc.function.name;
                        if (window.KiteDragon) window.KiteDragon.tool(chat, toolName);
                        var toolArgs;
                        var toolArgsError = null;
                        var rawArgs = tc.function.arguments;
                        // 部分中转层会提前把 arguments 解成对象；不要对对象调用 JSON.parse。
                        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
                            toolArgs = rawArgs;
                            tc.function.arguments = JSON.stringify(toolArgs);
                        } else {
                            rawArgs = String(rawArgs || '{}');
                            try {
                                toolArgs = JSON.parse(rawArgs);
                            } catch (e) {
                                // 兼容模型生成的未转义路径、实际换行/制表符等非法 JSON 字符。
                                var fixed = '';
                                var inString = false;
                                var escaped = false;
                                for (var ai = 0; ai < rawArgs.length; ai++) {
                                    var ch = rawArgs[ai];
                                    if (escaped) {
                                        fixed += ch;
                                        escaped = false;
                                    } else if (ch === '\\') {
                                        var next = rawArgs[ai + 1] || '';
                                        if (inString && !/["\\\\\/bfnrtu]/.test(next)) fixed += '\\\\';
                                        else { fixed += ch; escaped = true; }
                                    } else if (ch === '"') {
                                        fixed += ch;
                                        inString = !inString;
                                    } else if (inString && ch === '\n') fixed += '\\n';
                                    else if (inString && ch === '\r') fixed += '\\r';
                                    else if (inString && ch === '\t') fixed += '\\t';
                                    else fixed += ch;
                                }
                                try { toolArgs = JSON.parse(fixed); }
                                catch (e2) {
                                    // ===== 【新增】通用截断 JSON 修复 =====
                                    // 部分中转层/模型会在超长参数中插入 <arg_value 之类占位符导致 JSON 被截断。
                                    // 修复：逐字符扫描，补齐未闭合的字符串引号与括号后再解析。
                                    if (!toolArgsError || toolArgsError === e.message) {
                                        try {
                                            var _rp = rawArgs.replace(/<arg_value[^>]*>?/gi, '');
                                            var _stack = [], _inStr = false, _esc = false;
                                            for (var _ri = 0; _ri < _rp.length; _ri++) {
                                                var _rc = _rp[_ri];
                                                if (_esc) { _esc = false; continue; }
                                                if (_rc === '\\') { _esc = true; continue; }
                                                if (_rc === '"') { _inStr = !_inStr; continue; }
                                                if (_inStr) continue;
                                                if (_rc === '{' || _rc === '[') _stack.push(_rc);
                                                else if (_rc === '}' || _rc === ']') _stack.pop();
                                            }
                                            var _repaired = _rp;
                                            if (_esc) _repaired = _repaired.slice(0, -1); // 结尾悬空反斜杠
                                            if (_inStr) _repaired += '"';                // 补齐未闭合字符串
                                            // 尾部收尾循环：去掉孤立逗号 / 孤立键名 / 补缺失值
                                            while (true) {
                                                var _t = _repaired.replace(/\s+$/, '');
                                                if (/,\s*$/.test(_t)) { _repaired = _t.replace(/,\s*$/, ''); continue; }
                                                var _m = _t.match(/,\s*"(?:[^"\\]|\\.)*"$/);
                                                if (_m) { _repaired = _t.slice(0, _t.length - _m[0].length); continue; }
                                                if (/:\s*$/.test(_t)) { _repaired = _t + ' null'; continue; }
                                                break;
                                            }
                                            while (_stack.length) _repaired += (_stack.pop() === '{' ? '}' : ']');
                                            toolArgs = JSON.parse(_repaired);
                                            toolArgsError = null;
                                            console.warn('[agent] tool arguments JSON 被截断/含占位符，已修复补齐解析。工具:', toolName);
                                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → 参数截断已自动修复补齐');
                                        } catch (eRepair) { /* 继续走下方定向兜底 */ }
                                    }
                                    // ===== 【2026 新增】write_file 超长内容截断定向兜底 =====
                                    // 模型写超长文件（如双语帮助文档）时，content 常被单次输出上限截断，
                                    // JSON 字符串未闭合导致解析失败。兜底：按原始文本直接提取 path 与
                                    // content（未闭合也照收），把已生成的部分写入，不再直接报错丢弃。
                                    if (toolName === 'write_file' || toolName === 'write') {
                                        var _pMatch = rawArgs.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                                        var _cIdx = rawArgs.search(/"content"\s*:\s*"/);
                                        if (_pMatch && _cIdx !== -1) {
                                            var _cColon = rawArgs.indexOf(':', _cIdx);
                                            var _cStart = rawArgs.indexOf('"', _cColon) + 1;
                                            var _content = rawArgs.slice(_cStart)
                                                .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                                .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
                                            toolArgs = {
                                                path: _pMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
                                                content: _content
                                            };
                                            toolArgsError = null;
                                            console.warn('[agent] write_file 参数 JSON 被截断，已按原始文本兜底提取（内容可能不完整，建议分段写入）。path:', toolArgs.path);
                                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'write_file 参数截断，已兜底写入 ' + toolArgs.path);
                                        }
                                    }
                                    // run_code 的 code 字段仍保留一个定向兜底，避免多行代码被截断。
                                    var codeMatch = rawArgs.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                                    if (codeMatch) {
                                        toolArgs = { code: codeMatch[1]
                                            .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                            .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t') };
                                    }
                                    // ===== 【新增】run_code 的 codes（批量命令数组）定向兜底 =====
                                    // 模型生成的 codes 数组里含未转义引号/换行时 JSON.parse 失败，
                                    // 上面的 code 兜底抓不到数组，这里单独提取每条命令字符串。
                                    if (!codeMatch && /"codes"\s*:\s*\[/.test(rawArgs)) {
                                        try {
                                            var _unesc = function (s) {
                                                return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                                    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
                                            };
                                            var codesArr = [];
                                            var codesRe = /"(?:[^"\\\n]|\\[\s\S])*"/g; // 逐个提取字符串字面量（允许 \" 跨任意字符转义）
                                            var cm;
                                            var _inArr = false;
                                            // 找到 codes 数组区段：从 "codes": [ 起到对应 ] 或字符串末尾
                                            var _cs = rawArgs.search(/"codes"\s*:\s*\[/);
                                            if (_cs !== -1) {
                                                var _body = rawArgs.slice(_cs).replace(/^.*?"codes"\s*:\s*\[/, '');
                                                // 截到配对的 ]：必须跳过字符串字面量并按括号深度配对，
                                                // 否则命令内部的 [IO.File] 之类会被误认为数组结尾导致截断丢命令。
                                                var _depth = 0; var _end = -1; var _q = false; var _esc2 = false;
                                                for (var _i = 0; _i < _body.length; _i++) {
                                                    var _ch = _body.charAt(_i);
                                                    if (_esc2) { _esc2 = false; continue; }
                                                    if (_ch === '\\') { if (_q) _esc2 = true; continue; }
                                                    if (_ch === '"') { _q = !_q; continue; }
                                                    if (_q) continue;
                                                    if (_ch === '[' || _ch === '{') _depth++;
                                                    else if (_ch === ']' || _ch === '}') {
                                                        _depth--;
                                                        // 未转义引号会让 _q 状态错乱，导致中途误判数组结束（命令被截断）。
                                                        // 兜底：只有当剩余部分不再有 ", " 元素边界时才认作数组结尾。
                                                        if (_depth === 0) {
                                                            var _rest = _body.slice(_i + 1);
                                                            if (/_q_/.test(_rest) || !/",\s*"/.test(_rest)) { _end = _i; break; }
                                                        }
                                                    }
                                                }
                                                if (_end === -1) _end = _body.length; // 未闭合则取到末尾
                                                _body = _body.slice(0, _end);
                                                // 先按数组元素边界 ", " 切分（命令内部的引号不会截断命令本身）
                                                var _parts = _body.split(/",\s*"/);
                                                if (_parts.length > 1) {
                                                    _parts[0] = _parts[0].replace(/^\s*"/, '');
                                                    _parts[_parts.length - 1] = _parts[_parts.length - 1].replace(/"\s*,?\s*$/, '');
                                                    for (var _p = 0; _p < _parts.length; _p++) {
                                                        var _pc = _parts[_p].replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
                                                        if (_pc) codesArr.push(_unesc(_pc));
                                                    }
                                                } else {
                                                    // 单元素或无边界：退回字符串字面量提取
                                                    while ((cm = codesRe.exec(_body)) !== null) {
                                                        codesArr.push(_unesc(cm[0].slice(1, -1)));
                                                    }
                                                    if (!codesArr.length) {
                                                        var _one = _body.replace(/^\s*"|"\s*$/g, '').trim();
                                                        if (_one) codesArr.push(_unesc(_one));
                                                    }
                                                }
                                                if (codesArr.length) {
                                                    toolArgs = { codes: codesArr };
                                                    toolArgsError = null;
                                                    console.warn('[agent] tool arguments JSON 解析失败，已从 codes 数组定向提取', codesArr.length, '条命令。工具:', toolName);
                                                    if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → codes 参数已定向提取修复');
                                                }
                                            }
                                        } catch (eCodes) { /* 走下方通用失败分支 */ }
                                    }
                                    if (!codeMatch && !(toolArgs && toolArgs.codes)) {
                                        toolArgs = {};
                                        toolArgsError = e.message || '工具参数 JSON 解析失败';
                                        console.warn('[agent] invalid tool arguments', toolName, rawArgs, e);
                                        if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → ' + toolArgsError);
                                    }
                                    // ===== 【2026 修复】终止型工具(task_complete)定向兜底 =====
                                    // 问题：模型调用 task_complete 时 message 很长/含未转义字符，JSON 解析失败后
                                    // 会走 toolArgsError 分支 → 终止判断成立 → 显示"❌ 任务失败: Invalid tool arguments"，
                                    // 但任务实际已经完成，属于误报失败。
                                    // 修复：先清洗非法控制字符再解析；仍失败则降级为成功+原始文本作为 message。
                                    if (toolArgsError && /task[_\s]?complete/i.test(toolName || '')) {
                                        try {
                                            var _sanitized = String(rawArgs || '{}').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
                                            toolArgs = JSON.parse(_sanitized);
                                            toolArgsError = null;
                                        } catch (e4) {
                                            // 最后一道：尝试宽松提取 message 字段内容
                                            var _msg = '';
                                            var _mm = String(rawArgs).match(/"message"\s*:\s*"([\s\S]*)/);
                                            if (_mm) {
                                                _msg = _mm[1]
                                                    .replace(/",\s*"(?:scope|success|reason|summary)[\s\S]*$/i, '')
                                                    .replace(/",\s*\{[\s\S]*$/, '')
                                                    .replace(/"\s*\}?\s*$/, '');
                                            }
                                            if (!_msg) _msg = String(rawArgs).replace(/^[{\s]*/, '').replace(/[\s}]*$/, '');
                                            try { _msg = _msg.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); } catch (e5) {}
                                            if (!_msg.trim()) _msg = '任务完成';
                                            // success 字段尽量识别，识别不到默认按成功处理（终止型工具+有 message 即视为正常收尾）
                                            var _succM = String(rawArgs).match(/"success"\s*:\s*(false)/i);
                                            toolArgs = { success: !_succM, message: _msg };
                                            toolArgsError = null;
                                            console.warn('[agent] task_complete 参数解析失败，已降级为成功收尾。原文:', rawArgs);
                                            if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'task_complete → 参数解析失败，已降级为成功收尾兜底');
                                        }
                                    }
                                    // ===== 【新增】task_list 定向兜底 =====
                                    // 模型有时会生成非法 JSON：tasks 数组元素不加引号（中文裸词）、
                                    // 或把 "title" 键混进数组。宽松提取 action/title/tasks。
                                    if (toolArgsError && /^task[_\s]?list$/i.test(toolName || '')) {
                                        try {
                                            var _tl = String(rawArgs || '');
                                            var _action = (_tl.match(/"action"\s*:\s*"([a-z]+)"/i) || [])[1] || 'create';
                                            var _tlObj = { action: _action };
                                            var _tlTitle = (_tl.match(/"title"\s*:\s*"([^"]*)"/) || [])[1];
                                            if (_tlTitle) _tlObj.title = _tlTitle;
                                            // 提取 tasks 数组区段
                                            var _ts = _tl.search(/"tasks"\s*:\s*\[/);
                                            if (_ts !== -1) {
                                                var _tBody = _tl.slice(_ts).replace(/^.*?"tasks"\s*:\s*\[/, '');
                                                _tBody = _tBody.replace(/\]\s*\}?[\s\S]*$/, ''); // 截掉数组之后的残余
                                                var _tasks = [];
                                                // 情况A：数组里是对象 {title, ...}
                                                var _objRe = /\{[^{}]*\}/g;
                                                var _om;
                                                while ((_om = _objRe.exec(_tBody)) !== null) {
                                                    var _t = (_om[0].match(/"title"\s*:\s*"([^"]*)"/) || [])[1];
                                                    if (_t) _tasks.push({ title: _t });
                                                }
                                                // 情况B：数组里是裸词字符串（未加引号），按逗号/引号字符串混合切分
                                                if (!_tasks.length) {
                                                    _tBody.split(/,\s*/).forEach(function (_seg) {
                                                        var _q = _seg.match(/"([^"]*)"/);
                                                        var _name = _q ? _q[1] : _seg.replace(/^[\s"'\[{]+|[\s"'\]}]+$/g, '');
                                                        _name = _name.replace(/^["']+|["']+$/g, '').trim();
                                                        // 剔除混进数组的键值对残余
                                                        if (_name && !/^"?\w+"?\s*:/.test(_name) && !/^(title|action|tasks)$/i.test(_name)) {
                                                            _tasks.push(_name);
                                                        }
                                                    });
                                                }
                                                if (_tasks.length) _tlObj.tasks = _tasks;
                                            }
                                            if (_tlObj.tasks || _tlTitle || _action !== 'create') {
                                                toolArgs = _tlObj;
                                                toolArgsError = null;
                                                console.warn('[agent] task_list 参数解析失败，已用宽松提取兜底。原文:', rawArgs);
                                                if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', 'task_list → 参数解析失败，已宽松提取兜底');
                                            }
                                        } catch (e5) {}
                                    }
                                }
                            }
                            if (toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)) {
                                tc.function.arguments = JSON.stringify(toolArgs);
                            }
                        }
                        if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
                            toolArgs = {};
                            toolArgsError = '工具参数必须是 JSON 对象';
                        }

                        // 参数无效时不要继续执行工具，避免空参数产生破坏性副作用。
                        if (toolArgsError) {
                            result = { ok: false, error: 'Invalid tool arguments: ' + toolArgsError };
                            lastResult = result;
                            lastToolName = toolName;
                            Store.addMessage(chat.id, 'tool_call', toolName + ': invalid arguments', 'tool');
                            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
                            continue;
                        }


                        // 执行工具（可能是异步 Promise）
                        if (toolName === 'ask_user') {
                            // 询问用户：渲染提问卡片并阻塞等待用户回答，回答作为工具结果回传给 AI
                            var askResult = await self.askUser(toolArgs, box, chat);
                            result = askResult;
                            lastResult = askResult;
                            lastToolName = toolName;
                            // 持久化工具调用日志
                            Store.addMessage(chat.id, 'tool_call', toolName + ': ' + JSON.stringify(toolArgs), 'tool');
                            // 将工具结果（用户回答）加入 messages 回传给 AI
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify(askResult)
                            });
                            // 用户取消询问 → 停止 Agent 循环
                            if (askResult && askResult.cancelled) {
                                Store.addLog('warn', chat.id, 'tool-exec', toolName + ' → 用户取消，对话停止');
                                self.addMsg(box, '⚠ 用户取消了询问，对话已停止。', 'ai', chat.modelId);
                                chat.history.push({ role: 'assistant', content: '用户取消了询问，对话已停止。' });
                                self._onSendComplete(box, chat);
                                return;
                            }
                            Store.addLog('info', chat.id, 'tool-exec', toolName + ' → success (用户已回答)');
                            continue;
                        }
                        var result = Tools.execute(toolName, toolArgs, { chatId: chat.id });
                        if (result && typeof result.then === 'function') {
                            result = await result;
                        }
                        // 工具返回归一化
                        if (!result || typeof result !== 'object' || Array.isArray(result)) {
                            result = { success: false, message: '工具执行未返回有效结果', tool: toolName };
                        }
                        lastResult = result;
                        lastToolName = toolName;

                        // ===== 工作日志：任务完成时自动记录到 private/用户设置/worklog.json =====
                        if (toolName === 'task_complete' && result && (result.message || result.success)) {
                            try {
                                var _wlSummary = String(result.message || (result.success ? '任务完成' : '任务失败')).replace(/\s+/g, ' ').trim();
                                if (_wlSummary.length > 600) _wlSummary = _wlSummary.slice(0, 600) + '…';
                                fetch('/api/worklog', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        summary: _wlSummary,
                                        chatId: String(chat.id || ''),
                                        success: !!result.success
                                    })
                                }).catch(function() {});
                            } catch (e) {}
                        }

                        // ===== 朗读助手：任务完成后朗读结果前30字 =====
                        if (toolName === 'task_complete' && window.TTS && TTS.isEnabled()) {
                            try {
                                var _ttsText = String(result.message || (result.success !== false ? '任务完成' : '任务失败'));
                                TTS.speak(_ttsText);
                            } catch (e) {}
                        }

                        // ===== 工具结果数据提取（用于画布建节点等）=====
                        var _toolData = (result && (result.data || result.url || result.video_url)) || null;

                        // ===== image_gen / video_gen：画布建节点（可拖拽/缩放/连线）=====
                        if (toolName === 'image_gen' && _toolData) {
                            var _imgUrl = _toolData.url || result.url;
                            var _imgPrompt = toolArgs.prompt || toolArgs.text || '生图结果';
                            if (_imgUrl && typeof App !== 'undefined' && App.createImageCanvasNode) {
                                try { App.createImageCanvasNode(box, _imgUrl, _imgPrompt); } catch (e) { console.error('[imagenode]', e); }
                            }
                        } else if (toolName === 'video_gen' && _toolData) {
                            var _vidUrl = _toolData.video_url || _toolData.url || result.url;
                            var _vidPrompt = toolArgs.prompt || toolArgs.text || '视频结果';
                            if (_vidUrl && typeof App !== 'undefined' && App.createVideoCanvasNode) {
                                try { App.createVideoCanvasNode(box, _vidUrl, _vidPrompt); } catch (e) { console.error('[videonode]', e); }
                            }
                        }

                        // 显示工具卡片（终止型工具跳过，由 showTaskNotify 展示结果，避免重复）
                        if (!Tools.isTerminal(toolName)) {
                            self.addToolCard(box, Tools.renderToolCard(toolName, toolArgs, result));
                        // 任务清单工具执行后，自动刷新右侧任务面板
                        if (toolName === 'task_list' && self.refreshTaskPanel) {
                            self.refreshTaskPanel();
                        }
                        }

                        // ===== 分类切换：更新对话框 UI =====
                        if (toolName === 'switch_tool_category' && result.success && result.category) {
                            var newCat = Tools.categories[result.category];
                            if (newCat) {
                                var catIconEl = box.querySelector('.tool-cat-icon');
                                var catNameEl = box.querySelector('.tool-cat-name');
                                if (catIconEl) catIconEl.textContent = newCat.icon;
                                if (catNameEl) catNameEl.textContent = result.category;
                                // Update menu active state
                                var catMenu = box.querySelector('.tool-cat-menu');
                                if (catMenu) {
                                    catMenu.querySelectorAll('.tool-cat-item').forEach(function(i) {
                                        i.classList.toggle('active', i.dataset.cat === result.category);
                                    });
                                }
                                Store.addLog('info', chat.id, 'cat-switch-ai', 'AI 自动切换工具分类: ' + result.category);

                                // ===== 分类切换提示框 + 声音 =====
                                var swToolList = newCat.tools.filter(function(t) { return t !== 'task_complete' && t !== 'switch_tool_category'; });
                                self.showCategorySwitchNotify({
                                    catName: result.category,
                                    catIcon: newCat.icon,
                                    catDesc: newCat.desc,
                                    toolCount: swToolList.length,
                                    chatId: chat.id
                                });
                                self.playSwitchSound();
                            }
                        }

                        // 持久化工具调用日志
                        Store.addMessage(chat.id, 'tool_call', toolName + ': ' + JSON.stringify(toolArgs), 'tool');
                        Store.addLog('info', chat.id, 'tool-exec', toolName + ' → ' + (result.success ? 'success' : 'failure'));

                        // ===== 工具结果出口限额（源头拦截：进上下文前截断超长结果，原文归档可找回） =====
                        if (typeof Tools !== 'undefined' && Tools.capResult) {
                            try { result = Tools.capResult(toolName, result); } catch (e) {}
                        }

                        // 将工具结果加入 messages（终止型工具的也会 push，但 return 后不会发给 AI）
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify(result)
                        });
                        // ===== 三档压缩：记录本轮任务的工具结果（截断为6000字，供下一轮压缩模式注入） =====
                        try {
                            if (!chat._curTaskToolResults) chat._curTaskToolResults = [];
                            chat._curTaskToolResults.push({ tool: toolName, content: String(JSON.stringify(result)).slice(0, 6000) });
                        } catch (e) {}
                    }

                    // ===== 刷新系统提示词（仅在分类切换时）=====
                    // 只有 AI 调用了 switch_tool_category 时才需要更新 system prompt
                    // 避免每轮都重建 messages[0]，保持前缀稳定以提高 API 缓存命中率
                    var _categoryChanged = false;
                    for (var _ci = 0; _ci < msg.tool_calls.length; _ci++) {
                        if (msg.tool_calls[_ci].function && msg.tool_calls[_ci].function.name === 'switch_tool_category') {
                            _categoryChanged = true;
                            break;
                        }
                    }
                    if (_categoryChanged) {
                        messages[0] = { role: 'system', content: Tools.getSystemPrompt(chat.id) };
                    }

                    // 如果是终止型工具，结束循环（复用已执行的结果，不重复执行）
                    if (Tools.isTerminal(lastToolName) && lastResult) {
                        // ===== 前缀去重（代码级兜底）：模型 message 自带“✅ 任务完成/❌ 任务失败”时先剥离，避免与 summaryPrefix 叠加显示两次 =====
                        var _rawMsg = self._stripFakeToolTags(String(lastResult.message || ''));
                        var _msgLines = _rawMsg.split('\n');
                        var _firstLine = (_msgLines[0] || '').trim();
                        var _prefixStripped = false;
                        // 情况A：整行恰好是“✅ 任务完成/❌ 任务失败”等（可带括号备注/收尾标点）→ 剥掉整行
                        if (/^[\s#*]*(?:✅|❌)?[\s#*]*(?:任务完成|任务成功|任务失败)(?:[（(][^（）()]{0,20}[）)])?[\s#*]*(?:✅|❌)?[\s#:：。！!？?]*$/.test(_firstLine)) {
                            _msgLines.shift();
                            _prefixStripped = true;
                        } else {
                            // 情况B：首行形如“✅ 任务完成：实际内容”（前缀+分隔符+内容同一行）→ 只剥前缀，保留内容
                            var _pmB = _firstLine.match(/^[\s#*]*(?:✅|❌)[\s#*]*(?:任务完成|任务成功|任务失败)(?:[（(][^（）()]{0,20}[）)])?[\s#*]*(?:✅|❌)?[\s:：\-—–|｜、]*\s*(.+)$/);
                            // 情况C：无 emoji 但以“任务完成：”等开头（要求冒号分隔，避免误伤“任务完成的文件”等正常句子）
                            var _pmC = (!_pmB) ? _firstLine.match(/^(?:任务完成|任务成功|任务失败)(?:[（(][^（）()]{0,20}[）)])?\s*[:：]\s*(.+)$/) : null;
                            var _pm = _pmB || _pmC;
                            if (_pm) {
                                var _rest = (_pm[1] || '').trim();
                                if (_rest) {
                                    _msgLines[0] = _rest;
                                } else {
                                    _msgLines.shift();
                                }
                                _prefixStripped = true;
                            }
                        }
                        if (_prefixStripped) {
                            while (_msgLines.length && !(_msgLines[0] || '').trim()) _msgLines.shift();
                            lastResult.message = _msgLines.join('\n');
                        }
                        // 移除残留的 typing 指示器（防止计时器继续运行）
                        var _typingElsTerm = box.querySelectorAll('.msg.typing');
                        _typingElsTerm.forEach(function(t) { t.remove(); });
                        // 计算任务总耗时
                        var _taskTotalMs = chat._taskStartTime ? (Date.now() - chat._taskStartTime) : 0;
                        var _taskTotalStr = self._formatDuration(_taskTotalMs);
                        Store.addLog(lastResult.success ? 'info' : 'warn', chat.id, 'terminal', lastToolName + ' → ' + (lastResult.success ? '任务完成' : '任务失败') + ': ' + lastResult.message + ' | 总耗时: ' + _taskTotalStr);
                        // 对话完成率：每个终止任务只写一条成功/失败记录。
                        if (typeof DB !== 'undefined' && typeof DB.saveStats === 'function') {
                            DB.saveStats(chat.id, {
                                success: lastResult.success,
                                task_title: String(lastResult.message || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                                tokens: chat._sessionTotalTokens || 0,
                                api_calls: chat._sessionTotalApiCalls || 0,
                                duration: _taskTotalMs / 1000
                            });
                        }

                        // 1) 对话框边框变色，并保存结果供小地图持续导航。
                        // ===== 结果验证轮：验证轮的成功显示为「二次验证成功」，颜色用金色区分普通绿色 =====
                        // _continueRound：继续轮复用 _verifyActive 机制但不属于验证，不算二次验证成功
                        var _lastUserMsg = (function(){ for (var i = chat.history.length - 1; i >= 0; i--) { if (chat.history[i] && chat.history[i].role === 'user') return chat.history[i]; } return null; })();
                        // 【2026 修复】增加 chat._roundWasVerify 快照判定：验证轮进行中用户插入新消息/守卫注入
                        // 导致 _verifyActive 被提前清除时，任务完成仍按验证轮显示金色，不再漏判成普通绿色
                        var _isVerifySuccess = !!(lastResult.success && (chat._roundWasVerify || chat._verifyRoundActive || (chat._verifyActive && (chat._verifyRoundActive || (_lastUserMsg && _lastUserMsg._verifyRound && !_lastUserMsg._continueRound)))));
                        var borderCls = lastResult.success ? (_isVerifySuccess ? 'task-verify-success' : 'task-success') : 'task-fail';
                        chat._taskStatus = lastResult.success ? 'success' : 'fail';
                        box.classList.add(borderCls);
                        // 同步：右下角小地图导航也显示边框动画
                        var _minimap = document.getElementById('minimap');
                        if (_minimap) {
                            _minimap.classList.remove('task-success', 'task-fail');
                            _minimap.classList.add(borderCls);
                        }
                        // 边框动画结束后恢复；chat._taskStatus 保留给小地图导航。
                        setTimeout(function() {
                            box.classList.remove(borderCls);
                            if (_minimap) { _minimap.classList.remove(borderCls); }
                            if (self.updateMinimap) self.updateMinimap();
                        }, 4000);
                        if (self.updateMinimap) self.updateMinimap();
                        if (self._updateAllNavArrows) self._updateAllNavArrows(); // 立即刷新成功指示箭头
                        // 立即同步：风筝龙该节颜色（金黄=成功 / 暗红=失败）——不依赖 RAF 下一帧
                        if (window.KiteDragon && window.KiteDragon.refresh) { try { window.KiteDragon.refresh(); } catch (e) {} }

                        // 2) 右下角通知弹窗
                        self.showTaskNotify({
                            success: lastResult.success,
                            message: lastResult.message,
                            chatId: chat.id,
                            modelName: model.name,
                            scope: lastResult.scope
                        });

                        // 3) 声音提示
                        // 4) 结束总结：持久化保存并进 history，同时在对话框中显示（此前只弹 toast，对话框看不到）
                        // ===== 结果验证轮：显示「✅ 二次验证成功」并带醒目标记，区别于普通「✅ 任务完成」 =====
                        var summaryPrefix = _isVerifySuccess
                            ? "\u2705\u2705 \u4e8c\u6b21\u9a8c\u8bc1\u6210\u529f \uff5c \u672c\u4efb\u52a1\u5df2\u901a\u8fc7\u9a8c\u8bc1\u5ba1\u67e5\n\n"
                            : (lastResult.success ? "\u2705 任务完成\n\n" : "\u274C 任务失败\n\n");
                        chat.history.push({ role: "assistant", content: summaryPrefix + lastResult.message });
                        try {
                            if (box.id) {
                                Store.addMessage(box.id, 'assistant', summaryPrefix + lastResult.message, 'final', chat.modelId, (Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) || null);
                            }
                        } catch (e) { console.warn('[Agent] task summary persistence failed:', e); }
                        self.addMsg(box, summaryPrefix + lastResult.message, 'ai', chat.modelId, true, true); // 已手动持久化，skipSave 防重复写库
                        // ===== 结果验证轮：给最终消息气泡加金色「已验证」标记条 =====
                        if (_isVerifySuccess) {
                            var _verifyMsgEl = box.querySelector('.chatbox-body .msg.ai-final:last-child');
                            if (_verifyMsgEl) {
                                _verifyMsgEl.classList.add('ai-verified');
                                var _vBadge = document.createElement('div');
                                _vBadge.className = 'verify-badge';
                                _vBadge.innerHTML = '\u2713 \u5df2\u4e8c\u6b21\u9a8c\u8bc1';
                                _verifyMsgEl.insertBefore(_vBadge, _verifyMsgEl.firstChild);
                            }
                        }
                        // ===== 验证成功后：「结果验证」行的「2 验证」按钮变为金色「✓ 已验证」并禁用（renderCompressSelector 之后还需再执行一次，因其会重建该行） =====
                        if (_isVerifySuccess) { self._markVerifyButton(box); try { chat._verifiedOnce = true; } catch(e){} }
                        self.playTaskSound(lastResult.success);

                        // 5) 在最底部显示任务总耗时
                        var _timeDiv = document.createElement('div');
                        _timeDiv.className = 'msg task-duration';
                        _timeDiv.innerHTML = '<span class="task-duration-icon">\u23F1</span> 本任务总耗时 <span class="task-duration-value">' + _taskTotalStr + '</span>';
                        var _tBody = box.querySelector('.chatbox-body');
                        if (_tBody) {
                            _tBody.appendChild(_timeDiv);
                            var _tc = self.chatBoxes.find(function(c) { return c.el === box; });
                            if (_tc && _tc.autoFollowBottom) _tBody.scrollTop = _tBody.scrollHeight;
                        }

                        // ===== 三档压缩：任务完成后显示下一轮压缩档位选择器 =====
                        self.renderCompressSelector(box, chat);
                        // 验证成功：renderCompressSelector 会重建「结果验证」行，重建后再标一次「✓ 已验证」
                        if (_isVerifySuccess) self._markVerifyButton(box);


                        
                        // ===== 自动邮件通知（任务成功时） =====
                        if (lastResult.success) {
                            self._sendEmailNotify(lastResult.message, model.name, chat.id);
                        }

                        // 清空工具结果存档（任务结束，不再需要）
                        if (typeof Tools !== 'undefined' && Tools.toolResultArchive) {
                            delete Tools.toolResultArchive[chat.id];
                        }

                        self._onSendComplete(box, chat);
                        return;
                    }

                    // 递归调用，继续 Agent 循环（如果用户已停止则不递归）
                    if (!chat._stopped) {
                        self._agentLoop(box, chat, model, messages, depth + 1);
                    } else {
                        self._onSendComplete(box, chat);
                    }
                    return;
                }

                // 情况2：AI 返回普通文本
                // 成功获得回复，重置截断重试状态
                chat._truncRetryCount = 0;
                delete chat._maxTokensOverride;
                var reply = '';
                if (msg.content) {
                    reply = msg.content;
                } else if (choice.text) {
                    reply = choice.text;
                } else if (res.data.output_text) {
                    reply = res.data.output_text;
                } else if (msg.reasoning_content || msg.reasoning || msg.thinking) {
                    // content 为空但有思考内容（GLM 思考模式边缘情况）
                    reply = (msg.reasoning_content || msg.reasoning || msg.thinking);
                } else {
                    reply = '（空回复）';
                }
                reply = (reply || '').trim() || '（空回复）';
                // 检测输出被截断（max_tokens 不足导致 finish_reason=length，但仍有部分 content）
                if (choice.finish_reason === 'length' || res.data._truncated) {
                    reply += '\n\n⚠ **[输出被截断]** AI 回复因达到最大输出 token 上限被截断，可能内容不完整。如需完整回复请发送"继续"。';
                    Store.addLog('warn', chat.id, 'truncated', 'AI 输出因 finish_reason=length 被截断（有部分 content），max_tokens=' + (payload.max_tokens || model.maxTokens || 8192));
                }
                // 显示回复前移除 typing 指示器
                var _typingEls = box.querySelectorAll('.msg.typing');
                _typingEls.forEach(function(t) { t.remove(); });
                // 【星号残留修复】真实流式阶段用 textContent 显示原始 markdown（**未渲染），
                // 最终回复渲染前必须移除流式占位 div，否则带星号的原文永久留在页面上。
                if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                chat._realStreamDiv = null;
                self.addMsgStreaming(box, reply, 'ai', chat.modelId, true, function() {
                    self._onSendComplete(box, chat);
                });
                // ===== 三档压缩：纯文本回复结束同样显示档位选择器（保证每轮都出现） =====
                try { self.renderCompressSelector(box, chat); } catch (e) {}
                chat.history.push({ role: 'assistant', content: reply });
                Store.addLog('info', chat.id, 'ai-reply', 'AI回复 | ' + reply.length + '字 | ' + reply.substring(0, 80) + (reply.length > 80 ? '…' : ''));

            }).catch(function(err) {
                // 统一清洗底层网络/SSL 错误，避免把英文运行时异常直接展示给用户
                var _catchErrorMsg = _translateApiError(0, (err && err.message) || err);
                // 【星号残留修复】错误路径也要清掉流式占位 div，否则带星号的原文会残留在页面上
                if (chat._realStreamDiv && chat._realStreamDiv.parentNode) { chat._realStreamDiv.remove(); }
                chat._realStreamDiv = null;
                // 移除所有 typing 指示器
                var _typingEls3 = box.querySelectorAll('.msg.typing');
                _typingEls3.forEach(function(t) { t.remove(); });
                // 【2025 修复】只有 chat._stopped=true 才视为用户主动停止。
                // 仅凭 AbortError 判定会把内部超时/db.js 旧版 300 秒 abort 误判为用户停止，
                // 导致对话静默终止（无提示、无重试、无日志）——正是「对话自动停止」的根因之一。
                var _isUserAbort = !!chat._stopped;
                if (_isUserAbort) {
                    // 用户停止 - stopSending() 已显示消息并处理排队
                    // 如果 _onSendComplete 尚未被调用（防止遗漏），调用一次
                    if (!chat._sendCompleteCalled) {
                        self._onSendComplete(box, chat);
                    }
                } else if (err && err.name === 'AbortError' && !chat._stopped) {
                    // 非用户触发的 AbortError（内部超时等）：明确提示并走重试
                    try { err.message = '请求被中断（疑似超时），将自动重试'; } catch(e) {}
                    Store.addLog('error', chat.id, 'abort-unexpected', 'AbortError without user stop | depth=' + depth + ' | ' + _catchErrorMsg);
                    self.addMsg(box, '⚠ ' + _catchErrorMsg + '，将自动重试…', 'warning');
                    if (retryCount >= MAX_RETRY) {
                        self.addMsg(box, '❌ 已重试 ' + MAX_RETRY + ' 次仍失败，请检查网络连接或 API 服务后手动重试。\n\n最后错误：' + _catchErrorMsg, 'error');
                        self._onSendComplete(box, chat);
                        return;
                    }
                    retryCount++;
                    setTimeout(function() {
                        self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound);
                    }, RETRY_INTERVAL);
                } else if (!chat._stopped) {
                    // ===== 网络异常自动重试（catch 分支：连接超时、DNS解析失败等）=====
                    if (retryCount >= MAX_RETRY) {
                        if (retryRound + 1 < MAX_RETRY_ROUNDS) {
                            var _nextRound2 = retryRound + 1;
                            self.addMsg(box, '⚠ 本轮网络异常重试 ' + MAX_RETRY + ' 次仍失败，5分钟后开始第' + (_nextRound2 + 1) + '/' + MAX_RETRY_ROUNDS + '轮重试…', 'warning');
                            Store.addLog('warn', chat.id, 'retry-round-wait', 'wait 300s before catch retry round ' + (_nextRound2 + 1) + '/' + MAX_RETRY_ROUNDS);
                            setTimeout(function() { self._agentLoop(box, chat, model, messages, depth, 0, _nextRound2); }, RETRY_ROUND_INTERVAL);
                            return;
                        }
                        var _typingElsFinal = box.querySelectorAll('.msg.typing');
                        _typingElsFinal.forEach(function(t) { t.remove(); });
                        self.addMsg(box, '❌ 已完成 ' + MAX_RETRY_ROUNDS + ' 轮重试（每轮 ' + MAX_RETRY + ' 次）仍失败，请检查网络连接或 API 服务后手动重试。\n\n最后错误：' + _catchErrorMsg, 'error');
                        Store.addLog('error', chat.id, 'proxy-error', _catchErrorMsg + ' (retried ' + MAX_RETRY_ROUNDS + ' rounds)');
                        self._onSendComplete(box, chat);
                        return;
                    } else {
                        retryCount++;
                    }
                    var _retryMsg2 = '⚠ 网络异常（' + _catchErrorMsg + '），' + RETRY_INTERVAL / 1000 + '秒后自动重试…（第' + retryCount + '/' + MAX_RETRY + '次，第' + (retryRound + 1) + '/' + MAX_RETRY_ROUNDS + '轮）';
                    var _typingEls7 = box.querySelectorAll('.msg.typing');
                    _typingEls7.forEach(function(t) { t.remove(); });
                    self.addMsg(box, _retryMsg2, 'warning');
                    Store.addLog('warn', chat.id, 'retry', 'retry(catch) ' + retryCount + '/' + MAX_RETRY + ' | ' + _catchErrorMsg);
                    setTimeout(function() {
                        self._agentLoop(box, chat, model, messages, depth, retryCount, retryRound);
                    }, RETRY_INTERVAL);
                } else {
                    // 重试次数用尽
                    var _typingEls8 = box.querySelectorAll('.msg.typing');
                    _typingEls8.forEach(function(t) { t.remove(); });
                    if (retryCount >= MAX_RETRY) {
                        self.addMsg(box, '❌ 已重试 ' + MAX_RETRY + ' 次仍失败，请检查网络连接或 API 服务后手动重试。\n\n最后错误：' + _catchErrorMsg, 'error');
                    } else {
                        self.addMsg(box, '代理请求失败：' + _catchErrorMsg, 'error');
                    }
                    Store.addLog('error', chat.id, 'proxy-error', _catchErrorMsg + (retryCount > 0 ? ' (retried ' + retryCount + 'x)' : ''));
                    self._onSendComplete(box, chat);
                }
            });
        },

    // ===== 验证成功后：把「结果验证」行的「2 验证」按钮变为金色「✓ 已验证」并禁用 =====
    // 注意：renderCompressSelector 每次会重建该行，所以需在其执行后再次调用本方法
    _markVerifyButton: function(box) {
        try {
            // 定位操作按钮行：以「撤销」按钮为锚点（按钮重排后已无「结果验证：」标签；早期版本叫「撤销本步」，兼容两者）
            box.querySelectorAll('button').forEach(function(_b) {
                if (_b.textContent.trim() === '撤销' || _b.textContent.trim() === '撤销本步') {
                    var _row = _b.closest('div');
                    if (_row) {
                        _row.querySelectorAll('button').forEach(function(_b2) {
                            if (_b2.textContent.indexOf('验证') >= 0) {
                                _b2.textContent = '查看验证结果';
                                _b2.disabled = false;
                                _b2.style.borderColor = 'rgba(255,200,80,.65)';
                                _b2.style.color = '#ffd76a';
                                _b2.style.background = 'rgba(255,200,80,.12)';
                                _b2.style.cursor = 'pointer';
                                _b2.title = '点击查看二次验证结果（滚动到已验证的最终答案位置）';
                                // 点击按钮滚动到已验证的最终答案位置
                                if (!_b2._viewVerifyBound) {
                                    _b2._viewVerifyBound = true;
                                    _b2.addEventListener('click', function(e) {
                                        e.stopPropagation();
                                        try {
                                            var _body = box.querySelector('.chatbox-body');
                                            if (!_body) return;
                                            var _btnRowTop = 0; try { _btnRowTop = (_b2.closest('div') || _b2).getBoundingClientRect().top; } catch (_e2) {}
                                            var _cand = null;
                                            _body.querySelectorAll('.msg.ai-final.ai-verified').forEach(function(_m) {
                                                // 取按钮上方（或最近）的那条已验证消息，而不是全页第一条
                                                if (!_cand) { _cand = _m; return; }
                                                var _dOld = Math.abs(_m.getBoundingClientRect().top - _btnRowTop);
                                                var _dCur = Math.abs(_cand.getBoundingClientRect().top - _btnRowTop);
                                                // 优先取按钮上方最近的；若都在按钮下方则取最靠上的
                                                if ((_m.getBoundingClientRect().top <= _btnRowTop) === (_cand.getBoundingClientRect().top <= _btnRowTop)) {
                                                    if (_dOld < _dCur) _cand = _m;
                                                } else if (_m.getBoundingClientRect().top <= _btnRowTop) {
                                                    _cand = _m;
                                                }
                                            });
                                            var _finalEl = _cand || _body.querySelector('.msg.ai-final.ai-verified') || _body.querySelector('.msg.ai-final:last-of-type') || _body.querySelector('.msg.ai-final:last-child');
                                            if (!_finalEl) return;
                                            var _top = _finalEl.offsetTop - 90;
                                            if (_top < 0) _top = 0;
                                            _body.scrollTo({ top: _top, behavior: 'smooth' });
                                        } catch (_e) { console.warn('[Agent] scroll to verify result failed:', _e); }
                                    });
                                }
                            }
                        });
                    }
                }
            });
        } catch (e) { console.warn('[Agent] verify button update failed:', e); }
    },

});
