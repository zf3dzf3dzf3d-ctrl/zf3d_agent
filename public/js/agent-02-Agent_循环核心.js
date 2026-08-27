// ==== 拆分自 app-agent.js：Agent 循环核心 ====
Object.assign(App, {
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

            // ===== 防卡死(1)：Agent 递归步数上限 ====

            var loopConfig = this._getContextLoopConfig();
            var MAX_AGENT_DEPTH = loopConfig.maxRounds;
            if ((depth || 0) >= MAX_AGENT_DEPTH) {
                try { this.addMsg(box, '\u26A0\uFE0F 已达到最大智能体执行步数（' + MAX_AGENT_DEPTH + '），为避免程序卡死已自动停止。请把任务拆分成更小的步骤再继续。', 'error'); } catch(e){}
                try { Store.addLog('warn', chat.id, 'agent-max-depth', 'Agent reached max depth=' + depth); } catch(e){}
                this._recoverFromMaxDepth(box, chat, model, depth);
                return;
            }

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

            // ===== 免费生图模型拦截（imageGen 标记）：不走 chat/completions，直接本地生图 =====
            if (model.imageGen) {
                var _lastUser = '';
                for (var i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === 'user') { _lastUser = messages[i].content; break; }
                }
                if (!_lastUser) _lastUser = 'a cute picture';
                var _sz = _lastUser.match(/(\d{3,4})\s*[xX×]\s*(\d{3,4})/);
                var _size = _sz ? (_sz[1] + 'x' + _sz[2]) : '1024x1024';
                var _preferredImageModel = '';
                try { _preferredImageModel = UserSettings.get('zf3d_image_model') || ''; } catch(e) {}
                var _ch = _preferredImageModel || ((model.imageGen && model.modelId && model.modelId !== 'free-image-auto') ? model.modelId : 'poll-flux');
                var _imgMsg = '';
                var self2 = this;
                fetch('/api/image-gen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'generate', prompt: _lastUser, size: _size, model: _ch })
                }).then(function(r) { return r.json(); }).then(function(j) {
                    var d = j.data || {};
                    if (j.ok && d.url) {
                        var info = '\n\n- **模型**: ' + (d.channel_name || d.model) +
                                   '\n- **尺寸**: ' + d.size +
                                   '\n- **文件**: ' + d.bytes + ' 字节';
                        if (d.exhausted_today && d.exhausted_today.length) {
                            info += '\n- **今日额度已耗尽**: ' + d.exhausted_today.join(', ');
                        }
                        _imgMsg = '✅ 已生成\n\n![' + _lastUser.slice(0, 30).replace(/[\[\]()]/g, '') + '](' + d.url + ')' + info;
                    } else {
                        _imgMsg = '❌ 生图失败: ' + (d.error || '未知错误') +
                                  '\n\n> 可对 AI 说「查看生图渠道状态」或运行 image_gen 工具 (action=status)';
                    }
                    var box2 = box;
                    var done = function() {
                        try { self2.addMsg(box2, _imgMsg, 'ai', chat.modelId, true); } catch(e) {
                            try { self2.addMsg(box2, _imgMsg, 'ai', chat.modelId, true); } catch(e2) {}
                        }
                        try { Store.addLog('info', chat.id, 'image-gen', '渠道=' + (d.channel || 'auto') + ' 尺寸=' + d.size); } catch(e) {}
                        // 🎨 画布式生图：创建独立图片节点 + 动态连线
                        if (j.ok && d.url && typeof App !== 'undefined' && App.createImageCanvasNode) {
                            try {
                                App.createImageCanvasNode(box2, d.url, _lastUser, { model: d.model || '', channel: d.channel_name || d.channel || '' });
                            } catch(imgE) { console.warn('[imagenode] createImageCanvasNode failed:', imgE); }
                        }
                        try { self2._onSendComplete(box2, chat); } catch(e) {}
                    };
                    done();
                }).catch(function(e) {
                    _imgMsg = '❌ 生图请求异常: ' + e.message;
                    try { self2.addMsg(box, _imgMsg, 'ai', chat.modelId, true); } catch(e2) {}
                    try { self2._onSendComplete(box, chat); } catch(e2) {}
                });
                return;
            }

            // 请求头
            var headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + model.key
            };
            if (model.headers) {
                for (var hk in model.headers) if (model.headers.hasOwnProperty(hk)) headers[hk] = model.headers[hk];
            }

            // ===== 消息格式清洗：移除孤立的 tool 消息和孤立的 tool_calls =====
            // 压缩/重建后可能产生 tool 角色消息没有对应的 assistant tool_calls，
            // 或 assistant tool_calls 没有对应的 tool 结果，GLM 等严格 API 会返回 400。
            (function sanitizeMessages() {
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
            })();

            // 图片理解必须由模型配置显式声明；imageGen 仅表示生图，不等于识图。
            var _hasImageInput = messages.some(function (msg) {
                return msg && Array.isArray(msg.content) && msg.content.some(function (part) {
                    return part && (part.type === 'image_url' || part.type === 'input_image');
                });
            });
            if (_hasImageInput && !model.visionInput) {
                var _visionError = '当前模型「' + (model.name || model.modelId || '未命名') + '」未配置图片理解能力（visionInput=false），不能识图。请在 models.json 中配置确实支持图片输入的模型后再发送。';
                try { this.addMsg(box, _visionError, 'error'); this._onSendComplete(box, chat); } catch (e) {}
                try { Store.addLog('warn', chat.id, 'vision-input-rejected', _visionError); } catch (e) {}
                return;
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
                    var _validEfforts = ReasoningLevels.listFor(model.modelId).map(function(l) { return l.value; });
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
                tool_choice: 'auto'
            };
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

            // ===== 发送前清洗 messages：移除 reasoning_content 等非标准字段，防止 HTTP 400 =====
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

            var _proxyP;
            chat._realStreamDiv = null;
            chat._realStreamBuf = '';
            if (typeof DB.proxyStream === 'function' && payload.stream === true) {
                // ===== 真实流式：最终回复轮走 /api/proxy_stream，逐块增量渲染（失败自动回退聚合代理）=====
                // 注意：不新增 abort 计时器（沿用上方唯一 330 秒 Promise.race 超时），避免双计时器复发「自动停止」
                _proxyP = DB.proxyStream(model.endpoint, headers, payload,
                    chat.abortController ? chat.abortController.signal : null,
                    function(chunk) {
                        if (!chunk || !chunk.content) return;
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
                        var _cleanMsgs = [{ role: 'system', content: Tools.getSystemPrompt(chat.id) }].concat(self._buildContext(chat.history, model));
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
                                    // run_code 的 code 字段仍保留一个定向兜底，避免多行代码被截断。
                                    var codeMatch = rawArgs.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                                    if (codeMatch) {
                                        toolArgs = { code: codeMatch[1]
                                            .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                                            .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t') };
                                    } else {
                                        toolArgs = {};
                                        toolArgsError = e.message || '工具参数 JSON 解析失败';
                                        console.warn('[agent] invalid tool arguments', toolName, rawArgs, e);
                                        if (window.Store && Store.addLog) Store.addLog('warn', chat.id, 'tool-args', toolName + ' → ' + toolArgsError);
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
                        var borderCls = lastResult.success ? 'task-success' : 'task-fail';
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
                        // 4) 将 AI 结束总结作为消息显示在对话流中（持久化，通知消失后仍可见）
                        var summaryPrefix = lastResult.success ? "\u2705 任务完成\n\n" : "\u274C 任务失败\n\n";
                        var summaryMsg = self.addMsg(box, summaryPrefix + lastResult.message, "ai", chat.modelId, true);
                        summaryMsg.classList.add(lastResult.success ? 'task-result-success' : 'task-result-fail');
                        chat.history.push({ role: "assistant", content: summaryPrefix + lastResult.message });
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

        // ===== 清洗 AI 正文残留的"伪工具调用标签"（代码级兜底） =====
        // 模型偶尔会把 task_complete 等工具调用以 XML 文本形式误写进正文/答案，
        // 显示成 "schenck_task_complete"
        // 之类不可读内容。此函数统一剥离。
        _stripFakeToolTags: function(text) {
            if (!text || typeof text !== 'string') return text || '';
            var cleaned = text;
            // 1) 完整块：<任意前缀 tool 调用 ...>
            cleaned = cleaned.replace(/<[\w\-]*\s*tool[_\-]?call[^>]*>[\s\S]*?<[\s/]*[\w\-]*\s*tool[_\-]?call[^>]*>/gi, '');
            // 2) 单个开/闭标签行：<...task_complete... />、</...task_complete...> 等
            cleaned = cleaned.replace(/<[\s/]*[A-Za-z0-9_\u4e00-\u9fa5\-]*\s*task[_\-]?(?:complete|list|record)[^>\n]*\/?>/g, '');
            // 2) 思考标签块 / <thinking>...</thinking> / <thought>...</thought>
            //    开闭标签成对出现时整体剥离；只有开标签时，剥离开标签及其后所有内容（防止后半截裸思考泄漏）
            cleaned = cleaned.replace(/<\s*\/?\s*(?:think|thinking|thought|reasoning|reflection)\s*\/?>/gi, '\u0000');
            cleaned = cleaned.replace(/\u0000([\s\S]*?)\u0000/g, '');   // 成对的部分清空
            cleaned = cleaned.split('\u0000')[0];                        // 剩下的孤立开标签：之后全是思考，直接截断
            // 2.5) 带前缀的思考标签，如 <schenck_think>...</schenck_think>
            cleaned = cleaned.replace(/<[\w\-]*\s*(?:think|thinking|thought|reasoning|reflection)[^>\n]*>[\s\S]*?<[\s/]*[\w\-]*\s*(?:think|thinking|thought|reasoning|reflection)[^>\n]*>/gi, '');
            // 3) 兜底：裸的 schenck_task_complete 字样（不管是否独立成行，前后无字母数字即剥离）
            cleaned = cleaned.replace(/(?:^|[^A-Za-z0-9_])schenck[_\s]*task[_\s]*complete(?:\s*\{[^}]*\})?/gim, '');
            // 3.5) 兜底：独立的工具调用标签对（如 "schenck_工具名 param=值" 形式的多行块，含 task_complete 参数块）
            cleaned = cleaned.replace(/schenck_(?:task_complete|task_list|ask_user|project_record|write_file|read_file|run_code)[^\n]*\n?/gi, '');
            // 3.6) 兜底：无 < 前缀的裸参数行，如 "task_complete message=... success=true ..."（含典型参数特征才剥离，避免误伤正常文字）
            cleaned = cleaned.replace(/^[ \t]*[\w\-]*task[_\s]?complete[ \t]+[^\n]*?(message|success|scope)[^\n]*$/gim, '');
            // 4) 清理因此产生的连续空行（3 个以上压成 2 个）以及只残留空白符号的行
            cleaned = cleaned.replace(/\n[ \t]+\n/g, '\n\n');
            cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
            return cleaned.trim() === '' ? text : cleaned;
        },
});
