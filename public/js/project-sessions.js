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
            box.innerHTML =
                App.buildChatboxPanels({
                    header: App.buildChatboxHeader({
                        title: title,
                        headerTitleAttr: '拖拽移动对话；按住 Shift 拖拽可复制一个一模一样的对话到鼠标落点',
                        extraBeforeButtons: '<span class="proj-name" style="display:none"></span>'
                    })
                });
            // 底部配置区控件（引擎菜单/分类菜单）统一填充
            App.fillChatboxConfigWidgets(box, { engineId: node._engine || node.engine || '', categoryName: _projCatName });

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
                    // 任务 meta 消息（⏱__TASKMETA__ 前缀）不渲染本体，由 _restoreTaskMetaRow 统一重绘耗时行+撤销按钮
                    if (m.role === 'assistant' && String(m.content || '').indexOf('\u23F1__TASKMETA__') === 0) {
                        chat.history.push({ role: m.role, content: m.content });
                        return;
                    }
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
                // 恢复任务耗时行+撤销按钮（若有 meta 且其后无新用户消息）
                if (self._restoreTaskMetaRow) self._restoreTaskMetaRow(box, chat, msgs);
            } else if (typeof DB !== 'undefined' && DB.online) {
                DB.getChatHistory(node.id).then(function(res) {
                    var rows = (res && res.data) ? res.data : [];
                    rows.forEach(function(m) {
                        if (m.type === 'typing') return;
                        if (m.type === 'tool_call') return;
                        if (m.role === 'tool') return;
                        // 任务 meta 消息不渲染本体，由 _restoreTaskMetaRow 统一重绘
                        if (m.role === 'assistant' && String(m.content || '').indexOf('\u23F1__TASKMETA__') === 0) {
                            if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') chat.history.push({ role: m.role, content: m.content });
                            return;
                        }
                        var role = m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai');
                        var div = document.createElement('div');
                        div.className = 'msg ' + role + (m.type === 'final' ? ' ai-final' : '');
                        self.setMsgContent(div, m.content, role);
                        body.appendChild(div);
                        // 【关键修复】DB 兜底分支也必须写回 chat.history，否则重启后走服务端恢复时模型上下文为空（用户最后的问题和中途工具丢失）
                        if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') chat.history.push({ role: m.role, content: m.content });
                    });
                    // DB 历史渲染完成：标题显示第一句用户提问
                    var fu2 = body.querySelector('.msg.user');
                    if (fu2) self.updateChatTitle(box, '');
                    // DB 兜底分支同样恢复任务耗时行+撤销按钮
                    if (self._restoreTaskMetaRow) self._restoreTaskMetaRow(box, chat, rows);
                }).catch(function() {});
                    self._refreshUserMsgBtns(body);
            }

            body.scrollTop = body.scrollHeight;

            this.activate(box);
            this.bindChatBox(box, chat);
            this._updateProjectBtn(chat);
            // 【按用户要求】恢复对话后不再重建角色按钮行（策划师/施工队/审核员/总结师等），
            // 重启后 AI 答案下方保持干净，不带压缩/角色条；该行仍会在 AI 回复完成时正常渲染。
            Store.saveChatBox(chat);
            Store.addLog('info', chat.id, 'restore', '从项目历史恢复对话: ' + boxName);
            self.updateStatus();
            self.hideHint();
            self.updateMinimap();
        },
});
