// ========== project-sessions.js - 会话管理（新建/删除/置顶/重命名） ==========
// 拆分自 app-chatbox-projects.js（原 1238~1564 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 新建会话弹窗 =====
        openNewSessionModal: function(chat, panel) {
            var self = this;
            var existing = document.getElementById('newSessionOverlay');
            if (existing) existing.remove();

            var overlay = document.createElement('div');
            overlay.className = 'overlay show';
            overlay.id = 'newSessionOverlay';
            overlay.style.zIndex = '99999';

            var currentModelId = chat ? chat.modelId : '';
            var defaultTitle = '对话' + ((Store.data && Store.data.chatBoxes ? Store.data.chatBoxes.length : 0) + 1);

            overlay.innerHTML =
                '<div class="modal new-session-modal">' +
                    '<h3>✨ 新建会话</h3>' +
                    '<div style="font-size:12px;color:var(--text2);margin-bottom:16px;">选择模型并创建一段新对话，可在画布上自由拖拽。</div>' +
                    '<div class="field">' +
                        '<label>选择模型</label>' +
                        '<select id="ns-model" class="ns-select">' + self.modelOptions(currentModelId) + '</select>' +
                    '</div>' +
                    '<div class="field">' +
                        '<label>对话标题</label>' +
                        '<input type="text" id="ns-title" value="' + defaultTitle + '" />' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">' +
                        '<button class="btn ghost" id="ns-cancel">取消</button>' +
                        '<button class="btn" id="ns-create">✨ 创建会话</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) overlay.remove();
            });
            overlay.querySelector('#ns-cancel').addEventListener('click', function() {
                overlay.remove();
            });

            function doCreate() {
                var modelId = overlay.querySelector('#ns-model').value || null;
                var title = overlay.querySelector('#ns-title').value.trim();
                var hb = panel ? panel.closest('.chatbox').getBoundingClientRect() : null;
                var cx = hb ? hb.right + 30 : window.innerWidth / 2;
                var cy = hb ? hb.top + 60 : window.innerHeight / 2;
                var newChat = self.createChatBox(cx, cy, modelId);
                if (title && newChat) {
                    var titleEl = newChat.el.querySelector('.title');
                    if (titleEl) titleEl.textContent = title;
                    newChat.title = title;
                    Store.saveChatBox(newChat);
                }
                if (panel) panel.classList.remove('open');
                overlay.remove();
                Store.addLog('info', newChat ? newChat.id : '', 'new-session', '新建会话' + (title ? ': ' + title : ''));
            }

            overlay.querySelector('#ns-create').addEventListener('click', doCreate);
            overlay.querySelector('#ns-title').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
            });

            // 修复：Models.load() 是异步的（GET /api/models/config）。
            // 若弹窗打开时模型列表尚未加载完成，下拉框会是空的（只剩"请选择模型"占位）。
            // 这里在加载完成后重填一次下拉选项，保证能看到具体模型。
            try {
                if (global.Models && !Models._loaded && typeof Models.load === 'function') {
                    Models.load().then(function() {
                        var sel = overlay.querySelector('#ns-model');
                        if (sel && overlay.isConnected) {
                            var cur = sel.value;
                            sel.innerHTML = self.modelOptions(cur || (chat ? chat.modelId : ''));
                        }
                    }).catch(function() {});
                }
            } catch (e) {}

            setTimeout(function() {
                var titleInput = overlay.querySelector('#ns-title');
                if (titleInput) titleInput.focus();
            }, 50);
        },

        // ===== 删除历史对话节点 =====
        deleteHistoryNode: function(nodeId, panel, chat) {
            if (Store.data && Store.data.chatBoxes) {
                Store.data.chatBoxes = Store.data.chatBoxes.filter(function(b) {
                    return b.id !== nodeId;
                });
                Store.flush();
            }
            Store.clearMessages(nodeId);
            if (typeof DB !== 'undefined' && DB.online) {
                DB.deleteNode(nodeId).catch(function() {});
            }
            Store.addLog('info', nodeId, 'delete', '删除对话节点');
            this.loadProjectNodes(panel, chat);
        },

        // ===== 置顶管理 =====
        getPinnedIds: function() {
            if (!Store.data) Store.data = {};
            if (!Store.data.pinnedIds) Store.data.pinnedIds = [];
            return Store.data.pinnedIds;
        },
        togglePin: function(nodeId) {
            var ids = this.getPinnedIds();
            var idx = ids.indexOf(nodeId);
            if (idx >= 0) { ids.splice(idx, 1); }
            else { ids.push(nodeId); }
            Store.flush();
            Store.addLog('info', nodeId, 'pin', idx >= 0 ? '取消置顶' : '置顶');
        },

        // ===== 重命名 =====
        renameNode: function(nodeId, newTitle) {
            if (Store.data && Store.data.chatBoxes) {
                for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                    if (Store.data.chatBoxes[i].id === nodeId) {
                        Store.data.chatBoxes[i].title = newTitle;
                        break;
                    }
                }
                Store.flush();
            }
            for (var j = 0; j < this.chatBoxes.length; j++) {
                if (this.chatBoxes[j].id === nodeId) {
                    var titleEl = this.chatBoxes[j].el.querySelector('.title');
                    if (titleEl) titleEl.textContent = newTitle;
                    this.chatBoxes[j].title = newTitle;
                    break;
                }
            }
            if (typeof DB !== 'undefined' && DB.online) {
                // 修复：saveNode(node) 接收完整节点对象（原代码调用了不存在的 DB.updateNode）
                var nodeData = null;
                if (window.Store && Store.data && Store.data.chatBoxes) {
                    for (var i = 0; i < Store.data.chatBoxes.length; i++) {
                        if (Store.data.chatBoxes[i].id === nodeId) { nodeData = Store.data.chatBoxes[i]; break; }
                    }
                }
                if (nodeData) DB.saveNode(nodeData).catch(function() {});
            }
            Store.addLog('info', nodeId, 'rename', '重命名为: ' + newTitle);
        },

        mergeAndRender: function(panel, nodes, render) {
            var seen = {}, out = [];
            nodes.forEach(function(n) {
                if (!n.id) return;
                if (seen[n.id]) return;
                seen[n.id] = 1;
                out.push(n);
            });
            out.sort(function(a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
            render(out);
        },

        countMsgs: function(pid) {
            var msgs = Store.getMessages(pid);
            return msgs.length;
        },

        restoreHistoryNode: function(node) {
            for (var i = 0; i < this.chatBoxes.length; i++) {
                if (this.chatBoxes[i].id === node.id) { this.activate(this.chatBoxes[i].el); return; }
            }
            this.buildBoxFromNode(node);
            // 【5.1.0 修复】点历史对话恢复时，同步把活动项目切到该对话所属项目，
            // 否则新打开的对话框 📁 仍显示之前的活动项目（默认第一个项目）
            var npid = node.projectId || node.project_id || null;
            if (npid) {
                var pname = this._lookupProjectName ? this._lookupProjectName(String(npid)) : '';
                if (!pname && typeof App._projAllProjects !== 'undefined' && App._projAllProjects) {
                    for (var pi = 0; pi < App._projAllProjects.length; pi++) {
                        if (String(App._projAllProjects[pi].id) === String(npid)) { pname = App._projAllProjects[pi].name || ''; break; }
                    }
                }
                this.setActiveProjectUnified(String(npid), pname, { skipChatSync: true });
            }
        },

        buildBoxFromNode: function(node) {
            var self = this;
            var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var box = document.createElement('div');
            box.className = 'chatbox' + (node.collapsed ? ' collapsed' : '');
            box.id = this.nextBoxId();
            box.style.left = (node.x || 100) + 'px';
            box.style.top = (node.y || 100) + 'px';
            box.style.width = (node.w || 360) + 'px';
            box.style.height = (node.h || 480) + 'px';
            box.style.zIndex = ++this.zCounter;

            var modelId = node.modelId || node.model_id || '';
            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            var title = node.title || ('对话' + this.chatCounter);
            if (title.indexOf('💬') === 0) title = title.substring(2).trim();
            var _projCatName = Tools.activeCategory || '极简';
            if (!Tools.categories[_projCatName]) _projCatName = '极简';
            Tools.chatCategories[box.id] = _projCatName;
            // 项目会话恢复：分类下拉按该对话引擎过滤
            var _catList = Tools.getCategoryList(box.id, node._engine || node.engine || '');
            var _catHtml = '';
            _catList.forEach(function(c) {
                _catHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                    '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                    '<span class="tool-cat-item-name">' + c.name + '</span>' +
                    '</div>';
            });
            var _curCat = Tools.categories[_projCatName];
            var _curCatIcon = _curCat ? _curCat.icon : '📄';


            box.innerHTML =
                '<div class="chatbox-header" title="拖拽移动对话；按住 Shift 拖拽可复制一个一模一样的对话到鼠标落点">' +
                    
                    '<div class="chatbox-header-row1">' +
                    
                    '<span class="status-dot status-idle"></span>' +
                    '<span class="title">' + title + '</span>' +
                    '<span class="proj-name" style="display:none"></span>' +
                    '<button class="hd-btn tool-panel-btn" data-act="tools" title="工具执行过程">🔧<span class="tool-badge" style="display:none">0</span></button>' +
                    '<button class="hd-btn log-panel-btn" data-act="logs" title="日志">📜</button>' +
                    '<button class="hd-btn close" data-act="close" title="关闭">✕</button>' +
                    '</div>' +
                '<div class="chatbox-body"></div>' +
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
                    '<button class="voice-btn" type="button" title="语音输入"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>' +
                        '<textarea placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>' +
                    '<button class="send-btn" title="发送消息"><svg class="send-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>' +
                '</div>' +
                '<div class="chatbox-configrow">' +
                    '<div class="eng-picker-wrap">' +
                        '<button class="eng-trigger" title="底层对话引擎（对话处理管线）">' +

                            '<span class="eng-name">默认</span>' +
                            '<span class="eng-arrow">▾</span>' +
                        '</button>' +
                        '<div class="eng-menu" hidden></div>' +
                    '</div>' +
                    '<div class="tool-cat-wrap">' +
                        '<button class="tool-cat-trigger" title="切换工具分类">' +
                            '<span class="tool-cat-icon">' + _curCatIcon + '</span>' +
                            '<span class="tool-cat-name">' + _projCatName + '</span>' +
                            '<span class="tool-cat-arrow">▾</span>' +
                        '</button>' +
                        '<div class="tool-cat-menu" hidden>' + _catHtml + '</div>' +
                    '</div>' +
                    '<button class="cfg-btn cfg-project-btn" data-act="project" title="切换项目">📁<span class="proj-label">切换项目</span></button>' +
                    '<div class="model-picker-wrap">' +
                        '<button class="model-picker-btn" title="点击选择模型 / 模型ID / 思考强度"><span class="model-picker-name">未选择模型</span><span class="model-picker-arrow">▾</span></button>' +
                        '<div class="model-picker-menu mp-horizontal" hidden>' +
                            '<div class="mp-row">' +
                                '<select class="mp-line-select" title="选择大模型"></select>' +
                                '<select class="mp-modelid-input" title="选择模型 ID"></select>' +
                                '<select class="mp-re-input" title="思考强度（reasoning_effort）"></select>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="chatbox-resize"><span class="chatbox-resize-handle south-east"></span><span class="chatbox-resize-handle south-west"></span><span class="chatbox-resize-handle south"></span><span class="chatbox-resize-handle east"></span><span class="chatbox-resize-handle west"></span></div>';

            canvas.appendChild(box);

            var chat = {
                id: box.id,
                el: box,
                modelId: modelId,
                chatNum: this.chatCounter,
                history: [],
                createdAt: node.createdAt || node.created_at || Date.now(),
                projectId: node.projectId || node.project_id || null,
                // ===== 底部选择器覆盖字段（模型ID / 思考强度） =====
                _modelIdOverride: node.modelIdOverride || node.model_id_override || '',
                _reasoningEffort: node.reasoningEffort || node.reasoning_effort || '',
                _engine: node._engine || node.engine || '',
                // 【压缩档位恢复】从用户习惯 JSON 恢复本对话的保留状态（截断/极简/全保留）
                _compressMode: (function(){ try { return (window.UserSettings && UserSettings.getChatCompressionModes(box.id).toolResults) || 'minimal'; } catch(e) { return 'minimal'; } })(),
                _historyMode: (function(){ try { return (window.UserSettings && UserSettings.getChatCompressionModes(box.id).historyAnswers) || 'minimal'; } catch(e) { return 'minimal'; } })()
            };
            this.chatBoxes.push(chat);

            // 加载历史消息（本地优先，服务端兜底）
            var body = box.querySelector('.chatbox-body');
            var msgs = Store.getMessages(node.id);
            if (msgs.length) {
                msgs.forEach(function(m) {
                    if (m.type === 'typing') return;
                    if (m.type === 'tool_call') return; // skip tool call records
                    var div = document.createElement('div');
                    var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                    div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                    var restoredContent = String(m.content || '');
                    // 任务结束总结（✅ 任务完成/❌ 任务失败 开头）不显示给用户，仅保留进 history 供大模型使用
                    var isTaskSummary = m.role === 'assistant' && (restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0 || restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0);
                    if (!isTaskSummary) {
                        if (m.role === 'assistant' && restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) div.classList.add('task-result-success');
                        if (m.role === 'assistant' && (restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) div.classList.add('task-result-fail');
                        self.setMsgContent(div, m.content, whoCls);
                        body.appendChild(div);
                    }
                    if (m.role === "user" || m.role === "assistant" || m.role === "system") chat.history.push({ role: m.role, content: m.content });
                });
                // 历史渲染完成：标题显示第一句用户提问
                var fu3 = body.querySelector('.msg.user');
                if (fu3) self.updateChatTitle(box, '');
            } else if (typeof DB !== 'undefined' && DB.online) {
                DB.getChatHistory(node.id).then(function(res) {
                    var rows = (res && res.data) ? res.data : [];
                    rows.forEach(function(m) {
                        if (m.type === 'typing') return;
                        if (m.type === 'tool_call') return;
                        if (m.role === 'tool') return;
                        var role = m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai');
                        var div = document.createElement('div');
                        div.className = 'msg ' + role + (m.type === 'final' ? ' ai-final' : '');
                        self.setMsgContent(div, m.content, role);
                        body.appendChild(div);
                    });
                    // DB 历史渲染完成：标题显示第一句用户提问
                    var fu2 = body.querySelector('.msg.user');
                    if (fu2) self.updateChatTitle(box, '');
                }).catch(function() {});
                    self._refreshUserMsgBtns(body);
            }

            body.scrollTop = body.scrollHeight;

            this.activate(box);
            this.bindChatBox(box, chat);
            this._updateProjectBtn(chat);
            Store.saveChatBox(chat);
            Store.addLog('info', chat.id, 'restore', '从项目历史恢复对话: ' + boxName);
            self.updateStatus();
            self.hideHint();
            self.updateMinimap();
        },
});
