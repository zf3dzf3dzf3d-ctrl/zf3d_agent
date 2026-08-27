// ========== app.js - 主应用逻辑 ==========
// 朱峰社区无限智能体 5.0.1
// 多对话框系统：右键创建 · 多模型连通 · 互不干扰
// 说明：改为「合并」而非「整体替换」，保证热更新重载本文件时，
// 其他模块（app-panels.js / app-project.js 等）通过 Object.assign(App, ...) 扩展的方法不丢失。

    var App = App || {};
    Object.assign(App, {
        version: '5.0.1',
        name: '朱峰社区无限智能体',
        chatBoxes: [],
        chatCounter: 0,
        zCounter: 50,
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
            if (!saved || saved.chatBoxes.length === 0) return;

            // 恢复画布视口 — 初始打开时自动居中到所有对话的包围盒中心，方便快速定位
            // 必须通过 canvasSetView 更新闭包 view 变量，否则拖拽时 view 仍为 {0,0}
            var self = this;
            (function() {
                if (!saved.chatBoxes.length) return;
                // 防重入：热更新重复调用 restoreSession 时，对话框已存在则不重置视口
                if (document.querySelector('.chatbox')) return;
                var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                saved.chatBoxes.forEach(function(sb) {
                    var w = sb.w || 360, h = sb.h || 480;
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
                box.style.width = (sb.w || 360) + 'px';
                box.style.height = (sb.h || 480) + 'px';
                box.style.zIndex = sb.z || (++maxZ);

                // 恢复路径也生成分类器（与 createChatBox 一致）
                var restoredCategory = (sb.toolCategory && Tools.categories[sb.toolCategory]) ? sb.toolCategory : '极简';
                Tools.chatCategories[sb.id] = restoredCategory;
                Tools.currentChatId = sb.id;
                Tools.activeCategory = restoredCategory;
                var rCatList = Tools.getCategoryList(sb.id);
                var rCatHtml = '';
                rCatList.forEach(function(c) {
                    rCatHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                        '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                        '<span class="tool-cat-item-name">' + c.name + '</span>' +
                        '</div>';
                });
                var rCurCat = Tools.categories[restoredCategory];
                var rCurCatIcon = rCurCat ? rCurCat.icon : '📄';

                box.innerHTML =
                '<div class="chatbox-header">' +
                    '<div class="chatbox-header-row1">' +
                    '<span class="status-dot status-idle"></span>' +
                    '<span class="title">💬 对话' + self.chatCounter + '</span>' +
                    '<button class="hd-btn tool-panel-btn" data-act="tools" title="工具执行过程">🔧<span class="tool-badge" style="display:none">0</span></button>' +
                    '<button class="hd-btn log-panel-btn" data-act="logs" title="日志">📜</button>' +
                    '<button class="hd-btn close" data-act="close" title="关闭">✕</button>' +
                    '</div>' +
                '</div>' +
                    '<div class="chatbox-body"></div>' +
                    '<div class="chatbox-toolpanel">' +
                        '<div class="chatbox-toolpanel-header">' +
                            '<span class="chatbox-toolpanel-title">🔧 工具执行过程</span>' +
                            '<button class="chatbox-toolpanel-close" title="关闭面板">✕</button>' +
                        '</div>' +
                        '<div class="chatbox-toolpanel-body"></div>' +
                    '</div>' +
                    '<div class="chatbox-logpanel">' +
                        '<div class="logpanel-tabs">' +
                            '<span class="logpanel-tab active" data-tab="logs">日志</span>' +
                            '<span class="logpanel-tab" data-tab="ctx">上下文</span>' +
                            '<span class="logpanel-actions">' +
                                '<button class="lp-btn" data-lp-act="copy" title="复制对话和日志">📋 复制</button>' +
                                '<button class="lp-btn" data-lp-act="clear" title="清空对话和日志">🗑 清空</button>' +
                            '</span>' +
                        '</div>' +
                        '<div class="logpanel-body"></div>' +
                    '</div>' +
                    '<div class="chatbox-queue" style="display:none"></div>' +
                '<button class="prev-user-btn" title="定位到上一条用户问题所在的段落"><span>▲</span></button> <button class="scroll-bottom-btn" title="滚动到底部"><span>▼</span></button>' +
                    '<div class="chatbox-inputrow">' +
                        '<button class="upload-btn" title="上传文件给AI">+</button>' +
                        '<textarea placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>' +
                        '<button class="send-btn" title="发送消息"><svg class="send-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>' +
                    '</div>' +
                    '<div class="chatbox-configrow">' +
                    '<div class="tool-cat-wrap">' +
                        '<button class="tool-cat-trigger" title="切换工具分类">' +
                            '<span class="tool-cat-icon">' + rCurCatIcon + '</span>' +
                            '<span class="tool-cat-name">' + restoredCategory + '</span>' +
                            '<span class="tool-cat-arrow">▾</span>' +
                        '</button>' +
                        '<div class="tool-cat-menu" hidden>' + rCatHtml + '</div>' +
                    '</div>' +
                    '<button class="cfg-btn cfg-project-btn" data-act="project" title="切换项目">📁<span class="proj-label">切换项目</span></button>' +
                    '<div class="model-picker-wrap">' +
                        '<button class="model-picker-btn" title="点击选择模型 / 模型ID / 思考强度"><span class="model-picker-name">未选择模型</span><span class="model-picker-arrow">▾</span></button>' +
                        '<div class="model-picker-menu" hidden>' +
                            '<div class="mp-search"><input type="text" class="mp-search-input" placeholder="搜索模型名称或模型ID…"></div>' +
                            '<div class="mp-list"></div>' +
                            '<div class="mp-section">模型 ID 覆盖（仅本对话）</div>' +
                            '<div class="mp-modelid-row"><select class="mp-modelid-input" title="选择要覆盖的模型ID"></select></div>' +
                            '<div class="mp-section">思考强度（reasoning_effort）</div>' +
                            '<div class="mp-re-row"><select class="mp-re-input" title="点击切换思考强度"></select><button type="button" class="mp-re-btn" data-re-dir="-1" title="降低思考强度">−</button><button type="button" class="mp-re-btn" data-re-dir="1" title="提升思考强度">＋</button></div>' +
                        '</div>' +
                    '</div>' +
                    '</div>' +
                    '<div class="chatbox-resize"><span class="chatbox-resize-handle south-east"></span><span class="chatbox-resize-handle south-west"></span><span class="chatbox-resize-handle south"></span><span class="chatbox-resize-handle east"></span><span class="chatbox-resize-handle west"></span></div>';

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
                    isSending: false,
                    abortController: null,
                    queue: [],
                    _stopped: false,
                    // ===== 恢复会话级累计统计（跨刷新保留整个对话累计） =====
                    _sessionTotalTokens: Number(sb.sessionTotalTokens) || 0,
                    _sessionTotalApiCalls: Number(sb.sessionTotalApiCalls) || 0,
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
                    var body = box.querySelector('.chatbox-body');
                    var div = document.createElement('div');
                    var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                    div.className = 'msg ' + whoCls;
                    var restoredContent = String(m.content || '');
                    if (m.role === 'assistant' && restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) div.classList.add('task-result-success');
                    if (m.role === 'assistant' && (restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) div.classList.add('task-result-fail');
                    self.setMsgContent(div, m.content, m.role);
                    body.appendChild(div);
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
                var body = box.querySelector('.chatbox-body');
                if (body) {
                    body.scrollTop = body.scrollHeight;
                    var rsbb = box.querySelector('.scroll-bottom-btn');
                    if (rsbb) rsbb.classList.remove('visible');
                }

                self.activate(box);
                self.bindChatBox(box, chat);
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
        nextBoxId: function() {
            var n = this.maxBoxNum() + 1;
            this.chatCounter = n;
            return 'cb' + n;
        },

        // ===== 状态栏更新 =====
        updateStatus: function() {
            document.getElementById('statusCount').textContent = '对话框: ' + this.chatBoxes.length;
            if (this._updateChatStatusButton) this._updateChatStatusButton();
        },

        updateStatusModelText: function() {
            var el = document.getElementById('status-model-trigger');
            el.textContent = Models.list.length === 0 ? '模型: 未配置' : '模型: ' + Models.list.length + '个已配置';
        },

        // 生成模型下拉选项 HTML（用于 createChatBox / restore 的 model-select）
        modelOptions: function(selectedId) {
            var opts = [];
            var visible = Models.list.filter(function(m) { return m.visible !== false; });
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
