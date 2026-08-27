// ==== 拆分自 app-chatbox.js：防风暴提示（右上角轻提示，自动消失）_新建窗口尺寸记忆_创建对话框_Shift+左键 ====
Object.assign(App, {


        // ===== 防风暴提示（右上角轻提示，自动消失） =====
        _showStormToast: function(text) {
            try {
                var t = document.createElement('div');
                t.textContent = '🛡 ' + text;
                t.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:#c0392b;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,sans-serif;';
                document.body.appendChild(t);
                setTimeout(function() { t.remove(); }, 4000);
            } catch (e) { console.warn('[ChatBox] toast失败', e); }
        },

        // ===== 新建窗口尺寸记忆（localStorage 持久化，重启后依然生效） =====
        getLastBoxSize: function() {
            try {
                var pref = window.UserSettings && UserSettings.getDefaultChatBoxSize ? UserSettings.getDefaultChatBoxSize() : null;
                if (pref) return pref;
                var raw = UserSettings.get('zf3d_lastBoxSize');
                if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
                if (raw) {
                    var o = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                    if (o && typeof o.w === 'number' && typeof o.h === 'number' &&
                        o.w >= 280 && o.w <= 5000 && o.h >= 200 && o.h <= 5000) return o;
                }
            } catch (e) { }
            return null;
        },
        rememberBoxSize: function(w, h) {
            try {
                if (w >= 280 && h >= 200) {
                    UserSettings.set('zf3d_lastBoxSize', JSON.stringify({ w: Math.round(w), h: Math.round(h) }));
                    if (window.UserSettings && UserSettings.setChatPreferences) UserSettings.setChatPreferences(null, { w: w, h: h }, null);
                }
            } catch (e) { }
        },

        // ===== 创建对话框 =====
        createChatBox: function(clientX, clientY, modelId) {
            // 【防风暴闸门】所有限流检查在分配 id 之前完成（否则 id 会被浪费性递增）
            var canvas0 = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var cRect0 = canvas0.getBoundingClientRect();
            var self0 = this;

            var MAX_BOXES = 30;          // 画布窗口总量上限
            var CREATE_WINDOW_MS = 10000; // 频率窗口：10秒
            var MAX_PER_WINDOW = 8;      // 10秒内最多创建 8 个

            var now = Date.now();
            self0._createHistory = self0._createHistory || [];

            // 1) 总量上限：已有窗口 ≥ 30 时拒绝新建（用户双击画布会得到提示，关闭部分窗口后恢复）
            var boxesOnCanvas = document.querySelectorAll('.chatbox').length;
            if (boxesOnCanvas >= MAX_BOXES) {
                console.warn('[ChatBox] 窗口总量已达上限 ' + MAX_BOXES + '，拒绝新建（可能是程序失控，请检查）');
                self0._showStormToast('窗口已达上限 ' + MAX_BOXES + '，请先关闭部分窗口');
                return null;
            }

            // 2) 频率限制：10 秒内创建 > 8 个 → 判定为风暴，拒绝（窗口期过后自动恢复）
            self0._createHistory = self0._createHistory.filter(function(t) { return now - t < CREATE_WINDOW_MS; });
            if (self0._createHistory.length >= MAX_PER_WINDOW) {
                console.warn('[ChatBox] 创建频率超限（10秒内 ' + self0._createHistory.length + ' 个），疑似风暴，已拦截');
                self0._showStormToast('创建过快，10秒后再试（防失控保护）');
                return null;
            }
            self0._createHistory.push(now);

            var canvas = canvas0;
            // 对话框 absolute 定位的参照容器就是 canvas（canvasContent），
            // 因此坐标须以 canvas 的 getBoundingClientRect() 为基准（画布可经 transform 平移/缩放）。
            var cRect = cRect0;
            var self = self0;

            var box = document.createElement('div');
            box.className = 'chatbox';
            box.id = this.nextBoxId();
            box.style.left = (clientX - cRect.left) + 'px';
            box.style.top = (clientY - cRect.top) + 'px';
            box.style.zIndex = ++this.zCounter;

            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            // 新对话以右侧模型设置为初始快照；后续底部选择器的修改仅作用于本对话。
            var initialModelIdOverride = model ? (model.modelId || '') : '';
            var initialReasoningEffort = model ? (model.reasoningEffort || ReasoningLevels.defaultValue()) : '';

            // 生成工具分类选择器（与恢复路径一致）
            var _newCatName = Tools.activeCategory || '极简';
            if (!Tools.categories[_newCatName]) _newCatName = '极简';
            Tools.chatCategories[box.id] = _newCatName;
            var catList = Tools.getCategoryList(box.id);
            var catHtml = '';
            catList.forEach(function(c) {
                catHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                    '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                    '<span class="tool-cat-item-name">' + c.name + '</span>' +
                    '</div>';
            });
            var curCat = Tools.categories[_newCatName];
            var curCatIcon = curCat ? curCat.icon : '📄';

            box.innerHTML =
                '<div class="chatbox-header" title="拖拽移动对话；Shift+左键拖拽：按下即在鼠标处复制一个一模一样的对话并跟随拖动">' +
                    
                    '<div class="chatbox-header-row1">' +
                    
                    '<span class="status-dot status-idle"></span>' +
                    '<span class="title">对话' + this.chatCounter + '</span>' +
                    '<span class="proj-name" style="display:none"></span>' +
                    '<button class="hd-btn tool-panel-btn" data-act="tools" title="工具执行过程">🔧<span class="tool-badge" style="display:none">0</span></button>' +
                    '<button class="hd-btn log-panel-btn" data-act="logs" title="日志">📜</button>' +
                    '<button class="hd-btn close" data-act="close" title="关闭">✕</button>' +
                    '</div>' +
                '</div>' +
                '<div class="chatbox-body">' +
                    '<div class="msg ai">您好！我是' + (model ? model.name : '当前模型') + '，很高兴为您服务。请告诉我您需要完成的任务。' +
                    (model ? '' : '（未选择模型，请在底部下拉菜单选择）') + '</div>' +
                '</div>' +
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
                    '<button class="upload-btn" title="上传文件 / 文件夹">+</button>' +
                    '<textarea placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>' +
                    '<button class="send-btn" title="发送消息"><svg class="send-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>' +
                '</div>' +
                '<div class="chatbox-configrow">' +
                    '<div class="tool-cat-wrap">' +
                        '<button class="tool-cat-trigger" title="切换工具分类">' +
                            '<span class="tool-cat-icon">' + curCatIcon + '</span>' +
                            '<span class="tool-cat-name">' + _newCatName + '</span>' +
                            '<span class="tool-cat-arrow">▾</span>' +
                        '</button>' +
                        '<div class="tool-cat-menu" hidden>' + catHtml + '</div>' +
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

            canvas.appendChild(box);

            // 新建窗口应用"最后激活窗口"的尺寸（localStorage 记忆，重启后依然生效）
            var lastSize = this.getLastBoxSize();
            if (lastSize) {
                box.style.width = lastSize.w + 'px';
                box.style.height = lastSize.h + 'px';
            }

            // 新会话直接继承用户习惯 JSON 中的默认压缩档位，避免首次发送前异步读取产生竞态。
            var compressionModes = { toolResults: 'minimal', historyAnswers: 'minimal' };
            try {
                if (window.UserSettings && UserSettings.getChatCompressionModes) {
                    compressionModes = UserSettings.getChatCompressionModes(box.id);
                }
            } catch (e) {}

            // 记录对话框状态
            var chat = {
                id: box.id,
                el: box,
                modelId: modelId,
                chatNum: this.chatCounter,
                history: [],
                createdAt: Date.now(),
                isSending: false,
                abortController: null,
                queue: [],
                _stopped: false,
                _compressMode: compressionModes.toolResults,
                _historyMode: compressionModes.historyAnswers,
                _modelIdOverride: initialModelIdOverride,
                _reasoningEffort: initialReasoningEffort
            };
            this.chatBoxes.push(chat);

            // 自动归入当前活动项目
            // 修复（5.0.1）：启动竞态窗口内 _activeProjectId 可能尚未从 DB 异步加载完成，
            // 导致新建对话丢失项目归属。这里分三层兜底：
            //   1) 内存值（正常路径，项目面板已加载）
            //   2) localStorage 同步读取（上次会话写入的永久备份，毫秒级可用）
            //   3) DB 异步拉取 + 延迟补归（前两层都为空时，拉到后回填内存并补归本对话）
            var _activePid = self._activeProjectId || null;
            if (!_activePid) {
                try {
                    var _savedPid = localStorage.getItem('active_project_id');
                    if (_savedPid) {
                        _activePid = _savedPid;
                        self._activeProjectId = _savedPid; // 回填内存，本页后续新建直接命中
                    }
                } catch (e) {}
            }
            if (_activePid) {
                chat.projectId = _activePid;
                for (var _pi = 0; _pi < Store.data.chatBoxes.length; _pi++) {
                    if (Store.data.chatBoxes[_pi].id === chat.id) {
                        Store.data.chatBoxes[_pi].projectId = _activePid;
                        break;
                    }
                }
                if (typeof DB !== 'undefined' && DB.online) {
                    DB.setNodeProject(chat.id, _activePid).catch(function(e) { console.warn('[Chatbox] project link failed:', e); });
                }
                Store.addLog('info', chat.id, 'project-auto', '自动归入活动项目: ' + _activePid);
            } else if (typeof DB !== 'undefined' && DB.getActiveProject) {
                // 第三层兜底：异步拉取 DB 中的活动项目，拉到后补归（不阻塞对话框创建）
                DB.getActiveProject().then(function (res) {
                    if (!res || !res.ok || res.data === null || res.data === undefined) return;
                    var pid2 = res.data;
                    try { pid2 = JSON.parse(pid2); } catch (e) {}
                    if (!pid2) return;
                    // 回填内存 + localStorage，后续新建对话直接命中
                    self._activeProjectId = pid2;
                    try { localStorage.setItem('active_project_id', pid2); } catch (e) {}
                    // 补归当前对话：仅当它仍存活且仍无归属（用户未手动改派到其他项目）时
                    var alive = self.chatBoxes && self.chatBoxes.indexOf(chat) >= 0;
                    if (alive && !chat.projectId) {
                        chat.projectId = pid2;
                        for (var _pj = 0; _pj < Store.data.chatBoxes.length; _pj++) {
                            if (Store.data.chatBoxes[_pj].id === chat.id) {
                                Store.data.chatBoxes[_pj].projectId = pid2;
                                break;
                            }
                        }
                        if (typeof DB !== 'undefined') {
                            DB.setNodeProject(chat.id, pid2).catch(function () {});
                        }
                        if (typeof self._updateProjectBtn === 'function') self._updateProjectBtn(chat);
                        Store.addLog('info', chat.id, 'project-auto', '自动归入活动项目(延迟补归): ' + pid2);
                    }
                }).catch(function () {});
            }

            // 激活
            this.activate(box);

            // 绑定事件
            this.bindChatBox(box, chat);

            // 初始化项目按钮显示
            this._updateProjectBtn(chat);

            // 持久化
            Store.saveChatBox(chat);
            Store.addMessage(box.id, 'assistant', box.querySelector('.msg').textContent, 'text', chat.modelId);
            Store.addLog('info', box.id, 'create', '创建对话框，模型: ' + (boxName));

            // 更新状态栏
            if (typeof Tools !== 'undefined' && Tools.toolResultArchive) {
                delete Tools.toolResultArchive[chat.id];
            }
            this.updateStatus();
            this.hideHint();
            this.updateMinimap();
            return chat;
        },

        // ===== Shift+左键拖拽复制对话 =====
        // 行为：按下瞬间（mousedown 且 shiftKey）立即创建一个副本对话（新对话 id、DB 单独一条会话记录），
        // 副本出现在鼠标按下的位置，随后鼠标继续拖拽时副本跟随鼠标移动（原对话不动），
        // 松开后副本停在松开位置。副本内容与原对话完全一致（含渲染方式）。
        cloneChatBox: function(srcChat, pressX, pressY) {
            var self = this;
            if (!srcChat || !srcChat.el) return null;

            // 0) 记录源对话当前信息（必须在创建副本前读取，创建后 DOM 会刷新）
            var srcTitleEl = srcChat.el.querySelector('.title');
            var srcTitle = srcTitleEl ? (srcTitleEl.textContent || '').trim() : ('对话' + (srcChat.chatNum || ''));
            var srcCollapsed = srcChat.el.classList.contains('collapsed');
            var srcModelId = srcChat.modelId || '';
            var srcModelIdOverride = srcChat._modelIdOverride || '';
            var srcReasoningEffort = srcChat._reasoningEffort || '';
            var srcProjectId = srcChat.projectId || null;
            var srcToolCat = (typeof Tools !== 'undefined' && Tools.chatCategories) ? (Tools.chatCategories[srcChat.id] || null) : null;
            var srcW = srcChat.el.offsetWidth || 480;
            var srcH = srcChat.el.offsetHeight || 520;
            // 消息深拷贝（含 role/content/type/ts/model_id，保证渲染方式一致：final/text 等）
            var srcMsgs = (Store.getMessages(srcChat.id) || []).map(function(m) {
                var cp = {};
                for (var k in m) {
                    if (Object.prototype.hasOwnProperty.call(m, k)) cp[k] = m[k];
                }
                return cp;
            });
            // history 也复制一份（用于发送上下文）
            var srcHistory = (srcChat.history || []).map(function(h) { return { role: h.role, content: h.content }; });

            // 1) 按源对话的画布坐标创建副本，保持鼠标抓取点与原对话一致。
            var newChat = self.createChatBox(srcChat.x, srcChat.y, srcModelId);
            if (!newChat) return null;
            // 副本继承源对话已经独立设置的模型 ID 与思考强度。
            newChat._modelIdOverride = srcModelIdOverride;
            newChat._reasoningEffort = srcReasoningEffort;
            if (typeof newChat._refreshModelPickerBtn === 'function') newChat._refreshModelPickerBtn();

            // 2) 覆盖项目归属：副本属于源对话同一个项目
            newChat.projectId = srcProjectId;
            for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                if (Store.data.chatBoxes[i].id === newChat.id) {
                    Store.data.chatBoxes[i].projectId = srcProjectId;
                    break;
                }
            }
            if (srcProjectId && typeof DB !== 'undefined' && DB.online) {
                DB.setNodeProject(newChat.id, srcProjectId).catch(function() {});
            }

            // 3) 覆盖工具分类（极简/编程/写作）
            if (srcToolCat && typeof Tools !== 'undefined' && Tools.chatCategories) {
                Tools.chatCategories[newChat.id] = srcToolCat;
                // 更新触发按钮显示
                try {
                    var trig = newChat.el.querySelector('.tool-cat-trigger');
                    var catObj = Tools.categories[srcToolCat];
                    if (trig && catObj) {
                        var ic = trig.querySelector('.tool-cat-icon');
                        var nm = trig.querySelector('.tool-cat-name');
                        if (ic) ic.textContent = catObj.icon || '📄';
                        if (nm) nm.textContent = srcToolCat;
                        // 重建下拉菜单并高亮当前分类
                        var menu = trig.nextElementSibling;
                        if (menu) {
                            var catList = Tools.getCategoryList(newChat.id);
                            var catHtml = '';
                            catList.forEach(function(c) {
                                catHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                                    '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                                    '<span class="tool-cat-item-name">' + c.name + '</span>' +
                                    '</div>';
                            });
                            menu.innerHTML = catHtml;
                        }
                    }
                } catch (e) {}
            }

            // 4) 尺寸/层级与源一致
            newChat.el.style.width = srcW + 'px';
            newChat.el.style.height = srcH + 'px';
            newChat.el.style.zIndex = (++this.zCounter);

            // 5) 折叠状态一致
            if (srcCollapsed) newChat.el.classList.add('collapsed');

            // 6) 标题与源一致（同一渲染方式，仅 id 不同）
            try {
                var newTitleEl = newChat.el.querySelector('.title');
                if (newTitleEl) newTitleEl.textContent = srcTitle;
                newChat.title = srcTitle;
            } catch (e) {}

            // 7) 用源消息完整替换初始欢迎消息：清空 DOM + Store + DB
            var body = newChat.el.querySelector('.chatbox-body');
            if (body) body.innerHTML = '';
            if (typeof Store.clearMessages === 'function') {
                Store.clearMessages(newChat.id);
            } else if (Store.data && Store.data.messages) {
                Store.data.messages[newChat.id] = [];
            }

            // 8) 逐条写入源消息（Store 内存 + SQLite 新会话；保留 role/type/ts，渲染方式与源一致）
            srcMsgs.forEach(function(m) {
                var role = m.role || 'user';
                var content = m.content || '';
                var type = m.type || 'text';
                var mModel = m.model_id || m.modelId || srcModelId || '';
                try {
                    if (typeof Store.addMessage === 'function') {
                        Store.addMessage(newChat.id, role, content, type, mModel);
                    } else {
                        if (!Store.data.messages[newChat.id]) Store.data.messages[newChat.id] = [];
                        Store.data.messages[newChat.id].push({ role: role, content: content, type: type, ts: m.ts || Date.now() });
                    }
                } catch (e) {
                    console.error('[cloneChatBox] 写入消息失败:', e);
                }
            });
            // DB 直接按原始 ts 归档（新会话 id，时间与源一致）
            if (Store.dbOnline && typeof DB !== 'undefined' && srcMsgs.length) {
                DB.clearChatHistory(newChat.id).then(function() {
                    srcMsgs.forEach(function(m) {
                        DB.addChatMessage(newChat.id, m.role || 'user', m.content || '', m.model_id || m.modelId || srcModelId || '', null, m.ts).catch(function() {});
                    });
                }).catch(function() {});
            }

            // 9) 用源的渲染方式逐条渲染到副本 DOM（分块异步渲染，和恢复对话路径一致）
            newChat.history = srcHistory.slice();
            if (srcMsgs.length) {
                var cbody = newChat.el.querySelector('.chatbox-body');
                if (cbody) {
                    var msgIdx = 0;
                    var CHUNK = 8;
                    (function renderChunk() {
                        var end = Math.min(msgIdx + CHUNK, srcMsgs.length);
                        var frag = document.createDocumentFragment();
                        for (; msgIdx < end; msgIdx++) {
                            var m = srcMsgs[msgIdx];
                            // 跳过工具调用日志（实际持久化字段为 role='tool_call'/type='tool'）与打字中占位
                            if (m.type === 'typing' || m.type === 'tool_call' || m.type === 'tool' || m.role === 'tool_call' || m.role === 'tool') continue;
                            var div = document.createElement('div');
                            var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                            div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                            self.setMsgContent(div, m.content, whoCls);
                            frag.appendChild(div);
                        }
                        cbody.appendChild(frag);
                        if (msgIdx < srcMsgs.length) {
                            requestAnimationFrame(renderChunk);
                        } else {
                            cbody.scrollTop = cbody.scrollHeight;
                        }
                        try { self._refreshUserMsgBtns(cbody); } catch (e) {}
                    })();
                }
            }

            // 10) 副本默认显示在源对话上方（y 坐标更高），避免完全重叠看不到新副本；
            //    保留鼠标在标题栏中的抓取偏移；新副本提升层级显示在原对话上方。
            try {
                var CLONE_OFFSET_Y = -32; // 负值 = 在源对话上方
                var sourceLeft = typeof srcChat.x === 'number' ? srcChat.x : srcChat.el.offsetLeft;
                var sourceTop = typeof srcChat.y === 'number' ? srcChat.y : srcChat.el.offsetTop;
                newChat.el.style.left = sourceLeft + 'px';
                newChat.el.style.top = (sourceTop + CLONE_OFFSET_Y) + 'px';
                newChat.el.style.zIndex = (++self.zCounter);
                newChat.x = sourceLeft;
                newChat.y = sourceTop + CLONE_OFFSET_Y;
            } catch (e) {
                console.warn('[Shift+拖拽] 初始位置设置失败:', e);
            }

            // 11) 持久化节点信息（含新 projectId / 标题 / 尺寸 / 位置）
            Store.saveChatBox(newChat);

            // 12) 日志 + 刷新视图
            Store.addLog('info', newChat.id, 'clone', 'Shift+拖拽复制对话（源: ' + srcChat.id + '，消息 ' + srcMsgs.length + ' 条）');
            if (typeof self.updateProjectView === 'function') { try { self.updateProjectView(); } catch (e) {} }
            if (typeof self.updateStatus === 'function') { try { self.updateStatus(); } catch (e) {} }
            if (typeof self.updateMinimap === 'function') { try { self.updateMinimap(); } catch (e) {} }

            return newChat;
        },
});
