// ==== 拆分自 app-chatbox.js：格式化耗时_关闭对话框_更新右键菜单中"_恢复最后一个关闭 ====
Object.assign(App, {
        // ===== 格式化耗时 =====
        _formatDuration: function(ms) {
            if (!ms || ms < 0) ms = 0;
            var totalSec = Math.floor(ms / 1000);
            if (totalSec < 1) return ms + 'ms';
            if (totalSec < 60) return totalSec + 's';
            var m = Math.floor(totalSec / 60);
            var s = totalSec % 60;
            if (m < 60) return m + 'm' + (s > 0 ? s + 's' : '');
            var h = Math.floor(m / 60);
            m = m % 60;
            return h + 'h' + (m > 0 ? m + 'm' : '') + (s > 0 ? s + 's' : '');
        },

        addMsgStreaming: function(box, text, who, modelId, isFinal, onDone) {
            var self = this;
            text = String(text == null ? '' : text);
            // skipSave=true：流式内容尚未完整，先不持久化（避免把空内容写入数据库导致重启后回复空白）
            var div = this.addMsg(box, '', who, modelId, isFinal, true);
            if (who !== 'ai' || !text) {
                if (onDone) onDone(div);
                return div;
            }
            var body = box.querySelector('.chatbox-body');
            var index = 0;
            var step = Math.max(1, Math.ceil(text.length / 20)); // 提速：每次tick显示更多字符（较原/30快1.5倍）
            var lastTick = 0;   // 上次 tick 时间戳（检测后台节流用）
            var tick = function() {
                // 页面切到后台时浏览器会节流 setTimeout（后台标签约1秒/次），打字动画会积压；
                // 切回页面后所有工具说明文本会集中"流式重放"，观感异常。
                // 因此：页面不可见 或 两次 tick 间隔异常大（经历后台节流）时，
                // 跳过打字动画直接显示完整内容，切回后看到的就是工具执行完毕的最终结果。
                var now = Date.now();
                if (document.hidden || (lastTick > 0 && now - lastTick > 800)) {
                    index = text.length;
                    self._setMsgContent(div, text);
                    if (body) body.scrollTop = body.scrollHeight;
                    // 动画完成：用完整内容持久化，保证重启后回复可见
                    try {
                        if (box.id && typeof Store !== 'undefined') {
                            var role = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
                            var msgType = isFinal ? 'final' : 'text';
                            var msgParentId = null;
                            if (role === 'assistant' && Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) {
                                msgParentId = Store._lastUserMsgIds[box.id];
                            }
                            Store.addMessage(box.id, role, text, msgType, modelId, msgParentId);
                        }
                    } catch (e) {}
                    if (onDone) onDone(div);
                    return;
                }
                lastTick = now;
                index = Math.min(text.length, index + step);
                // [Fix 2026-01-12] 流式阶段严禁重跑 markdown 渲染。
                // 半截 HTML（未闭合的 <table>/<li>/<code> 等）经 marked 反复解析会
                // 产生损坏的 DOM 树，浏览器自动补全闭合标签时会把表格/列表/代码块
                // 搬出原父容器，导致"表格飞走""代码块错位"等渲染 bug。
                // 改为：打字机阶段只更新 textContent，最后一帧才走完整 markdown 管道。
                if (div._streamMd) {
                    self.setMsgContent(div, text, who);
                    div._streamMd = false;
                } else {
                    div.textContent = text.slice(0, index);
                }
                if (body) body.scrollTop = body.scrollHeight;
                if (index < text.length) {
                    if (text.length - index <= step) div._streamMd = true;
                    setTimeout(tick, 18);
                } else {
                    // 动画完成：用完整内容持久化，保证重启后回复可见
                    try {
                        if (box.id && typeof Store !== 'undefined') {
                            var role = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
                            var msgType = isFinal ? 'final' : 'text';
                            var msgParentId = null;
                            if (role === 'assistant' && Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) {
                                msgParentId = Store._lastUserMsgIds[box.id];
                            }
                            Store.addMessage(box.id, role, text, msgType, modelId, msgParentId);
                        }
                    } catch (e) {}
                    if (onDone) onDone(div);
                }
            };
            setTimeout(tick, 18);
            return div;
        },

        _setMsgContent: function(div, text) {
            if (!div) return;
            var content = div.querySelector('.msg-content');
            if (content) {
                content.innerHTML = this.renderMarkdown(text);
            } else {
                div.textContent = text;
            }
        },

        addMsg: function(box, text, who, modelId, isFinal, skipSave) {
            var self = this;
            var body = box.querySelector('.chatbox-body');
            var div = document.createElement('div');
            div.className = 'msg ' + who + (isFinal && who === 'ai' ? ' ai-final' : '');
            if (who === 'typing') {
                // 增强型 typing 指示器：旋转图标 + 文字 + 实时计时器（每秒更新）
                var _typingStart = Date.now();
                div.innerHTML =
                    '<span class="typing-spinner"></span>' +
                    '<span class="typing-text">' + this._escapeHtml(text) + '</span>' +
                    '<span class="typing-timer">0s</span>';
                var _timerEl = div.querySelector('.typing-timer');
                div._typingInterval = setInterval(function() {
                    if (!div.parentNode) { clearInterval(div._typingInterval); return; }
                    var secs = Math.floor((Date.now() - _typingStart) / 1000);
                    if (secs < 60) { _timerEl.textContent = secs + 's'; }
                    else { _timerEl.textContent = Math.floor(secs / 60) + 'm' + (secs % 60) + 's'; }
                }, 1000);
            } else {
                this.setMsgContent(div, text, who);
            }
            // 工具组默认折叠为紧凑条，用户点击展开查看详情
            body.appendChild(div);
            self._refreshUserMsgBtns(body);
            var _chat = this.chatBoxes.find(function(c) { return c.el === box; }) || self.chatBoxes.find(function(c) { return c.id === box.id; });
            if (_chat && _chat.autoFollowBottom) {
                body.scrollTop = body.scrollHeight;
            } else if (!_chat) {
                body.scrollTop = body.scrollHeight;
            }
            var sbb = box.querySelector('.scroll-bottom-btn');
            if (sbb && (!_chat || _chat.autoFollowBottom)) sbb.classList.remove('visible');
            // 持久化（typing 类型是临时的，不保存）
            if (!skipSave && who !== 'typing' && box.id) {
                var role = who === 'user' ? 'user' : (who === 'error' ? 'error' : 'assistant');
            var msgType = isFinal ? 'final' : 'text';
                var msgParentId = null;
                if (role === 'assistant' && Store._lastUserMsgIds && Store._lastUserMsgIds[box.id]) {
                    msgParentId = Store._lastUserMsgIds[box.id];
                }
                Store.addMessage(box.id, role, text, msgType, modelId, msgParentId);
                if (who === 'error' && self.updateMinimap) self.updateMinimap();
            }
            return div;
        },

        // ===== 关闭对话框 =====
        closeChatBox: function(chat) {
            // 清理 bindChatBox 注册的监听器和定时器（替代 monkey-patch 方案）
            if (chat._cleanup) {
                if (chat._cleanup.scrollBtnTimer) clearInterval(chat._cleanup.scrollBtnTimer);
                if (chat._cleanup.navArrowTimer) clearInterval(chat._cleanup.navArrowTimer);
                chat._cleanup.listeners.forEach(function(item) {
                    item.target.removeEventListener(item.event, item.handler);
                });
                chat._cleanup = null;
            }
            if (chat.el) this.flushQueryPin(chat.el, chat);
            // 保存关闭快照（用于恢复）
            var el = chat.el;
            var snapshot = {
                id: chat.id,
                modelId: chat.modelId || '',
                modelIdOverride: chat._modelIdOverride || '',
                reasoningEffort: chat._reasoningEffort || '',
                x: el ? parseInt(el.style.left) || 0 : 0,
                y: el ? parseInt(el.style.top) || 0 : 0,
                w: el ? el.offsetWidth || 360 : 360,
                h: el ? el.offsetHeight || 480 : 480,
                z: el ? parseInt(el.style.zIndex) || 50 : 50,
                collapsed: el ? el.classList.contains('collapsed') : false,
                title: el && el.querySelector('.title') ? el.querySelector('.title').textContent : '',
                createdAt: chat.createdAt || Date.now(),
                chatNum: chat.chatNum || 0,
                messages: Store.getMessages(chat.id).slice(),
                projectId: chat.projectId || null
            };
            this._closedStack.push(snapshot);
            if (this._closedStack.length > 20) this._closedStack.shift();
            // 更新右键菜单显示
            this._updateRestoreMenu();

            var idx = this.chatBoxes.indexOf(chat);
            if (idx >= 0) this.chatBoxes.splice(idx, 1);
            if (chat.el) chat.el.remove();
            // 内存中立即删除 chatBox 条目，DB 也立即清理
            // 快照保存在 _closedStack 中，可通过右键菜单"恢复已关闭"还原
            var self2 = this;
            Store.data.chatBoxes = Store.data.chatBoxes.filter(function(b) { return b.id !== chat.id; });
            // 取消防抖定时器
            if (Store._timers['box_' + chat.id]) {
                clearTimeout(Store._timers['box_' + chat.id]);
                Store._timers['box_' + chat.id] = null;
            }
            // 立即清理 DB（不再延迟 3 秒，避免页面关闭后 DB 残留导致重启后重新打开已关闭面板）
            // 快照仍保存在 _closedStack 中用于"恢复已关闭"功能；
            // 恢复时 restoreLastClosed 会通过 Store.saveChatBox + DB.addChatMessage 重新写入 DB
            if (Store.dbOnline && typeof DB !== 'undefined') {
                DB.deleteNode(snapshot.id).catch(function(e) { console.warn('[Chatbox] node delete failed:', e); });
                DB.clearChatHistory(snapshot.id).catch(function() {});
            }
            Store.addLog('info', chat.id, 'close', '关闭对话框');
            // 联动清理：删除该对话关联的任务清单，并刷新任务面板
            if (typeof App !== 'undefined' && App._cleanupTaskListsForChat) {
                App._cleanupTaskListsForChat(chat.id);
            }
            this.updateStatus();
            this.updateMinimap();
            // 刷新所有剩余对话框的导航箭头
            this._updateAllNavArrows();
            // 清理已移至画布层的箭头容器
            var hostLayer2 = (chat.el && (chat.el.offsetParent || chat.el.parentNode)) || null;
            if (hostLayer2) {
                var navEl = hostLayer2.querySelector('.cbx-succ-nav[data-for="' + chat.id + '"]');
                if (navEl) navEl.remove();
            }
            // 如果所有对话框都已关闭，重新显示画布提示
            if (this.chatBoxes.length === 0) {
                this.showHint();
            }
        },

        // ===== 更新右键菜单中"恢复已关闭"项的显示 =====
        _updateRestoreMenu: function() {
            var item = document.getElementById('ctxRestoreClosed');
            var sep = document.getElementById('ctxSepRestore');
            if (!item || !sep) return;
            var has = this._closedStack.length > 0;
            sep.style.display = has ? '' : 'none';
            item.style.display = has ? '' : 'none';
            if (has) {
                var last = this._closedStack[this._closedStack.length - 1];
                var label = last.title || ('对话' + (last.chatNum || ''));
                if (label.length > 12) label = label.substring(0, 12) + '…';
                item.innerHTML = '<span class="ctx-icon">\u267b\ufe0f</span> 恢复: ' + label;
            }
        },

        // ===== 恢复最后一个关闭的会话 =====
        restoreLastClosed: function() {
            if (this._closedStack.length === 0) return;
            var snapshot = this._closedStack.pop();
            this._updateRestoreMenu();

            var self = this;
            var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
            var box = document.createElement('div');
            box.className = 'chatbox' + (snapshot.collapsed ? ' collapsed' : '');
            box.id = snapshot.id;
            box.style.left = snapshot.x + 'px';
            box.style.top = snapshot.y + 'px';
            box.style.width = (snapshot.w || 360) + 'px';
            box.style.height = (snapshot.h || 480) + 'px';
            box.style.zIndex = ++this.zCounter;

            var modelId = snapshot.modelId || '';
            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            var title = snapshot.title || ('对话' + (snapshot.chatNum || ''));
            if (title.indexOf('\ud83d\udcac') === 0) title = title.substring(2).trim();
            var _restoredCatName = Tools.chatCategories[snapshot.id] || snapshot.toolCategory || Tools.activeCategory;
            if (!Tools.categories[_restoredCatName]) _restoredCatName = '极简';
            Tools.chatCategories[snapshot.id] = _restoredCatName;
            var _catList = Tools.getCategoryList(snapshot.id);
            var _catHtml = '';
            _catList.forEach(function(c) {
                _catHtml += '<div class="tool-cat-item' + (c.active ? ' active' : '') + '" data-cat="' + c.name + '">' +
                    '<span class="tool-cat-item-icon">' + c.icon + '</span>' +
                    '<span class="tool-cat-item-name">' + c.name + '</span>' +
                    '</div>';
            });
            var _curCat = Tools.categories[_restoredCatName];
            var _curCatIcon = _curCat ? _curCat.icon : '📄';


            box.innerHTML =
                '<div class="chatbox-header" title="拖拽移动对话；Shift+左键拖拽：按下即在鼠标处复制一个一模一样的对话并跟随拖动">' +
                    
                    '<div class="chatbox-header-row1">' +
                    
                    '<span class="status-dot status-idle"></span>' +
                    '<span class="title">' + title + '</span>' +
                    '<span class="proj-name" style="display:none"></span>' +
                    '<button class="hd-btn tool-panel-btn" data-act="tools" title="工具执行过程">🔧<span class="tool-badge" style="display:none">0</span></button>' +
                    '<button class="hd-btn log-panel-btn" data-act="logs" title="日志">📜</button>' +
                    '<button class="hd-btn close" data-act="close" title="关闭">✕</button>' +
                    '</div>' +
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
                '<button class="prev-user-btn" title="定位到上一条用户问题所在的段落"><span>\u25b2</span></button> <button class="scroll-bottom-btn" title="滚动到底部"><span>\u25bc</span></button>' +
                '<div class="chatbox-inputrow">' +
                    '<button class="upload-btn" title="上传文件 / 文件夹">+</button>' +
                    '<textarea placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>' +
                    '<button class="send-btn" title="发送消息"><svg class="send-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>' +
                '</div>' +
                '<div class="chatbox-configrow">' +
                    '<div class="tool-cat-wrap">' +
                        '<button class="tool-cat-trigger" title="切换工具分类">' +
                            '<span class="tool-cat-icon">' + _curCatIcon + '</span>' +
                            '<span class="tool-cat-name">' + _restoredCatName + '</span>' +
                            '<span class="tool-cat-arrow">▾</span>' +
                        '</button>' +
                        '<div class="tool-cat-menu" hidden>' + _catHtml + '</div>' +
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
                            '<div class="mp-re-row"><select class="mp-re-input" title="点击切换思考强度"></select></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="chatbox-resize"><span class="chatbox-resize-handle south-east"></span><span class="chatbox-resize-handle south-west"></span><span class="chatbox-resize-handle south"></span><span class="chatbox-resize-handle east"></span><span class="chatbox-resize-handle west"></span></div>';

            canvas.appendChild(box);

            var chat = {
                id: box.id,
                el: box,
                modelId: modelId,
                chatNum: snapshot.chatNum || this.chatCounter,
                history: [],
                createdAt: snapshot.createdAt,
                isSending: false,
                abortController: null,
                queue: [],
                _stopped: false,
                projectId: snapshot.projectId || null,
                // ===== 底部选择器覆盖字段（模型ID / 思考强度） =====
                _modelIdOverride: snapshot.modelIdOverride || '',
                _reasoningEffort: snapshot.reasoningEffort || ''
            };
            this.chatBoxes.push(chat);
            this._updateProjectBtn(chat);

            // （原 _dbCleanupTimer 已移除，DB 在关闭时立即清理，恢复时重新写入）

            // 恢复消息到 Store 内存
            Store.data.messages[snapshot.id] = snapshot.messages ? snapshot.messages.slice() : [];

            // 重新写入 DB：先清空旧消息（防竞态残留），再逐条写入
            // 传入原始 ts，保持时间一致性（服务端按原始时间归档，避免伪重复）
            if (snapshot.messages && snapshot.messages.length && Store.dbOnline && typeof DB !== 'undefined') {
                var sid = snapshot.id;
                DB.clearChatHistory(sid).then(function() {
                    snapshot.messages.forEach(function(m) {
                        DB.addChatMessage(sid, m.role, m.content, m.modelId || '', null, m.ts).catch(function() {});
                    });
                }).catch(function() {});
            }

            // 渲染消息到 DOM（分块异步渲染，避免大量消息同步阻塞）
            var body = box.querySelector('.chatbox-body');
            var msgs = Store.getMessages(snapshot.id);
            if (msgs.length) {
                var msgIdx = 0;
                var CHUNK_SIZE = 8;
                (function renderChunk() {
                    var end = Math.min(msgIdx + CHUNK_SIZE, msgs.length);
                    var frag = document.createDocumentFragment();
                    for (; msgIdx < end; msgIdx++) {
                        var m = msgs[msgIdx];
                        if (m.type === 'typing' || m.type === 'tool_call') continue;
                        var div = document.createElement('div');
                        var whoCls = (m.role === 'user' ? 'user' : (m.role === 'error' ? 'error' : 'ai'));
                        div.className = 'msg ' + whoCls + (m.type === 'final' ? ' ai-final' : '');
                        var restoredContent = String(m.content || '');
                        if (m.role === 'assistant' && restoredContent.indexOf('\u2705 \u4efb\u52a1\u5b8c\u6210') === 0) div.classList.add('task-result-success');
                        if (m.role === 'assistant' && (restoredContent.indexOf('\u274c \u4efb\u52a1\u5931\u8d25') === 0 || restoredContent.indexOf('\u274C \u4efb\u52a1\u5931\u8d25') === 0)) div.classList.add('task-result-fail');
                        self.setMsgContent(div, m.content, whoCls);
                        frag.appendChild(div);
                        if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') chat.history.push({ role: m.role, content: m.content });
                    }
                    body.appendChild(frag);
                    if (msgIdx < msgs.length) {
                        requestAnimationFrame(renderChunk);
                    } else {
                        body.scrollTop = body.scrollHeight;
                        // 渲染完成：标题显示第一句用户提问
                        var fu = body.querySelector('.msg.user');
                        if (fu) self.updateChatTitle(box, '');
                    }
                        self._refreshUserMsgBtns(body);
                })();
            } else {
                body.scrollTop = body.scrollHeight;
            }

            this.syncChatCounter();
            this.activate(box);
            this.bindChatBox(box, chat);
            this._updateProjectBtn(chat);
            Store.saveChatBox(chat);
            Store.addLog('info', chat.id, 'restore', '恢复已关闭的对话: ' + boxName);
            this.updateStatus();
            this.hideHint();
            this.updateMinimap();
        },

});
