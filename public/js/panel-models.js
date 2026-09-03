// ========== panel-models.js - 模型列表/添加/编辑/拖拽排序/连通测试 ==========
// 拆分自 app-panels.js（原 662~1342 行），Object.assign(App,{...}) 注册
Object.assign(App, {
        // ===== 渲染模型列表 =====
        renderModelList: function() {
            var listEl = document.getElementById('modelList');
            var self = this;
            if (!listEl) return;
            if (Models.list.length === 0) {
                listEl.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:8px 0 12px 0;">尚未配置模型。添加一个模型后，右键画布即可选择它创建对话框。</div>' + self._renderAddModelForm();
                self._bindAddModelForm(listEl);
                return;
            }
            var html = '';
            var seen = {};
            Models.list.forEach(function(m) {
                if (m.imageGen) return; // 生图模型不放入聊天模型配置
                if (seen[m.id]) return; // 防重复
                seen[m.id] = true;
                var keyVal = m.key || m.apiKey || '';
                var visible = m.visible !== false;
                var re = m.reasoningEffort || 'medium';
                var esc = function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

                html += '<div class="model-item" data-model-id="' + esc(m.id) + '" draggable="true">' +
                    // 第1行：名称输入框 + 操作按钮
                    '<div class="mi-head">' +
                        '<span class="mi-drag" title="拖拽调整顺序">⋮⋮</span>' +
                        '<input type="text" class="mi-name-input" data-name-input="' + esc(m.id) + '" value="' + esc(m.name) + '" title="' + esc(m.name) + '" />' +
                        '<button class="mi-toggle' + (visible ? ' on' : '') + '" data-toggle="visible" data-id="' + esc(m.id) + '" title="在画布右键菜单中显示/隐藏此模型">' + (visible ? '👁' : '🚫') + '</button>' +
                        '<button class="mi-default' + ((m.isDefault) ? ' on' : '') + '" data-default="' + esc(m.id) + '" title="' + ((m.isDefault) ? '当前是默认模型（点击取消）' : '设为此类型默认模型') + '">⭐</button>' +
                        '<button class="mi-copy" data-copy="' + esc(m.id) + '" title="复制为新通道（保留规则，清空 API Key）">⧉</button>' +
                        '<button class="mi-del" data-del="' + esc(m.id) + '" title="删除此模型">✕</button>' +
                    '</div>' +
                    // 第2行：模型ID（火山方舟可选模型下拉） + 思考强度
                    '<div class="mi-settings-row">' +
                        '<div class="mi-field"><span class="mi-field-label">模型ID</span>' +
                        '<select data-modelid-input="' + esc(m.id) + '">' +
                            (function() {
                                var PROVIDER_IDS = (typeof Models !== 'undefined' && Models.modelIdsFor) ? Models.modelIdsFor(m) : [];
                                var cur = m.modelId || '';
                                var opts = '';
                                if (cur && PROVIDER_IDS.indexOf(cur) < 0) {
                                    opts += '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (当前)</option>';
                                }
                                PROVIDER_IDS.forEach(function(mid) {
                                    opts += '<option value="' + esc(mid) + '"' + (mid === cur ? ' selected' : '') + '>' + esc(mid) + '</option>';
                                });
                                return opts;
                            })() +
                        '</select></div>' +
                        '<div class="mi-field"><span class="mi-field-label">思考强度</span>' +
                        '<select data-reasoning-input="' + esc(m.id) + '">' +
                            (function() {
                                // 档位优先取模型条目内部的 reasoningLevels（models.json 已合并），无图标
                                var list = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(m.modelId, m) : [];
                                var cur2 = m.reasoningEffort || (list[0] && list[0].value) || '';
                                var o = '';
                                list.forEach(function(it) {
                                    o += '<option value="' + esc(it.value) + '"' + (it.value === cur2 ? ' selected' : '') + '>' + esc(it.label || it.value) + '</option>';
                                });
                                if (cur2 && !list.some(function(it){ return it.value === cur2; })) {
                                    o += '<option value="' + esc(cur2) + '" selected>' + esc(cur2) + ' (当前)</option>';
                                }
                                return o;
                            })() +
                        '</select>' +
                        '<span class="mi-re-stepwrap">' +
                        '<button type="button" class="mi-re-btn" data-re-lv-add="' + esc(m.id) + '" title="添加一个新的思考强度档位">＋</button>' +
                        '<button type="button" class="mi-re-btn" data-re-lv-del="' + esc(m.id) + '" title="删除当前选中的思考强度档位">−</button>' +
                        '</span></div>' +
                    // 第3行：API 网址（可编辑）
                    '<div class="mi-settings-row">' +
                        '<div class="mi-field mi-field-grow"><span class="mi-field-label">API 网址</span>' +
                        '<input type="text" data-endpoint-input="' + esc(m.id) + '" value="' + esc(m.endpoint || '') + '" placeholder="https://..." /></div>' +
                    '</div>' +
                    // 第4行：API 密钥输入（默认显示已存密钥掩码，眼睛可切换明文）
                    '<div class="mi-keyrow">' +
                        '<span class="mi-key-label">密匙</span>' +
                        '<form onsubmit="return false" style="display:flex;gap:6px;flex:1 1 auto;min-width:0;align-items:center;"><input type="text" name="username" autocomplete="username" aria-label="Username" tabindex="-1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><input type="password" data-key-input="' + esc(m.id) + '" value="' + esc(keyVal) + '" placeholder="输入API密钥" autocomplete="new-password" name="apikey_' + Math.random().toString(36).slice(2,9) + '" /></form>' +
                        '<button type="button" class="mi-eye" data-eye="' + esc(m.id) + '" title="显示/隐藏密钥">👁</button>' +
                    '</div>' +
                    // 第5行：操作按钮
                    '<div class="mi-actions">' +
                        '<button class="btn ghost" onclick="App.saveModelSettings(\'' + esc(m.id) + '\')">保存</button>' +
                        '<button class="btn ghost" onclick="App.testModel(\'' + esc(m.id) + '\')">测试</button>' +
                        '<button class="btn ghost" onclick="App.clearModelKey(\'' + esc(m.id) + '\')">清除</button>' +
                        (function() { var u = m.officialUrl; return u ? '<a class="btn ghost" href="' + u + '" target="_blank" rel="noopener noreferrer" title="打开模型服务官网">官网</a>' : ''; })() +
                    '</div>' +
                    '<div class="test-result" data-test-result="' + esc(m.id) + '"></div>' +
                '</div>';
            });
            // 底部添加模型表单
            html += self._renderAddModelForm();
            listEl.innerHTML = html;
            // 绑定密钥眼睛切换（显示/隐藏明文）
            listEl.querySelectorAll('[data-eye]').forEach(function(eyeBtn) {
                eyeBtn.addEventListener('click', function() {
                    var input = listEl.querySelector('[data-key-input="' + this.getAttribute('data-eye') + '"]');
                    if (!input) return;
                    if (input.type === 'password') {
                        input.type = 'text';
                        this.textContent = '🙈';
                        this.title = '隐藏密钥';
                    } else {
                        input.type = 'password';
                        this.textContent = '👁';
                        this.title = '显示密钥';
                    }
                });
            });
            this._bindModelListEvents(listEl);
            this._bindAddModelForm(listEl);
        },

        // ===== 添加模型表单 HTML =====
        _renderAddModelForm: function() {
            var esc = function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
            return '<div class="model-item mi-add-form" style="border-style:dashed;">' +
                '<div class="mi-head"><div class="mi-name" style="font-size:13px;">＋ 添加新模型</div></div>' +
                '<div class="mi-settings-row">' +
                    '<div class="mi-field"><span class="mi-field-label">名称</span>' +
                    '<input type="text" id="cfg-name" placeholder="如：火山方舟" /></div>' +
                    '<div class="mi-field"><span class="mi-field-label">模型ID</span>' +
                    '<input type="text" id="cfg-modelid" placeholder="如：glm-5.3" /></div>' +
                '</div>' +
                '<div class="mi-settings-row">' +
                    '<div class="mi-field mi-field-grow"><span class="mi-field-label">API 网址</span>' +
                    '<input type="text" id="cfg-endpoint" placeholder="https://..." /></div>' +
                    '<div class="mi-field"><span class="mi-field-label">思考强度</span>' +
                    '<select id="cfg-reasoning">' +
                        (function() {
                            // 档位统一由 reasoning_levels.json 提供，无图标
                            var list = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor('') : [];
                            var o = '';
                            list.forEach(function(it, idx) {
                                o += '<option value="' + esc(it.value) + '"' + (idx === 0 ? ' selected' : '') + '>' + esc(it.label || it.value) + '</option>';
                            });
                            return o || '<option value="medium" selected>中</option>';
                        })() +
                    '</select>' +
                    '<span style="display:inline-flex;gap:4px;margin-left:4px;">' +
                    '<button type="button" class="mi-re-btn" data-re-lv-add-new title="添加一个新的思考强度档位">＋</button>' +
                    '<button type="button" class="mi-re-btn" data-re-lv-del-new title="删除当前选中的思考强度档位">−</button>' +
                    '</span></div>' +
                '</div>' +
                '<div class="mi-keyrow">' +
                    '<span class="mi-key-label">密匙</span>' +
                    '<form onsubmit="return false" style="display:flex;flex:1 1 auto;min-width:0;"><input type="text" name="username" autocomplete="username" aria-label="Username" tabindex="-1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><input type="password" id="cfg-key" placeholder="API 密钥" autocomplete="new-password" /></form>' +
                '</div>' +
                '<div class="mi-actions">' +
                    '<button class="btn ghost" id="cfg-test-btn" onclick="App.testModel()">🧪 测试连通</button>' +
                    '<button class="btn ghost" style="background:#2f81f7;color:#fff;" onclick="App.saveModel()">💾 保存模型</button>' +
                '</div>' +
                '<div class="test-result" id="testResult"></div>' +
            '</div>';
        },

        // ===== 绑定添加模型表单事件 =====
        _bindAddModelForm: function(listEl) {
            // Enter 键提交
            var inputs = listEl.querySelectorAll('#cfg-name, #cfg-endpoint, #cfg-modelid, #cfg-key');
            inputs.forEach(function(inp) {
                if (inp._zf3dEnterBound) return;
                inp._zf3dEnterBound = true;
                inp.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); App.saveModel(); }
                });
            });
        },

        // ===== 保存模型设置（名称 + 网址 + 模型ID + 思考强度 + 密钥，一键保存全部项目）=====
        saveModelSettings: async function(id) {
            var container = document.getElementById('modelList');
            var nameInput = container.querySelector('[data-name-input="' + id + '"]');
            var modelIdInput = container.querySelector('[data-modelid-input="' + id + '"]');
            var endpointInput = container.querySelector('[data-endpoint-input="' + id + '"]');
            var reasoningInput = container.querySelector('[data-reasoning-input="' + id + '"]');
            var keyInput = container.querySelector('[data-key-input="' + id + '"]');
            if (!modelIdInput || !reasoningInput) return;
            var newName = nameInput ? nameInput.value.trim() : '';
            var newModelId = modelIdInput.value.trim();
            var newEndpoint = endpointInput ? endpointInput.value.trim() : '';
            var newReasoning = reasoningInput.value;
            var tr = container.querySelector('[data-test-result="' + id + '"]');
            if (!newName) { this._toast('名称不能为空', 'err'); return; }
            if (!newModelId) { this._toast('模型ID不能为空', 'err'); return; }
            if (!newEndpoint) { this._toast('API 网址不能为空', 'err'); return; }
            var m = Models.get(id);
            if (!m) return;
            // 密钥：输入框有值则更新，为空保持原值不变
            var newKey = keyInput ? keyInput.value.trim() : '';
            if (newKey) {
                // 清除可能残留的掩码文本（兼容旧版）
                newKey = newKey.replace(/sk-•+•?/g, '').trim();
                if (newKey) {
                    m.key = newKey;
                    m.apiKey = newKey;
                }
            }
            m.name = newName;
            m.modelId = newModelId;
            m.endpoint = newEndpoint;
            m.baseUrl = newEndpoint;
            m.reasoningEffort = newReasoning;
            var self = this;
            try {
                await Models.save();
            } catch (e) {
                if (tr) tr.innerHTML = '<span class="err">✗ 保存失败:' + (e && e.message ? e.message : e) + '</span>';
                Store.addLog('error', id, 'model-settings', '保存模型设置失败: ' + m.name + ' ' + (e && e.message ? e.message : e));
                return;
            }
            self._toast('✅ 模型设置已保存', 'ok');
            if (tr) tr.innerHTML = '<span class="ok">✓ 设置已保存（名称/网址/模型ID/思考强度/密钥）</span>';
            Store.addLog('info', id, 'model-settings', '更新模型设置: ' + m.name + ' | endpoint=' + newEndpoint + ' | modelId=' + newModelId + ' | reasoning=' + newReasoning);
            self.renderModelList();
            self.updateStatusModelText();
            self.refreshAllModelSelects();
        },

        _bindModelListEvents: function(list) {
            var self = this;
            if (list._eventsBound) return; // 防止重复绑定
            list._eventsBound = true;

            function clearMarks() {
                var marks = list.querySelectorAll('.insert-before, .insert-after');
                for (var i = 0; i < marks.length; i++) marks[i].classList.remove('insert-before', 'insert-after');
            }

            // 删除 + 开关按钮（事件委托，只更新按钮自身，不整列表重渲染）
            list.addEventListener('click', function(e) {
                var del = e.target.closest ? e.target.closest('.mi-del') : null;
                if (del) { App.removeModel(del.getAttribute('data-del')); return; }
                var copy = e.target.closest ? e.target.closest('.mi-copy') : null;
                if (copy) { App.cloneModel(copy.getAttribute('data-copy')); return; }
                var btn = e.target.closest ? e.target.closest('.mi-toggle') : null;
                if (!btn) return;
                var id = btn.getAttribute('data-id');
                var type = btn.getAttribute('data-toggle');
                var m = Models.get(id);
                if (!m) return;
                var on;
                if (type === 'visible') {
                    m.visible = (m.visible === false);
                    Models.setVisible(id, m.visible);
                    on = m.visible;
                } else { return; }
                btn.classList.toggle('on', on);
                btn.innerHTML = on ? '👁' : '🚫';
                try { Store.addLog('info', '', 'model', '「' + m.name + '」窗口可见 → ' + (on ? '开' : '关')); } catch(ex) {}
            });

            list.addEventListener('click', function(e) {
                var dbtn = e.target.closest ? e.target.closest('.mi-default') : null;
                if (!dbtn) return;
                var id = dbtn.getAttribute('data-default');
                Models.setDefaultForType(id).then(function(r) {
                    if (!r || !r.ok) { if (self._toast) self._toast((r && r.error) || '设置失败', 'err'); return; }
                    try {
                        var mm = Models.get(id);
                        Store.addLog('info', '', 'model', mm ? (r.isDefault ? '「' + mm.name + '」已设为' + (r.type === 'vision' ? '识图' : '语言') + '默认模型' : '「' + mm.name + '」已取消默认') : '默认已更新');
                    } catch(ex) {}
                    if (typeof self.renderModelList === 'function') self.renderModelList();
                    if (typeof self.updateStatusModelText === 'function') self.updateStatusModelText();
                });
            });

            list.addEventListener('click', function(e) {
                var b = e.target.closest ? e.target.closest('.mi-re-btn') : null;
                if (!b) return;
                e.preventDefault();
                // 添加表单的档位增删（⊕/⊖），编辑的是表单下拉自身选项
                var addLvAdd = b.getAttribute('data-re-lv-add-new');
                var addLvDel = b.getAttribute('data-re-lv-del-new');
                if (addLvAdd || addLvDel) {
                    var selNew = document.getElementById('cfg-reasoning');
                    if (!selNew) return;
                    // 从下拉选项读出当前档位列表
                    var opts = [];
                    for (var oi = 0; oi < selNew.options.length; oi++) {
                        opts.push({ value: selNew.options[oi].value, label: selNew.options[oi].textContent });
                    }
                    var selfN = self;
                    if (addLvDel) {
                        if (opts.length <= 1) { self._toast('至少保留一个思考强度档位', 'err'); return; }
                        var delIdx = selNew.selectedIndex;
                        if (delIdx < 0 || delIdx >= opts.length) return;
                        var removedOpt = opts.splice(delIdx, 1)[0];
                        var nextOpt = opts[delIdx] || opts[opts.length - 1];
                        _rebuildReasoningSel(selNew, opts, nextOpt.value);
                        self._toast('✓ 已删除档位 ' + (removedOpt.label || removedOpt.value), 'ok');
                        return;
                    }
                    _promptText('新增思考强度档位', '请输入档位 value（发给 API 的值，如 extreme）:').then(function (v) {
                        v = (v == null ? '' : String(v).trim());
                        if (!v) return;
                        if (opts.some(function (it) { return it.value === v; })) { selfN._toast('档位 value 已存在: ' + v, 'err'); return; }
                        return _promptText('新增思考强度档位', '请输入档位显示名（如 极强，留空则用 value）:', v).then(function (label) {
                            label = (label == null ? '' : String(label).trim()) || v;
                            opts.push({ value: v, label: label });
                            _rebuildReasoningSel(selNew, opts, v);
                            selfN._toast('✓ 已新增档位 ' + label + ' 并选中', 'ok');
                        });
                    }).catch(function () {});
                    return;
                }
            });

            // ===== 思考强度档位增删（⊕ 新增档位 / ⊖ 删除当前档位）=====
            function _promptText(title, message, value) {
                if (typeof ConfirmDialog !== 'undefined' && ConfirmDialog.prompt) {
                    return ConfirmDialog.prompt({ title: title, message: message, value: value || '' });
                }
                return Promise.resolve(window.prompt(message, value || ''));
            }
            function _ensureLvList(m) {
                if (!Array.isArray(m.reasoningLevels) || !m.reasoningLevels.length) {
                    var base = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(m.modelId, m) : [];
                    m.reasoningLevels = base.map(function (it) { return { value: it.value, label: it.label || it.value }; });
                }
                return m.reasoningLevels;
            }
            function _rebuildReasoningSel(sel, list, curVal) {
                if (!sel) return;
                var o = '';
                list.forEach(function (it) {
                    o += '<option value="' + String(it.value).replace(/"/g, '&quot;') + '"' + (it.value === curVal ? ' selected' : '') + '>' + String(it.label || it.value).replace(/</g, '&lt;') + '</option>';
                });
                if (curVal && !list.some(function (it) { return it.value === curVal; })) {
                    o += '<option value="' + String(curVal).replace(/"/g, '&quot;') + '" selected>' + String(curVal) + ' (当前)</option>';
                }
                sel.innerHTML = o;
            }
            list.addEventListener('click', function (e) {
                var addBtn = e.target.closest ? e.target.closest('[data-re-lv-add]') : null;
                var delBtn = e.target.closest ? e.target.closest('[data-re-lv-del]') : null;
                if (!addBtn && !delBtn) return;
                e.preventDefault();
                var id = (addBtn || delBtn).getAttribute(addBtn ? 'data-re-lv-add' : 'data-re-lv-del');
                var sel = list.querySelector('[data-reasoning-input="' + id + '"]');
                var m = Models.get(id);
                if (!m || !sel) return;
                var lvs = _ensureLvList(m);
                if (delBtn) {
                    if (lvs.length <= 1) { self._toast('至少保留一个思考强度档位', 'err'); return; }
                    var curVal = sel.value;
                    var idx = -1;
                    for (var i = 0; i < lvs.length; i++) { if (lvs[i].value === curVal) { idx = i; break; } }
                    if (idx < 0) { self._toast('当前值不在档位列表中，无法删除', 'err'); return; }
                    var removed = lvs.splice(idx, 1)[0];
                    var nextVal = (lvs[idx] || lvs[lvs.length - 1]).value;
                    m.reasoningEffort = nextVal;
                    _rebuildReasoningSel(sel, lvs, nextVal);
                    Models.save();
                    self._toast('✓ 已删除档位 ' + (removed.label || removed.value) + '，当前档位: ' + nextVal, 'ok');
                    Store.addLog('info', id, 'model-levels', '删除思考强度档位: ' + (removed.label || removed.value) + ' | 模型: ' + m.name);
                    return;
                }
                // ⊕ 新增档位：先问 value，再问 label
                _promptText('新增思考强度档位', '请输入档位 value（发给 API 的值，如 extreme）:').then(function (v) {
                    v = (v == null ? '' : String(v).trim());
                    if (!v) return;
                    if (lvs.some(function (it) { return it.value === v; })) { self._toast('档位 value 已存在: ' + v, 'err'); return; }
                    return _promptText('新增思考强度档位', '请输入档位显示名（如 极强，留空则用 value）:', v).then(function (label) {
                        label = (label == null ? '' : String(label).trim()) || v;
                        lvs.push({ value: v, label: label });
                        m.reasoningEffort = v;
                        _rebuildReasoningSel(sel, lvs, v);
                        Models.save();
                        self._toast('✓ 已新增档位 ' + label + ' 并设为当前', 'ok');
                        Store.addLog('info', id, 'model-levels', '新增思考强度档位: ' + v + '(' + label + ') | 模型: ' + m.name);
                    });
                }).catch(function () {});
            });

            // ===== 拖拽排序（HTML5 Drag API + 插入位置预览线）=====
            var dragEl = null;
            list.addEventListener('dragstart', function(e) {
                dragEl = e.target.closest ? e.target.closest('.model-item') : null;
                if (!dragEl) return;
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', dragEl.getAttribute('data-model-id')); } catch(ex) {}
                var el = dragEl;
                setTimeout(function() { el.classList.add('dragging'); }, 0);
            });
            list.addEventListener('dragend', function() {
                if (!dragEl) return;
                dragEl.classList.remove('dragging');
                clearMarks();
                dragEl = null;
            });
            list.addEventListener('dragover', function(e) {
                if (!dragEl) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                var target = e.target.closest ? e.target.closest('.model-item') : null;
                clearMarks();
                if (!target || target === dragEl) return;
                var rect = target.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) {
                    target.classList.add('insert-before');
                } else {
                    target.classList.add('insert-after');
                }
            });
            list.addEventListener('drop', function(e) {
                if (!dragEl) return;
                e.preventDefault();
                var target = e.target.closest ? e.target.closest('.model-item') : null;
                if (!target || target === dragEl) return;
                var dragId = dragEl.getAttribute('data-model-id');
                var rect = target.getBoundingClientRect();
                var isTop = e.clientY < rect.top + rect.height / 2;
                var items = Models.list.filter(function(mm) { return !mm.imageGen; });
                var targetIdx = -1;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].id === target.getAttribute('data-model-id')) { targetIdx = i; break; }
                }
                if (targetIdx < 0) return;
                var insertIdx = isTop ? targetIdx : targetIdx + 1;
                var fromIdx = -1;
                for (var j = 0; j < Models.list.length; j++) {
                    if (Models.list[j].id === dragId) { fromIdx = j; break; }
                }
                if (fromIdx < 0) return;
                if (fromIdx < insertIdx) insertIdx--;
                Models.move(dragId, insertIdx);
                try { Store.addLog('info', '', 'model', '模型顺序已调整'); } catch(ex) {}
                self.renderModelList();
            });
        },

        // ===== 保存模型 =====
        saveModel: function() {
            var name = document.getElementById('cfg-name').value.trim();
            var endpoint = document.getElementById('cfg-endpoint').value.trim();
            var key = document.getElementById('cfg-key').value.trim();
            var modelId = document.getElementById('cfg-modelid').value.trim();
            if (!name || !endpoint || !key || !modelId) {
                document.getElementById('testResult').innerHTML = '<span class="err">请填写完整信息</span>';
                return;
            }
                        // 密钥格式校验：禁止把 JWT token（eyJ...）当模型密钥；该网关 网关只接受 sk- 开头的 Virtual Key
            if (false) {
                document.getElementById('testResult').innerHTML = '<span class="err">✗ 密钥格式错误：检测到 JWT token（eyJ... 开头）。该网关 网关不接受 JWT，请到 服务商控制台的密钥页面 获取 sk- 开头的虚拟密钥节点后重新填写。</span>';
                Store.addLog('error', '', 'model-add', '密钥格式错误: ' + name + ' (检测到 JWT, eyJ... 开头)');
                return;
            }
            if (false) {
                document.getElementById('testResult').innerHTML = '<span class="err">✗ 密钥格式错误：该网关 需要 sk- 开头的虚拟密钥（到 服务商控制台的密钥页面 获取），不能使用 JWT token。</span>';
                Store.addLog('error', '', 'model-add', '密钥格式错误: ' + name + ' (非sk-开头)');
                return;
            }
            // 允许重复 API Key（用户要求：同一 API Key 可添加到多个模型），去掉重复校验
            // var duplicate = Models.list.find(function(item) {
            //     return item && item.key === key;
            // });
            // if (duplicate) {
            //     document.getElementById('testResult').innerHTML = '<span class="err">已经有同样的 API Key 输入了，请换一个不同的 API Key。</span>';
            //     Store.addLog('warn', '', 'model-add', '拒绝重复 API Key: ' + name + ' 与 ' + duplicate.name);
            //     return;
            // }
            var reasoningEl = document.getElementById('cfg-reasoning');
            var reasoningEffort = reasoningEl ? reasoningEl.value : 'medium';
            // 表单下拉的完整选项即该模型的档位表（含用 ⊕/⊖ 增删过的）
            var reasoningLevels = [];
            if (reasoningEl) {
                for (var ri = 0; ri < reasoningEl.options.length; ri++) {
                    reasoningLevels.push({ value: reasoningEl.options[ri].value, label: reasoningEl.options[ri].textContent });
                }
            }
            var newModel = { name: name, endpoint: endpoint, key: key, modelId: modelId, reasoningEffort: reasoningEffort, visible: true, enabled: true };
            if (reasoningLevels.length) newModel.reasoningLevels = reasoningLevels;
            Models.add(newModel).then(function(r) {
                if (r && r.ok) {
                    Store.addLog('info', '', 'model-add', '添加模型: ' + name + ' | endpoint=' + endpoint + ' | modelId=' + modelId + ' | reasoning=' + reasoningEffort);
                }
            });
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            // 保存后自动测试连通
            this.testModel();
        },

        // saveModelKey 已合并进 saveModelSettings 一键保存（保留兼容入口）
        saveModelKey: async function(id) {
            await this.saveModelSettings(id);
        },

        // ===== 删除模型 =====
        removeModel: async function(id) {
            var m0 = Models.get(id);
            var mName0 = m0 ? m0.name : id;
            var ok = await ConfirmDialog.confirm({
                title: '删除模型',
                message: '确定删除「' + mName0 + '」模型配置？删除后不可恢复。',
                okText: '删除', danger: true
            });
            if (!ok) return;
            var m = Models.get(id);
            var mName = m ? m.name : id;
            Models.remove(id);
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            Store.addLog('warn', id, 'model-remove', '删除模型: ' + mName);
        },

        // ===== 清除模型密钥 =====
        clearModelKey: async function(id) {
            var m = Models.get(id);
            if (!m) return;
            var ok = await ConfirmDialog.confirm({
                title: '清除密钥',
                message: '确定清除「' + m.name + '」当前已保存的密钥吗？清除后必须重新填写并保存才能连接。',
                okText: '清除', danger: true
            });
            if (!ok) return;
            m.key = '';
            m.apiKey = '';
            Models.save();
            if (typeof Store !== 'undefined' && Store.clearModelKey) Store.clearModelKey(id);
            this.renderModelList();
            var tr = document.querySelector('[data-test-result="' + id + '"]');
            if (tr) tr.innerHTML = '<span class="ok">✓ 密钥已清除，请重新填写并保存</span>';
            Store.addLog('warn', id, 'model-key-clear', '清除模型密钥: ' + m.name);
        },

        // ===== 修改模型显示名称 =====
        renameModel: async function(id) {
            var m = Models.get(id);
            if (!m) return;
            var name = await ConfirmDialog.prompt({
                title: '修改模型名称',
                message: '请输入模型显示名称：',
                value: m.name
            });
            if (name === null || name === undefined) return;
            name = (name || '').trim();
            if (!name) {
                await ConfirmDialog.alert({ title: '提示', message: '模型名称不能为空。' });
                return;
            }
            if (name === m.name) return;
            var previousName = m.name;
            m.name = name;
            Models.save();
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            Store.addLog('info', id, 'model-rename', '修改模型名称: ' + previousName + ' → ' + name);
        },

        // ===== 复制模型通道 =====
        cloneModel: function(id) {
            var source = Models.get(id);
            if (!source) return;
            var copy = Models.clone(id);
            if (!copy) return;
            this.renderModelList();
            this.updateStatusModelText();
            this.refreshAllModelSelects();
            Store.addLog('info', copy.id, 'model-clone', '复制模型通道: ' + source.name + ' → ' + copy.name + '（API Key 已清空）');
        },

        // ===== 测试连通 =====
        testModel: function(id) {
            var self = this;
            var resultEl;
            var endpoint, key, modelId, name;

            if (id) {
                var m = Models.get(id);
                if (!m) return;
                // 优先从输入框读取当前值（用户可能改了还没保存）
                var container = document.getElementById('modelList');
                var endpointInputEl = container.querySelector('[data-endpoint-input="' + id + '"]');
                var modelIdInputEl = container.querySelector('[data-modelid-input="' + id + '"]');
                var inputEl = container.querySelector('[data-key-input="' + id + '"]');
                endpoint = (endpointInputEl ? endpointInputEl.value.trim() : '') || m.endpoint;
                modelId = (modelIdInputEl ? modelIdInputEl.value.trim() : '') || m.modelId;
                name = m.name;
                var inputVal = inputEl ? inputEl.value.trim() : '';
                if (inputVal) {
                    // 清除可能残留的掩码文本（兼容旧版）
                    inputVal = inputVal.replace(/sk-•+•?/g, '').trim();
                }
                if (inputVal) {
                    // 输入框有密钥（默认回显已存的），先保存再测试
                    m.key = inputVal;
                    m.apiKey = inputVal;
                    Models.save();
                    key = inputVal;
                } else {
                    // 输入框为空 = 用户清空了密钥，提示先保存
                    resultEl = container.querySelector('[data-test-result="' + id + '"]');
                    if (resultEl) resultEl.innerHTML = '<span class="err">请先输入 API 密钥并保存</span>';
                    return;
                }
                if (!key) {
                    resultEl = container.querySelector('[data-test-result="' + id + '"]');
                    if (resultEl) resultEl.innerHTML = '<span class="err">请先输入 API 密钥</span>';
                    return;
                }
                resultEl = container.querySelector('[data-test-result="' + id + '"]');
            } else {
                endpoint = document.getElementById('cfg-endpoint').value.trim();
                key = document.getElementById('cfg-key').value.trim();
                modelId = document.getElementById('cfg-modelid').value.trim();
                name = document.getElementById('cfg-name').value.trim() || '测试';
                resultEl = document.getElementById('testResult');
                if (!endpoint || !key || !modelId) {
                    resultEl.innerHTML = '<span class="err">请先填写完整配置</span>';
                    return;
                }
            }

            resultEl.innerHTML = '<span>正在测试…</span>';
            Store.addLog('info', id || '', 'model-test', '测试连通: ' + name + ' | endpoint=' + endpoint + ' | model=' + modelId);

            // 请求头：基础 + 模型自定义附加头
            var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
            if (id) {
                var mm = Models.get(id);
                if (mm && mm.headers) for (var hk in mm.headers) if (mm.headers.hasOwnProperty(hk)) headers[hk] = mm.headers[hk];
            }
            // 请求体：基础 + 模型自定义附加参数
            // 生图模型（火山方舟 images/generations 等接口）必须用 prompt 字段，不能发 messages
            var _isImageEndpoint = /images\/generations/i.test(endpoint || '');
            var _mmPayload = (id || '').trim() ? Models.get(String(id).trim()) : (typeof Models !== 'undefined' && Models.list ? (Models.list.find ? Models.list.find(function(x){return x.endpoint===endpoint && x.modelId===modelId;}) : null) : null);
            if (!_isImageEndpoint && _mmPayload && _mmPayload.imageGen) _isImageEndpoint = true;
            var payload;
            if (_isImageEndpoint) {
                payload = { model: modelId, prompt: '一张连通性测试图：晴朗天空下的一只小猫', size: '1920x1920', response_format: 'url' };
            } else {
                payload = { model: modelId, messages: [{ role: 'user', content: '你好，请回复"连通成功"' }], stream: false };
            }
            // 注入思考强度（与正式对话一致）
            var _re = null;
            if (id) {
                var mm2 = Models.get(id);
                _re = mm2 && mm2.reasoningEffort;
                if (mm2 && mm2.body) for (var bk in mm2.body) if (mm2.body.hasOwnProperty(bk)) payload[bk] = mm2.body[bk];
            } else {
                var _reEl = document.getElementById('cfg-reasoning');
                if (_reEl) _re = _reEl.value;
            }
            if (_re && _re !== 'off') {
                payload.reasoning_effort = _re;
            }

            // 所有模型统一通过标准 OpenAI 兼容代理测试。
            var reqP = DB.proxy(endpoint, headers, payload);
            reqP.then(function(res) {
                if (res.ok && res.data) {
                    resultEl.innerHTML = '<span class="ok">✓ ' + name + ' 连通成功</span>';
                    Store.addLog('info', id || '', 'model-test-ok', '连通成功: ' + name + ' | HTTP ' + (res.status || 200));
                } else {
                    var showMsg = (typeof _translateApiError === 'function')
                        ? _translateApiError(res.status, res.error || res.raw)
                        : ('HTTP ' + (res.status || '?') + ': ' + (res.error || res.raw || '未知错误'));
                    resultEl.innerHTML = '<span class="err">✗ 连通失败：' + showMsg + '</span>';
                    Store.addLog('error', id || '', 'model-test-fail', '连通失败: ' + name + ' | ' + showMsg);
                }
            }).catch(function(err) {
                var _em = (typeof _translateApiError === 'function') ? _translateApiError(0, err.message) : (err.message || '未知错误');
                resultEl.innerHTML = '<span class="err">✗ 代理请求失败：' + _em + '</span>';
                Store.addLog('error', id || '', 'model-test-fail', '代理请求失败: ' + name + ' | ' + _em);
            });
        },
});
