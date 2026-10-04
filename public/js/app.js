// ========== app.js - 主应用逻辑 ==========
// 朱峰智能体无限智能体 5.0.2
// 多对话框系统：右键创建 · 多模型连通 · 互不干扰
// 说明：改为「合并」而非「整体替换」，保证热更新重载本文件时，
// 其他模块（app-panels.js / app-project.js 等）通过 Object.assign(App, ...) 扩展的方法不丢失。

    var App = App || {};
    Object.assign(App, {
        version: '5.0.2',
        name: '朱峰智能体无限智能体',
        // 【修复】热更新重载 app.js 时保留已有对话数据：
        // Object.assign 会用这里的 [] 覆盖运行中的 App.chatBoxes，
        // 导致界面上明明有对话框、但"排列/小狗守卫"等读到空数组，误报"当前没有对话框"
        chatBoxes: (App.chatBoxes && App.chatBoxes.length) ? App.chatBoxes : [],
        chatCounter: (typeof App.chatCounter === 'number' && App.chatCounter > 0) ? App.chatCounter : 0,
        zCounter: (typeof App.zCounter === 'number' && App.zCounter > 0) ? App.zCounter : 50,
        _closedStack: [],

        init: function() {
            var self = this;
            Theme.init();
            Store.addLog('info', '', 'init', '应用启动 v' + this.version);
            // 关键：Models.load() 是异步的（GET 后端 JSON），必须等它完成后
            // 才能 renderModelList，否则 Models.list 还是空，UI 会显示"尚未配置"。
            Models.load().then(function() {
                self.renderModelList();
                self.updateStatusModelText();
            }).catch(function(err) {
                console.error('[App.init] Models.load 失败:', err);
                self.renderModelList(); // 失败也渲染一次（显示错误态）
            });
            Store.load();
            this.setupCanvas();
            this.setupContextMenu();
            this.setupSettings();
            this.setupLogPanel();
            this.updateStatus();
            this.setupMinimap();
            // restoreSession 由 Store._onDBLoaded() 在 SQLite 数据加载完后异步调用
            // 关闭页面前保存
            window.addEventListener('beforeunload', function() {
                Store.flush();
            });

            // 启动监控轮询器（热重载时扩展模块可能尚未重新挂载）
            if (typeof this._initTaskPanel === 'function') {
                this._initTaskPanel();
            } else {
                var self = this;
                setTimeout(function() {
                    if (typeof self._initTaskPanel === 'function') self._initTaskPanel();
                }, 0);
            }
            if (typeof this._initProjectPanel === 'function') this._initProjectPanel();
            // 【修复 5.0.5】启动时立即恢复上次的活动项目（不等用户打开项目面板），
            // 新建对话自动归入项目、消息上下文注入都能命中
            if (typeof this.initProjectSync === 'function') this.initProjectSync();
            if (typeof this.startMonitorPoll === 'function') this.startMonitorPoll();
            // 启动健康守护（强制开启，保护身体和用眼）
            if (typeof HealthGuard !== 'undefined') {
                HealthGuard.init();
            }
            // AI display
            if (typeof PixelPanel !== 'undefined') {
                PixelPanel.init();
            }
            // 键盘快捷键
            if (typeof this.setupKeyboardShortcuts === 'function') this.setupKeyboardShortcuts();
        },

        // ===== 恢复上次会话 =====
        restoreSession: function() {
            // DB 已上线，重新加载活动项目（以 DB 为准，覆盖 localStorage 缓存）
            if (this._loadActiveProject) this._loadActiveProject();
            
            var saved = Store.data;
            if (!saved || saved.chatBoxes.length === 0) {
                // 【首次启动友好引导】画布上没有任何对话框时，自动新建一个默认对话框，
                // 方便新用户快速了解智能体（正常恢复流程不受影响）
                var self0 = this;
                setTimeout(function() {
                    // 防重入：若热更新等场景下画布已有对话框则跳过
                    if (document.querySelector('.chatbox')) return;
                    var canvasEl = document.getElementById('canvasContent') || document.getElementById('canvasArea');
                    if (!canvasEl || typeof self0.createChatBox !== 'function') return;
                    var r = canvasEl.getBoundingClientRect();
                    var cx = r.left + r.width / 2;
                    var cy = r.top + r.height / 2;
                    // 居中创建一个默认对话框
                    var b1 = self0.createChatBox(cx - 160, cy - 150);
                    if (b1) {
                        self0.hideHint();
                        self0.updateStatus();
                        try { Store.addLog('info', '', 'welcome', '首次启动：已自动创建 1 个默认对话框'); } catch (e) {}
                    }
                }, 300);
                return;
            }

            // 恢复画布视口 — 优先使用上次关闭时保存的位置（Store._syncFromDB 已通过
            // canvasSetView 从 SQLite 恢复），不再强制居中到对话框包围盒中心。
            // 仅当 DB 中没有保存过视口（首次使用）时，才居中到所有对话的包围盒中心。
            var self = this;
            (function() {
                if (!saved.chatBoxes.length) return;
                // 防重入：热更新重复调用 restoreSession 时，对话框已存在则不重置视口
                if (document.querySelector('.chatbox')) return;
                // DB 已恢复过视口则直接使用，不覆盖
                if (saved.canvas && typeof saved.canvas.x === 'number' && typeof saved.canvas.y === 'number') return;
                var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                saved.chatBoxes.forEach(function(sb) {
                    var w = Math.min(sb.w || 320, window.innerWidth * 0.9), h = sb.h || 480;
                    if (sb.x < minX) minX = sb.x;
                    if (sb.y < minY) minY = sb.y;
                    if (sb.x + w > maxX) maxX = sb.x + w;
                    if (sb.y + h > maxY) maxY = sb.y + h;
                });
                var cx = (minX + maxX) / 2;
                var cy = (minY + maxY) / 2;
                // 视口平移量 = 屏幕中心 - 包围盒中心
                var vx = Math.round(window.innerWidth / 2 - cx);
                var vy = Math.round(window.innerHeight / 2 - cy);
                if (self.canvasSetView) {
                    self.canvasSetView(vx, vy, 1);
                } else {
                    var contentEl = document.getElementById('canvasContent');
                    if (contentEl) {
                        contentEl.style.transform = 'translate(' + vx + 'px,' + vy + 'px) scale(1)';
                        var coordEl = document.getElementById('canvasCoord');
                        if (coordEl) coordEl.textContent = 'x:' + vx + ' · y:' + vy + ' · 100%';
                    }
                }
            })();

            // 恢复每个对话框
            var maxZ = 50;
            var skippedCount = 0;
            saved.chatBoxes.forEach(function(sb) {
                // 【防重复】跳过已在 this.chatBoxes 中的对话框（热更新/重复调用 restoreSession 时避免复制）
                var existingChat = self.chatBoxes.find(function(c) { return c.id === sb.id; });
                if (existingChat) {
                    skippedCount++;
                    return;
                }
                // 如果 DOM 元素已存在但 chat 对象不在 this.chatBoxes 中（孤儿 DOM），
                // 移除孤儿 DOM 元素后走正常创建流程，确保 chat 对象被重新注册
                var existingEl = document.getElementById(sb.id);
                if (existingEl) {
                    existingEl.remove();
                }

                var model = sb.modelId ? Models.get(sb.modelId) : null;
                var boxName = model ? model.name : '未选择模型';

                self.chatCounter++;
                var box = document.createElement('div');
                box.className = 'chatbox' + (sb.collapsed ? ' collapsed' : '');
                box.id = sb.id;
                box.style.left = sb.x + 'px';
                box.style.top = sb.y + 'px';
                box.style.width = Math.min(sb.w || 320, window.innerWidth * 0.9) + 'px';
                box.style.height = (sb.h || 480) + 'px';
                box.style.zIndex = sb.z || (++maxZ);

                // 恢复路径也生成分类器（与 createChatBox 一致）
                var restoredCategory = (sb.toolCategory && Tools.categories[sb.toolCategory]) ? sb.toolCategory : '极简';
                // own_tools 引擎：常规分类（极简/编程/写作/流程图等）是朱峰智能体底层独有，
                // 恢复时若停留在常规分类则自动定位到该引擎的专属分类
                try {
                    var _rbEngId = sb._engine || sb.engine || '';
                    if (_rbEngId && typeof DB !== 'undefined' && DB.getEngines) {
                        var _rbEm = DB.getEngines().filter(function (x) { return x.id === _rbEngId; })[0];
                        if (_rbEm && _rbEm.own_tools) {
                            var _rbCatDef = Tools.categories[restoredCategory];
                            if (!_rbCatDef || !_rbCatDef.engineId) {
                                restoredCategory = (window.EngineToolCategories && EngineToolCategories[_rbEngId])
                                    ? EngineToolCategories[_rbEngId] : restoredCategory;
                            }
                        }
                    }
                } catch (e) {}
                Tools.chatCategories[sb.id] = restoredCategory;
                Tools.currentChatId = sb.id;
                Tools.activeCategory = restoredCategory;
                box.innerHTML =
                App.buildChatboxPanels({
                    header: App.buildChatboxHeader({ title: (sb.title && String(sb.title).indexOf('💬 对话') !== 0) ? sb.title : '💬 对话' + self.chatCounter })
                });
                // 底部配置区控件（引擎菜单/分类菜单）统一填充
                App.fillChatboxConfigWidgets(box, { engineId: sb._engine || sb.engine || '', categoryName: restoredCategory });

                var canvasEl = document.getElementById('canvasContent') || document.getElementById('canvasArea');
                canvasEl.appendChild(box);

                var chat = {
                    id: sb.id,
                    el: box,
                    modelId: sb.modelId,
                    chatNum: self.chatCounter,
                    history: [],
                    createdAt: sb.createdAt,
                    projectId: sb.projectId || null,
                    toolCategory: restoredCategory,
                    // ===== 底部选择器覆盖字段（模型ID / 思考强度） =====
                    _modelIdOverride: sb.modelIdOverride || '',
                    _reasoningEffort: sb.reasoningEffort || '',
                    _engine: sb._engine || sb.engine || '',
                    isSending: false,
                    abortController: null,
                    queue: [],
                    _stopped: false,
                    // 【压缩档位恢复】从用户习惯 JSON 恢复本对话的保留状态（截断/极简/全保留）
                    _compressMode: (function(){ try { return (window.UserSettings && UserSettings.getChatCompressionModes(sb.id).toolResults) || 'minimal'; } catch(e) { return 'minimal'; } })(),
                    _historyMode: (function(){ try { return (window.UserSettings && UserSettings.getChatCompressionModes(sb.id).historyAnswers) || 'minimal'; } catch(e) { return 'minimal'; } })(),
                    // ===== 恢复会话级累计统计（跨刷新保留整个对话累计） =====
                    _sessionTotalTokens: Number(sb.sessionTotalTokens) || 0,
                    _sessionTotalApiCalls: Number(sb.sessionTotalApiCalls) || 0,
                    // 【重启记忆增强】恢复各轮工具结果摘要（重启后 AI 能看到历史轮的工具结论）
                    _roundToolBriefs: (function(){ try { return Array.isArray(sb.roundToolBriefs) ? sb.roundToolBriefs : []; } catch(e) { return []; } })(),
                    // 【风筝测速】恢复真实往返间隔数据（刷新/重启后历史测速仍可追溯）
                    _lastGapMs: Number(sb.lastGapMs) || 0,
                    _lastApiAt: Number(sb.lastApiAt) || 0,
                    _gapLog: (function(){ try { return Array.isArray(sb.gapLog) ? sb.gapLog : []; } catch(e) { return []; } })(),
                    _sessionTotalDuration: Number(sb.sessionTotalDuration) || 0,
                    _sessionTotalPromptTokens: Number(sb.sessionTotalPromptTokens) || 0,
                    _sessionTotalCompletionTokens: Number(sb.sessionTotalCompletionTokens) || 0,
                    _sessionTotalCacheHitTokens: Number(sb.sessionTotalCacheHitTokens) || 0,
                    _sessionTotalCacheMissTokens: Number(sb.sessionTotalCacheMissTokens) || 0
                };
                self.chatBoxes.push(chat);

                // 恢复消息历史
                var msgs = Store.getMessages(sb.id);
                msgs.forEach(function(m) {
                    if (m.type === 'typing') return; // 跳过临时typing消息
                    if (m.type === 'tool' || m.type === 'tool_call' || m.role === 'tool' || m.role === 'tool_call') return; // 跳过工具调用记录，不显示在对话中
                    // 任务 meta 消息（⏱__TASKMETA__ 前缀）不渲染本体，由 _restoreTaskMetaRow 统一重绘耗时行+撤销按钮
                    if (m.role === 'assistant' && String(m.content || '').indexOf('\u23F1__TASKMETA__') === 0) {
                        chat.history.push({ role: m.role, content: m.content });
                        return;
                    }
                    var body = box.querySelector('.chatbox-body');
                    var div = document.createElement('div');
                    var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                    div.className = 'msg ' + whoCls;
                    var restoredContent = String(m.content || '');
                    // 任务结束总结（✅ 任务完成/❌ 任务失败 开头）不显示给用户，仅保留进 history 供大模型使用
                    var isTaskSummary = m.role === 'assistant' && (restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0 || restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0);
                    // A 方案：[自验收] 消息并入上一条 ai-final 答案气泡内，不再单独成条
                    if (m.role === 'assistant' && restoredContent.indexOf('[\u81EA\u9A8C\u6536]') === 0) {
                        var _scAll = body.querySelectorAll('.msg.ai-final');
                        var _scLast = _scAll.length ? _scAll[_scAll.length - 1] : null;
                        if (_scLast) {
                            var _scDiv = document.createElement('div');
                            _scDiv.className = 'self-check-inline md-body';
                            // 【升级】恢复路径也走 Markdown 渲染（含折叠 details 样式），与实时追加路径一致
                            try { _scDiv.innerHTML = App.renderMarkdown ? App.renderMarkdown(restoredContent) : App._escapeHtml(restoredContent); }
                            catch (_eScR2) { _scDiv.textContent = restoredContent; }
                            _scLast.appendChild(_scDiv);
                        }
                        chat.history.push({ role: m.role, content: m.content });
                        return;
                    }
                    if (!isTaskSummary) {
                        if (m.role === 'assistant' && restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) div.classList.add('task-result-success');
                        if (m.role === 'assistant' && (restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) div.classList.add('task-result-fail');
                        self.setMsgContent(div, m.content, m.role);
                        body.appendChild(div);
                    }
                    if (m.role === "user" || m.role === "assistant" || m.role === "system") chat.history.push({ role: m.role, content: m.content });
                });
                // ===== 重启恢复任务状态：从持久化消息推断 _taskStatus，保证导航/小地图/风筝龙正常显示 =====
                // 规则：找到最后一条"✅ 任务完成 / ❌ 任务失败"结果消息；若其后没有新的用户消息，则恢复该状态
                (function() {
                    var lastTs = 0, lastSt = null;
                    for (var mi = 0; mi < msgs.length; mi++) {
                        var mm = msgs[mi];
                        if (mm.role !== 'assistant') continue;
                        var mc = String(mm.content || '');
                        if (mc.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) { lastTs = mm.ts || lastTs; lastSt = 'success'; }
                        else if (mc.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || mc.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0) { lastTs = mm.ts || lastTs; lastSt = 'fail'; }
                    }
                    if (lastSt) {
                        var hasNewUser = false;
                        for (var ui = 0; ui < msgs.length; ui++) {
                            if (msgs[ui].role === 'user' && (msgs[ui].ts || 0) > lastTs) { hasNewUser = true; break; }
                        }
                        if (!hasNewUser) chat._taskStatus = lastSt;
                    }
                })();
                // 恢复任务耗时行+撤销按钮（若有 meta 且其后无新用户消息）
                if (self._restoreTaskMetaRow) self._restoreTaskMetaRow(box, chat, msgs);
                var body = box.querySelector('.chatbox-body');
                if (body) {
                    body.scrollTop = body.scrollHeight;
                    var rsbb = box.querySelector('.scroll-bottom-btn');
                    if (rsbb) rsbb.classList.remove('visible');
                }

                self.activate(box);
                self.bindChatBox(box, chat);
                // 【修复】重启恢复的对话框补挂角色头像/角色属性（与新建/选择角色路径一致）
                try { if (typeof App._refreshRoleBadge === 'function') App._refreshRoleBadge(box); } catch (e) {}
                if (sb.z > maxZ) maxZ = sb.z;
            });
            self.zCounter = maxZ;
            self.syncChatCounter();
            self.updateStatus();
            self.hideHint();
            Store.addLog('info', '', 'restore', '恢复 ' + saved.chatBoxes.length + ' 个对话框');
            
            self.updateMinimap();
            // 重启恢复后立即刷新导航箭头与小地图（使用恢复的任务状态）
            if (self._updateAllNavArrows) self._updateAllNavArrows();
            if (self.chatBoxes) self.chatBoxes.forEach(function(c) { if (self.updateStatusDot) self.updateStatusDot(c); });
            // 恢复后的窗口需要等浏览器完成布局后再重绘，避免小地图首次绘制为空。
            if (self.updateMinimap) {
                requestAnimationFrame(function() { self.updateMinimap(); });
                setTimeout(function() { self.updateMinimap(); }, 300);
            }

            // 【5.1.0 修复】恢复"最后激活的对话"：优先 UserSettings（JSON 持久化），
            // 激活它并把摄像机移过去；记录的对话已删除时回落到 zIndex 最高的窗口
            (function() {
                var lastId = null;
                try { lastId = (window.UserSettings && UserSettings.get('last_active_chat_id')) || null; } catch (e) {}
                var target = null;
                if (lastId) target = self.chatBoxes.find(function(c) { return c.id === String(lastId); });
                if (!target && self.chatBoxes.length) {
                    self.chatBoxes.forEach(function(c) {
                        if (!target || (c.el && parseInt(c.el.style.zIndex) || 0) > (parseInt(target.el.style.zIndex) || 0)) target = c;
                    });
                }
                if (target && target.el) {
                    self.activate(target.el);
                    if (self._focusCameraOn) self._focusCameraOn(target.el);
                    else if (self._focusChatBox) self._focusChatBox(target);
                }
            })();
            // 【重启恢复工作台】对话框全部重建后再补扫一次抽屉展开状态/页签
            // （原 800/2500ms 定时扫描在 DB 冷启动慢于 2.5s 时会落空且无重试）
            try { if (window.__KiteNS && __KiteNS.workbench && __KiteNS.workbench.restoreOpenState) setTimeout(function () { __KiteNS.workbench.restoreOpenState(); }, 200); } catch (e) {}
        },

        // 计算当前所有已用对话框 id(cbN) 中的最大编号
        maxBoxNum: function() {
            var max = 0, i, id, n;
            for (i = 0; i < this.chatBoxes.length; i++) {
                id = this.chatBoxes[i].id || '';
                if (id.indexOf('cb') === 0) {
                    n = parseInt(id.slice(2), 10);
                    if (!isNaN(n) && n > max) max = n;
                }
            }
            if (typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes) {
                for (i = 0; i < Store.data.chatBoxes.length; i++) {
                    id = Store.data.chatBoxes[i].id || '';
                    if (id.indexOf('cb') === 0) {
                        n = parseInt(id.slice(2), 10);
                        if (!isNaN(n) && n > max) max = n;
                    }
                }
            }
            return max;
        },
        // 让计数器与已用最大编号对齐（防止新建框撞上历史 session_id）
        syncChatCounter: function() {
            this.chatCounter = this.maxBoxNum();
            return this.chatCounter;
        },
        // 下一个不重复的框 id：始终 = 当前最大编号 + 1
        // 【全局唯一】用持久化计数器兜底：对话关闭后 maxBoxNum 只统计"打开中"的框，
        // 刷新/重启后新对话会复用已关闭对话的 id，导致随手标题旧绑定错误关联到新对话。
        nextBoxId: function() {
            var n = this.maxBoxNum() + 1;
            try {
                var saved = parseInt(localStorage.getItem('zf3d_cb_counter') || '0', 10) || 0;
                if (saved >= n) n = saved + 1;   // 计数器只增不减，保证 id 永不复用
                localStorage.setItem('zf3d_cb_counter', String(n));
            } catch (e) {}
            this.chatCounter = n;
            // 【绝对唯一】追加时间戳+随机后缀：即使 localStorage 被清空/换设备导致计数器归零，
            // 新 id 也不可能等于历史 id（时间戳单调 + 随机数兜底）。
            // 后缀不影响老解析逻辑：parseInt('cb12-x3f'.slice(2)) 仍得 12（遇到非数字即停止）。
            var _uid;
            try {
                _uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            } catch (e2) { _uid = String(Date.now()); }
            return 'cb' + n + '-' + _uid;
        },

        // ===== 状态栏更新 =====
        updateStatus: function() {
            var sc = document.getElementById('statusCount');
            if (sc) sc.textContent = '对话框: ' + this.chatBoxes.length;
            if (this._updateChatStatusButton) this._updateChatStatusButton();
        },

        updateStatusModelText: function() {
            var el = document.getElementById('status-model-trigger');
            el.textContent = Models.list.length === 0 ? '模型: 未配置' : '模型: ' + Models.list.length;
        },

        // 生成模型下拉选项 HTML（用于 createChatBox / restore 的 model-select）
        modelOptions: function(selectedId) {
            var opts = [];
            var visible = Models.list.filter(function(m) {
                if (m.visible === false) return false;
                // 本地（非朱峰官方）模型只允许语言分类的可见模型；语音/识图/生图等其他分类不出现
                if (m.imageGen || m.visionInput) return false;
                var t = String(m.modelType || '').toLowerCase();
                var isZf = (typeof Models.isZfOfficial === 'function') ? Models.isZfOfficial(m)
                         : !!(m.zfManaged || m.zfPinned || m.zfLine);
                if (!isZf) {
                    if (!(t === 'language' || t === 'text' || t === 'chat' || t === '')) return false;
                    if ((m.endpoint || m.baseUrl || '').toLowerCase().indexOf('/images/') !== -1) return false;
                    return true;
                }
                if (t && t !== 'language' && t !== 'text' && t !== 'chat') return false;
                return true;
            });
            var list = visible.length > 0 ? visible : Models.list;
            var found = false;
            list.forEach(function(m) {
                var sel = (m.id !== undefined && String(m.id) === String(selectedId)) ? ' selected' : '';
                if (sel) found = true;
                opts.push('<option value="' + m.id + '"' + sel + '>' + m.name + '</option>');
            });
            // 若选中项不在当前模型列表中，则默认选中第一个可见模型
            if (!found && opts.length > 0) {
                opts[0] = opts[0].replace(/<option value="([^"]+)"/, '<option value="$1" selected');
            }
            return opts.join('');
        }
    });
