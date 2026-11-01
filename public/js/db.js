// ========== db.js - 数据客户端（HTTP → 后台 SQLite）==========
// 朱峰智能体无限 4.2.0
// 前端通过 HTTP 请求后台 server.py 的 SQLite 持久化服务
// 降级策略: DB 离线时自动回退 localStorage

// ===== 响应 JSON 解析保护（2026-10-01）=====
// 服务返回非 JSON（服务器重启闪断/网关 HTML/文本错误）时，res.json() 会抛 SyntaxError，
// 在前端只显示难懂的“服务响应格式异常”，丢掉了 HTTP 状态码和正文。改为先读文本再解析：
// 解析失败时抛出带状态码+正文片段的错误，重试行可直接显示真实原因（排障证据）。
function _safeJson(res) {
    return res.text().then(function(txt) {
        try { return JSON.parse(txt); }
        catch (e) {
            var snip = String(txt || '').replace(/\s+/g, ' ').slice(0, 120);
            try { console.warn('[DB] 非 JSON 响应 status=' + res.status + ' body=' + String(txt || '').slice(0, 300)); } catch (e2) {}
            throw new Error('服务响应格式异常(HTTP ' + res.status + ')：' + (snip || '空响应'));
        }
    });
}

var DB = {
    // 后台服务地址
    BASE_URL: '',  // 空字符串=相对路径，自动使用当前访问的服务器地址（支持localhost/IP/域名）
    API_PREFIX: '/api/db',
    online: false,
    _checking: false,
    // ===== 防卡死(5.1)：当前循环模式（'1' 直接聊天 / '2' 工具循环 / '3' 自主循环）。可用 UI 改写 =====
    _loopMode: '2',
    _loopModeConfig: null,        // 缓存的 chat_loop_mode.json 内容
    _loopModeInited: false,       // 是否已用 json 初始化过（避免 UI 切过后被反向覆盖）
    // 从 chat_loop_mode.json 加载配置
    _loadLoopModeFromConfig: function() {
        var self = this;
        var url = (this.BASE_URL || '') + '/api/loop-mode-config';
        var ctl = new AbortController();
        var t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 15000);
        return fetch(url, { method: 'GET', cache: 'no-store', signal: ctl.signal })
            .finally(function () { clearTimeout(t); })
            .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('http ' + res.status)); })
            .then(function(cfg) {
                if (!cfg || typeof cfg !== 'object') throw new Error('bad config');
                self._loopModeConfig = cfg;
                if (!self._loopModeInited) {
                    var dm = String(cfg.default_mode || '2');
                    // 已移除"直接聊天(1)"模式：一律回退工具循环
                    if (dm === '1') dm = '2';
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
        mode = String(mode || '2');
        if (mode === '1') mode = '2'; // 已移除"直接聊天"模式，强制走工具循环
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

    // 取得某个对话的循环模式（json 里就取，没有就用全局 _loopMode；'1'直接聊天已移除，一律工具循环）
    getLoopModeForChat: function(chatId) {
        var cfg = this._loopModeConfig;
        if (cfg && cfg.conversations && chatId && cfg.conversations[chatId] && cfg.conversations[chatId].loop_mode) {
            var m = String(cfg.conversations[chatId].loop_mode);
            if (m === '1') m = '2';
            return m;
        }
        return this._loopMode === '1' ? '2' : this._loopMode;
    },

    // ===== 检查后台服务是否在线 =====
    checkOnline: function() {
        var self = this;
        if (this._checking) return Promise.resolve(this.online);
        this._checking = true;
        var url = this.BASE_URL + '/api/health';
        // 【修复】后端重启/初始化期间 CPU 忙，3 秒超时容易误判离线导致对话框迟迟不载入，放宽到 8 秒
        return fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
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
                    // 熔断已静默：10s 后自动恢复
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
    // 批量写日志：一次请求带多条，避免日志风暴耗尽浏览器连接资源
    addLogs: function(list) {
        if (!list || !list.length) return Promise.resolve();
        return this._request('POST', '/logs', { logs: list });
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
        // [强化A4 2026-10-16] 仅当带有效质量分（0-100，>0）才附加 reviewScore；
        // 无该字段时 JSON 自动省略，后端消费端钩子零触发（向后兼容，无自评不上报）。
        if (stats.review_score && stats.review_score > 0) {
            body.reviewScore = Math.max(0, Math.min(100, Math.round(stats.review_score)));
        }
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function(res) { return res.json(); })
          .catch(function(e) { console.warn('[DB] saveStats failed:', e); });
    },

    // ===== API 代理（解决 CORS）=====
    // signal 参数可选：外部传入 AbortSignal 可手动中断请求
    // 【20261008 断流兜底】relay-proxy 聚合请求加 150s 前端超时（服务端上游超时120s+重试余量）：
    // 服务器端连接被掐断且未回包时，fetch 会永远 pending → 用户无限转圈只能重启。
    // 超时后返回失败结构（不 reject，避免被上层误判为"用户主动停止"静默吞掉）。
    _relayFetchWithTimeout: function(url, opts, timeoutMs) {
        timeoutMs = timeoutMs || 150000;
        return new Promise(function (resolve) {
            var _done = false;
            var _timer = setTimeout(function () {
                if (_done) return; _done = true;
                var _msg = '朱峰线路响应超时(150s)：上游可能已断流，请点重试或稍后再发。';
                try { console.warn('[DB]', _msg); } catch (e) {}
                resolve({ ok: false, status: 504, error: _msg, data: { error: { message: _msg } } });
            }, timeoutMs);
            fetch(url, opts).then(function (res) {
                if (_done) return; _done = true; clearTimeout(_timer); resolve(res);
            }, function (err) {
                if (_done) return; _done = true; clearTimeout(_timer); resolve(Promise.reject(err));
            });
        });
    },

    // 【太空舱补字·聚合代理广播 2026-10 修复】
    // DB.proxy() 是聚合（非流式）调用，工具选择轮 / stream=false 的最终轮都走这里，
    // 拿到的是 OpenAI 格式聚合 JSON（data.choices[0].message.content / reasoning_content），
    // 全程不触发 zf:llm-chunk → 太空舱舷窗收不到任何 token → 黑屏。
    // 这里把聚合结果里的真实文本（思考 + 正文）按片段模拟流式广播，驱动舷窗数字雨。
    // 调用方传入 proxy() 的完整返回 {ok,status,data}，本函数只读不返（无副作用，异常吞掉）。

    // ===== 【停顿期优化 v1.0】IdleDetector + 只读预取 PrefetchCache =====
    // 停顿窗口 = 模型思考期 + 工具执行期 + API 排队期。此期间前端网络空闲。
    // 1) 每次收到 zf:llm-chunk / _zfBcastAgg 更新 _zfIdle.lastAt；isIdle(th) 判定当前是否处于停顿窗口。
    // 2) tool_calls 增量解析出只读工具的完整 path 参数时，立即预取缓存（TTL 30s + mtime 校验），
    //    后续 read_file/tree/search 执行前命中缓存则秒回。
    _zfPrefetch: {
        cache: {},          // key -> {data, mtime, ts}
        inflight: {},       // key -> true
        order: [],          // LRU
        TTL: 30000,
        VERIFY_MS: 5000,    // mtime 复验窗口：超过 5s 未复验的条目命中时先失效并异步复验
        MAX: 50,
        stats: { feed: 0, hit: 0, miss: 0, drop: 0 },  // 喂入数/命中数/未命中数/复验失效数（S6 熔断线数据源）
        stat: function (k) { try { this.stats[k]++; } catch (e) {} },
        // 只读白名单：写/删/执行类永不预取
        whitelist: { read_file: 1, read_lines: 1, tree_dir: 1, search_in_files: 1, find_files: 1, file_info: 1 },
        // 关键参数抽取：tool name -> arguments 内字段（抽不到就不预取，静默放弃）
        keyFields: { read_file: ['path'], read_lines: ['path'], tree_dir: ['path'], search_in_files: ['keyword', 'path'], find_files: ['pattern', 'path'], file_info: ['path'] },
        touch: function (key) {
            var o = this.order, i = o.indexOf(key);
            if (i >= 0) o.splice(i, 1);
            o.push(key);
            while (o.length > this.MAX) { var old = o.shift(); delete this.cache[old]; }
        },
        feed: function (toolName, args) {
            // arguments 完整解析成功才可能走到这；白名单外一律忽略
            try {
                if (!toolName || !this.whitelist[toolName]) return;
                var fields = this.keyFields[toolName] || ['path'];
                var parts = [];
                for (var i = 0; i < fields.length; i++) {
                    var v = args[fields[i]];
                    if (v === undefined || v === null || v === '') return;  // 流式分片未齐 → 放弃
                    parts.push(String(v));
                }
                var key = toolName + '|' + parts.join('|');
                if (this.cache[key] || this.inflight[key]) return;
                this.stat('feed');
                var self = this;
                this.inflight[key] = true;
                // 预取走既有后端只读 API；失败静默（try/catch 全包裹）
                var body = { tool: toolName, args: args };
                fetch('/api/tool_prefetch', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
                    delete self.inflight[key];
                    if (!j || j.ok === false) return;
                    self.cache[key] = { data: j.data !== undefined ? j.data : j, mtime: (j.mtime === undefined ? null : j.mtime), ts: Date.now(), verifiedAt: Date.now() };
                    self.touch(key);
                }).catch(function () { delete self.inflight[key]; });
            } catch (e) { try { delete this.inflight[toolName]; } catch (e2) {} }
        },
        hit: function (toolName, args) {
            try {
                var fields = this.keyFields[toolName];
                if (!fields) return null;
                var parts = [];
                for (var i = 0; i < fields.length; i++) {
                    var v = args ? args[fields[i]] : undefined;
                    if (v === undefined || v === null || v === '') return null;
                    parts.push(String(v));
                }
                var key = toolName + '|' + parts.join('|');
                var e = this.cache[key];
                if (!e) { this.stat('miss'); return null; }
                if (Date.now() - e.ts > this.TTL) { delete this.cache[key]; this.stat('miss'); return null; }
                // mtime 防脏读：TTL 窗口内文件仍可能被写工具修改。VERIFY_MS 内已复验则直接命中；
                // 超过则本次返回 null（走原真实读取），同时异步复验：mtime 不一致删缓存，一致则刷新数据+时间戳
                var self = this;
                if (e.mtime !== null && e.mtime !== undefined) {
                    if (Date.now() - (e.verifiedAt || 0) > this.VERIFY_MS) {
                        delete this.cache[key];   // 先失效，复验通过会重新写入
                        this.stat('drop');
                        this.revalidate(key, toolName, args);
                        return null;
                    }
                }
                this.touch(key);
                this.stat('hit');
                return { __zfPrefetchHit: true, data: e.data };
            } catch (e2) { return null; }
        },
        // 异步复验：重新调只读预取接口，比对新 mtime；不一致弃缓存，一致则刷新数据续期
        revalidate: function (key, toolName, args) {
            var self = this;
            try {
                if (this.inflight[key]) return;
                this.inflight[key] = true;
                fetch('/api/tool_prefetch', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolName, args: args })
                }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
                    delete self.inflight[key];
                    if (!j || j.ok === false) return;
                    var newMtime = (j.mtime === undefined ? null : j.mtime);
                    // 重新算 key 下的最新条目（可能已被 TTL/LRU 清掉）
                    var old = self.cache[key];
                    if (old && newMtime !== null && old.mtime === null) { delete self.cache[key]; return; }  // 旧条目无 mtime（理论残窗）→ 弃缓存保安全
                    if (old && newMtime !== null && old.mtime !== null && String(old.mtime) !== String(newMtime)) {
                        delete self.cache[key];   // 文件已被修改 → 弃缓存
                        return;
                    }
                    self.cache[key] = { data: j.data !== undefined ? j.data : j, mtime: newMtime, ts: Date.now(), verifiedAt: Date.now() };
                    self.touch(key);
                }).catch(function () { delete self.inflight[key]; });
            } catch (e) { try { delete this.inflight[key]; } catch (e2) {} }
        },
        info: function () { return { size: Object.keys(this.cache).length, inflight: Object.keys(this.inflight).length }; }
    },
    _zfIdle: {
        lastAt: 0,
        mark: function () { this.lastAt = Date.now(); },
        isIdle: function (th) { return Date.now() - this.lastAt > (th || 1400); }
    },
    // ===== 【停顿期优化】工具执行前查预取缓存；并从聚合响应中的 tool_calls 喂入预取 =====
    _zfTryCache: function (toolName, args) {
        try { return DB._zfPrefetch.hit(toolName, args); } catch (e) { return null; }
    },
    _zfBcastAgg: function(resp, boxId) {
        try {
            if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
            var data = resp && resp.data;
            if (!data) return;
            var choices = data.choices;
            if (!choices || !choices.length) return;
            var msg = (choices[0] && (choices[0].message || choices[0].delta)) || {};
            var _txt = '';
            if (msg.reasoning_content) _txt += String(msg.reasoning_content);
            if (msg.reasoning) _txt += String(msg.reasoning);
            if (msg.content) { if (_txt) _txt += '\n'; _txt += String(msg.content); }
            // 工具调用轮的 arguments 也算"正在输出的真实内容"
            var _tcs = msg.tool_calls;
            if (_tcs && _tcs.length) {
                for (var _ti = 0; _ti < _tcs.length; _ti++) {
                    try {
                        var _fn = (_tcs[_ti] && _tcs[_ti].function) || {};
                        if (_fn.name) _txt += (_txt ? '\n' : '') + String(_fn.name);
                        if (_fn.arguments) _txt += String(_fn.arguments);
                    } catch (_te) {}
                }
                // 【停顿期预取】聚合响应里已拿到完整 tool_calls arguments，喂入预取缓存
                try {
                    for (var _tp = 0; _tp < _tcs.length; _tp++) {
                        var _fnP = (_tcs[_tp] && _tcs[_tp].function) || {};
                        if (_fnP.name && _fnP.arguments) {
                            var _aP = null;
                            try { _aP = JSON.parse(_fnP.arguments); } catch (_pe) { _aP = null; }
                            if (_aP) DB._zfPrefetch.feed(_fnP.name, _aP);
                        }
                    }
                } catch (_pe2) {}
            }
            if (!_txt) return;
            var bid = boxId || (data._box_id || (resp && resp._box_id) || null);
            var _sLen = _txt.length, _sStep = 16, _sI = 0;
            (function _sNext() {
                if (_sI >= _sLen) return;
                var _sPc = _txt.slice(_sI, _sI + _sStep); _sI += _sStep;
                try {
                    window.dispatchEvent(new CustomEvent('zf:llm-chunk', {
                        detail: { content: _sPc, boxId: bid, t: Date.now() }
                    }));
                } catch (_se) {}
                setTimeout(_sNext, 30);
            })();
            DB._zfIdle.mark();
        } catch (e) { }
    },

    proxy: function(targetUrl, headers, payload, signal) {
        // 【20260930 修复】朱峰官方网关线路（zf_models_relay）：前端裸调必 401 no-key
        // （官方 relay 要求 X-ZF-Key/X-ZF-User，key 永不出服务器，前端不可能持有）。
        // 改走本地服务端 /api/zf3d/relay-proxy，由服务端补鉴权头后再转发。
        try {
            if (String(targetUrl || '').indexOf('zf_models_relay') !== -1 && payload && typeof payload === 'object') {
                var _m = String(payload.model || '');
                if (_m) {
                    var _rpBody = { model: _m, payload: payload };
                    if (payload._loop_mode) _rpBody._loop_mode = String(payload._loop_mode);
                    // 【2026-09-30 修复】必须包装成 {ok,status,data}，与 /api/proxy 路径及 proxyStream 的
                    // relay 重定向保持一致——之前直接 res.json() 返回裸 JSON，调用方 res.ok=undefined
                    // 恒判失败，报「调用失败：未知错误」。
                    return DB._relayFetchWithTimeout(this.BASE_URL + '/api/zf3d/relay-proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(_rpBody),
                        signal: signal || undefined
                    }).then(function (res) {
                        return res.json().then(function (j) {
                            // relay-proxy 自身报错时返回 {ok:false,error:'...'}，转成网关错误格式让前端显示具体原因
                            if (j && j.ok === false && j.error && !j.choices) {
                                // 【2026-10-01 修复】错误文本里常带真实状态码（如"上游限流(429)"），必须解析出来——
                                // 之前用 res.status（恒为200），调用方报「调用失败：HTTP 200：未知错误」。
                                var _stRp = (String(j.error).match(/\b(429|401|402|403|400|404|408|500|502|503|504)\b/) || [])[1];
                                // 【2026-10-01 审核补修】解析不到码时兜底透传真实 res.status，而非硬编码 502——
                                // 否则上游 401/404 等响应体无数字码时会被错误显示成 502。
                                return { ok: false, status: _stRp ? parseInt(_stRp, 10) : res.status, error: j.error, data: { error: { message: j.error } } };
                            }
                            var _aggRp = { ok: res.ok, status: res.status, data: j };
                            DB._zfBcastAgg(_aggRp, (payload && payload._box_id) || null);
                            return _aggRp;
                        });
                    });
                }
            }
        } catch (e) { console.warn('[DB] relay-proxy redirect failed, fallback', e); }
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
        // 【重试幂等 2026-09-10】调用方（Agent 循环）指定的池轮次 id：同一逻辑请求的重试
        // 全部复用同一 id，服务端幂等/让位语义靠它识别"重投"与"新请求"（防互杀风暴的关键）
        if (payload && typeof payload === 'object' && payload._pool_turn_id) {
            body._turn_id = String(payload._pool_turn_id);
            try { delete payload._pool_turn_id; } catch (e) {}   // 不随 _body 发给上游
        }
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
        // ===== 对话池托管（chat_pool v1.0）：池可用走托管+断点续读；null 回退旧直连 =====
        var _boxIdAgg = (payload && payload._box_id) || null;
        return DB._poolProxyFlow(body, signal).then(function(poolRes) {
            if (poolRes !== null) { DB._zfBcastAgg(poolRes, _boxIdAgg); return poolRes; }
            return fetch(url, opts).then(function(res) {
                return _safeJson(res).then(function(d) {
                    DB._zfBcastAgg({ ok: res.ok, status: res.status, data: d }, _boxIdAgg);
                    return d;
                });
            });
        });
    },

    // ===== 真实流式代理（/api/proxy_stream）：fetch + getReader 逐块解析 SSE =====
    // 返回 Promise<{ok, status, data}>：data 为聚合后的 OpenAI 格式响应（与 DB.proxy 兼容）
    // 回调（可选）：onChunk({content, reasoning}) 每个增量、onDone(最终聚合对象)
    // 上游非 SSE 时退化为一次性 done 事件，行为等同 DB.proxy —— 保证可回退
    proxyStream: function(targetUrl, headers, payload, signal, onChunk, onDone, onEvent) {
        // 【20260930 修复】朱峰官方网关线路（zf_models_relay）改走本地 relay-proxy（服务端补鉴权头）。
        // relay-proxy 返回聚合 JSON（非 SSE），包装成 {ok,status,data} 兼容格式后直接返回。
        try {
            if (String(targetUrl || '').indexOf('zf_models_relay') !== -1 && payload && typeof payload === 'object') {
                var _m2 = String(payload.model || '');
                if (_m2) {
                    var _rpBody2 = { model: _m2, payload: payload };
                    if (payload._loop_mode) _rpBody2._loop_mode = String(payload._loop_mode);
                    return DB._relayFetchWithTimeout(this.BASE_URL + '/api/zf3d/relay-proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(_rpBody2),
                        signal: signal || undefined
                    }).then(function (res) {
                        return res.json().then(function (j) {
                            // 【2026-10-01 修复】relay-proxy 报错（HTTP 200 + {ok:false}）也要转成失败格式，
                            // 否则 res.ok=true 被调用方误判成功 → 走 choices 检查报「AI 返回格式异常」。
                            if (j && j.ok === false && j.error && !j.choices) {
                                var _stRp2 = (String(j.error).match(/\b(429|401|402|403|400|404|408|500|502|503|504)\b/) || [])[1];
                                if (typeof onDone === 'function') { try { onDone(j); } catch (e) {} }
                                // 【2026-10-01 审核补修】同聚合路径：解析不到码时兜底透传真实 res.status，不硬编码 502。
                                return { ok: false, status: _stRp2 ? parseInt(_stRp2, 10) : res.status, error: j.error, data: { error: { message: j.error } } };
                            }
                            // 【太空舱补字·朱峰 relay 聚合路径 2026-10 修复】
                            // relay-proxy 返回的是聚合 JSON（非 SSE），不进下方逐块解析循环，
                            // 导致走朱峰线路时太空舱收不到任何 zf:llm-chunk → 舷窗全黑看不到文字。
                            // 这里把聚合结果里的真实文本（思考 reasoning_content + 正文 content）
                            // 按小片段用 setTimeout 链式模拟流式广播，驱动太空舱数字雨滚动。
                            try {
                                var _msgRp = (j && j.choices && j.choices[0] && j.choices[0].message) || {};
                                var _segRp = [];
                                if (_msgRp.reasoning_content) _segRp.push(String(_msgRp.reasoning_content));
                                if (_msgRp.content) _segRp.push(String(_msgRp.content));
                                var _fullRp = _segRp.join('\n');
                                var _bidRp = (payload && payload._box_id) ? String(payload._box_id) : '';
                                if (_fullRp && _fullRp.length >= 2 &&
                                    typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' &&
                                    typeof CustomEvent === 'function') {
                                    var _stepRp = 12, _ipRp = 0;
                                    var _fireRp = function () {
                                        if (_ipRp >= _fullRp.length) return;
                                        var _sRp = _fullRp.slice(_ipRp, _ipRp + _stepRp);
                                        _ipRp += _stepRp;
                                        try {
                                            window.dispatchEvent(new CustomEvent('zf:llm-chunk', {
                                                detail: { content: _sRp, boxId: _bidRp, t: Date.now() }
                                            }));
                                        } catch (e2) {}
                                        setTimeout(_fireRp, 30);
                                    };
                                    _fireRp();
                                }
                            } catch (e) { }
                            if (typeof onDone === 'function') { try { onDone(j); } catch (e) {} }
                            return { ok: res.ok, status: res.status, data: j };
                        });
                    });
                }
            }
        } catch (e) { console.warn('[DB] relay-proxy stream redirect failed, fallback', e); }
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
        // 【重试幂等 2026-09-10】调用方（Agent 循环）指定的池轮次 id：同一逻辑请求的重试
        // 全部复用同一 id，服务端幂等/让位语义靠它识别"重投"与"新请求"（防互杀风暴的关键）
        if (payload && typeof payload === 'object' && payload._pool_turn_id) {
            body._turn_id = String(payload._pool_turn_id);
            try { delete payload._pool_turn_id; } catch (e) {}   // 不随 _body 发给上游
        }
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
                    // 【真实 token 全局流事件】把每个真实增量广播成 window 事件，
                    // 供太空舱等可视化组件订阅——以端口/输出流源头为准，而非按对话框 DOM 抓取。
                    try {
                        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                            window.dispatchEvent(new CustomEvent('zf:llm-chunk', {
                                detail: {
                                    content: delta.content,
                                    boxId: (payload && payload._box_id) ? String(payload._box_id) : '',
                                    t: Date.now()
                                }
                            }));
                        DB._zfIdle.mark();
                        }
                    } catch (e) {}
                }
                /* 【太空舱补字】思考(reasoning)增量同样广播：GLM 等思考模型长思考阶段 content 为空，
                   只广播 content 会导致太空舱整个思考期舷窗全黑。改为把 reasoning 增量也汇入字符流。 */
                if (acc.reasoning) {
                    var _rs = acc._reasonSent || 0;
                    if (acc.reasoning.length > _rs) {
                        acc._reasonSent = acc.reasoning.length;
                        try {
                            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                                window.dispatchEvent(new CustomEvent('zf:llm-chunk', {
                                    detail: {
                                        content: acc.reasoning.slice(_rs),
                                        boxId: (payload && payload._box_id) ? String(payload._box_id) : '',
                                        reasoning: true,
                                        t: Date.now()
                                    }
                                }));
                            }
                        } catch (e) {}
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
                        // 【停顿期预取】分片 arguments 累积中，尝试每片解析（完整 JSON 才成功）
                        try {
                            var _pf = acc.tool_calls[idx].function;
                            if (_pf.name && _pf.arguments) {
                                var _pa = null;
                                try { _pa = JSON.parse(_pf.arguments); } catch (_pe3) { _pa = null; }
                                if (_pa) DB._zfPrefetch.feed(_pf.name, _pa);
                            }
                        } catch (_pe4) {}
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

        // ===== 对话池托管（chat_pool v1.0）：池可用走托管+断点续读；null 回退旧直连 =====
        return DB._poolProxyStreamFlow(body, signal, onChunk, onDone).then(function(poolRes) {
            if (poolRes !== null) return poolRes;
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
        });
    },

    // ===== 对话池（chat_pool v1.0）：请求生命周期托管 + 断点续读 =====
    // 池不可用/未开启/引擎不支持时一律返回 null，调用方原样走旧 /api/proxy(_stream) 直连路径。
    // 协议：POST /api/chat-pool/chat 拿 slot/turn → GET /slot/{id}/events?cursor=N&turn_id= 订阅；
    //       断线带游标自动重连续读；停止（signal abort）→ POST /slot/{id}/cancel（池内无孤儿请求）。
    _poolCfg: null,
    _poolCfgAt: 0,

    _poolProbe: function() {
        // 60s 缓存探测池开关；失败视为不可用（走旧路径）
        var now = Date.now();
        if (DB._poolCfg && (now - DB._poolCfgAt) < 60000) {
            return Promise.resolve(DB._poolCfg && DB._poolCfg.enabled ? DB._poolCfg : null);
        }
        return fetch(DB.BASE_URL + '/api/chat-pool/config').then(function(r) { return r.json(); }).then(function(c) {
            DB._poolCfg = (c && typeof c === 'object') ? c : { enabled: false };
            DB._poolCfgAt = Date.now();
            return DB._poolCfg.enabled ? DB._poolCfg : null;
        }).catch(function() {
            DB._poolCfg = { enabled: false };
            DB._poolCfgAt = Date.now();
            return null;
        });
    },

    _poolTurnId: function() {
        return 'pt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    },

    _poolCancel: function(slotId, turnId) {
        // fire-and-forget 停止池内 Turn（防孤儿请求继续占上游）
        try {
            fetch(DB.BASE_URL + '/api/chat-pool/slot/' + encodeURIComponent(slotId) + '/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turn_id: turnId })
            }).catch(function() {});
        } catch (e) {}
    },

    _poolSubscribe: function(slotId, turnId, cursor, handlers) {
        // 订阅槽位事件流（SSE），传输断开带游标自动重连，直到 done 事件。
        // handlers: { onEvent({event, data}), signal }
        // resolve: done 事件对象；reject: AbortError（用户停止）/ Error（不可恢复）
        return new Promise(function(resolve, reject) {
            var lastSeq = cursor || 0;
            var attempts = 0;
            var settled = false;
            function finish(fn, arg) {
                if (settled) return;
                settled = true;
                fn(arg);
            }
            function checkAbort() {
                if (handlers.signal && handlers.signal.aborted) {
                    DB._poolCancel(slotId, turnId);
                    finish(reject, new DOMException('用户取消了请求', 'AbortError'));
                    return true;
                }
                return false;
            }
            function attempt() {
                if (settled) return;
                if (checkAbort()) return;
                fetch(DB.BASE_URL + '/api/chat-pool/slot/' + encodeURIComponent(slotId) +
                      '/events?cursor=' + lastSeq + '&turn_id=' + encodeURIComponent(turnId))
                    .then(function(res) {
                        if (res.status === 404) { attempts++; if (attempts <= 5) { /* 服务器重启恢复期：槽位重建前短暂重试（约5秒），恢复续跑后原游标续播；旧slot已消失则快速回退 */ setTimeout(attempt, 1000); return; } throw { fatal: true, msg: 'slot not found' }; }
                        if (!res.ok || !res.body || typeof res.body.getReader !== 'function') {
                            throw { retry: true, msg: 'events HTTP ' + res.status };
                        }
                        var reader = res.body.getReader();
                        var decoder = new TextDecoder('utf-8');
                        var buf = '';
                        var curEvent = '';
                        function pump() {
                            if (settled) { try { reader.cancel(); } catch (e) {} return; }
                            return reader.read().then(function(r) {
                                if (settled) return;
                                if (checkAbort()) { try { reader.cancel(); } catch (e) {} return; }
                                if (r.done) throw { retry: true, msg: 'stream end' };
                                buf += decoder.decode(r.value, { stream: true });
                                var nl;
                                while ((nl = buf.indexOf('\n')) >= 0) {
                                    var line = buf.slice(0, nl).replace(/\r/g, '');
                                    buf = buf.slice(nl + 1);
                                    if (line.indexOf('event:') === 0) { curEvent = line.slice(6).trim(); continue; }
                                    if (line.indexOf('data:') !== 0) continue;
                                    var payloadStr = line.slice(5).trim();
                                    if (!payloadStr) continue;
                                    var ev = null;
                                    try { ev = JSON.parse(payloadStr); } catch (e) { continue; }
                                    if (ev && typeof ev.seq === 'number' && ev.seq > lastSeq) lastSeq = ev.seq;
                                    if (curEvent === 'done') {
                                        finish(resolve, ev);
                                        try { reader.cancel(); } catch (e) {}
                                        return;
                                    }
                                    if (curEvent !== '' && typeof handlers.onEvent === 'function') {
                                        try {
                                            handlers.onEvent({ event: curEvent, data: ev });
                                        } catch (e) {
                                            // onEvent 抛错（如上游失败）= 终态，不重连
                                            try { reader.cancel(); } catch (e2) {}
                                            finish(reject, e);
                                            return;
                                        }
                                    }
                                }
                                return pump();
                            });
                        }
                        return pump();
                    })
                    .catch(function(err) {
                        if (settled) return;
                        if (err && err.name === 'AbortError') { finish(reject, err); return; }
                        if (err && err.fatal) { finish(reject, new Error('chat-pool: ' + err.msg)); return; }
                        // 传输断：Turn 未结束 → 退避重连（游标续读，回复不丢字）
                        attempts++;
                        var delay = Math.min(10000, 1500 * Math.pow(1.5, Math.min(attempts, 8)));
                        if (attempts > 40) {
                            finish(reject, new Error('chat-pool 订阅重连耗尽'));
                            return;
                        }
                        setTimeout(attempt, delay);
                    });
            }
            attempt();
        });
    },

    _poolProxyFlow: function(body, signal) {
        // 非流式（对应旧 /api/proxy）：resolve 旧同形 JSON（ok:false 也 resolve，调用方自行判断）
        var slotId = null, turnId = null;
        return DB._poolProbe().then(function(cfg) {
            if (!cfg) return null;
            turnId = body._turn_id || DB._poolTurnId();   // 调用方带 id（重试幂等重投）则复用，不铸造新 Turn
            body._turn_id = turnId;
            return fetch(DB.BASE_URL + '/api/chat-pool/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: signal || undefined
            }).then(function(r) {
                if (r.status === 404) return { fallback: true };   // 服务器未重启（无池路由）→ 旧路径
                return _safeJson(r);
            });
        }).then(function(start) {
            if (start === null) return null;
            if (start.fallback) return null;
            if (!start.ok && start.superseded) {
                // 【让位 2026-09-10】老代次 Turn 重投撞上更新的 Turn：安静退出，
                // 不回退旧直连路径（否则僵尸循环借直连复活）
                var _se = new Error('chat-pool: superseded');
                _se._poolSuperseded = true;
                throw _se;
            }
            if (!start.ok) {
                // 池端参数错误（对齐旧形状 resolve）
                return { ok: false, status: start.status || 400, error: start.error || 'chat-pool submit failed', data: null };
            }
            slotId = start.slot_id;
            turnId = start.turn_id || turnId;
            var finalResult = null;
            return DB._poolSubscribe(slotId, turnId, 0, {
                signal: signal,
                onEvent: function(ev) {
                    if (ev.event === 'result') finalResult = ev.data ? ev.data.result : null;
                }
            }).then(function(done) {
                if (finalResult) return finalResult;
                if (done && (done.state === 'superseded' || done.superseded)) {
                    // 【让位】本 Turn 已被同框更新的 Turn 取代：安静退出，绝不重试
                    var _se2 = new Error('chat-pool: superseded');
                    _se2._poolSuperseded = true;
                    throw _se2;
                }
                if (done && done.state === 'cancelled') {
                    // 【2026-10 修复】pool 权威取消（done.state=cancelled）：打 _poolCancelled 标记，
                    // 供 loop 的 catch 区分「服务端已把本 Turn 判死」与「本地内部超时误 abort」。
                    // 旧行为：排队续发会复位 chat._stopped，于是这里抛的 AbortError 被 loop 当成
                    // 「意外超时」走自动重试，并重投同一个已 cancelled 的 _poolTurnId → 秒级空转死循环
                    // （abort-unexpected 每 3s 刷一次、depth 固定）。标记后 loop 安静收尾，绝不重投死 Turn。
                    var _pcancel = new DOMException('用户取消了请求', 'AbortError');
                    _pcancel._poolCancelled = true;
                    throw _pcancel;
                }
                return { ok: false, status: 0, error: 'chat-pool: turn ended without result (' + ((done && done.state) || '?') + ')', data: null };
            });
        }).catch(function(err) {
            if (err && err.name === 'AbortError') throw err;
            if (err && err._poolSuperseded) throw err;   // 让位信号原样上抛：不取消不回退（Turn 已死，回退=僵尸借直连复活）
            // 池链路异常：取消池内轮次防孤儿，然后回退旧路径
            if (slotId && turnId) DB._poolCancel(slotId, turnId);
            console.warn('[DB] chat-pool 托管异常，回退旧代理:', (err && err.message) || err);
            return null;
        });
    },

    _poolProxyStreamFlow: function(body, signal, onChunk, onDone) {
        // 流式（对应旧 /api/proxy_stream）：chunk 事件为上游原始 SSE 行 → 与旧路径同款累加/聚合
        var slotId = null, turnId = null;
        var acc = { content: '', reasoning: '', tool_calls: {}, finish_reason: null };
        var REASONING_KEYS = ['reasoning_content', 'reasoning', 'thinking', 'thought'];
        var chunksSeen = 0;
        var streamFinal = null;   // 上游非 SSE 时池端包好的聚合结果

        function buildFinal() {
            var message = { role: 'assistant', content: acc.content };
            if (acc.reasoning) message.reasoning_content = acc.reasoning;
            var keys = Object.keys(acc.tool_calls);
            if (keys.length) {
                message.tool_calls = keys.sort(function(a, b) { return a - b; }).map(function(k) { return acc.tool_calls[k]; });
            }
            return {
                id: 'chatcmpl-stream',
                _sse_aggregated: true,
                object: 'chat.completion',
                choices: [{ index: 0, message: message, finish_reason: acc.finish_reason || 'stop' }],
                _truncated: acc.finish_reason === 'length'
            };
        }

        function feedLine(text) {
            // text = 上游 SSE 原始行（'data: {...}' 等）
            if (!text) return;
            var line = String(text).replace(/\r/g, '');
            if (line.indexOf('data:') !== 0) return;
            var payloadStr = line.slice(5).trim();
            if (!payloadStr || payloadStr === '[DONE]') return;
            var obj = null;
            try { obj = JSON.parse(payloadStr); } catch (e) { return; }
            if (!obj || typeof obj !== 'object' || !Array.isArray(obj.choices)) return;
            chunksSeen++;
            for (var i = 0; i < obj.choices.length; i++) {
                var c = obj.choices[i];
                if (!c || typeof c !== 'object') continue;
                if (c.finish_reason) acc.finish_reason = c.finish_reason;
                var delta = c.delta || c.message || {};
                if (typeof delta !== 'object') continue;
                for (var k = 0; k < REASONING_KEYS.length; k++) {
                    if (delta[REASONING_KEYS[k]]) acc.reasoning += delta[REASONING_KEYS[k]];
                }
                if (delta.content) {
                    acc.content += delta.content;
                    if (typeof onChunk === 'function') { try { onChunk({ content: delta.content, reasoning: '' }); } catch (e) {} }
                    // 【真实 token 全局流事件】对话池托管路径同样广播（与直连路径 L631 口径一致），
                    // 否则走对话池时太空舱收不到任何真实 token → 舷窗空白看不到文字。
                    try {
                        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                            window.dispatchEvent(new CustomEvent('zf:llm-chunk', {
                                detail: {
                                    content: delta.content,
                                    boxId: (body && body._box_id) ? String(body._box_id) : '',
                                    t: Date.now()
                                }
                            }));
                            DB._zfIdle.mark();
                        }
                    } catch (e) {}
                }
                /* 【太空舱补字·对话池路径】思考(reasoning)增量同样广播，口径与直连路径一致： */
                if (acc.reasoning) {
                    var _rs2 = acc._reasonSent || 0;
                    if (acc.reasoning.length > _rs2) {
                        acc._reasonSent = acc.reasoning.length;
                        try {
                            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                                window.dispatchEvent(new CustomEvent('zf:llm-chunk', {
                                    detail: {
                                        content: acc.reasoning.slice(_rs2),
                                        boxId: (body && body._box_id) ? String(body._box_id) : '',
                                        reasoning: true,
                                        t: Date.now()
                                    }
                                }));
                            }
                        } catch (e) {}
                    }
                }
                if (acc.reasoning && typeof onChunk === 'function') {
                    try { onChunk({ content: '', reasoning: acc.reasoning }); } catch (e) {}
                }
                var tc = delta.tool_calls;
                if (tc && Array.isArray(tc)) {
                    for (var j = 0; j < tc.length; j++) {
                        var t = tc[j];
                        var idx = (t.index !== undefined) ? t.index : 0;
                        if (!acc.tool_calls[idx]) acc.tool_calls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                        if (t.id) acc.tool_calls[idx].id = t.id;
                        if (t.type) acc.tool_calls[idx].type = t.type;
                        var fn = t.function || {};
                        if (fn.name) acc.tool_calls[idx].function.name += fn.name;
                        if (fn.arguments) acc.tool_calls[idx].function.arguments += fn.arguments;
                        // 【停顿期预取】分片 arguments 累积中，尝试每片解析（完整 JSON 才成功）
                        try {
                            var _pf = acc.tool_calls[idx].function;
                            if (_pf.name && _pf.arguments) {
                                var _pa = null;
                                try { _pa = JSON.parse(_pf.arguments); } catch (_pe3) { _pa = null; }
                                if (_pa) DB._zfPrefetch.feed(_pf.name, _pa);
                            }
                        } catch (_pe4) {}
                    }
                }
            }
        }

        return DB._poolProbe().then(function(cfg) {
            if (!cfg) return null;
            turnId = body._turn_id || DB._poolTurnId();   // 调用方带 id（重试幂等重投）则复用，不铸造新 Turn
            body._turn_id = turnId;
            return fetch(DB.BASE_URL + '/api/chat-pool/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: signal || undefined
            }).then(function(r) {
                if (r.status === 404) return { fallback: true };
                return _safeJson(r);
            });
        }).then(function(start) {
            if (start === null) return null;
            if (start.fallback) return null;
            if (!start.ok && start.superseded) {
                // 【让位 2026-09-10】老代次 Turn 重投撞上更新的 Turn：安静退出，不回退旧路径
                var _se3 = new Error('chat-pool: superseded');
                _se3._poolSuperseded = true;
                throw _se3;
            }
            if (!start.ok) {
                throw new Error('【流式代理】' + (start.error || 'chat-pool submit failed'));
            }
            slotId = start.slot_id;
            turnId = start.turn_id || turnId;
            return DB._poolSubscribe(slotId, turnId, 0, {
                signal: signal,
                onEvent: function(ev) {
                    if (ev.event === 'chunk') {
                        feedLine(ev.data && ev.data.text);
                    } else if (ev.event === 'result') {
                        streamFinal = ev.data ? ev.data.result : null;
                    } else if (ev.event === 'error') {
                        // 与旧路径 error 事件同语义；已有增量则按旧路径"部分内容成功"处理
                        if (chunksSeen > 0) return;
                        throw new Error('【流式代理】' + ((ev.data && ev.data.error) || '上游请求失败'));
                    }
                }
            }).then(function(done) {
                if (done && (done.state === 'superseded' || done.superseded)) {
                    // 【让位】本 Turn 已被同框更新的 Turn 取代：安静退出（流式已收的增量一并放弃，
                    // 不给接管的框渲染半截回复）；绝不重试、不回退
                    var _se4 = new Error('chat-pool: superseded');
                    _se4._poolSuperseded = true;
                    throw _se4;
                }
                if (done && done.state === 'cancelled') {
                    // 【2026-10 修复】pool 权威取消（done.state=cancelled）：打 _poolCancelled 标记，
                    // 供 loop 的 catch 区分「服务端已把本 Turn 判死」与「本地内部超时误 abort」。
                    // 旧行为：排队续发会复位 chat._stopped，于是这里抛的 AbortError 被 loop 当成
                    // 「意外超时」走自动重试，并重投同一个已 cancelled 的 _poolTurnId → 秒级空转死循环
                    // （abort-unexpected 每 3s 刷一次、depth 固定）。标记后 loop 安静收尾，绝不重投死 Turn。
                    var _pcancel = new DOMException('用户取消了请求', 'AbortError');
                    _pcancel._poolCancelled = true;
                    throw _pcancel;
                }
                if (done && done.state === 'gone') {
                    if (chunksSeen > 0) {
                        var d0 = buildFinal();
                        if (onDone) { try { onDone(d0); } catch (e) {} }
                        return { ok: true, status: 200, data: d0 };
                    }
                    throw new Error('【流式代理】turn gone');
                }
                if (streamFinal) {
                    if (streamFinal.ok === false) throw new Error('【流式代理】' + (streamFinal.error || '上游请求失败'));
                    if (onDone) { try { onDone(streamFinal.data); } catch (e) {} }
                    return { ok: true, status: 200, data: streamFinal.data };
                }
                var data = buildFinal();
                if (onDone) { try { onDone(data); } catch (e) {} }
                return { ok: true, status: 200, data: data };
            });
        }).catch(function(err) {
            if (err && err.name === 'AbortError') throw err;
            if (err && err._poolSuperseded) throw err;   // 让位信号原样上抛：不取消不回退
            var msg = (err && err.message) || String(err);
            if (msg.indexOf('【流式代理】') === 0) throw err;   // 上游失败：走 loop-core 的 DB.proxy 回退（与旧路径一致）
            // 纯池链路异常：取消池内轮次防孤儿，回退旧流式路径（零增量，不会重复渲染）
            if (slotId && turnId) DB._poolCancel(slotId, turnId);
            console.warn('[DB] chat-pool 流式托管异常，回退旧流式代理:', msg);
            return null;
        });
    }
};

// 页面加载即初始化 loop_mode
if (typeof window !== 'undefined') { try { DB.init(); } catch(e) {} }
