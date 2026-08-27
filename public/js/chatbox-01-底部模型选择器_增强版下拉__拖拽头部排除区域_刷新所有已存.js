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
            var listEl = menu.querySelector('.mp-list');
            var searchInput = menu.querySelector('.mp-search-input');
            var modelidInput = menu.querySelector('.mp-modelid-input');
            var modelidAddBtn = menu.querySelector('.mp-modelid-add');
            var modelidRemoveBtn = menu.querySelector('.mp-modelid-remove');
            var reInput = menu.querySelector('.mp-re-input');
            if (!btn || !menu || !listEl) return;

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
                // 刷新菜单选中态 + modelid 下拉框选项与选中态 + 思考强度选中态
                if (modelidInput) {
                    // 模型 ID 只来自当前线路在设置中保存的具体配置，不使用全局回退项。
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
                    var cur = chat._modelIdOverride || '';
                    if (cur && !seen[cur]) {
                        optsHtml += '<option value="' + cur + '">' + cur + '</option>';
                    }
                    modelidInput.innerHTML = optsHtml;
                    modelidInput.value = cur;
                }
                if (menu) {
                    // 刷新思考强度下拉：按当前模型实际生效的 modelId 取档位列表
                    if (reInput) {
                        var reList = ReasoningLevels.listFor(effModelId());
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
                }
            }
            chat._refreshModelPickerBtn = refreshBtn;
            refreshBtn();

            // ---- 内部工具：渲染模型列表 ----
            function renderList(filter) {
                var kw = (filter || '').trim().toLowerCase();
                var html = '';
                var list = Models.list.filter(function(m) {
                    if (m.visible === false || m.imageGen) return false;
                    // 识图模型（visionInput / types_vision）不在对话模型选择中出现
                    if (m.modelType === 'types_vision') return false; // 仅排除专用识图模型
                    if (!kw) return true;
                    var searchable = [m.name, m.modelId, m.id];
                    if (Models.modelIdsFor) {
                        searchable = searchable.concat(Models.modelIdsFor(m) || []);
                    }
                    return searchable.join(' ').toLowerCase().indexOf(kw) >= 0;
                });
                if (list.length === 0) {
                    listEl.innerHTML = '<div class="mp-empty">无匹配模型</div>';
                    return;
                }
                list.forEach(function(m) {
                    var active = (m.id === chat.modelId) ? ' active' : '';
                    html += '<div class="mp-item' + active + '" data-mid="' + m.id + '">' +
                        '<span class="mp-item-name">' + (m.name || m.modelId || '未命名') + '</span>' +
                        '<span class="mp-item-id">' + (m.modelId || '') + '</span>' +
                        '</div>';
                });
                listEl.innerHTML = html;
            }

            // ---- 打开/关闭菜单 ----
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var isOpen = !menu.hidden;
                if (isOpen) { menu.hidden = true; return; }
                renderList('');
                if (searchInput) { searchInput.value = ''; }
                menu.hidden = false;
                // 菜单宽度不超过对话框宽度（防止模型下拉菜单超出对话框边界）
                try {
                    var boxW = box.clientWidth || 0;
                    if (boxW > 0) {
                        menu.style.width = Math.max(150, Math.min(280, boxW - 12)) + 'px';
                    }
                } catch (e) {}
                refreshBtn();
                // 聚焦搜索框（延迟等菜单显示）
                setTimeout(function() { if (searchInput) searchInput.focus(); }, 30);
            });

            // ---- 搜索过滤 ----
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    renderList(this.value);
                });
                searchInput.addEventListener('keydown', function(e) {
                    e.stopPropagation();
                    if (e.key === 'Escape') { menu.hidden = true; }
                });
            }

            // ---- 选择模型线路 ----
            listEl.addEventListener('click', function(e) {
                var item = e.target.closest('.mp-item');
                if (!item) return;
                e.stopPropagation();
                var mid = item.dataset.mid;
                if (mid && mid !== chat.modelId) {
                    // 【2026 修复】发送中切换模型先给予明确提示，避免用户误以为旧循环已终止
                    if (chat.isSending || chat._stopped === false && (chat.abortController)) {
                        self.addMsg(box, '⚠ 当前对话正在运行中，已切换下一轮使用的模型线路。如需立即停止请点击停止按钮。', 'warning');
                        Store.addLog('warn', chat.id, 'model-switch-sending', '发送中切换模型: ' + mid);
                    }
                    chat.modelId = mid;
                    // 切换后立即锁定该线路在模型设置中保存的具体模型 ID，避免回退到全局配置。
                    var m = Models.get(mid);
                    chat._modelIdOverride = (m && m.modelId ? String(m.modelId).trim() : '');
                    chat._reasoningEffort = '';
                    var displayName = m ? m.name : mid;
                    self.addMsg(box, '系统已切换模型：' + displayName, 'ai');
                    Store.saveChatBox(chat, true);
                    Store.addLog('info', chat.id, 'model-switch', '切换到: ' + displayName);
                    if (self.updateMinimap) self.updateMinimap();
                }
                refreshBtn();
                renderList(searchInput ? searchInput.value : '');
                menu.hidden = true;
            });

            // ---- 模型 ID 覆盖（下拉选择，即时生效） ----
            function saveModelIdOverride() {
                var m = chat.modelId ? Models.get(chat.modelId) : null;
                var base = m ? String(m.modelId || '').trim() : '';
                var v = (modelidInput.value || '').trim() || base;
                chat._modelIdOverride = v;
                Store.saveChatBox(chat, true);
                self.addMsg(box, '⚙️ 本对话模型 ID 已设为：' + v + (base && base !== v ? '（线路默认：' + base + '）' : ''), 'ai');
                Store.addLog('info', chat.id, 'model-id-override', '模型ID: ' + v);
                refreshBtn();
            }
            if (modelidInput) {
                modelidInput.addEventListener('change', function(e) {
                    e.stopPropagation();
                    saveModelIdOverride();
                });
                modelidInput.addEventListener('click', function(e) { e.stopPropagation(); });
            }

            function stopModelIdButtonEvent(e) { e.preventDefault(); e.stopPropagation(); }
            if (modelidAddBtn) {
                modelidAddBtn.addEventListener('click', function(e) {
                    stopModelIdButtonEvent(e);
                    var model = chat.modelId ? Models.get(chat.modelId) : null;
                    if (!model) { self.addMsg(box, '请先选择模型线路。', 'warning'); return; }
                    (window.ConfirmDialog ? ConfirmDialog.prompt({ title: '添加模型 ID', message: '输入要添加到「' + (model.name || model.id) + '」的模型 ID：', placeholder: '如：glm-5.3' }) : Promise.resolve(window.prompt('输入要添加到“' + (model.name || model.id) + '”的模型 ID：', ''))).then(function(value) {
                        if (!value) return;
                        value = String(value).trim();
                        if (!value) return;
                    Models.addModelIdOption(model.id, value).then(function(result) {
                        if (!result.ok) { self.addMsg(box, '模型 ID 未添加：' + (result.error || '保存失败'), 'warning'); return; }
                        chat._modelIdOverride = result.modelId;
                        Store.saveChatBox(chat, true);
                        Store.addLog('info', chat.id, 'model-id-add', '添加模型ID: ' + result.modelId);
                        self.addMsg(box, '已添加并选择本对话模型 ID：' + result.modelId, 'ai');
                        refreshBtn();
                        });
                    });
                });
            }
            if (modelidRemoveBtn) {
                modelidRemoveBtn.addEventListener('click', function(e) {
                    stopModelIdButtonEvent(e);
                    var model = chat.modelId ? Models.get(chat.modelId) : null;
                    var value = (modelidInput && modelidInput.value || '').trim();
                    if (!model || !value) { self.addMsg(box, '请选择要删除的模型 ID。', 'warning'); return; }
                    var _delMsg = '删除「' + value + '」吗？此操作会从「' + (model.name || model.id) + '」的模型 ID 列表中移除。';
                    (window.ConfirmDialog ? ConfirmDialog.confirm({ title: '删除模型 ID', message: _delMsg, danger: true, okText: '删除' }) : Promise.resolve(window.confirm(_delMsg))).then(function(ok) {
                        if (!ok) return;
                    Models.removeModelIdOption(model.id, value).then(function(result) {
                        if (!result.ok) { self.addMsg(box, '模型 ID 未删除：' + (result.error || '保存失败'), 'warning'); return; }
                        if (chat._modelIdOverride === value) {
                            chat._modelIdOverride = String(model.modelId || '').trim();
                            Store.saveChatBox(chat, true);
                        }
                        Store.addLog('info', chat.id, 'model-id-remove', '删除模型ID: ' + value);
                        self.addMsg(box, '已删除模型 ID：' + value, 'ai');
                        refreshBtn();
                        });
                    });
                });
            }

            // ---- 思考强度切换 ----
            if (reInput) {
                reInput.addEventListener('change', function(e) {
                    e.stopPropagation();
                    var re = this.value;
                    chat._reasoningEffort = re;
                    Store.saveChatBox(chat, true);
                    var reName = ReasoningLevels.labelOf(re) || re;
                    self.addMsg(box, '🧠 思考强度已切换为：' + reName, 'ai');
                    Store.addLog('info', chat.id, 'reasoning-switch', '思考强度: ' + reName + ' (' + re + ')');
                    refreshBtn();
                });
                reInput.addEventListener('click', function(e) { e.stopPropagation(); });
                reInput.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') { menu.hidden = true; } });

                // ---- 思考强度 +/− 步进按钮 ----
                var stepBtns = wrap.querySelectorAll('.mp-re-btn');
                function applyReasoningChange(re) {
                    chat._reasoningEffort = re;
                    Store.saveChatBox(chat, true);
                    var reName2 = ReasoningLevels.labelOf(re) || re;
                    self.addMsg(box, '🧠 思考强度已切换为：' + reName2, 'ai');
                    Store.addLog('info', chat.id, 'reasoning-switch', '思考强度: ' + reName2 + ' (' + re + ')');
                }
                stepBtns.forEach(function(sb) {
                    sb.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var dir = this.getAttribute('data-re-dir') === '1' ? 1 : -1;
                        var list = ReasoningLevels.listFor(effModelId());
                        if (!list.length) return;
                        var curRe = curReasoning();
                        var idx = -1;
                        for (var i = 0; i < list.length; i++) { if (list[i].value === curRe) { idx = i; break; } }
                        if (idx < 0) idx = 0;
                        var ni = Math.max(0, Math.min(list.length - 1, idx + dir));
                        if (ni === idx) {
                            self.addMsg(box, dir > 0 ? '🧠 已经是最高思考强度了。' : '🧠 已经是最低思考强度了。', 'ai');
                            return;
                        }
                        if (reInput) { reInput.value = list[ni].value; }
                        refreshBtn();
                        applyReasoningChange(list[ni].value);
                    });
                });
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
                if (m.visible === false || m.imageGen) return; // 隐藏的模型和生图入口不显示
                if (m.modelType === 'types_vision') return; // 专用识图模型不在对话选择中出现
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
            if (hint && !document.querySelector('.kite-dual-create-panel,.kite-image-panel,.kite-edit-panel,.kite-vision-panel,.kite-aux-panel')) hint.style.display = '';
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
            var view = this.canvasGetView ? this.canvasGetView() : { x: 0, y: 0 };
            var rect = chat.el.getBoundingClientRect();
            var area = document.getElementById('canvasArea');
            var areaRect = area ? area.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
            var targetX = view.x + (areaRect.width / 2 - rect.left - rect.width / 2);
            var targetY = view.y + (areaRect.height / 2 - rect.top - rect.height / 2);
            if (this.canvasSetView) {
                this.canvasSetView(targetX, targetY, 1, true);
            }
            this.activate(chat.el);
        },

        // ===== 设置导航箭头 =====
        _setupNavArrows: function(box, chat) {
            var self = this;
            var existingPrev = box.querySelector('.chatbox-nav-prev');
            var existingNext = box.querySelector('.chatbox-nav-next');
            if (existingPrev) existingPrev.remove();
            if (existingNext) existingNext.remove();

            var prevArrow = document.createElement('div');
            prevArrow.className = 'chatbox-nav-arrow chatbox-nav-prev';
            prevArrow.innerHTML = '';
            prevArrow.title = '上一个对话';

            var nextArrow = document.createElement('div');
            nextArrow.className = 'chatbox-nav-arrow chatbox-nav-next';
            nextArrow.innerHTML = '';
            nextArrow.title = '下一个对话';

            box.appendChild(prevArrow);
            box.appendChild(nextArrow);

            prevArrow.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var target = self._findNeighborChat(chat, -1);
                if (target) {
                    self._focusChatBox(target);
                    self._updateAllNavArrows();
                }
            });
            nextArrow.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var target = self._findNeighborChat(chat, 1);
                if (target) {
                    self._focusChatBox(target);
                    self._updateAllNavArrows();
                }
            });

            prevArrow.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            nextArrow.addEventListener('mousedown', function(e) { e.stopPropagation(); });
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

        // ===== 更新单个对话框的导航圆圈（显示数字） =====
        _updateNavArrowStatus: function(box, chat) {
            if (!box) return;
            var prevArrow = box.querySelector('.chatbox-nav-prev');
            var nextArrow = box.querySelector('.chatbox-nav-next');
            if (!prevArrow || !nextArrow) return;

            var counts = this._countNeighbors(chat);
            var prevTarget = this._findNeighborChat(chat, -1);
            var nextTarget = this._findNeighborChat(chat, 1);

            var statusClasses = ['nav-sending', 'nav-queued', 'nav-error', 'nav-success', 'nav-active', 'nav-collapsed', 'nav-idle', 'nav-none'];
            statusClasses.forEach(function(cls) {
                prevArrow.classList.remove(cls);
                nextArrow.classList.remove(cls);
            });

            // Left circle - 仅当左侧邻居任务成功时显示绿色小圈，其他状态一律隐藏
            if (prevTarget) {
                var pSt = this._getChatStatus(prevTarget);
                prevArrow.classList.add(pSt === 'success' ? 'nav-success' : 'nav-none');
                prevArrow.textContent = '';
            } else prevArrow.classList.add('nav-none');

            // Right circle - 仅当右侧邻居任务成功时显示绿色小圈，其他状态一律隐藏
            if (nextTarget) {
                var nSt = this._getChatStatus(nextTarget);
                nextArrow.classList.add(nSt === 'success' ? 'nav-success' : 'nav-none');
                nextArrow.textContent = '';
            } else nextArrow.classList.add('nav-none');
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
