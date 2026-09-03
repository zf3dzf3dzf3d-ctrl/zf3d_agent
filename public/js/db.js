// ========== db.js - 数据客户端（HTTP → 后台 SQLite）==========
// 朱峰社区智能体无限 4.2.0
// 前端通过 HTTP 请求后台 server.py 的 SQLite 持久化服务
// 降级策略: DB 离线时自动回退 localStorage

var DB = {
    // 后台服务地址
    BASE_URL: '',  // 空字符串=相对路径，自动使用当前访问的服务器地址（支持localhost/IP/域名）
    API_PREFIX: '/api/db',
    online: false,
    _checking: false,
    // ===== 防卡死(5.1)：当前循环模式（'1' 直接聊天 / '2' 工具循环 / '3' 自主循环）。可用 UI 改写 =====
    _loopMode: '1',
    _loopModeConfig: null,        // 缓存的 chat_loop_mode.json 内容
    _loopModeInited: false,       // 是否已用 json 初始化过（避免 UI 切过后被反向覆盖）
    // 从 chat_loop_mode.json 加载配置
    _loadLoopModeFromConfig: function() {
        var self = this;
        var url = (this.BASE_URL || '') + '/api/loop-mode-config';
        return fetch(url, { method: 'GET', cache: 'no-store' })
            .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('http ' + res.status)); })
            .then(function(cfg) {
                if (!cfg || typeof cfg !== 'object') throw new Error('bad config');
                self._loopModeConfig = cfg;
                if (!self._loopModeInited) {
                    var dm = String(cfg.default_mode || '1');
                    self._loopMode = dm;
                    self._loopModeInited = true;
                }
                return cfg;
            })
            .catch(function(err) {
                console.warn('[DB] load loop_mode config failed, keep current=' + self._loopMode, err);
                return null;
            });
    },

    // UI 切换循环模式（写回 json + 改内存）
    setLoopMode: function(mode) {
        mode = String(mode || '1');
        this._loopMode = mode;
        this._loopModeInited = true;
        var url = (this.BASE_URL || '') + '/api/loop-mode-config';
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 当前选中即默认：插件模式 id（非数字）原样透传，不再 parseInt（parseInt 会变 NaN）
            body: JSON.stringify({ default_mode: mode })
        }).catch(function(err) { console.warn('[DB] setLoopMode write back failed:', err); });
    },

    // ===== 底层对话引擎（server/engines/ 可插拔）=====
    _engine: '',                 // 当前引擎 id（'' = 用服务端默认）
    _engines: null,              // 缓存的引擎列表
    loadEngines: function() {
        var self = this;
        return fetch((this.BASE_URL || '') + '/api/engines', { method: 'GET', cache: 'no-store' })
            .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('http ' + res.status)); })
            .then(function(data) {
                self._engines = (data && data.ok && data.engines) ? data.engines : [];
                return self._engines;
            })
            .catch(function(err) {
                console.warn('[DB] load engines failed:', err);
                self._engines = [];
                return self._engines;
            });
    },
    getEngines: function() { return this._engines || []; },
    setEngine: function(engineId) {
        this._engine = String(engineId || '');
        try { localStorage.setItem('zf_engine', this._engine); } catch (e) {}
        // 用户配置走 JSON 文件持久化（private/用户设置/user_settings.json）
        try {
            if (typeof UserSettings !== 'undefined') UserSettings.set('defaultEngine', this._engine);
        } catch (e) {}
    },
    _restoreEngine: function() {
        // 优先读 JSON 用户配置；无则回退 localStorage 旧值
        try {
            if (typeof UserSettings !== 'undefined') {
                var saved = UserSettings.get('defaultEngine', null);
                if (saved !== null && saved !== undefined && saved !== '') {
                    this._engine = String(saved);
                    return;
                }
            }
        } catch (e) {}
        try { this._engine = String(localStorage.getItem('zf_engine') || ''); } catch (e) { this._engine = ''; }
    },

    // 初始化入口（db.js 加载即调文件末尾的 DB.init() 调用）
    init: function() {
        var self = this;
        // JSON 用户配置从服务器异步到达后，以服务器值为准再恢复一次
        try {
            window.addEventListener('user-settings-refreshed', function() { self._restoreEngine(); });
        } catch (e) {}
        this._loadLoopModeFromConfig();
        this.loadChatModeRules();
        this._restoreEngine();
        this.loadEngines();
        if (!this._loopModeTimer) {
            this._loopModeTimer = setInterval(function() { self._loadLoopModeFromConfig(); }, 30000);
        }
        if (!this._modeRulesTimer) {
            this._modeRulesTimer = setInterval(function() { self.loadChatModeRules(); }, 30000);
        }
    },

    // ===== 对话模式限制规则（private/chat_mode_rules.json，服务端强制 + 前端读取 loop 段）=====
    _modeRules: null,          // 缓存 {rules: {...}} 或 null
    _modeRulesTimer: null,
    loadChatModeRules: function() {
        var self = this;
        return fetch((this.BASE_URL || '') + '/api/chat-mode-rules', { method: 'GET', cache: 'no-store' })
            .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('http ' + res.status)); })
            .then(function(data) {
                self._modeRules = (data && data.ok && data.rules) ? data.rules : null;
                return self._modeRules;
            })
            .catch(function(err) {
                console.warn('[DB] load chat-mode-rules failed:', err);
                return null;
            });
    },
    // 取指定模式的 loop 规则（无规则时返回 null -> 调用方用系统默认值）
    getModeLoopRules: function(mode) {
        try {
            var m = String(mode == null ? this._loopMode : mode);
            var r = this._modeRules;
            if (!r || !r.modes) return null;
            var seg = r.modes[m];
            if (!seg || !seg.loop || typeof seg.loop !== 'object') return null;
            return seg.loop;
        } catch (e) { return null; }
    },

    // 取得某个对话的循环模式（json 里就取，没有就用全局 _loopMode）
    getLoopModeForChat: function(chatId) {
        var cfg = this._loopModeConfig;
        if (cfg && cfg.conversations && chatId && cfg.conversations[chatId] && cfg.conversations[chatId].loop_mode) {
            return String(cfg.conversations[chatId].loop_mode);
        }
        return this._loopMode;
    },

    // ===== 检查后台服务是否在线 =====
    checkOnline: function() {
        var self = this;
        if (this._checking) return Promise.resolve(this.online);
        this._checking = true;
        var url = this.BASE_URL + '/api/health';
        return fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                self.online = !!(data && data.ok);
                self._checking = false;
                
                return self.online;
            })
            .catch(function(err) {
                self.online = false;
                self._checking = false;
                console.warn('[DB] backend service unreachable, fallback to localStorage');
                return false;
            });
    },

    // 熔断：连续失败次数，超过阈值则暂停请求
    _failCount: 0,
    _failThreshold: 3,
    _circuitOpen: false,

    // ===== 通用请求方法 =====
    _request: function(method, path, body) {
        var self = this;

        // 熔断打开时直接拒绝，不再发请求（避免服务器上线后请求洪水）
        if (this._circuitOpen) {
            return Promise.reject(new Error('circuit-open'));
        }

        var url = this.BASE_URL + this.API_PREFIX + path;
        var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        return fetch(url, opts)
            .then(function(res) {
                if (!res.ok) {
                    return res.json().catch(function() { return { error: 'HTTP ' + res.status }; })
                        .then(function(data) {
                            var msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
                            if (data && data.traceback) console.error('[DB] server error detail:', data.traceback);
                            throw new Error(msg);
                        });
                }
                // 请求成功 → 重置熔断
                self._failCount = 0;
                self._circuitOpen = false;
                return res.json();
            })
            .catch(function(err) {
                // 仅对网络错误计数（非业务错误）
                if (err.message === 'circuit-open') {
                    throw err;
                }
                self._failCount++;
                if (self._failCount >= self._failThreshold && !self._circuitOpen) {
                    self._circuitOpen = true;
                    console.warn('[DB] circuit open: ' + self._failCount + ' consecutive failures, pause 10s');
                    setTimeout(function() {
                        
                        self._circuitOpen = false;
                        self._failCount = 0;
                    }, 10000);
                }
                throw err;
            });
    },

    // ===== KV 存储 =====
    kvGet: function(key) {
        return this._request('GET', '/kv/' + encodeURIComponent(key));
    },
    kvSet: function(key, value) {
        return this._request('POST', '/kv', { key: key, value: value });
    },
    kvDelete: function(key) {
        return this._request('DELETE', '/kv/' + encodeURIComponent(key));
    },
    kvHas: function(key) {
        return this.kvGet(key).then(function (v) { return v !== null && v !== undefined && v !== ''; }).catch(function () { return false; });
    },

    // ===== 节点（对话框）CRUD =====
    getNodes: function() {
        return this._request('GET', '/nodes');
    },
    saveNode: function(node) {
        return this._request('POST', '/nodes', node);
    },
    deleteNode: function(nodeId) {
        return this._request('DELETE', '/nodes/' + encodeURIComponent(nodeId));
    },

    // ===== 画布视图状态 =====
    getCanvasView: function() {
        return this._request('GET', '/canvas/view');
    },
    saveCanvasView: function(x, y, scale) {
        return this._request('POST', '/canvas/view', { x: x, y: y, scale: scale });
    },

    // ===== 会话管理 =====
    getSessions: function() {
        return this._request('GET', '/sessions');
    },
    createSession: function(name) {
        return this._request('POST', '/sessions', { name: name });
    },
    deleteSession: function(sid) {
        return this._request('DELETE', '/sessions/' + encodeURIComponent(sid));
    },

    // ===== 对话历史 =====
    getChatHistory: function(sessionId) {
        return this._request('GET', '/chat/' + encodeURIComponent(sessionId));
    },
    addChatMessage: function(sessionId, role, content, modelId, parentId, ts) {
        var payload = { role: role, content: content, modelId: modelId || '', parentId: parentId || null };
        // ts: 恢复已关闭对话时传入原始时间戳，保持时间一致性
        if (ts) payload.ts = ts;
        return this._request('POST', '/chat/' + encodeURIComponent(sessionId), payload);
    },
    clearChatHistory: function(sessionId) {
        return this._request('DELETE', '/chat/' + encodeURIComponent(sessionId));
    },

    // ===== 通用数据表 =====
    getData: function(category, key) {
        var path = '/data/' + encodeURIComponent(category);
        if (key) path += '/' + encodeURIComponent(key);
        return this._request('GET', path);
    },
    setData: function(category, key, value) {
        return this._request('POST', '/data/' + encodeURIComponent(category),
            { key: key, value: value });
    },
    deleteData: function(category, key) {
        var path = '/data/' + encodeURIComponent(category);
        if (key) path += '/' + encodeURIComponent(key);
        return this._request('DELETE', path);
    },

    // ===== 日志 =====
    getLogs: function(limit) {
        var q = limit ? ('?limit=' + limit) : '';
        return this._request('GET', '/logs' + q);
    },
    addLog: function(level, boxId, action, detail) {
        return this._request('POST', '/logs', {
            level: level, boxId: boxId, action: action, detail: detail
        });
    },

    // ===== 项目管理 =====
    getProjects: function() {
        return this._request('GET', '/projects');
    },
    createProject: function(name) {
        return this._request('POST', '/projects', { name: name });
    },
    renameProject: function(projId, name) {
        return this._request('POST', '/projects/' + encodeURIComponent(projId), { name: name });
    },
    deleteProject: function(projId) {
        return this._request('DELETE', '/projects/' + encodeURIComponent(projId));
    },
    setNodeProject: function(nodeId, projectId) {
        return this._request('POST', '/nodes/' + encodeURIComponent(nodeId) + '/project', { projectId: projectId });
    },
    // 打开项目关联的文件夹（在系统文件管理器中打开）
    openProjectFolder: function(projId) {
        var url = this.BASE_URL + '/api/project/open-folder?proj_id=' + encodeURIComponent(projId);
        return fetch(url, { method: 'GET' }).then(function(res) { return res.json(); });
    },
    // 浏览目录（文件夹选择器）— 返回子目录列表
    browseFolders: function(path) {
        var url = this.BASE_URL + '/api/project/browse-folder?path=' + encodeURIComponent(path || '');
        return fetch(url, { method: 'GET' }).then(function(res) { return res.json(); });
    },
    // 获取当前活动项目ID（记忆上次选择的项目）
    getActiveProject: function() {
        return this.kvGet('active_project_id');
    },
    // 设置当前活动项目ID
    setActiveProject: function(projId) {
        return this.kvSet('active_project_id', projId || '');
    },
    // 关联文件夹到项目
    linkFolder: function(projId, folderPath) {
        return fetch(this.BASE_URL + '/api/project/link-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proj_id: projId, folder_path: folderPath })
        }).then(function(res) { return res.json(); });
    },

    // ===== 保存 Token 统计 =====
    saveStats: function(sessionId, stats) {
        var url = this.BASE_URL + this.API_PREFIX + '/stats';
        var body = {
            sessionId: sessionId,
            success: !!stats.success,
            taskTitle: stats.task_title || '',
            tokensUsed: stats.tokens || 0,
            apiCalls: stats.api_calls || 0,
            durationMs: (stats.duration || 0) * 1000,
            cacheHitTokens: stats.cache_hit_tokens || 0,
            cacheRate: stats.cache_rate || 0
        };
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function(res) { return res.json(); })
          .catch(function(e) { console.warn('[DB] saveStats failed:', e); });
    },

    // ===== API 代理（解决 CORS）=====
    // signal 参数可选：外部传入 AbortSignal 可手动中断请求
    proxy: function(targetUrl, headers, payload, signal) {
        var url = this.BASE_URL + '/api/proxy';
        // ===== 防卡死(5.1)：前端循环模式标记从 payload 提升到 body 顶层，后端据此选提提示词 =====
        var loopMode = null;
        var projectPath = null;
        if (payload && typeof payload === 'object' && payload._loop_mode) {
            loopMode = String(payload._loop_mode);
            try { delete payload._loop_mode; } catch (e) { payload._loop_mode = undefined; }
        } else if (DB && DB._loopMode) {
            loopMode = String(DB._loopMode);
        }
        if (payload && typeof payload === 'object' && payload._project_path) {
            projectPath = String(payload._project_path);
            try { delete payload._project_path; } catch (e) { payload._project_path = undefined; }
        }
        var body = {
            _target_url: targetUrl,
            _method: 'POST',
            _headers: headers,
            _body: payload
        };
        if (loopMode) body._loop_mode = loopMode;
        if (projectPath) body._project_path = projectPath;
        if (payload && typeof payload === 'object' && payload._box_id) body._box_id = String(payload._box_id);
        // 对话级 _engine（payload 内）优先于全局 DB._engine
        if (payload && typeof payload === 'object' && payload._engine !== undefined) {
            if (payload._engine) body._engine = String(payload._engine);
        } else if (DB._engine) {
            body._engine = DB._engine;
        }
        // ===== 防卡死(5)：代理超时统一由 app-agent.js 的 330 秒 Promise.race 管理 =====
        // 【2025 修复】移除内部 300 秒 abort 计时器：它与上层 330 秒超时形成双计时器，
        // 300 秒先触发 -> fetch 抛 AbortError -> app-agent.js catch 分支误判为「用户主动停止」
        // -> 静默走 _onSendComplete，无错误提示、无重试、无日志 —— 这就是对话「自动停止」的根因。
        // 保留用户手动停止的外部 signal 透传。
        var opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        };
        if (signal) {
            if (signal.aborted) {
                return Promise.reject(new DOMException('用户取消了请求', 'AbortError'));
            }
            opts.signal = signal;
        }
        return fetch(url, opts).then(function(res) {
            return res.json();
        });
    },

    // ===== 真实流式代理（/api/proxy_stream）：fetch + getReader 逐块解析 SSE =====
    // 返回 Promise<{ok, status, data}>：data 为聚合后的 OpenAI 格式响应（与 DB.proxy 兼容）
    // 回调（可选）：onChunk({content, reasoning}) 每个增量、onDone(最终聚合对象)
    // 上游非 SSE 时退化为一次性 done 事件，行为等同 DB.proxy —— 保证可回退
    proxyStream: function(targetUrl, headers, payload, signal, onChunk, onDone, onEvent) {
        var url = this.BASE_URL + '/api/proxy_stream';
        var loopMode = null;
        var projectPath = null;
        if (payload && typeof payload === 'object' && payload._loop_mode) {
            loopMode = String(payload._loop_mode);
            try { delete payload._loop_mode; } catch (e) { payload._loop_mode = undefined; }
        } else if (DB && DB._loopMode) {
            loopMode = String(DB._loopMode);
        }
        if (payload && typeof payload === 'object' && payload._project_path) {
            projectPath = String(payload._project_path);
            try { delete payload._project_path; } catch (e) { payload._project_path = undefined; }
        }
        if (payload && typeof payload === 'object') {
            payload.stream = true;
        }
        var body = {
            _target_url: targetUrl,
            _method: 'POST',
            _headers: headers,
            _body: payload
        };
        if (loopMode) body._loop_mode = loopMode;
        if (projectPath) body._project_path = projectPath;
        if (payload && typeof payload === 'object' && payload._box_id) body._box_id = String(payload._box_id);
        // 对话级 _engine（payload 内）优先于全局 DB._engine
        if (payload && typeof payload === 'object' && payload._engine !== undefined) {
            if (payload._engine) body._engine = String(payload._engine);
        } else if (DB._engine) {
            body._engine = DB._engine;
        }
        // 注意：与 proxy 相同——不设内部 abort 计时器，避免双计时器导致「自动停止」回归
        var opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        };
        if (signal) {
            if (signal.aborted) {
                return Promise.reject(new DOMException('用户取消了请求', 'AbortError'));
            }
            opts.signal = signal;
        }

        function _finishReasoning(acc, delta) {
            for (var i = 0; i < REASONING_KEYS.length; i++) {
                var k = REASONING_KEYS[i];
                if (delta[k]) {
                    acc.reasoning += delta[k];
                    return true;
                }
            }
            return false;
        }
        var REASONING_KEYS = ['reasoning_content', 'reasoning', 'thinking', 'thought'];

        function _accumulate(acc, chunk) {
            if (!chunk || typeof chunk !== 'object') return;
            if (!Array.isArray(chunk.choices)) return;
            for (var i = 0; i < chunk.choices.length; i++) {
                var c = chunk.choices[i];
                if (!c || typeof c !== 'object') continue;
                if (c.finish_reason) acc.finish_reason = c.finish_reason;
                var delta = c.delta || c.message || {};
                if (typeof delta !== 'object') continue;
                if (_finishReasoning(acc, delta)) {
                    /* reasoning 累计 */
                }
                if (delta.content) {
                    acc.content += delta.content;
                    if (typeof onChunk === 'function') {
                        try { onChunk({ content: delta.content, reasoning: '' }); } catch (e) {}
                    }
                }
                if (acc.reasoning && typeof onChunk === 'function') {
                    // 最后一次增量带出当前累计 reasoning 长度标记，显示层自行决定
                    try { onChunk({ content: '', reasoning: acc.reasoning }); } catch (e) {}
                }
                var tc = delta.tool_calls;
                if (tc && Array.isArray(tc)) {
                    for (var j = 0; j < tc.length; j++) {
                        var t = tc[j];
                        var idx = (t.index !== undefined) ? t.index : 0;
                        if (!acc.tool_calls[idx]) {
                            acc.tool_calls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                        }
                        if (t.id) acc.tool_calls[idx].id = t.id;
                        if (t.type) acc.tool_calls[idx].type = t.type;
                        var fn = t.function || {};
                        if (fn.name) acc.tool_calls[idx].function.name += fn.name;
                        if (fn.arguments) acc.tool_calls[idx].function.arguments += fn.arguments;
                    }
                }
            }
        }

        function _buildFinal(acc) {
            var message = { role: 'assistant', content: acc.content };
            if (acc.reasoning) message.reasoning_content = acc.reasoning;
            var tcKeys = Object.keys(acc.tool_calls);
            if (tcKeys.length) {
                message.tool_calls = tcKeys.sort(function(a, b) { return a - b; }).map(function(k) { return acc.tool_calls[k]; });
            }
            return {
                id: 'chatcmpl-stream',
                _sse_aggregated: true,
                object: 'chat.completion',
                choices: [{ index: 0, message: message, finish_reason: acc.finish_reason || 'stop' }],
                _truncated: acc.finish_reason === 'length'
            };
        }

        return fetch(url, opts).then(function(res) {
            if (!res.body || typeof res.body.getReader !== 'function') {
                // 极老浏览器无流 API：整体按 JSON 读
                return res.json();
            }
            var reader = res.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var sseBuf = '';
            var acc = { content: '', reasoning: '', tool_calls: {}, finish_reason: null };
            var finalMeta = { ok: true, status: res.status };
            var _curEvent = '';  // 当前 SSE 事件名（tool_event 等自定义事件用）

            function processLine(line) {
                line = line.replace(/\r/g, '');
                if (line.indexOf('event:') === 0) {
                    // 记录当前 SSE 事件名（支持 tool_event 等自定义事件）
                    // 注意 'event:' 是 6 个字符，slice(6) 才能去掉冒号（slice(5) 会留 ': ' 导致匹配失败）
                    _curEvent = line.slice(6).trim();
                    return;
                }
                if (line.indexOf('data:') !== 0) { if (line) _curEvent = ''; return; }
                var payloadStr = line.slice(5).trim();
                if (!payloadStr) return;
                if (payloadStr === '[DONE]') { _curEvent = ''; return; }
                try {
                    var obj = JSON.parse(payloadStr);
                } catch (e) { return; }
                // 【新增】自定义 tool_event 事件（引擎敏感工具提示等）：交给 onEvent 回调，不进聚合
                if (_curEvent === 'tool_event') {
                    _curEvent = '';
                    if (typeof onEvent === 'function') {
                        try { onEvent(obj); } catch (e) {}
                    }
                    return;
                }
                _curEvent = '';
                // 错误事件（后端上游失败时发 event:error）
                if (obj && obj.ok === false && obj.error && obj.data === undefined && obj.choices === undefined) {
                    throw new Error('【流式代理】' + (obj.error || '上游请求失败'));
                }
                // 后端「done」事件：上游本身不是 SSE 的聚合结果
                if (obj && obj.ok !== undefined && obj.status !== undefined && obj.data !== undefined) {
                    finalMeta.ok = !!obj.ok;
                    finalMeta.status = obj.status;
                    finalMeta.donePayload = obj;
                    return;
                }
                _accumulate(acc, obj);
            }

            function pump() {
                return reader.read().then(function(r) {
                    if (r.done) {
                        if (sseBuf.trim()) {
                            sseBuf.split('\n').forEach(processLine);
                        }
                        var data;
                        if (finalMeta.donePayload) {
                            data = finalMeta.donePayload.data;
                            if (finalMeta.donePayload.ok === false) throw new Error('【流式代理】' + (finalMeta.donePayload.error || '上游请求失败'));
                        } else {
                            data = _buildFinal(acc);
                        }
                        if (typeof onDone === 'function') { try { onDone(data); } catch (e) {} }
                        return { ok: true, status: res.status, data: data };
                    }
                    sseBuf += decoder.decode(r.value, { stream: true });
                    var nl;
                    while ((nl = sseBuf.indexOf('\n')) >= 0) {
                        var line = sseBuf.slice(0, nl);
                        sseBuf = sseBuf.slice(nl + 1);
                        try { processLine(line); } catch (e) { try { reader.cancel(); } catch (_) {} throw e; }
                    }
                    return pump();
                });
            }
            return pump();
        });
    }
};

// 页面加载即初始化 loop_mode
if (typeof window !== 'undefined') { try { DB.init(); } catch(e) {} }
