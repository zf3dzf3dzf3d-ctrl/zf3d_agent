// ==== 拆分自 app-chatbox.js：底部模型选择器（增强版下拉）_拖拽头部排除区域_刷新所有已存在对_仅移动摄像机到指_获取对话框状态（_更新状态指示（标_摄像机聚焦到指定_设置导航箭头_查找相邻对话（d_统计左右两侧符合_更新单个对话框的_更新所有对话框的 ====
Object.assign(App, {
        // ===== 底部模型选择器（增强版下拉） =====
        // 功能：1) 搜索/切换模型线路 2) 本对话模型ID覆盖 3) 思考强度（off/low/medium/high）
        _initModelPicker: function(box, chat) {
            var self = this;
            var wrap = box.querySelector('.model-picker-wrap');
            if (!wrap) return;
            var btn = wrap.querySelector('.model-picker-btn');
            var menu = wrap.querySelector('.model-picker-menu');
            var lineSelect = menu ? menu.querySelector('.mp-line-select') : null;
            var modelidInput = menu ? menu.querySelector('.mp-modelid-input') : null;
            var reInput = menu ? menu.querySelector('.mp-re-input') : null;
            if (!btn || !menu || !lineSelect) return;

            // ---- 内部工具：当前模型实际生效的 modelId（覆盖优先） ----
            function effModelId() {
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                return (chat._modelIdOverride || (m && m.modelId) || '');
            }

            // ---- 内部工具：当前生效思考强度 ----
            function curReasoning() {
                if (chat._reasoningEffort) return chat._reasoningEffort;
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                return (m && m.reasoningEffort) || ReasoningLevels.defaultValue();
            }

            // ---- 内部工具：刷新按钮显示 ----
            function refreshBtn() {
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                var nameEl = btn.querySelector('.model-picker-name');
                if (!m) {
                    btn.querySelector('.model-picker-name').textContent = '未选择模型';
                } else {
                    var fullName = m.name || m.modelId || '未命名';
                    var label = String(fullName).substring(0, 4);
                    if (nameEl) nameEl.textContent = label;
                    var re = curReasoning();
                    var mid = chat._modelIdOverride || m.modelId || '';
                    btn.title = '模型线路: ' + fullName + '\n模型 ID: ' + mid + '\n思考强度: ' + re + '\n点击修改';
                }
                // 刷新三个下拉框
                renderLineSelect();
                renderModelIdSelect();
                renderReSelect();
            }
            chat._refreshModelPickerBtn = refreshBtn;
            refreshBtn();

            // ---- 渲染大模型下拉（第一列） ----
            function renderLineSelect() {
                var html = '';
                var list = Models.list.filter(function(m) {
                    // 创建对话框只允许：语言模型 + 语音模型；图片/视频/识图/向量化即使可见也不出现
                    var t = String(m.modelType || '').toLowerCase();
                    if (m.imageGen) return false;
                    if (t === 'language' || t === 'speech' || t === 'audio' || t === 'omni') return m.visible !== false;
                    return false; // types_vision / vision / video / embedding 等一律不显示
                });
                if (!chat.modelId) {
                    html += '<option value="" disabled selected hidden>选择大模型</option>';
                }
                list.forEach(function(m) {
                    var sel = (m.id === chat.modelId) ? ' selected' : '';
                    html += '<option value="' + m.id + '"' + sel + '>' + (m.name || m.modelId || '未命名') + '</option>';
                });
                lineSelect.innerHTML = html;
            }

            // ---- 渲染模型 ID 下拉（第二列，跟随当前大模型） ----
            function renderModelIdSelect() {
                if (!modelidInput) return;
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                var seen = {};
                var optsHtml = '';
                var _ids = (Models.modelIdsFor && m) ? Models.modelIdsFor(m) : [];
                _ids.forEach(function(v) {
                    v = (v || '').trim();
                    if (!v || seen[v]) return;
                    seen[v] = true;
                    optsHtml += '<option value="' + v + '">' + v + '</option>';
                });
                // 当前覆盖值不在列表中时（如旧数据/自定义ID），补充一个选项避免显示空
                var cur = chat._modelIdOverride || (m && m.modelId) || '';
                if (cur && !seen[cur]) {
                    optsHtml += '<option value="' + cur + '">' + cur + '</option>';
                }
                if (!optsHtml) {
                    optsHtml = '<option value="">（该模型暂无 ID）</option>';
                }
                modelidInput.innerHTML = optsHtml;
                modelidInput.value = cur || '';
            }

            // ---- 渲染思考强度下拉（第三列） ----
            function renderReSelect() {
                if (!reInput) return;
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                var reList = ReasoningLevels.listFor(effModelId(), m);
                var curRe = curReasoning();
                var hasCur = reList.some(function (it) { return it.value === curRe; });
                var reHtml = reList.map(function (it) {
                    return '<option value="' + it.value + '">' + it.label + '</option>';
                }).join('');
                // 当前值不在该模型档位列表中时补一项，避免显示空
                if (!hasCur && curRe) {
                    reHtml += '<option value="' + curRe + '">' + (ReasoningLevels.labelOf(curRe) || curRe) + '</option>';
                }
                reInput.innerHTML = reHtml;
                reInput.value = curRe;
            }

            // ---- 打开/关闭菜单 ----
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var isOpen = !menu.hidden;
                if (isOpen) { menu.hidden = true; return; }
                menu.hidden = false;
                refreshBtn();
            });

            // ---- 第一列：切换大模型线路 ----
            lineSelect.addEventListener('change', function(e) {
                e.stopPropagation();
                var mid = this.value;
                if (mid && mid !== chat.modelId) {
                    // 发送中切换模型先给予明确提示，避免用户误以为旧循环已终止
                    if (chat.isSending || chat._stopped === false && (chat.abortController)) {
                        self.addMsg(box, '⚠ 当前对话正在运行中，已切换下一轮使用的模型线路。如需立即停止请点击停止按钮。', 'warning');
                        Store.addLog('warn', chat.id, 'model-switch-sending', '发送中切换模型: ' + mid);
                    }
                    chat.modelId = mid;
                    // 切换后立即锁定该线路在模型设置中保存的具体模型 ID，避免回退到全局配置。
                    var m = Models.get(mid);
                    chat._modelIdOverride = (m && m.modelId ? String(m.modelId).trim() : '');
                    chat._reasoningEffort = '';
                    // 【用户习惯】保存选择，供新对话继承（永久保留，不影响老对话）
                    try {
                        if (window.UserSettings && UserSettings.set) {
                            UserSettings.set('lastModelSelection', {
                                modelId: mid,
                                modelIdOverride: chat._modelIdOverride,
                                reasoningEffort: '',
                                ts: Date.now()
                            });
                        }
                    } catch (e2) {}
                    var displayName = m ? m.name : mid;
                    self.addMsg(box, '系统已切换模型：' + displayName, 'ai');
                    Store.saveChatBox(chat, true);
                    Store.addLog('info', chat.id, 'model-switch', '切换到: ' + displayName);
                    if (self.updateMinimap) self.updateMinimap();
                }
                refreshBtn();
            });
            lineSelect.addEventListener('click', function(e) { e.stopPropagation(); });
            lineSelect.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });

            // ---- 第二列：模型 ID 覆盖（即时生效） ----
            if (modelidInput) {
                modelidInput.addEventListener('change', function(e) {
                    e.stopPropagation();
                    var m = chat.modelId ? Models.get(chat.modelId) : null;
                    var base = m ? String(m.modelId || '').trim() : '';
                    var v = (modelidInput.value || '').trim() || base;
                    chat._modelIdOverride = v;
                    // 【用户习惯】保存模型 ID 选择，供新对话继承
                    try {
                        if (window.UserSettings && UserSettings.set) {
                            var _h = UserSettings.get('lastModelSelection', {}) || {};
                            UserSettings.set('lastModelSelection', {
                                modelId: chat.modelId || _h.modelId || '',
                                modelIdOverride: v,
                                reasoningEffort: chat._reasoningEffort !== undefined ? chat._reasoningEffort : (_h.reasoningEffort || ''),
                                ts: Date.now()
                            });
                        }
                    } catch (e2) {}
                    Store.saveChatBox(chat, true);
                    self.addMsg(box, '⚙️ 本对话模型 ID 已设为：' + v + (base && base !== v ? '（线路默认：' + base + '）' : ''), 'ai');
                    Store.addLog('info', chat.id, 'model-id-override', '模型ID: ' + v);
                    refreshBtn();
                });
                modelidInput.addEventListener('click', function(e) { e.stopPropagation(); });
                modelidInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });
            }

            // ---- 第三列：思考强度切换 ----
            if (reInput) {
                reInput.addEventListener('change', function(e) {
                    e.stopPropagation();
                    var re = this.value;
                    chat._reasoningEffort = re;
                    // 【用户习惯】保存思考强度选择，供新对话继承
                    try {
                        if (window.UserSettings && UserSettings.set) {
                            var _h2 = UserSettings.get('lastModelSelection', {}) || {};
                            UserSettings.set('lastModelSelection', {
                                modelId: chat.modelId || _h2.modelId || '',
                                modelIdOverride: chat._modelIdOverride || (_h2.modelIdOverride || ''),
                                reasoningEffort: re,
                                ts: Date.now()
                            });
                        }
                    } catch (e2) {}
                    Store.saveChatBox(chat, true);
                    var reName = ReasoningLevels.labelOf(re) || re;
                    self.addMsg(box, '🧠 思考强度已切换为：' + reName, 'ai');
                    Store.addLog('info', chat.id, 'reasoning-switch', '思考强度: ' + reName + ' (' + re + ')');
                    refreshBtn();
                });
                reInput.addEventListener('click', function(e) { e.stopPropagation(); });
                reInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });
            }

            // ---- 点击外部关闭 ----
            document.addEventListener('click', function(e) {
                if (!menu.hidden && !wrap.contains(e.target)) {
                    menu.hidden = true;
                }
            });
        },

        // ===== 拖拽头部排除区域（底部选择器不参与拖拽） =====

        modelOptions: function(selectedId) {
            var opts = '';
            var hasSelected = selectedId && Models.get(selectedId);
            if (!hasSelected) {
                opts += '<option value="" disabled selected hidden>请选择模型</option>';
            }
            Models.list.forEach(function(m) {
                // 创建对话框只允许：语言模型 + 语音模型；图片/视频/识图/向量化即使可见也不出现
                var t = String(m.modelType || '').toLowerCase();
                if (m.imageGen) return;
                if (!(t === 'language' || t === 'speech' || t === 'audio' || t === 'omni')) return;
                if (m.visible === false) return;
                opts += '<option value="' + m.id + '"' + (m.id === selectedId ? ' selected' : '') + '>' + m.name + '</option>';
            });
            return opts;
        },

        // ===== 刷新所有已存在对话框的模型选择器 =====
        // 在设置面板添加/删除模型后调用，确保已打开的对话框选择器同步更新
        refreshAllModelSelects: function() {
            if (!this.chatBoxes || this.chatBoxes.length === 0) return;
            this.chatBoxes.forEach(function(chat) {
                if (!chat.el) return;
                // 刷新底部增强选择器按钮显示（列表在下拉打开时按最新 Models.list 渲染）
                if (typeof chat._refreshModelPickerBtn === 'function') {
                    chat._refreshModelPickerBtn();
                }
                // 模型被删除时的处理：置为未选择等待用户手动选
                var currentModelId = chat.modelId || '';
                if (!(currentModelId && Models.get(currentModelId))) {
                    chat.modelId = '';
                    // 提示用户模型已失效，需手动重新选择
                    try {
                        if (typeof App !== 'undefined' && App.addMsg && chat.el) {
                            App.addMsg(chat.el, '⚠️ 原模型已被删除（已禁用自动切换），请在下拉框手动选择模型。', 'error');
                        }
                    } catch (e) {}
                }
            });
        },

        activate: function(box) {
            var self = this;
            this.chatBoxes.forEach(function(c) { c.el.classList.remove('active'); });
            box.classList.add('active');
            box.style.zIndex = ++this.zCounter;
            // 【5.1.0 修复】记住最后激活的对话（UserSettings JSON 持久化），刷新/重开后恢复聚焦
            try {
                if (window.UserSettings && UserSettings.set) UserSettings.set('last_active_chat_id', box.id);
                if (window.UserSettings && UserSettings.set) UserSettings.set('last_active_at', Date.now());
            } catch (e) {}
            // 记住最后激活窗口的尺寸（折叠状态不记录，避免新建窗口变成折叠条）
            if (!box.classList.contains('collapsed') && box.offsetWidth >= 280 && box.offsetHeight >= 200) {
                self.rememberBoxSize(box.offsetWidth, box.offsetHeight);
                try { if (window.UserSettings && UserSettings.setChatPreferences) UserSettings.setChatPreferences(null, { w: box.offsetWidth, h: box.offsetHeight }, null); } catch (e) {}
            }
            // 点击激活（只绑定一次，避免重复添加监听器导致指数级增长卡死浏览器）
            if (!box._zf3dActivated) {
                box._zf3dActivated = true;
                box.addEventListener('mousedown', function() {
                    self.activate(box);
                });
                // 点击对话时不再移动摄像机（用户要求保持视口不动）
            }
        },

        // ===== 仅移动摄像机到指定元素（不调用 activate，避免循环） =====
        _focusCameraOn: function(el) {
            if (!el) return;
            var view = this.canvasGetView ? this.canvasGetView() : { x: 0, y: 0 };
            var rect = el.getBoundingClientRect();
            var area = document.getElementById('canvasArea');
            var areaRect = area ? area.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
            var targetX = view.x + (areaRect.width / 2 - rect.left - rect.width / 2);
            var targetY = view.y + (areaRect.height / 2 - rect.top - rect.height / 2);
            if (this.canvasSetView) {
                this.canvasSetView(targetX, targetY, 1, true);
            }
        },

        hideHint: function() {
            var hint = document.getElementById('canvasHint');
            if (hint) hint.style.display = 'none';
        },
        showHint: function() {
            var hint = document.getElementById('canvasHint');
            // 画布上仍有任何视觉面板（文生图/识图/提示词编辑/创建面板）时，不显示「双击创建」引导提示
            if (hint && document.querySelector('.kite-dual-create-panel,.kite-image-panel,.kite-edit-panel,.kite-vision-panel,.kite-aux-panel')) return;
            // 【修复】画布上有拖拽的媒体图片/视频节点时，同样不显示「双击创建」提示
            if (hint && (document.querySelector('.media-canvas-node') || document.querySelector('.kite-node-image,.kite-node-video'))) return;
            // 【修复】画布上有流程图（FlowGlam 节点图）图层时，同样不显示「双击创建」提示
            if (hint && document.querySelector('.fg-layer')) return;
            if (hint) hint.style.display = '';
        },

        // ===== 获取对话框状态（与 minimap 逻辑一致） =====
        _getChatStatus: function(chat) {
            if (!chat || !chat.el) return 'idle';
            var el = chat.el;
            var hasError = false;
            var msgs = el.querySelectorAll('.msg');
            if (msgs.length > 0) {
                var lastMsg = msgs[msgs.length - 1];
                if (lastMsg.classList.contains('error')) hasError = true;
            }
            if (hasError) return 'error';
            if (chat.isSending) return 'sending';
            if (chat.queue && chat.queue.length > 0) return 'queued';
            // 任务结果保存在 chat 对象上，避免依赖 2 秒临时 DOM class（与 minimap 逻辑一致）。
            if (chat._taskStatus === 'success') return 'success';
            if (el.classList.contains('task-success')) return 'success';
            if (chat._taskStatus === 'fail') return 'error';
            if (el.classList.contains('task-fail')) return 'error';
            if (el.classList.contains('collapsed')) return 'collapsed';
            if (el.classList.contains('active')) return 'active';
            return 'idle';
        },

        // ===== 更新状态指示（标题前图标变色） =====
        _statusClasses: ['status-idle', 'status-sending', 'status-queued', 'status-error', 'status-success', 'status-collapsed', 'status-active'],
        updateStatusDot: function(chat) {
            if (!chat || !chat.el) return;
            var icon = chat.el.querySelector('.status-dot');
            if (!icon) return;
            var status = this._getChatStatus(chat);
            var statusClass = 'status-idle';
            if (status === 'error') statusClass = 'status-error';
            else if (status === 'sending') statusClass = 'status-sending';
            else if (status === 'queued') statusClass = 'status-queued';
            else if (status === 'success') statusClass = 'status-success';
            else if (status === 'collapsed') statusClass = 'status-collapsed';
            else if (status === 'active') statusClass = 'status-active';
            // 移除所有旧状态类
            this._statusClasses.forEach(function(cls) { icon.classList.remove(cls); });
            icon.classList.add(statusClass);
        },

        // ===== 摄像机聚焦到指定对话框 =====
        // 参数归一化：兼容 chat 对象（导航箭头传入）与 chatId 字符串（风筝尾巴/任务面板传入）。
        // 背景：app-taskpanel.js 有同名方法（收字符串），两者靠 Object.assign 后加载覆盖定胜负；
        //       热更新单个文件会打破顺序，若不做归一化，收字符串时 chat.el 为 undefined 静默 return，
        //       表现为「点击风筝尾巴球，摄像机不跳转、点击无反应」。
        _focusChatBox: function(chat) {
            if (typeof chat === 'string') {
                var fid = chat; chat = null;
                var boxes = this.chatBoxes || [];
                for (var i = 0; i < boxes.length; i++) {
                    if (boxes[i] && boxes[i].id === fid) { chat = boxes[i]; break; }
                }
                if (!chat) return;
            }
            if (!chat || !chat.el) return;
            // 与 app-taskpanel.js 版本保持一致：画布坐标系 + 保持当前缩放，不强制 scale=1。
            // 原先 getBoundingClientRect + 强制 scale=1 在画布缩放时跳转位置算错，摄像机无法追踪目标对话。
            var area = document.getElementById('canvasArea');
            if (!area) return;
            var scale = this.canvasScale ? this.canvasScale() : 1;
            var cx = chat.el.offsetLeft + chat.el.offsetWidth / 2;
            var cy = chat.el.offsetTop + chat.el.offsetHeight / 2;
            var targetX = area.clientWidth / 2 - cx * scale;
            var targetY = area.clientHeight / 2 - cy * scale;
            if (this.canvasSetView) {
                this.canvasSetView(targetX, targetY, scale, true);
            }
            this.activate(chat.el);
        },

        // ===== 设置导航箭头（已废弃：左右小圆圈导航功能彻底移除，由右下角"下一个成功任务"按钮代替） =====
        _setupNavArrows: function(box, chat) {
            var existingPrev = box.querySelector('.chatbox-nav-prev');
            var existingNext = box.querySelector('.chatbox-nav-next');
            if (existingPrev) existingPrev.remove();
            if (existingNext) existingNext.remove();
        },

        // ===== 查找相邻对话（dir: -1=左边最近, 1=右边最近，基于物理坐标） =====
        _findNeighborChat: function(currentChat, dir) {
            var boxes = this.chatBoxes;
            if (!boxes || boxes.length <= 1) return null;
            var currentX = currentChat.el.offsetLeft;
            var best = null;
            var bestDist = Infinity;
            for (var i = 0; i < boxes.length; i++) {
                if (boxes[i] === currentChat) continue;
                var x = boxes[i].el.offsetLeft;
                var diff = x - currentX;
                if (dir < 0 && diff < 0) {
                    if (-diff < bestDist) { bestDist = -diff; best = boxes[i]; }
                } else if (dir > 0 && diff > 0) {
                    if (diff < bestDist) { bestDist = diff; best = boxes[i]; }
                }
            }
            return best;
        },

        // ===== 统计左右两侧符合条件的对话数量 =====
        _countNeighbors: function(currentChat) {
            var boxes = this.chatBoxes;
            if (!boxes || boxes.length <= 1) return { left: 0, right: 0 };
            var currentX = currentChat.el.offsetLeft;
            var left = 0, right = 0;
            for (var i = 0; i < boxes.length; i++) {
                if (boxes[i] === currentChat) continue;
                var x = boxes[i].el.offsetLeft;
                if (x < currentX) left++;
                else right++;
            }
            return { left: left, right: right };
        },

        // ===== 更新单个对话框的导航圆圈（已废弃：左右小圆圈彻底移除） =====
        _updateNavArrowStatus: function(box, chat) {
            if (!box) return;
            // 彻底清理残留的左右导航圆圈
            var prevArrow = box.querySelector('.chatbox-nav-prev');
            var nextArrow = box.querySelector('.chatbox-nav-next');
            if (prevArrow) prevArrow.remove();
            if (nextArrow) nextArrow.remove();
        },

        // ===== 更新所有对话框的导航箭头 =====
        _updateAllNavArrows: function() {
            var self = this;
            // 只在当前函数内过滤出 DOM 仍连接的对话框，不修改 this.chatBoxes 本身。
            // 原代码 this.chatBoxes = filter(...) 会永久删除暂时断开连接的对话，
            // 导致重启/热更新后对话在导航/任务面板中消失且无法恢复。
            var liveBoxes = (this.chatBoxes || []).filter(function(chat) {
                return chat && chat.el && chat.el.isConnected;
            });
            document.querySelectorAll('.cbx-succ-nav[data-for]').forEach(function(container) {
                var ownerId = container.getAttribute('data-for');
                var ownerExists = liveBoxes.some(function(chat) { return chat.id === ownerId; });
                if (!ownerExists) container.remove();
            });
            liveBoxes.forEach(function(chat) {
                if (chat.el) self._updateNavArrowStatus(chat.el, chat);
                if (chat.el) self._updateSuccessArrows(chat.el, chat);
            });
        },
});
