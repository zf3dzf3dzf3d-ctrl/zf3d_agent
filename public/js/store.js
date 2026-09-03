// ========== store.js - 前端存储层（纯 SQLite，无 localStorage JSON） ==========
// v4.0.6 — 添加 projects 支持
// 内存缓存即时可用，SQLite 异步写入，智能防抖按场景控制频率

var Store = {
    data: null,
    dbOnline: false,

    // ===== 初始化：内存数据结构 + 异步从 SQLite 加载 =====
    load: function() {
        // 1. 先建空内存结构（保证页面即时可用）
        this.data = {
            version: 1,
            canvas: { x: 0, y: 0, scale: 1 },
            chatBoxes: [],
            messages: {},
            logs: [],
            projects: []
        };
        // 2. 异步从 SQLite 加载（不阻塞渲染）
        this._checkDB();
        return this.data;
    },

    // 检测后台 + 异步加载已有数据
    _checkDB: function() {
        var self = this;
        if (typeof DB === 'undefined') return;
        DB.checkOnline().then(function(online) {
            self.dbOnline = !!online;
            if (online) {
                self._syncFromDB();
            }
        }).catch(function(e) {
            self.dbOnline = false;
            console.warn('[Store] database availability check failed:', e);
        });
    },

    // 从 SQLite 异步加载数据到内存
    _syncFromDB: function() {
        var self = this;

        // 画布视口
        DB.getCanvasView().then(function(res) {
            if (res.ok && res.data) {
                self.data.canvas = { x: res.data.x || 0, y: res.data.y || 0, scale: res.data.scale || 1 };
                // 恢复画布视口 — 通过 canvasSetView 同步更新闭包 view 变量，否则拖拽时会跳到 (0,0)
                if (typeof App !== 'undefined' && App.canvasSetView) {
                    App.canvasSetView(self.data.canvas.x, self.data.canvas.y, self.data.canvas.scale);
                } else {
                    // App 尚未就绪时的 fallback
                    var content = document.getElementById('canvasContent');
                    if (content) {
                        content.style.transform = 'translate(' + self.data.canvas.x + 'px,' + self.data.canvas.y + 'px) scale(' + self.data.canvas.scale + ')';
                        var coord = document.getElementById('canvasCoord');
                        if (coord) coord.textContent = 'x:' + Math.round(self.data.canvas.x) + ' · y:' + Math.round(self.data.canvas.y) + ' · ' + Math.round(self.data.canvas.scale * 100) + '%';
                    }
                }
            }
        }).catch(function(e) { console.warn('[Store] canvas restore failed:', e); });

        // 恢复历史日志，确保完整调试报告跨页面刷新仍然完整
        if (typeof DB !== 'undefined' && DB.getLogs) {
            DB.getLogs(2000).then(function(res) {
                if (res && res.ok && Array.isArray(res.data)) {
                    self.data.logs = res.data.reverse().map(function(log) {
                        return {
                            ts: log.ts,
                            level: log.level || 'info',
                            boxId: log.box_id || '',
                            action: log.action || '',
                            detail: log.detail || ''
                        };
                    });
                }
            }).catch(function(e) { console.warn('[Store] log restore failed:', e); });
        }

        // 加载项目列表
        if (typeof DB !== 'undefined' && DB.getProjects) {
            DB.getProjects().then(function(res) {
                if (res && res.ok && res.data) {
                    self.data.projects = res.data;
                }
            }).catch(function(e) { console.warn('[Store] project restore failed:', e); });
        }

        // 节点（对话框）
        DB.getNodes().then(function(res) {
            var nodes = (res && res.ok && res.data) ? res.data : [];
            if (nodes.length > 0) {
                nodes.forEach(function(node) {
                    self.data.chatBoxes.push({
                        id: node.id,
                        title: node.title || '',
                        modelId: node.model_id || '',
                        modelIdOverride: node.model_id_override || '',
                        reasoningEffort: node.reasoning_effort || '',
                        engine: node.engine || '',
                        x: node.x, y: node.y,
                        w: node.w, h: node.h,
                        collapsed: !!node.collapsed,
                        z: node.z_index,
                        scrollPos: node.scroll_pos || 0,
                        projectId: node.project_id || null,
                        createdAt: node.created_at,
                        sessionTotalTokens: node.session_total_tokens || 0,
                        sessionTotalApiCalls: node.session_total_api_calls || 0,
                        sessionTotalDuration: node.session_total_duration || 0,
                        sessionTotalPromptTokens: node.session_total_prompt_tokens || 0,
                        sessionTotalCompletionTokens: node.session_total_completion_tokens || 0,
                        sessionTotalCacheHitTokens: node.session_total_cache_hit_tokens || 0,
                        sessionTotalCacheMissTokens: node.session_total_cache_miss_tokens || 0
                    });
                });
            }
            // 数据加载完后恢复 UI（等待所有消息加载完成）；空节点也要触发恢复收尾
            self._onDBLoaded();
        }).catch(function() {
            self._onDBLoaded();
        });
    },

    // DB 数据加载完成回调 — 通知 App 恢复界面（修复：等消息全部加载完再恢复 UI）
    _onDBLoaded: function() {
        var self = this;
        var boxIds = this.data.chatBoxes.map(function(b) { return b.id; });

        // 收集每个对话框消息加载的 Promise，确保全部完成后再恢复 UI
        var boxList = this.data.chatBoxes;
        var promises = boxList.map(function(box) {
            var boxId = box.id;
            var createdAt = box.createdAt || 0;
            return DB.getChatHistory(boxId).then(function(res) {
                if (res.ok && res.data) {
                    var msgs = res.data.map(function(m) {
                        return { role: m.role, content: m.content, ts: m.created_at, type: 'text' };
                    });
                    // 【修复】过滤同名历史会话残留：对话框 id(cbN) 会循环复用，
                    // 归档表中可能存在旧的同 id 会话消息。只保留本会话的消息
                    //（created_at >= 对话框创建时间；缺时间戳或无 createdAt 时不过滤，保持兼容）
                    if (createdAt > 0) {
                        var filtered = msgs.filter(function(m) {
                            return !m.ts || m.ts >= createdAt;
                        });
                        if (filtered.length) msgs = filtered;
                        // 全被过滤说明该框消息尚未落库/全部为旧残留，保留空即可
                    }
                    self.data.messages[boxId] = msgs;
                }
            }).catch(function(e) {
                console.warn('[Store] chat history restore failed:', boxId, e);
            });
        });

        // 等待所有消息加载完成后，一次性恢复 UI
        Promise.all(promises).then(function() {
            if (typeof App !== 'undefined') {
                // 先把计数顶到 DB 已恢复的最大编号+1，确保后续新建框不与历史 session 撞号
                if (App.syncChatCounter) App.syncChatCounter();
                if (App.restoreSession) {
                    
                    App.restoreSession();
                }
            }
        });
    },

    // ===== 智能防抖写入 SQLite =====
    // 不同操作用不同间隔，避免频繁无意义写入
    // 兼容旧调用：数据已在内存中，SQLite 按操作分别写入，此处无需再做整存
    _saveLocal: function() {},

    _timers: {},
    _debounce: function(key, fn, delay) {
        if (this._timers[key]) clearTimeout(this._timers[key]);
        var self = this;
        this._timers[key] = setTimeout(function() {
            self._timers[key] = null;
            fn.call(self);
        }, delay);
    },

    // 关闭页面前立即刷入所有待写数据
    // 使用 sendBeacon 确保浏览器关闭前请求能发出（fetch 在 beforeunload 中不可靠）
    flush: function() {
        // 清除所有定时器，立即执行
        var self = this;
        Object.keys(this._timers).forEach(function(key) {
            if (self._timers[key]) {
                clearTimeout(self._timers[key]);
                self._timers[key] = null;
            }
        });
        // 立即刷入所有数据（防抖被清除的待写数据不会丢失）
        if (this.dbOnline) {
            DB.saveCanvasView(this.data.canvas.x, this.data.canvas.y, this.data.canvas.scale).catch(function() {});
            // 刷入所有对话框最新状态（含 modelId / modelIdOverride / reasoningEffort，防止关闭页面时丢失）
            if (this.data && this.data.chatBoxes) {
                this.data.chatBoxes.forEach(function(box) {
                    // 优先用 sendBeacon（beforeunload 中更可靠），降级到 fetch
                    var url = (DB.BASE_URL || '') + DB.API_PREFIX + '/nodes';
                    var payload = JSON.stringify(box);
                    var sent = false;
                    if (navigator.sendBeacon) {
                        try {
                            var blob = new Blob([payload], { type: 'application/json' });
                            sent = navigator.sendBeacon(url, blob);
                        } catch (e) {}
                    }
                    if (!sent) {
                        DB.saveNode(box).catch(function(e) {
                            console.warn('[Store] node flush failed:', box.id, e);
                        });
                    }
                });
            }
        }
    },

    // ===== 画布状态（800ms 防抖，拖拽/缩放结束时才写） =====
    saveCanvas: function(x, y, scale) {
        if (!this.data) this.load();
        this.data.canvas = { x: x, y: y, scale: scale };
        if (this.dbOnline && typeof DB !== 'undefined') {
            this._debounce('canvas', function() {
                DB.saveCanvasView(x, y, scale).catch(function() {});
            }, 800);
        }
    },

    getCanvas: function() {
        if (!this.data) this.load();
        return this.data.canvas;
    },

    // ===== 对话框 =====
    // 拖拽/缩放结束 → 500ms 防抖写 SQLite
    // flushNow=true 时立即写入（用于模型/模型ID/思考强度等关键设置变更）
    saveChatBox: function(chat, flushNow = false) {
        if (!this.data) this.load();
        var el = chat.el;
        // el 缺失时（如删除项目解绑节点），从已存记录回填字段，避免读取 null 报错
        var prev = null;
        if (!el) {
            for (var i = 0; i < this.data.chatBoxes.length; i++) {
                if (this.data.chatBoxes[i].id === chat.id) { prev = this.data.chatBoxes[i]; break; }
            }
        }
        var entry = {
            id: chat.id,
            title: el ? (el.querySelector('.title') ? el.querySelector('.title').textContent : '') : (chat.title || (prev ? prev.title : '') || ''),
            modelId: chat.modelId || (prev ? prev.modelId : '') || '',
            x: el ? (parseInt(el.style.left) || 0) : (chat.x != null ? chat.x : (prev ? prev.x : 0) || 0),
            y: el ? (parseInt(el.style.top) || 0) : (chat.y != null ? chat.y : (prev ? prev.y : 0) || 0),
            w: el ? (el.offsetWidth || 360) : (chat.w != null ? chat.w : (prev ? prev.w : 0) || 360),
            h: el ? (el.offsetHeight || 480) : (chat.h != null ? chat.h : (prev ? prev.h : 0) || 480),
            collapsed: el ? el.classList.contains('collapsed') : (chat.collapsed != null ? chat.collapsed : (prev ? prev.collapsed : false)),
            z: el ? (parseInt(el.style.zIndex) || 50) : (chat.z != null ? chat.z : (prev ? prev.z : 0) || 50),
            scrollPos: (function() {
                if (el) {
                    var body = el.querySelector('.chatbox-body');
                    return body ? body.scrollTop : 0;
                }
                return (chat.scrollPos != null ? chat.scrollPos : (prev ? prev.scrollPos : 0) || 0);
            })(),
            projectId: chat.projectId || null,
            toolCategory: (typeof Tools !== 'undefined' && Tools.chatCategories && Tools.chatCategories[chat.id]) || chat.toolCategory || null,
            modelIdOverride: chat._modelIdOverride || (prev ? (prev.modelIdOverride || '') : '') || '',
            reasoningEffort: chat._reasoningEffort || (prev ? (prev.reasoningEffort || '') : '') || '',
            engine: chat._engine || (prev ? (prev.engine || '') : '') || '',
            createdAt: chat.createdAt || (prev ? prev.createdAt : undefined) || Date.now(),
            // ===== 会话级累计统计持久化（整个对话历史累计，跨刷新保留） =====
            sessionTotalTokens: Number(chat._sessionTotalTokens) || (prev ? (prev.sessionTotalTokens || 0) : 0),
            sessionTotalApiCalls: Number(chat._sessionTotalApiCalls) || (prev ? (prev.sessionTotalApiCalls || 0) : 0),
            sessionTotalDuration: Number(chat._sessionTotalDuration) || (prev ? (prev.sessionTotalDuration || 0) : 0),
            sessionTotalPromptTokens: Number(chat._sessionTotalPromptTokens) || (prev ? (prev.sessionTotalPromptTokens || 0) : 0),
            sessionTotalCompletionTokens: Number(chat._sessionTotalCompletionTokens) || (prev ? (prev.sessionTotalCompletionTokens || 0) : 0),
            sessionTotalCacheHitTokens: Number(chat._sessionTotalCacheHitTokens) || (prev ? (prev.sessionTotalCacheHitTokens || 0) : 0),
            sessionTotalCacheMissTokens: Number(chat._sessionTotalCacheMissTokens) || (prev ? (prev.sessionTotalCacheMissTokens || 0) : 0)
        };
        // 更新内存
        var found = false;
        for (var i = 0; i < this.data.chatBoxes.length; i++) {
            if (this.data.chatBoxes[i].id === chat.id) {
                // 保留已有的 projectId
                if (!entry.projectId && this.data.chatBoxes[i].projectId) {
                    entry.projectId = this.data.chatBoxes[i].projectId;
                }
                this.data.chatBoxes[i] = entry;
                found = true;
                break;
            }
        }
        if (!found) this.data.chatBoxes.push(entry);

        // SQLite — 按节点 ID 防抖，同框连续拖拽只写最后一次
        // flushNow=true 时立即写入，确保模型设置不因关闭页面而丢失
        if (this.dbOnline && typeof DB !== 'undefined') {
            var boxKey = 'box_' + chat.id;
            if (flushNow) {
                if (this._timers[boxKey]) { clearTimeout(this._timers[boxKey]); this._timers[boxKey] = null; }
                DB.saveNode(entry).catch(function() {});
            } else {
                this._debounce(boxKey, function() {
                    DB.saveNode(entry).catch(function() {});
                }, 500);
            }
        }
    },

    removeChatBox: function(boxId) {
        if (!this.data) this.load();
        this.data.chatBoxes = this.data.chatBoxes.filter(function(b) { return b.id !== boxId; });
        delete this.data.messages[boxId];
        // 取消该框的防抖定时器
        if (this._timers['box_' + boxId]) {
            clearTimeout(this._timers['box_' + boxId]);
            this._timers['box_' + boxId] = null;
        }
        if (this.dbOnline && typeof DB !== 'undefined') {
            DB.deleteNode(boxId).catch(function() {});
            DB.clearChatHistory(boxId).catch(function() {});
        }
    },

    getChatBoxes: function() {
        if (!this.data) this.load();
        return this.data.chatBoxes;
    },

    // ===== 消息（立即写，不防抖 — 用户消息必须可靠持久化） =====
    _lastUserMsgIds: {},
    addMessage: function(boxId, role, content, type, modelId, parentId) {
        if (!this.data) this.load();
        if (!this.data.messages[boxId]) this.data.messages[boxId] = [];
        this.data.messages[boxId].push({
            role: role,
            content: content,
            ts: Date.now(),
            type: type || 'text'
        });
        // SQLite 立即写
        if (this.dbOnline && typeof DB !== 'undefined') {
            var self = this;
            return DB.addChatMessage(boxId, role, content, modelId, parentId).then(function(res) {
                if (role === 'user' && res && res.id) {
                    self._lastUserMsgIds[boxId] = res.id;
                }
            }).catch(function() {});
        }
        return Promise.resolve();
    },

    clearMessages: function(boxId) {
        if (!this.data) this.load();
        this.data.messages[boxId] = [];
        // 清空 parent_id 追踪
        if (this._lastUserMsgIds) delete this._lastUserMsgIds[boxId];
        if (this.dbOnline && typeof DB !== 'undefined') {
            DB.clearChatHistory(boxId).catch(function() {});
        }
    },

    getMessages: function(boxId) {
        if (!this.data) this.load();
        return this.data.messages[boxId] || [];
    },

    // ===== 日志（1s 防抖批处理） =====
    _logBuffer: [],

    addLog: function(level, boxId, action, detail) {
        if (!this.data) this.load();
        this.data.logs.push({
            ts: Date.now(),
            level: level,
            boxId: boxId || '',
            action: action,
            detail: detail || ''
        });
        if (this.data.logs.length > 2000) {
            this.data.logs = this.data.logs.slice(-1000);
        }
        // SQLite — 1s 批处理
        if (this.dbOnline && typeof DB !== 'undefined') {
            this._logBuffer.push({ level: level, boxId: boxId, action: action, detail: detail });
            this._debounce('logs', function() {
                var batch = this._logBuffer;
                this._logBuffer = [];
                batch.forEach(function(log) {
                    DB.addLog(log.level, log.boxId, log.action, log.detail).catch(function() {});
                });
            }, 1000);
        }
    },

    getLogs: function() {
        if (!this.data) this.load();
        return this.data.logs;
    },

    clearLogs: function() {
        if (!this.data) this.load();
        this.data.logs = [];
        this._logBuffer = [];
        if (this.dbOnline && typeof DB !== 'undefined') {
            // 用 DELETE 请求清空 DB 日志
            DB._request('DELETE', '/logs').catch(function() {});
        }
    },

    // ===== 模型配置 =====
    saveModelKey: function(modelId, key) {
        if (this.dbOnline && typeof DB !== 'undefined') {
            DB.kvSet('model_key_' + modelId, key).catch(function() {});
        }
        // 同步到后端 /api/models/config（双源拆分：公开区+private/api_keys.json）
        // 后端 save_models_config 要求 list 包含完整公开字段（displayName/endpoint/modelId 等）
        // 否则 split 出来的 api_keys.json 字段是空。传整份 list 更稳。
        try {
            // 先取服务端最新完整列表，只改当前模型的 key 后整体回写。
            // 旧逻辑用 Store 本地旧副本、且只 POST 单条，会触发后端整体覆盖，
            // 把其它模型及其 visible 状态冲掉 —— 这就是"隐藏后点一下又变回去"的根因。
            fetch('/api/models/config').then(function(res){ return res.json(); }).then(function(cfgData){
                var srvList = (cfgData && cfgData.ok && cfgData.config && Array.isArray(cfgData.config.list)) ? cfgData.config.list : null;
                var baseList;
                if (srvList && srvList.length) {
                    baseList = srvList;
                } else {
                    baseList = [{ modelId: modelId, name: name }];
                }
                var hit = null;
                for (var i = 0; i < baseList.length; i++) {
                    var mm = baseList[i];
                    if (!mm) continue;
                    if (mm.id === modelId || mm.name === name || mm.modelId === modelId) { hit = mm; break; }
                }
                if (!hit) { hit = { modelId: modelId, name: name }; baseList.push(hit); }
                hit.key = (typeof key === 'string') ? key : '';
                hit.name = hit.name || name;
                return fetch('/api/models/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ list: baseList })
                });
            }).then(function(r) {
                if (!r || !r.ok) console.warn('[Store] sync api_keys.json failed');
                else console.log('[Store] sync api_keys.json ok:', name);
            }).catch(function(e) {
                console.warn('[Store] sync api_keys.json failed:', e);
            });
        } catch (e) {
            console.warn('[Store] saveModelKey sync error:', e);
        }
    },

    clearModelKey: function(modelId) {
        if (this.dbOnline && typeof DB !== 'undefined') {
            DB.kvDelete('model_key_' + modelId).catch(function() {});
        }
    },

    // ===== 清空全部 =====
    clearAll: function() {
        this.data = {
            version: 1,
            canvas: { x: 0, y: 0, scale: 1 },
            chatBoxes: [],
            messages: {},
            logs: [],
            projects: []
        };
    }
};
