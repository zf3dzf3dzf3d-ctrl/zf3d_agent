// ==== 拆分自 app-agent.js：询问用户工具（ask_user） ====
Object.assign(App, {
                // ===== 询问用户工具（ask_user）=====
        // 全局浮动弹窗（挂 document.body，fixed 居中，无遮罩可点别处），返回 Promise
                askUser: function(toolArgs, box, chat) {
            var self = this;
            var question = (toolArgs && toolArgs.question) || '请补充说明：';
            var chatId = (chat && chat.id) || '';
            // 多字段支持：toolArgs.fields 为字段数组（[{type,label,name,options,placeholder,...}]）；
            // 未传 fields 时退化为单一文本框，保持向后兼容。
            var rawFields = (toolArgs && Array.isArray(toolArgs.fields) && toolArgs.fields.length)
                ? toolArgs.fields : null;

            // ===== 字段类型注册表：可扩展——新增类型只需在下面加 {render, collect} 一组 =====
            // render(field, fi, self) -> 返回该字段控件 HTML 字符串
            // collect(root, fi, self) -> 返回该字段当前取值（或数组）
            var FIELD_TYPES = {
                'text': {
                    label: '单行文本',
                    render: function(f, fi, s) {
                        var ph = f.placeholder || ('请输入' + (f.label || '内容') + '…');
                        return '<input type="text" class="ask-user-modal-input ask-field-ctl" data-fi="' + fi + '" data-type="text" placeholder="' + s._esq(ph) + '" />';
                    },
                    collect: function(root, fi) {
                        var el = root.querySelector('.ask-field-ctl[data-fi="' + fi + '"]');
                        return (el && el.value || '').trim();
                    },
                    checkValid: function(root, fi, f, s) {
                        var el = root.querySelector('.ask-field-ctl[data-fi="' + fi + '"]');
                        return !(el && !(el.value || '').trim());
                    }
                },
                'select': {
                    label: '下拉选择',
                    render: function(f, fi, s) {
                        var opts = (f.options && f.options.length) ? f.options : (f.choices || []);
                        var h = '<select class="ask-user-modal-input ask-field-ctl ask-field-select" data-fi="' + fi + '" data-type="select">';
                        h += '<option value="">' + s._esq(f.placeholder || '请选择…') + '</option>';
                        for (var i = 0; i < opts.length; i++) {
                            var o = opts[i];
                            var ov = (typeof o === 'object' && o !== null) ? o.value : o;
                            var ol = (typeof o === 'object' && o !== null) ? (o.label || o.text || o.value) : o;
                            h += '<option value="' + s._esq(String(ov)) + '">' + s._esq(String(ol)) + '</option>';
                        }
                        h += '</select>';
                        return h;
                    },
                    collect: function(root, fi) {
                        var el = root.querySelector('.ask-field-ctl[data-fi="' + fi + '"]');
                        return (el && el.value || '').trim();
                    },
                    checkValid: function(root, fi, f, s) {
                        var el = root.querySelector('.ask-field-ctl[data-fi="' + fi + '"]');
                        return !(el && !(el.value || '').trim());
                    }
                },
                'radio': {
                    label: '单选',
                    render: function(f, fi, s) {
                        var opts = (f.options && f.options.length) ? f.options : (f.choices || []);
                        var h = '<div class="ask-user-options" role="radiogroup" data-type="radio">';
                        for (var i = 0; i < opts.length; i++) {
                            var o = opts[i];
                            var ov = (typeof o === 'object' && o !== null) ? o.value : o;
                            var ol = (typeof o === 'object' && o !== null) ? (o.label || o.text || o.value) : o;
                            if (typeof ov !== 'string') ov = String(ov);
                            if (typeof ol !== 'string') ol = String(ol);
                            var id = 'askopt-' + fi + '-' + i;
                            h += '<label class="ask-user-opt">' +
                                '<input type="radio" class="ask-field-ctl ask-radio" name="askq-' + fi + '" data-fi="' + fi + '" data-fieldtype="radio" value="' + s._esq(ov) + '" id="' + id + '"' + ((f.default === ov) ? ' checked' : '') + ' />' +
                                '<span class="ask-opt-radio" aria-hidden="true"></span>' +
                                '<span class="ask-opt-text">' + s._esq(ol) + '</span>' +
                                '</label>';
                        }
                        h += '</div>';
                        return h;
                    },
                    collect: function(root, fi) {
                        var el = root.querySelector('.ask-field-ctl[data-fi="' + fi + '"]:checked');
                        return el ? el.value : '';
                    },
                    checkValid: function(root, fi, f, s) {
                        var el = root.querySelector('.ask-field-ctl[data-fi="' + fi + '"]:checked');
                        return !!(el && el.value);
                    }
                },
                'checkbox': {
                    label: '多选',
                    render: function(f, fi, s) {
                        var opts = (f.options && f.options.length) ? f.options : (f.choices || []);
                        var h = '<div class="ask-user-options" data-type="checkbox">';
                        for (var i = 0; i < opts.length; i++) {
                            var o = opts[i];
                            var ov = (typeof o === 'object' && o !== null) ? o.value : o;
                            var ol = (typeof o === 'object' && o !== null) ? (o.label || o.text || o.value) : o;
                            if (typeof ov !== 'string') ov = String(ov);
                            if (typeof ol !== 'string') ol = String(ol);
                            var id = 'askcx-' + fi + '-' + i;
                            var def = (f.default && f.default.indexOf(ov) >= 0);
                            h += '<label class="ask-user-opt">' +
                                '<input type="checkbox" class="ask-field-ctl ask-checkbox" data-fi="' + fi + '" data-fieldtype="checkbox" value="' + s._esq(ov) + '" id="' + id + '"' + (def ? ' checked' : '') + ' />' +
                                '<span class="ask-opt-check" aria-hidden="true"></span>' +
                                '<span class="ask-opt-text">' + s._esq(ol) + '</span>' +
                                '</label>';
                        }
                        h += '</div>';
                        return h;
                    },
                    collect: function(root, fi) {
                        var els = root.querySelectorAll('.ask-field-ctl[data-fi="' + fi + '"]:checked');
                        var arr = [];
                        for (var i = 0; i < els.length; i++) arr.push(els[i].value);
                        return arr;
                    },
                    checkValid: function(root, fi, f, s) {
                        // 未设置 required 时允许多选为空
                        if (f && f.required === false) return true;
                        var els = root.querySelectorAll('.ask-field-ctl[data-fi="' + fi + '"]:checked');
                        return els.length > 0;
                    }
                }
                // ↓ 未来扩展：'date': {...}, 'number': {...}, 'rating': {...}, 'slider': {...} 等
            };

            // 归一化字段：为简单字段补默认配置
            function normFields(list) {
                var out = [];
                for (var i = 0; i < list.length; i++) {
                    var f = list[i];
                    if (typeof f === 'string') f = { type: 'text', label: f };
                    if (typeof f !== 'object' || f === null) f = {};
                    var type = (f.type || 'text').toLowerCase();
                    if (!FIELD_TYPES[type]) type = 'text';
                    var name = f.name || ('field' + (i + 1));
                    out.push({
                        type: type,
                        label: f.label || FIELD_TYPES[type].label || name,
                        name: name,
                        options: f.options || f.choices || [],
                        placeholder: f.placeholder || '',
                        default: f['default'],
                        required: f.required !== false
                    });
                }
                return out;
            }

            var fields = rawFields ? normFields(rawFields) : null;

            return new Promise(function(resolve) {
                
                                // ===== 防卡死(3)：ask_user 模态框超时兜底 =====
                                var askSettled = false;
                                var askTimer = null;
                                function askResolve(v) {
                                    if (askSettled) return;
                                    askSettled = true;
                                    if (askTimer) { clearTimeout(askTimer); askTimer = null; }
                                    resolve(v);
                                }
                                askTimer = setTimeout(function() {
                                    askResolve({ success: false, cancelled: true, question: question, answer: '', message: '等待用户输入超时，已自动继续，请稍后重试。', tool: 'ask_user' });
                                    try { if (modal && modal.parentNode) modal.parentNode.removeChild(modal); } catch(e){}
                                    if (self._askUserQueue && self._askUserQueue.length > 0) { var _nq = self._askUserQueue.shift(); setTimeout(function(){ self.askUser(_nq.toolArgs, _nq.box, _nq.chat).then(_nq.resolve); }, 300); }
                                }, 300000);
                
                // 排队机制：如果已有一个询问弹窗在等用户回答，新请求排队等待，不替换
                var existing = document.getElementById('askUserModalGlobal');
                if (existing) {
                    self._askUserQueue = self._askUserQueue || [];
                    self._askUserQueue.push({ resolve: resolve, toolArgs: toolArgs, box: box, chat: chat, question: question, fields: fields });
                    var qBadge = existing.querySelector('.ask-user-queue-badge');
                    if (!qBadge) {
                        qBadge = document.createElement('span');
                        qBadge.className = 'ask-user-queue-badge';
                        qBadge.style.cssText = 'font-size:11px;color:rgba(255,193,7,0.95);background:rgba(255,193,7,0.18);padding:2px 8px;border-radius:8px;margin-left:8px;white-space:nowrap;';
                        existing.querySelector('.ask-user-modal-head').appendChild(qBadge);
                    }
                    qBadge.textContent = '排队：' + self._askUserQueue.length;
                    return;
                }

                var modal = document.createElement('div');
                modal.id = 'askUserModalGlobal';
                modal.className = 'ask-user-modal-global';
                modal.innerHTML =
                    '<div class="ask-user-modal-card ask-user-modal-card--form">' +
                        '<div class="ask-user-modal-head">' +
                            '<span class="ask-user-modal-icon">?</span>' +
                            '<span class="ask-user-modal-title">询问用户</span>' +
                            '<span class="ask-user-modal-status">等待你的回答</span>' +
                            '<span class="ask-user-modal-close" title="取消并停止对话">&times;</span>' +
                        '</div>' +
                        '<div class="ask-user-modal-body">' +
                            '<div class="ask-user-modal-question">' + self._escapeForAttr(question) + '</div>' +
                            '<div class="ask-user-fields"></div>' +
                            '<div class="ask-user-input-row ask-user-btn-row">' +
                                '<button type="button" class="ask-user-submit ask-user-modal-submit">提交</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
                document.body.appendChild(modal);

                var fieldsBox = modal.querySelector('.ask-user-fields');
                var btn = modal.querySelector('.ask-user-modal-submit');
                var closeBtn = modal.querySelector('.ask-user-modal-close');
                var card = modal.querySelector('.ask-user-modal-card');
                var statusEl = modal.querySelector('.ask-user-modal-status');
                var finished = false;

                // 渲染字段（若非表单则放一个普通文本框以保持兼容并聚焦）
                function renderFields() {
                    if (!fields) {
                        var ph = '在此输入你的回答…';
                        fieldsBox.innerHTML = '<div class="ask-field-row ask-field-row--single">' +
                            '<input type="text" class="ask-user-modal-input ask-user-single-input" placeholder="' + ph + '" />' +
                            '</div>';
                        return;
                    }
                    var html = '';
                    for (var i = 0; i < fields.length; i++) {
                        var f = fields[i];
                        var t = FIELD_TYPES[f.type];
                        html += '<div class="ask-field-row" data-name="' + self._esq(f.name) + '">' +
                            '<div class="ask-field-label">' + self._esq(f.label) +
                                (f.required ? '<span class="ask-field-required"> *</span>' : '') +
                            '</div>' +
                            '<div class="ask-field-control">' + t.render(f, i, self) + '</div>' +
                        '</div>';
                    }
                    fieldsBox.innerHTML = html;
                }
                renderFields();

                function closeModal() {
                    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
                    finished = true;
                    // 触发队列中的下一个 ask_user
                    if (self._askUserQueue && self._askUserQueue.length > 0) {
                        var next = self._askUserQueue.shift();
                        setTimeout(function() {
                            self.askUser(next.toolArgs, next.box, next.chat).then(next.resolve);
                        }, 300);
                    }
                }

                function flashReceived() {
                    if (statusEl) statusEl.textContent = '? 已收到你的回答';
                    if (card) card.style.borderColor = 'rgba(74, 187, 120, 0.6)';
                }

                function collectAnswer() {
                    // 兼容纯文本模式：如果弹窗里存在单文本框（asub 模式），取其值
                    var single = modal.querySelector('.ask-user-single-input');
                    if (single) return (single.value || '').trim();

                    var result = {};
                    var firstErr = null;
                    for (var i = 0; i < fields.length; i++) {
                        var f = fields[i];
                        var t = FIELD_TYPES[f.type];
                        var v = t.collect(fieldsBox, i, self);
                        // 校验必填
                        if (firstErr === null && f.required && t && t.checkValid) {
                            if (!t.checkValid(fieldsBox, i, f, self)) {
                                firstErr = f.label;
                            }
                        }
                        result[f.name] = v;
                    }
                    return { values: result, firstErr: firstErr };
                }

                function finish() {
                    if (finished) return;
                    var ans;
                    if (fields) {
                        ans = collectAnswer();
                        var singleEl = modal.querySelector('.ask-user-single-input');
                        if (ans && ans.firstErr && !singleEl) {
                            // 必填未填，提示并聚焦第一个错误字段
                            if (statusEl) statusEl.textContent = '\u26A0\uFE0F 请完善：' + ans.firstErr;
                            var errCtl = fieldsBox.querySelector('.ask-field-label');
                            if (errCtl) errCtl.scrollIntoView({ block: 'center' });
                            return;
                        }
                        // 组装可读回答文本
                        var parts = [];
                        var valObj = (ans && ans.values) ? ans.values : {};
                        for (var i = 0; i < fields.length; i++) {
                            var f = fields[i];
                            var v = valObj[f.name];
                            var str;
                            if (Array.isArray(v)) str = v.join('、');
                            else str = (v === undefined || v === null || v === '') ? '' : String(v);
                            if (str) { parts.push(f.label + '：' + str); }
                        }
                        var val = parts.length ? parts.join('；') : '';
                        if (!val) { if (statusEl) statusEl.textContent = '\u26A0\uFE0F 请至少填写一项'; return; }
                        flashReceived();
                        var full = (valObj && Object.keys(valObj).length)
                            ? valObj
                            : val;
                        setTimeout(closeModal, 250);
                        // 在所属对话里补一条简洁的“问/答”记录，便于回溯
                        try {
                            if (chatId) {
                                Store.addMessage(chatId, 'tool', '[询问用户] ' + question + ' → 你的回答：' + val, 'tool');
                            }
                        } catch (e) {}
                        askResolve({
                            success: true,
                            question: question,
                            answer: full,
                            message: '用户回答：' + val,
                            tool: 'ask_user'
                        });
                    } else {
                        var single = modal.querySelector('.ask-user-single-input');
                        var val = (single && single.value || '').trim();
                        if (!val) { if (single) single.focus(); return; }
                        flashReceived();
                        setTimeout(closeModal, 250);
                        try {
                            if (chatId) {
                                Store.addMessage(chatId, 'tool', '[询问用户] ' + question + ' → 你的回答：' + val, 'tool');
                            }
                        } catch (e) {}
                        askResolve({
                            success: true,
                            question: question,
                            answer: val,
                            message: '用户回答：' + val,
                            tool: 'ask_user'
                        });
                    }
                }

                // 关闭按钮：取消询问，停止 Agent 循环
                if (closeBtn) closeBtn.addEventListener('click', function() {
                    if (finished) return;
                    flashReceived = null; // 不显示已收到
                    if (statusEl) statusEl.textContent = '用户已取消';
                    if (card) { card.style.borderColor = 'rgba(255,107,107,0.6)'; }
                    // 记录取消日志
                    try {
                        if (chatId) {
                            Store.addMessage(chatId, 'tool', '[询问用户] ' + question + ' → 用户取消', 'tool');
                        }
                    } catch(e) {}
                    var cancelVal = { success: false, cancelled: true, question: question, answer: '', message: '用户取消了询问，对话已停止。', tool: 'ask_user' };
                    setTimeout(function() {
                        closeModal();
                        askResolve(cancelVal);
                    }, 200);
                });

                if (btn) btn.addEventListener('click', finish);
                if (fields) {
                    // 表单模式：聚焦第一个未填字段 / 或允许回车提交（在文本框上）
                } else {
                    var single = modal.querySelector('.ask-user-single-input');
                    if (single) {
                        single.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter') { e.preventDefault(); finish(); }
                        });
                        setTimeout(function() { single.focus(); }, 60);
                    }
                }
            });
        },
});
