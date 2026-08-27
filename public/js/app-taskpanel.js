// ========== app-taskpanel.js - 右侧任务清单面板 ==========
// 当存在任务清单时显示浮动按钮，点击展开右侧面板查看所有任务进度
Object.assign(App, {

    // ===== 任务面板状态 =====
    _taskPanelOpen: false,
    _taskLists: [],
    _taskPollTimer: null,
    _taskHasLists: false,
    _taskRefreshVersion: 0,

    // ===== 初始化 =====
    _taskActiveTab: 'task',
    _chatPollTimer: null,

    // ===== 对话面板排序/筛选状态 =====
    _chatSortField: 'time',      // 'time' | 'status'
    _chatSortDir: 'desc',        // 'asc' | 'desc'
    _chatStatusFilter: 'all',    // 'all' | 'busy' | 'idle' | 'queued' | 'stopped'

    _initTaskPanel: function() {
        var self = this;


        // 热更新安全：清理上一实例遗留的幽灵定时器
        if (self._taskPollTimer) { clearInterval(self._taskPollTimer); self._taskPollTimer = null; }
        if (self._chatPollTimer) { clearInterval(self._chatPollTimer); self._chatPollTimer = null; }
        if (window.__taskPollTimer) { clearInterval(window.__taskPollTimer); window.__taskPollTimer = null; }
        if (window.__chatPollTimer) { clearInterval(window.__chatPollTimer); window.__chatPollTimer = null; }

        // 绑定任务按钮点击
        var btn = document.getElementById('taskPanelBtn');
        if (btn) {
            btn.addEventListener('click', function() {
                self._switchTab('task');
                self.openTaskPanel();
            });
        }

        // 绑定对话状态按钮点击
        var csBtn = document.getElementById('chatStatusBtn');
        if (csBtn) {
            csBtn.addEventListener('click', function() {
                self._switchTab('chat');
                self.openTaskPanel();
            });
        }

        // 绑定 Tab 切换
        var tabs = document.querySelectorAll('.tp-tab');
        tabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                if (!this.classList.contains('task-panel-close')) {
                    self._switchTab(this.getAttribute('data-tab'));
                }
            });
        });

        // 绑定面板关闭按钮
        var closeBtn = document.getElementById('taskPanelCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                self.closeTaskPanel();
            });
        }

        // 点击遮罩关闭
        var overlay = document.getElementById('taskPanelOverlay');
        if (overlay) {
            overlay.addEventListener('click', function() {
                self.closeTaskPanel();
            });
        }

        // 恢复用户上次调整后的面板宽度，并绑定拖拽
        this._initTaskPanelResize();

        // 首次加载：后端 /api/tools/task_list 接口已恢复，拉取一次任务列表
        this.refreshTaskPanel();

        // 启动轮询：刷新对话状态 + 任务列表（面板打开时更频繁刷新任务）
        this._taskPollTimer = setInterval(function() {
            self._updateChatStatusButton();
            if (self._taskPanelOpen && self._taskActiveTab !== 'chat') {
                self._renderChatPanel();
                self.refreshTaskPanel();
            }
        }, 5000);
        // 存到全局变量，热更新后也能清理
        window.__taskPollTimer = this._taskPollTimer;
        window.__chatPollTimer = this._chatPollTimer;
    },

    _initTaskPanelResize: function() {
        var panel = document.getElementById('taskPanel');
        var handle = document.getElementById('taskPanelResizeHandle');
        if (!panel || !handle || handle.dataset.bound === '1') return;
        handle.dataset.bound = '1';
        var baseWidth = 360;
        var minWidth = 280;
        var maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.75));
        var offset = parseInt(UserSettings.get('taskPanelWidthOffset'), 10);
        if (!Number.isFinite(offset)) offset = 50;
        var applyWidth = function(width) {
            width = Math.max(minWidth, Math.min(maxWidth, width));
            panel.style.setProperty('--task-panel-width', width + 'px');
            UserSettings.set('taskPanelWidthOffset', String(width - baseWidth));
        };
        applyWidth(baseWidth + offset);
        var dragging = false;
        handle.addEventListener('pointerdown', function(event) {
            dragging = true;
            handle.classList.add('is-dragging');
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        handle.addEventListener('pointermove', function(event) {
            if (!dragging) return;
            applyWidth(window.innerWidth - event.clientX);
        });
        handle.addEventListener('pointerup', function(event) {
            dragging = false;
            handle.classList.remove('is-dragging');
            if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        });
        handle.addEventListener('pointercancel', function() {
            dragging = false;
            handle.classList.remove('is-dragging');
        });
    },

    // ===== Tab 切换 =====
    _switchTab: function(tab) {
        this._taskActiveTab = tab;
        var tabs = document.querySelectorAll('.tp-tab');
        tabs.forEach(function(t) {
            if (t.getAttribute('data-tab') === tab) t.classList.add('active');
            else t.classList.remove('active');
        });
        var taskBody = document.getElementById('taskPanelBody');
        var chatBody = document.getElementById('chatPanelBody');
        var historyBody = document.getElementById('historyPanelBody');
        var modelBody = document.getElementById('modelPanelBody');
        var searchBar = document.getElementById('chatSearchBar');
        if (tab === 'chat') {
            if (taskBody) taskBody.style.display = 'none';
            if (chatBody) chatBody.style.display = '';
            if (historyBody) historyBody.style.display = 'none';
            if (modelBody) modelBody.style.display = 'none';
            if (searchBar) searchBar.style.display = '';
            this._renderChatPanel();
        } else if (tab === 'history') {
            if (taskBody) taskBody.style.display = 'none';
            if (chatBody) chatBody.style.display = 'none';
            if (historyBody) historyBody.style.display = '';
            if (modelBody) modelBody.style.display = 'none';
            if (searchBar) searchBar.style.display = 'none';
            this._loadHistoryPanel();
        } else if (tab === 'model') {
            if (taskBody) taskBody.style.display = 'none';
            if (chatBody) chatBody.style.display = 'none';
            if (historyBody) historyBody.style.display = 'none';
            if (modelBody) modelBody.style.display = '';
            if (searchBar) searchBar.style.display = 'none';
            this._loadModelPanel();
        } else {
            if (taskBody) taskBody.style.display = '';
            if (chatBody) chatBody.style.display = 'none';
            if (historyBody) historyBody.style.display = 'none';
            if (modelBody) modelBody.style.display = 'none';
            if (searchBar) searchBar.style.display = 'none';
            this.refreshTaskPanel();
        }
    },

    _loadModelPanel: function() {
        var body = document.getElementById('modelPanelBody');
        if (!body) return;
        body.innerHTML = '<div class="tp-empty">正在统计今日大模型...</div>';
        // 今日统计仅需要一个“天”的数据，用 day 分页接口轻量获取（不再拉全量历史）
        var self = this;
        var today = new Date();
        var dayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        var records = [];
        var totalCount = 0;
        var fetchPage = function(offset) {
            return fetch('/api/db/chat-history/all?day=' + dayStr + '&offset=' + offset + '&limit=50').then(function(response) { return response.json(); }).then(function(result) {
                if (result && result.ok && Array.isArray(result.data)) {
                    records = records.concat(result.data);
                    totalCount = result.total || records.length;
                    if (records.length < totalCount && result.data.length) return fetchPage(records.length);
                }
                return records;
            });
        };
        fetchPage(0).then(function() {
            self._renderModelPanel(body, records);
        }).catch(function() {
            body.innerHTML = '<div class="tp-empty">大模型统计加载失败</div>';
        });
    },

    _renderModelPanel: function(body, records) {
            var now = new Date();
            var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            // 按“具体模型 ID”统计：同一条 user 消息记录一次，不做会话去重，
            // 这样火山方舟下的 deepseek / glm 等不同模型 ID 会被分别计数。
            var counts = {};
            records.forEach(function(record) {
                var model = String(record.model_id || record.modelId || record.model || '').trim();
                if (model) counts[model] = (counts[model] || 0) + 1;
            });
            var models = Object.keys(counts).map(function(name) { return { name: name, count: counts[name] }; }).sort(function(a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
            if (!models.length) { body.innerHTML = '<div class="tp-empty">今日暂无大模型对话</div>'; return; }
            body.innerHTML = '<div class="model-panel-summary">今日已使用 ' + models.length + ' 个模型ID，共 ' + models.reduce(function(sum, item) { return sum + item.count; }, 0) + ' 条对话</div>' + models.map(function(item, index) { return '<div class="model-stat-card"><span class="model-stat-rank">' + (index + 1) + '</span><span class="model-stat-name"></span><span class="model-stat-count">' + item.count + ' 条</span></div>'; }).join('');
            body.querySelectorAll('.model-stat-name').forEach(function(element, index) { element.textContent = models[index].name; });
    },

    _loadHistoryPanel: function() {
        var self = this;
        var body = document.getElementById('historyPanelBody');
        if (!body) return;
        // 历史面板每次打开都读取最新数据，避免发送消息后继续显示旧的空状态。
        this._historyRecords = null;
        // 每个会话当前已加载的对话数（按天分页状态），key = "YYYY-MM-DD"
        this._historyDayLoaded = {};

        body.innerHTML = '<div class="tp-empty">正在加载历史提问...</div>';
        fetch('/api/db/chat-history/all?initial=5').then(function(response) {
            return response.json();
        }).then(function(result) {
            if (!result || !result.ok || !result.data || !Array.isArray(result.data.days)) {
                body.innerHTML = '<div class="tp-empty">暂无历史提问</div>';
                return;
            }
            self._historyDays = result.data.days || [];
            self._renderHistoryPanel(body, self._historyDays);
        }).catch(function() {
            body.innerHTML = '<div class="tp-empty">历史提问加载失败</div>';
        });
    },

    // 按天加载更多对话（每次 5 条）
    _loadMoreHistoryForDay: function(dayStr, done) {
        var self = this;
        var loaded = this._historyDayLoaded[dayStr] || 5;
        fetch('/api/db/chat-history/all?day=' + encodeURIComponent(dayStr) + '&offset=' + loaded + '&limit=5').then(function(response) {
            return response.json();
        }).then(function(result) {
            var records = (result && result.ok && Array.isArray(result.data)) ? result.data : [];
            self._historyDayLoaded[dayStr] = loaded + records.length;
            done(records, (result && result.total) || 0);
        }).catch(function() {
            done([], 0);
        });
    },

    _renderHistoryPanel: function(body, days) {
        var self = this;

        if (!days || !days.length) {
            body.innerHTML = '<div class="tp-empty">暂无历史提问</div>';
            return;
        }
        var now = new Date();
        var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        var yesterdayStr = yesterdayDate.getFullYear() + '-' + String(yesterdayDate.getMonth() + 1).padStart(2, '0') + '-' + String(yesterdayDate.getDate()).padStart(2, '0');
        var fragment = document.createDocumentFragment();

        days.forEach(function(dayData) {
            var dayStr = dayData.day;
            if (!self._historyDayLoaded[dayStr]) self._historyDayLoaded[dayStr] = 5;

            var label = dayStr === todayStr ? '今天' : (dayStr === yesterdayStr ? '昨天' : dayStr);
            var details = document.createElement('details');
            details.className = 'history-day'; details.open = true;
            var summary = document.createElement('summary');
            // 不再统计整体数量，仅显示轻量的当日对话数
            summary.textContent = label + '（' + dayData.total + ' 个对话）';
            details.appendChild(summary);
            var list = document.createElement('div'); list.className = 'history-day-list';

            // 已加载的记录（每天默认前 5 条）
            var records = dayData.records || [];
            records.forEach(function(record) {
                var conversation = self._buildHistoryConversation(record);
                if (conversation) list.appendChild(conversation);
            });

            // “加载更多”按钮：每次追加 5 条
            if (records.length < dayData.total) {
                var more = document.createElement('button'); more.type = 'button'; more.className = 'history-more';
                var remaining = dayData.total - records.length;
                more.textContent = '加载更多（剩余 ' + remaining + ' 个对话）';
                more.addEventListener('click', function() {
                    more.disabled = true;
                    more.textContent = '加载中...';
                    self._loadMoreHistoryForDay(dayStr, function(newRecords, total) {
                        newRecords.forEach(function(record) {
                            var conversation = self._buildHistoryConversation(record);
                            if (conversation) list.insertBefore(conversation, more);
                        });
                        var loadedNow = (self._historyDayLoaded[dayStr] || 0);
                        if (loadedNow >= (total || dayData.total) || !newRecords.length) {
                            more.remove();
                        } else {
                            more.disabled = false;
                            more.textContent = '加载更多（剩余 ' + ((total || dayData.total) - loadedNow) + ' 个对话）';
                        }
                    });
                });
                list.appendChild(more);
            }
            details.appendChild(list); fragment.appendChild(details);
        });
        body.replaceChildren(fragment);
    },

    // 构造单个历史对话（一个对话 = 一条 user 记录）
    _buildHistoryConversation: function(record) {
        var self = this;
        if (!record) return null;
        var rawTime = Number(record.created_at || 0);
        var time = new Date(rawTime < 10000000000 ? rawTime * 1000 : rawTime);
        var conversation = document.createElement('details'); conversation.className = 'history-conversation';
        var title = document.createElement('summary');
        var contentPreview = String(record.content || record.session_name || '未命名提问');
        // ===== 对话完成率徽标（MVP：✅≥95% / ⚠️70~94% / ❌<70%，无记录不显示）=====
        var rateBadge = '';
        if (record.task_total) {
            var rate = Number(record.task_rate || 0);
            var cls = rate >= 95 ? 'ok' : (rate >= 70 ? 'warn' : 'fail');
            var icon = rate >= 95 ? '✅' : (rate >= 70 ? '⚠️' : '❌');
            rateBadge = '<span class="history-rate-badge ' + cls + '" title="对话完成率：' + rate + '%（' + (record.task_done || 0) + '/' + record.task_total + ' 个任务成功）">' + icon + ' ' + rate + '%</span>';
            title.classList.add('has-rate-badge');
        }
        // 标题文本放入独立 span：超长部分由 CSS 省略号裁剪，避免溢出压到右侧"↗"按钮
        var titleText = document.createElement('span');
        titleText.className = 'history-title-text';
        titleText.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '  ' + contentPreview.slice(0, 60);
        // 悬停显示较完整内容（后端前缀最多 200 字符）
        title.setAttribute('title', contentPreview.length > 200 ? contentPreview.slice(0, 200) + '…' : contentPreview);
        var continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.className = 'history-continue';
        continueBtn.title = '新建对话并发送已选择的问题';
        continueBtn.setAttribute('aria-label', continueBtn.title);
        continueBtn.setAttribute('data-tooltip', continueBtn.title);
        continueBtn.textContent = '↗';
        var questionRecord = { record: { content: record.content || '' }, time: time };
        continueBtn.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            self._continueHistoryConversation([questionRecord]);
        });
        title.appendChild(titleText);
        if (rateBadge) title.insertAdjacentHTML('beforeend', rateBadge);
        title.appendChild(continueBtn);
        conversation.appendChild(title);
        // ===== 修复：点击标题展开该对话的完整消息（原先 details 内无内容，点开是空的）=====
        // 展开时按需拉取该会话的完整历史消息（user + assistant），轻量渲染。
        conversation.addEventListener('toggle', function() {
            if (!conversation.open) return;
            var bodyEl = conversation.querySelector('.history-questions, .history-msgs');
            if (bodyEl && bodyEl.childElementCount > 0) return; // 已加载过
            var sid = record.session_id;
            if (!sid) return;
            var loading = document.createElement('div');
            loading.className = 'history-question';
            loading.textContent = '⏳ 加载对话消息...';
            conversation.appendChild(loading);
            fetch('/api/db/chat/' + encodeURIComponent(sid)).then(function(r) { return r.json(); }).then(function(res) {
                loading.remove();
                var msgs = (res && res.ok && Array.isArray(res.data)) ? res.data : [];
                var wrap = document.createElement('div');
                wrap.className = 'history-questions';
                if (!msgs.length) {
                    var empty = document.createElement('div');
                    empty.className = 'history-question';
                    empty.textContent = '（该对话无历史消息记录）';
                    wrap.appendChild(empty);
                }
                msgs.forEach(function(m) {
                    // 展开区只展示用户提问，不展示 AI、工具与输入中消息。
                    if (m.role !== 'user') return;
                    var text = String(m.content || '').replace(/\s+/g, ' ').trim();
                    if (!text) return;
                    var line = document.createElement('div');
                    line.className = 'history-question';
                    line.textContent = text;
                    // CSS 负责单行省略；title 保留完整提问供鼠标悬停查看。
                    line.title = text;
                    wrap.appendChild(line);
                });
                conversation.appendChild(wrap);
            }).catch(function() {
                loading.remove();
                var err = document.createElement('div');
                err.className = 'history-question';
                err.textContent = '⚠️ 历史消息加载失败';
                conversation.appendChild(err);
            });
        });
        return conversation;
    },

    _continueHistoryConversation: function(questionItems) {
        var canvas = document.getElementById('canvasContent') || document.getElementById('canvasArea');
        if (!canvas || !questionItems || !questionItems.length || typeof App.createChatBox !== 'function') return;
        var rect = canvas.getBoundingClientRect();
        var box = App.createChatBox(rect.left + Math.max(40, rect.width / 2 - 220), rect.top + Math.max(40, rect.height / 2 - 180));
        if (!box) return;
        var context = questionItems.map(function(item) { return String(item.record.content || '').trim(); }).filter(Boolean).join('\n');
        var boxEl = box.el || box;
        if (!boxEl || typeof boxEl.querySelector !== 'function') return;
        var input = boxEl.querySelector('textarea');
        if (!input || !context) return;
        input.value = context;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        // 仅将选中的历史消息填入新对话，发送由用户确认后执行。
    },

    openTaskPanel: function() {
        var panel = document.getElementById('taskPanel');
        var overlay = document.getElementById('taskPanelOverlay');
        if (!panel) return;
        panel.classList.add('open');
        void panel.offsetWidth; // 强制回流，防止合成器跳过重绘
        if (overlay) overlay.classList.add('show');
        this._taskPanelOpen = true;
        if (this._taskActiveTab === 'chat') {
            this._renderChatPanel();
        } else {
            this.refreshTaskPanel();
        }
    },

    closeTaskPanel: function() {
        var panel = document.getElementById('taskPanel');
        var overlay = document.getElementById('taskPanelOverlay');
        if (!panel) return;
        panel.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        this._taskPanelOpen = false;
    },

    // Remove task lists owned by a chat as soon as that chat is closed.
    _cleanupTaskListsForChat: function(chatId) {
        if (!chatId) return;
        // Invalidate in-flight aggregate reads so a closing chat cannot reappear on completion.
        this._taskRefreshVersion++;
        this._taskLists = (this._taskLists || []).filter(function(list) {
            return String(list.chat_id || '') !== String(chatId);
        });
        this._taskHasLists = this._taskLists.length > 0;
        this._updateTaskButton();
        if (this._taskPanelOpen) this._renderTaskPanel();
        // ✅ 5.0.0 修复：原 fetch /api/tools/task_list 已 404，改用 Tools.task_list（如可用）
        // 清理操作不需要重新拉取数据，本地已过滤即可；如需通知后端则走 Tools 静默调用
        try {
            if (typeof Tools !== 'undefined' && typeof Tools.execute === 'function') {
                Tools.execute('task_list', { action: 'delete', chat_id: String(chatId) }, { chatId: String(chatId) })
                    .catch(function(err) { console.warn('[TaskPanel] cleanup tool unavailable:', err && err.message); });
            }
        } catch (e) {
            console.warn('[TaskPanel] cleanup skipped:', e && e.message);
        }
    },

    // ===== 刷新任务面板（聚合所有当前打开对话的任务） =====
    refreshTaskPanel: function() {
        var self = this;
        var refreshVersion = ++this._taskRefreshVersion;
        var chatIds = (this.chatBoxes || []).map(function(chat) {
            return chat && chat.id ? String(chat.id).trim() : '';
        }).filter(Boolean);

        if (typeof Tools === 'undefined' || typeof Tools.execute !== 'function' || chatIds.length === 0) {
            self._taskLists = [];
            self._taskHasLists = false;
            self._updateTaskButton();
            if (self._taskPanelOpen) self._renderTaskPanel();
            return;
        }

        // 每个 task_list 都绑定其来源对话；并行查询后只保留当前仍打开的对话任务。
        Promise.all(chatIds.map(function(chatId) {
            return Tools.execute('task_list', { action: 'show' }, { chatId: chatId })
                .then(function(data) {
                    // Tools.execute 返回 { success, message, html, data: 原始响应 }
                    // 后端原始响应在 data.data 里；同时兼容直接返回后端响应的情况
                    var payload = (data && data.data && typeof data.data === 'object') ? data.data : data;
                    return (payload && (payload.lists || (payload.list ? [payload.list] : []))) || [];
                })
                .catch(function(err) {
                    console.warn('[TaskPanel] unable to load tasks for ' + chatId + ':', err && err.message);
                    return [];
                });
        })).then(function(groups) {
            if (refreshVersion !== self._taskRefreshVersion) return;
            var seen = {};
            var lists = [];
            groups.forEach(function(group) {
                group.forEach(function(list) {
                    if (!list || !list.id || seen[list.id]) return;
                    seen[list.id] = true;
                    lists.push(list);
                });
            });
            self._taskLists = lists;
            self._taskHasLists = lists.length > 0;
            self._updateTaskButton();
            if (self._taskPanelOpen) self._renderTaskPanel();
        });
    },

    // ===== 更新浮动按钮显示状态 =====
    _updateTaskButton: function() {
        var btn = document.getElementById('taskPanelBtn');
        if (!btn) {
            return;
        }

        // 按钮始终显示（display:flex 由 CSS 控制），只调整内容和样式
        if (this._taskHasLists && this._taskLists.length > 0) {
            btn.style.opacity = '1';

            // 计算总进度
            var totalTasks = 0, completedTasks = 0;
            for (var i = 0; i < this._taskLists.length; i++) {
                var tl = this._taskLists[i];
                for (var j = 0; j < tl.tasks.length; j++) {
                    totalTasks++;
                    if (tl.tasks[j].status === 'completed' || tl.tasks[j].status === 'skipped') completedTasks++;
                }
            }

            // 更新徽章
            var badge = btn.querySelector('.tp-btn-badge');
            if (badge) {
                badge.textContent = totalTasks - completedTasks;
                badge.style.display = (totalTasks - completedTasks) > 0 ? '' : 'none';
            }

            // 更新进度数字
            var pct = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;
            var pctEl = btn.querySelector('.tp-btn-pct');
            if (pctEl) {
                pctEl.textContent = pct + '%';
                pctEl.style.display = '';
            }

            // 全部完成时显示绿色完成态（不隐藏按钮）
            if (totalTasks > 0 && completedTasks === totalTasks) {
                btn.classList.add('tp-btn--done');
            } else {
                btn.classList.remove('tp-btn--done');
            }
        } else {
            // 无任务时：半透明，隐藏进度和徽章
            btn.style.opacity = '0.5';
            btn.classList.remove('tp-btn--done');
            var badge = btn.querySelector('.tp-btn-badge');
            if (badge) badge.style.display = 'none';
            var pctEl = btn.querySelector('.tp-btn-pct');
            if (pctEl) pctEl.style.display = 'none';
            // 静默处理，避免每5秒刷屏控制台
        }
    },

    // ===== 渲染任务面板内容 =====
    _renderTaskPanel: function() {
        var self = this;
var body = document.getElementById('taskPanelBody');
        if (!body) return;

        if (!this._taskLists || this._taskLists.length === 0) {
            body.innerHTML =
                '<div class="tp-panel-header">' +
                '<div class="tp-panel-title">📋 任务清单</div>' +
                '</div>' +
                '<div class="tp-empty">' +
                '<div class="tp-empty-icon">📋</div>' +
                '<div class="tp-empty-text">暂无进行中的任务</div>' +
                '<div class="tp-empty-hint">AI 创建任务清单后，进度将在此实时展示</div>' +
                '</div>';
            return;
        }

        var html = '';

        // ===== Panel header with live stats =====
        var allTotal = 0, allCompleted = 0, allInProgress = 0, allPending = 0;
        for (var ci = 0; ci < this._taskLists.length; ci++) {
            for (var cj = 0; cj < this._taskLists[ci].tasks.length; cj++) {
                var cs = this._taskLists[ci].tasks[cj].status;
                allTotal++;
                if (cs === 'completed' || cs === 'skipped') allCompleted++;
                else if (cs === 'in_progress') allInProgress++;
                else allPending++;
            }
        }
        var allDone = allTotal > 0 && allCompleted === allTotal;
        var allPct = allTotal > 0 ? Math.round(allCompleted / allTotal * 100) : 0;
        html += '<div class="tp-panel-header">';
        html += '<div class="tp-panel-title">' + (allDone ? '🎉 任务清单' : '📋 任务清单') + '</div>';
        html += '</div>';

        var statusIcons = {
            'pending': '☐',
            'in_progress': '⟳️',
            'completed': '✅',
            'skipped': '⏭️'
        };

        for (var i = 0; i < this._taskLists.length; i++) {
            var tl = this._taskLists[i];
            var total = tl.tasks.length;
            var completed = 0, skipped = 0, inProgress = 0, pending = 0;

            for (var j = 0; j < tl.tasks.length; j++) {
                var s = tl.tasks[j].status;
                if (s === 'completed') completed++;
                else if (s === 'skipped') skipped++;
                else if (s === 'in_progress') inProgress++;
                else pending++;
            }

            var pct = total > 0 ? Math.round(completed / total * 100) : 0;
            var allDone = completed === total && total > 0;

            html += '<div class="tp-list-card' + (allDone ? ' tp-list-card--done' : '') + '" data-chat-id="' + (tl.chat_id || '') + '" data-list-id="' + (tl.id || '') + '">';
            html += '<div class="tp-list-header">';
            html += '<span class="tp-list-title">' + this._esc(tl.title) + '</span>';
            html += '<span class="tp-list-pct' + (allDone ? ' tp-list-pct--done' : '') + '">' + pct + '%</span>';
            html += '</div>';

            // Progress bar with animated dog 🐕
            var dogCls = allDone ? 'tp-dog-celebrate' : (pct > 0 ? 'tp-dog-running' : 'tp-dog-idle');
            html += '<div class="tp-progress-bar">';
            html += '<div class="tp-progress-fill' + (allDone ? ' tp-progress-complete' : '') + '" style="width:' + pct + '%"></div>';
            html += '<span class="tp-progress-dog ' + dogCls + '" style="left:' + pct + '%">🐕</span>';
            html += '</div>';

            // Stats row
            html += '<div class="tp-stats">';
            html += '<span class="tp-stat tp-stat-completed">✅ ' + completed + '</span>';
            if (inProgress > 0) html += '<span class="tp-stat tp-stat-progress">⟳️ ' + inProgress + '</span>';
            if (pending > 0) html += '<span class="tp-stat tp-stat-pending">☐ ' + pending + '</span>';
            if (skipped > 0) html += '<span class="tp-stat tp-stat-skipped">⏭️ ' + skipped + '</span>';
            html += '<span class="tp-stat-total">' + completed + '/' + total + '</span>';
            html += '</div>';

            // Task list
            html += '<ul class="tp-task-list">';
            for (var k = 0; k < tl.tasks.length; k++) {
                var t = tl.tasks[k];
                var icon = statusIcons[t.status] || '☐';
                html += '<li class="tp-task-item tp-status-' + t.status + '">';
                html += '<span class="tp-task-icon">' + icon + '</span>';
                html += '<span class="tp-task-id">#' + t.id + '</span>';
                html += '<span class="tp-task-title">' + this._esc(t.title) + '</span>';
                html += '</li>';
            }
            html += '</ul>';

            html += '</div>';
        }

        // 保存滚动位置和快速发送框状态
        var savedScrollTop = body.scrollTop;
        var qsState = null;
        var existingQs = body.querySelector('.cs-quicksend-inline');
        if (existingQs) {
            var existingCard = existingQs.closest('.cs-card');
            var existingTa = existingQs.querySelector('.cs-qs-input');
            qsState = {
                chatId: existingCard ? existingCard.getAttribute('data-chat-id') : null,
                text: existingTa ? existingTa.value : '',
                focused: existingTa ? (document.activeElement === existingTa) : false
            };
        }

        body.innerHTML = html;

        // 恢复滚动位置
        body.scrollTop = savedScrollTop;

        // ===== 点击任务条目或卡片，跳转到对应对话并居中最大化 =====
        body.querySelectorAll('[data-chat-id]').forEach(function(card) {
            card.addEventListener('click', function(e) {
                var chatId = this.getAttribute('data-chat-id');
                if (chatId) {
                    self._focusChatBox(chatId);
                }
            });
        });
    },

    // ===== 更新对话状态浮动按钮 =====
    _updateChatStatusButton: function() {
        var btn = document.getElementById('chatStatusBtn');
        if (!btn) return;

        var boxes = this.chatBoxes || [];
        var count = boxes.length;
        var busy = 0;
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].isSending) busy++;
        }

        // 签名检查：如果数量和忙碌状态没变，跳过更新
        var btnSig = count + ':' + busy;
        if (btnSig === this._lastBtnSig) return;
        this._lastBtnSig = btnSig;

        var countEl = btn.querySelector('.cs-btn-count');
        if (countEl) countEl.textContent = count;

        var busyEl = btn.querySelector('.cs-btn-busy');
        if (busyEl) {
            busyEl.textContent = busy;
            busyEl.style.display = busy > 0 ? '' : 'none';
        }

        if (busy > 0) {
            btn.classList.add('cs-btn--busy');
        } else {
            btn.classList.remove('cs-btn--busy');
        }
    },

    // ===== 获取对话状态分类 =====
    _getChatStatusKey: function(chat) {
        if (chat.isSending) return 'busy';
        if (chat._stopped) return 'stopped';
        if (chat.queue && chat.queue.length > 0) return 'queued';
        return 'idle';
    },

    // ===== 渲染对话状态面板 =====
    _renderChatPanel: function() {
        var self = this;
var body = document.getElementById('chatPanelBody');
        if (!body) return;

        var boxes = this.chatBoxes || [];

        // ===== 状态签名（避免无变化时的无效刷新，防止闪烁和文字丢失） =====
        var sig = (this._chatStatusFilter || 'all') + ':' + (this._chatSortField || 'time') + ':' + (this._chatSortDir || 'desc') + ':' + boxes.length + ':';
        for (var si = 0; si < boxes.length; si++) {
            var sc = boxes[si];
            var scTitle = '';
            if (sc.el) { var scTitleEl = sc.el.querySelector('.title'); if (scTitleEl) scTitle = scTitleEl.textContent; }
            sig += sc.id + ',' + scTitle + ',' + (sc.isSending ? '1' : '0') + ',' + (sc._stopped ? '1' : '0') + ',' +
                   (sc.queue ? sc.queue.length : 0) + ',' + (sc.history ? sc.history.length : 0) + ',' + (Number(sc._sessionTotalTokens) || 0) + '|';
        }
        if (sig === this._lastChatPanelSig) return; // 无变化，跳过刷新
        this._lastChatPanelSig = sig;

        // 计算各状态计数
        var statusCounts = { busy: 0, idle: 0, queued: 0, stopped: 0 };
        for (var i = 0; i < boxes.length; i++) {
            var sk = this._getChatStatusKey(boxes[i]);
            statusCounts[sk]++;
        }

        if (boxes.length === 0) {
            body.innerHTML =
                '<div class="tp-panel-header">' +
                '<div class="tp-panel-title">💬 对话管理</div>' +
                '</div>' +
                '<div class="tp-empty">' +
                '<div class="tp-empty-icon">💬</div>' +
                '<div class="tp-empty-text">暂无对话窗口</div>' +
                '<div class="tp-empty-hint">右键画布或双击空白处创建新对话</div>' +
                '</div>';
            return;
        }

        // ===== Panel header =====
        var html = '<div class="tp-panel-header">';
        html += '<div class="tp-panel-title">💬 对话管理</div>';
        html += '</div>';

        // ===== 排序工具栏 =====
        html += '<div class="cs-toolbar">';

        // 状态筛选标签
        var filters = [
            { key: 'all',     label: '全部', icon: '📊', count: boxes.length },
            { key: 'busy',    label: '思考中', icon: '🔵', count: statusCounts.busy },
            { key: 'queued',  label: '排队', icon: '🟡', count: statusCounts.queued },
            { key: 'idle',    label: '空闲', icon: '🟢', count: statusCounts.idle },
            { key: 'stopped', label: '已停止', icon: '🔴', count: statusCounts.stopped }
        ];
        filters.forEach(function(f) {
            var active = (self._chatStatusFilter === f.key) ? ' cs-filter--active' : '';
            var hide = (f.count === 0 && f.key !== 'all') ? ' cs-filter--hide' : '';
            html += '<span class="cs-filter' + active + hide + '" data-filter="' + f.key + '" title="' + f.label + '">' +
                f.icon + ' ' + f.label + '<span class="cs-filter-count">' + f.count + '</span></span>';
        });

        // 排序方向箭头按钮（上下切换，按日期）
        html += '<span class="cs-sort-arrow" data-dir="asc" title="升序"' +
            (this._chatSortDir === 'asc' ? ' style="opacity:1"' : ' style="opacity:0.4"') + '>▲</span>';
        html += '<span class="cs-sort-arrow" data-dir="desc" title="降序"' +
            (this._chatSortDir === 'desc' ? ' style="opacity:1"' : ' style="opacity:0.4"') + '>▼</span>';

        html += '</div>';

        // ===== 筛选 + 排序 =====
        var filtered = boxes.filter(function(chat) {
            if (self._chatStatusFilter === 'all') return true;
            return self._getChatStatusKey(chat) === self._chatStatusFilter;
        });

        // 状态排序权重
        var statusWeight = { 'busy': 0, 'queued': 1, 'idle': 2, 'stopped': 3 };

        var sorted = filtered.slice().sort(function(a, b) {
            var dir = self._chatSortDir === 'asc' ? 1 : -1;
            if (self._chatSortField === 'status') {
                var wa = statusWeight[self._getChatStatusKey(a)] || 9;
                var wb = statusWeight[self._getChatStatusKey(b)] || 9;
                if (wa !== wb) return (wa - wb) * dir;
                // 同状态内按时间排序
                return ((b.createdAt || 0) - (a.createdAt || 0)) * dir;
            } else {
                // 时间排序
                return ((b.createdAt || 0) - (a.createdAt || 0)) * dir;
            }
        });

        // 渲染卡片
        for (var j = 0; j < sorted.length; j++) {
            var chat = sorted[j];
            var title = '';
            if (chat.el) {
                var titleEl = chat.el.querySelector('.title');
                if (titleEl) title = titleEl.textContent;
            }
            var msgCount = 0;
            if (chat.history) {
                for (var mi = 0; mi < chat.history.length; mi++) {
                    if (chat.history[mi].role === 'user') msgCount++;
                }
            }
            var isBusy = !!chat.isSending;
            var isStopped = !!(chat._stopped);
            var queueLen = chat.queue ? chat.queue.length : 0;

            var dotCls = 'cs-card-dot';
            var statusText = '🟢 空闲';
            var statusCls = 'cs-card-status cs-st--idle';
            if (isBusy) {
                dotCls += ' cs-dot--busy';
                statusText = '🔵 思考中';
                statusCls = 'cs-card-status cs-st--busy';
            } else if (isStopped) {
                dotCls += ' cs-dot--stopped';
                statusText = '🔴 已停止';
                statusCls = 'cs-card-status cs-st--stopped';
            } else if (queueLen > 0) {
                dotCls += ' cs-dot--queued';
                statusText = '🟡 排队 ' + queueLen;
                statusCls = 'cs-card-status cs-st--idle';
            }

            // Collect recent user question (最近1条=当前问题)
            var questions = [];
            if (chat.history && chat.history.length > 0) {
                for (var k = 0; k < chat.history.length; k++) {
                    if (chat.history[k].role === 'user') {
                        var uq = (chat.history[k].content || '').replace(/<[^>]+>/g, '').replace(/[#*>~]/g, '').trim();
                        if (uq) questions.push(uq);



                    }
                }
            }
            // 判断是否已完成（空闲且有消息且非停止）
            var isCompleted = !isBusy && !isStopped && queueLen === 0 && msgCount > 0;

            html += '<div class="cs-card" data-chat-id="' + chat.id + '">';
            html += '<div class="cs-card-header">';
            html += '<span class="' + dotCls + '"></span>';
            html += '<span class="cs-card-title">' + this._esc(title) + '</span>';
            html += '<span class="cs-card-id">' + chat.id + '</span>';
            html += '<button class="cs-card-qs-btn" data-qs="1" title="快速发送" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px;opacity:0.6;border-radius:4px;">✉️</button>';
            html += '</div>';
            html += '<div class="cs-card-meta cs-card-meta-right">';
            var tokenTotal = Number(chat._sessionTotalTokens) || 0;
            var tokenLabel = tokenTotal >= 1000000000 ? (tokenTotal / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B' : (tokenTotal / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
            html += '<span class="cs-card-tokens" title="对话累计 Token 总数（输入+输出）">🧠 ' + tokenLabel + ' tokens</span>';
            html += '<span class="cs-card-msgs">💬 ' + msgCount + '条</span>';
            html += '<span class="' + statusCls + '">' + statusText + '</span>';
            html += '</div>';
            // 当前问题
            if (questions.length) {
                var doneTag = isCompleted ? ' <span class="cs-card-done-tag">✓ 已完成</span>' : '';
                html += '<div class="cs-card-questions">';
                for (var qi = 0; qi < questions.length; qi++) {
                    var questionPreview = questions[qi].length > 60 ? questions[qi].substring(0, 60) + '...' : questions[qi];
                    html += '<button type="button" class="cs-card-q" data-question-index="' + qi + '" title="' + this._esc(questions[qi]) + '">';
                    html += '<span class="cs-card-q-num">' + (qi + 1) + '</span><span class="cs-card-q-text">' + this._esc(questionPreview) + (qi === questions.length - 1 ? doneTag : '') + '</span>';
                    html += '</button>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        if (sorted.length === 0) {
            html += '<div class="tp-empty" style="padding:30px 20px;">' +
                '<div class="tp-empty-icon" style="font-size:28px;">🔍</div>' +
                '<div class="tp-empty-text">该状态下暂无对话</div>' +
                '<div class="tp-empty-hint">切换筛选条件查看其他对话</div>' +
                '</div>';
        }

        // 保存滚动位置和快速发送框状态
        var savedScrollTop = body.scrollTop;
        var qsState = null;
        var existingQs = body.querySelector('.cs-quicksend-inline');
        if (existingQs) {
            var existingCard = existingQs.closest('.cs-card');
            var existingTa = existingQs.querySelector('.cs-qs-input');
            qsState = {
                chatId: existingCard ? existingCard.getAttribute('data-chat-id') : null,
                text: existingTa ? existingTa.value : '',
                focused: existingTa ? (document.activeElement === existingTa) : false
            };
        }

        body.innerHTML = html;

        // 恢复滚动位置
        body.scrollTop = savedScrollTop;

        // ===== 绑定筛选标签点击 =====
        body.querySelectorAll('.cs-filter[data-filter]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var f = this.getAttribute('data-filter');
                self._chatStatusFilter = f;
                self._lastChatPanelSig = null; // 签名失效
                self._renderChatPanel();
            });
        });

        // ===== 绑定排序字段切换 =====
        var sortToggle = body.querySelector('.cs-sort-toggle');
        if (sortToggle) {
            sortToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                // 在 'time' 和 'status' 之间切换
                // 排序固定按日期，不再切换字段
                self._lastChatPanelSig = null; // 签名失效
                self._renderChatPanel();
            });
        }

        // ===== 绑定排序方向箭头 =====
        body.querySelectorAll('.cs-sort-arrow[data-dir]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var d = this.getAttribute('data-dir');
                if (self._chatSortDir !== d) {
                    self._chatSortDir = d;
                    self._lastChatPanelSig = null; // 签名失效
                    self._renderChatPanel();
                }
            });
        });

        // ===== 绑定卡片点击 - 标题点击跳转 + 快速发送按钮 =====
        body.querySelectorAll('.cs-card[data-chat-id]').forEach(function(card) {
            card.addEventListener('click', function(e) {
                // 如果点击的是快速发送框内部，不处理
                if (e.target.closest('.cs-quicksend-inline')) return;
                var chatId = this.getAttribute('data-chat-id');
                if (!chatId) return;

                // 点击 ✉️ 按钮 - 切换快速发送框
                if (e.target.closest('.cs-card-qs-btn')) {
                    e.stopPropagation();
                    var existing = this.querySelector('.cs-quicksend-inline');
                    if (existing) {
                        existing.remove();
                        this.classList.remove('cs-card--active');
                        return;
                    }

                    // 关闭其他卡片的快速发送框
                    body.querySelectorAll('.cs-quicksend-inline').forEach(function(el) { el.remove(); });
                    body.querySelectorAll('.cs-card--active').forEach(function(el) { el.classList.remove('cs-card--active'); });

                    self._showQuickSend(this, chatId);
                    this.classList.add('cs-card--active');
                    return;
                }

                var questionItem = e.target.closest('.cs-card-q[data-question-index]');
                if (questionItem) {
                    self._focusChatBox(chatId, parseInt(questionItem.getAttribute('data-question-index'), 10));
                    return;
                }

                // 点击标题 - 跳转到对应对话并居中显示（摄像机跟随）
                if (e.target.closest('.cs-card-title')) {
                    self._focusChatBox(chatId);
                    return;
                }

                // 点击其他区域不做任何事（方便打字，不会意外跳转）
            });
        });

        // ===== 恢复快速发送框状态（防止轮询刷新时丢失） =====
        if (qsState && qsState.chatId) {
            var restoreCard = body.querySelector('.cs-card[data-chat-id="' + qsState.chatId + '"]');
            if (restoreCard) {
                self._showQuickSend(restoreCard, qsState.chatId);
                restoreCard.classList.add('cs-card--active');
                if (qsState.text) {
                    var restoreTa = restoreCard.querySelector('.cs-qs-input');
                    if (restoreTa) {
                        restoreTa.value = qsState.text;
                        restoreTa.style.height = 'auto';
                        restoreTa.style.height = Math.min(restoreTa.scrollHeight, 80) + 'px';
                    }
                }
                if (qsState.focused) {
                    var focusTa = restoreCard.querySelector('.cs-qs-input');
                    if (focusTa) setTimeout(function() { focusTa.focus(); }, 50);
                }
            }
        }
    },

    // ===== 在对话卡片下方显示快速发送框 =====
    _showQuickSend: function(card, chatId) {
        var self = this;
        // 创建内联快速发送框
        var qsBox = document.createElement('div');
        qsBox.className = 'cs-quicksend-inline';
        qsBox.innerHTML =
            '<textarea class="cs-qs-input" rows="1" placeholder="输入消息发送到 ' + chatId + '..."></textarea>' +
            '<button class="cs-qs-send-btn" title="发送">➤</button>';
        card.appendChild(qsBox);

        var ta = qsBox.querySelector('.cs-qs-input');
        var btn = qsBox.querySelector('.cs-qs-send-btn');

        // 自动聚焦
        setTimeout(function() { ta.focus(); }, 50);

        // 自适应高度
        function autoResize() {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
        }
        ta.addEventListener('input', autoResize);

        // 中文输入法支持
        var composing = false;
        ta.addEventListener('compositionstart', function() { composing = true; });
        ta.addEventListener('compositionend', function() { composing = false; });

        // 发送函数
        function qsSend() {
            var text = ta.value.trim();
            if (!text) return;
            ta.value = '';
            ta.style.height = '32px';
            self._quickSendToChat(chatId, text);
        }

        // 按钮点击发送
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            qsSend();
        });

        // Enter 发送，Shift+Enter 换行
        ta.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && !composing) {
                e.preventDefault();
                qsSend();
            }
            e.stopPropagation();
        });
    },

    // ===== 快速发送消息到指定对话 =====
    _quickSendToChat: function(chatId, text) {
        // 找到对应的 chat 对象
        var chat = null;
        if (this.chatBoxes) {
            for (var i = 0; i < this.chatBoxes.length; i++) {
                if (this.chatBoxes[i].id === chatId) {
                    chat = this.chatBoxes[i];
                    break;
                }
            }
        }
        if (!chat || !chat.el) {
            console.warn('[QuickSend] 对话框 ' + chatId + ' 不存在');
            return;
        }

        var box = chat.el;

        // 如果正在发送中，加入排队
        if (chat.isSending) {
            var qItem = { id: 'q' + Date.now() + Math.floor(Math.random() * 1000), text: text };
            chat.queue.push(qItem);
            this.renderQueue(box, chat);
            Store.addLog('info', chat.id, 'queue', '快速发送→排队 (' + chat.queue.length + '): ' + text.substring(0, 80));
            return;
        }

        // 直接发送
        this.addMsg(box, text, 'user', chat.modelId);
        this.showQueryPin(box, text);
        this.updateChatTitle(box, text);
        chat.history.push({ role: 'user', content: text });
        Store.addLog('info', chat.id, 'send', '快速发送消息: ' + text.substring(0, 80));
        this.sendToModel(box, chat);
    },

    // ===== 跳转到指定对话并居中显示 =====
    // 参数归一化：兼容 chatId 字符串（风筝尾巴/任务面板传入）与 chat 对象（导航箭头传入）。
    // 背景：与 app-chatbox.js 的同名方法会因加载/热更新顺序互相覆盖，两边都做归一化保证不失效。
    _focusChatBox: function(chatId, questionIndex) {
        if (chatId && typeof chatId === 'object') {
            questionIndex = undefined;
            chatId = chatId.id || '';
        }
        // 在已有对话框中查找
        var chat = null;
        if (this.chatBoxes) {
            for (var i = 0; i < this.chatBoxes.length; i++) {
                if (this.chatBoxes[i].id === chatId) {
                    chat = this.chatBoxes[i];
                    break;
                }
            }
        }
        if (!chat || !chat.el) {
            console.log('[TaskPanel] 对话框 ' + chatId + ' 不存在或已关闭');
            return;
        }

        var box = chat.el;
        var area = document.getElementById('canvasArea');
        var content_el = document.getElementById('canvasContent');
        if (!area || !content_el) return;

        // 激活（置顶）
        this.activate(box);

        // 使用 getBoundingClientRect 计算对话框中心点（与 chatbox 版本一致）
        var view = this.canvasGetView ? this.canvasGetView() : { x: 0, y: 0 };
        var rect = box.getBoundingClientRect();
        var areaRect = area ? area.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        var tx = view.x + (areaRect.width / 2 - rect.left - rect.width / 2);
        var ty = view.y + (areaRect.height / 2 - rect.top - rect.height / 2);

        // 带动画居中
        this.canvasSetView(tx, ty, 1, true);
        this.updateMinimap();

        // 关闭任务面板
        this.closeTaskPanel();

        // 添加高亮闪烁效果
        var userMessages = box.querySelectorAll('.msg.user:not(.msg-editing)');
        var targetMessage = userMessages[questionIndex];
        if (targetMessage) {
            targetMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetMessage.classList.add('msg-nav-highlight');
            setTimeout(function() { targetMessage.classList.remove('msg-nav-highlight'); }, 1600);
        }

        box.classList.add('chatbox--highlight');
        setTimeout(function() {
            box.classList.remove('chatbox--highlight');
        }, 2000);
    },

    // ===== HTML 转义 =====
    _esc: function(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }
});
