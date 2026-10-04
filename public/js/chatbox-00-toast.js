
/* ===== 自研对话框 shim (auto-injected) ===== */
function _dlgAlert(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.alert({ title: '提示', icon: 'ℹ️', confirmText: '知道了', message: typeof msg === 'string' ? msg : String(msg) });
  }
  window.alert(typeof msg === 'string' ? msg : String(msg));
  return Promise.resolve();
}
function _dlgConfirm(msg){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.confirm({ title: '请确认', icon: '❓', confirmText: '确定', cancelText: '取消', message: msg });
  }
  return Promise.resolve(window.confirm(msg));
}
function _dlgPrompt(msg, val){
  if (typeof ConfirmDialog !== 'undefined') {
    return ConfirmDialog.prompt({ title: '请输入', icon: '✏️', confirmText: '确定', cancelText: '取消', message: msg, value: val || '' });
  }
  return Promise.resolve(window.prompt(msg, val || ''));
}

﻿// ==== 拆分自 app-chatbox.js：防风暴提示（右上角轻提示，自动消失）_新建窗口尺寸记忆_创建对话框_Shift+左键 ====
Object.assign(App, {


        // ===== 防风暴提示（右上角轻提示，自动消失） =====
        _showStormToast: function(text, color) {
            try {
                var t = document.createElement('div');
                t.textContent = '🛡 ' + text;
                var bg = color || '#c0392b';
                t.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:' + bg + ';color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,sans-serif;';
                document.body.appendChild(t);
                setTimeout(function() { t.remove(); }, 4000);
            } catch (e) { console.warn('[ChatBox] toast失败', e); }
        },

        // ===== 自定义确认对话框（替代 window.confirm 原生弹窗，风格与界面统一） =====
        _showCustomConfirm: function(opts) {
            try {
                opts = opts || {};
                var old = document.getElementById('zfCustomConfirm');
                if (old) old.remove();   // 同时只保留一个
                var overlay = document.createElement('div');
                overlay.id = 'zfCustomConfirm';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
                var box = document.createElement('div');
                box.style.cssText = 'min-width:320px;max-width:440px;background:#2d2d2d;color:#eee;border:1px solid #444;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;';
                var title = document.createElement('div');
                title.textContent = opts.title || '提示';
                title.style.cssText = 'padding:10px 16px;font-size:13px;color:#aaa;border-bottom:1px solid #3a3a3a;';
                var body = document.createElement('div');
                body.textContent = opts.message || '';
                body.style.cssText = 'padding:16px;font-size:14px;line-height:1.7;white-space:pre-wrap;';
                var btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:0 16px 16px;';
                function mkBtn(text, primary, fn) {
                    var b = document.createElement('button');
                    b.textContent = text;
                    b.style.cssText = 'padding:8px 22px;border:none;border-radius:6px;font-size:13px;cursor:pointer;' +
                        (primary ? 'background:#1e88e5;color:#fff;' : 'background:#3a3a3a;color:#ddd;');
                    b.onmouseenter = function(){ b.style.filter = 'brightness(1.15)'; };
                    b.onmouseleave = function(){ b.style.filter = ''; };
                    b.onclick = function(){ close(); fn && fn(); };
                    return b;
                }
                function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey); }
                function onKey(e) { if (e.key === 'Escape') { close(); opts.onCancel && opts.onCancel(); } }
                btnRow.appendChild(mkBtn(opts.cancelText || '取消', false, function(){ opts.onCancel && opts.onCancel(); }));
                btnRow.appendChild(mkBtn(opts.okText || '确定', true, function(){ opts.onOk && opts.onOk(); }));
                box.appendChild(title); box.appendChild(body); box.appendChild(btnRow);
                overlay.appendChild(box);
                document.body.appendChild(overlay);
                document.addEventListener('keydown', onKey);
            } catch (e) {
                console.warn('[ChatBox] 自定义确认框失败，退回原生 confirm', e);
                var ok = _dlgConfirmSync(opts && opts.message || '');
                if (ok) { opts && opts.onOk && opts.onOk(); } else { opts && opts.onCancel && opts.onCancel(); }
            }
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


        // ===== 欢迎语构建（可在切换语言后重渲染）=====
        _welcomeHtml: function (box) {
            var ctx = box._welcomeCtx || {};
            var model = ctx.model;
            var _t = function (s) { try { return (window.I18N && I18N.t) ? I18N.t(s) : s; } catch (e) { return s; } };
            var _w = _t('您好！我是');
            var _modelName = model ? (model.name || '') : '';
            var _effMid = '';
            try {
                _effMid = ctx.mid || (model ? model.modelId : '') || '';
            } catch (e) { }
            if (_modelName) {
                _w += _modelName;
                if (_w.indexOf(_t('模型')) === -1) _w += _t('大模型');
                if (_effMid) _w += _t('（模型ID：') + _effMid + '）';
            } else {
                _w = _t('您好！当前还没有选择模型，请先在底部下拉菜单选择');
            }
            var _effRe = '';
            try { _effRe = ctx.re || ''; } catch (e) { }
            if (_effRe && _modelName) {
                var _reLabel = (typeof ReasoningLevels !== 'undefined' && ReasoningLevels.labelOf) ? (ReasoningLevels.labelOf(_effRe) || _effRe) : _effRe;
                _w += _t('，思考强度：') + _reLabel;
            }
            _w += '。<br>';
            var _catName = Tools.chatCategories[box.id] || ctx.catName || _t('极简');
            var _cat = Tools.categories[_catName];
            var _engList = (typeof DB !== 'undefined' && DB.getEngines) ? DB.getEngines() : [];
            var _eng = (_engList && _engList.length) ? (_engList.find(function(en){ return en.default; }) || _engList[0]) : null;
            _w += _t('我使用的是') + (_eng ? (_eng.icon ? _eng.icon + ' ' : '') + _eng.name : _t('朱峰底层')) + _t('对话引擎，') +
                  ((_cat && _cat.icon ? _cat.icon + ' ' : '📄 ') + (_t(_catName) || _catName)) + _t('模式。') + '<br>';
            try {
                if (typeof App.getProjectContext === 'function') {
                    var _pc = App.getProjectContext();
                    if (_pc && (_pc.root || _pc.project_id)) {
                        _w += _t('当前项目：') + (_pc.project_name || _t('未命名')) + '。<br>';
                    } else {
                        _w += _t('当前项目：未指定。') + '<br>';
                    }
                } else {
                    _w += _t('当前项目：未指定。') + '<br>';
                }
            } catch (e) { _w += _t('当前项目：未指定。') + '<br>'; }
            try {
                var _role = null;
                try { _role = JSON.parse(localStorage.getItem('zf_role_chat_' + (box.dataset.boxId || box.id || 'default')) || 'null'); } catch (e) {}
                if (_role && _role.name) _w += _t('当前角色：') + (_role.avatar || '🎭') + ' ' + _role.name + '。<br>';
            } catch (e) {}
            _w += _t('请告诉我您的目标和任务。');
            return _w;
        },
        // ===== 创建对话框 =====
        createChatBox: function(clientX, clientY, modelId, trustedSpawn) {
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
            // 【派单信任豁免】trustedSpawn=true（策划师/审核员/多角色等程序化派单链路）跳过频率闸门，总量上限仍生效
            self0._createHistory = self0._createHistory.filter(function(t) { return now - t < CREATE_WINDOW_MS; });
            if (!trustedSpawn && self0._createHistory.length >= MAX_PER_WINDOW) {
                console.warn('[ChatBox] 创建频率超限（10秒内 ' + self0._createHistory.length + ' 个），疑似风暴，已拦截');
                self0._showStormToast('创建过快，10秒后再试（防失控保护）');
                return null;
            }
            self0._createHistory.push(now); // 信任来源也计数（仅一次），防止真风暴刷爆总量

            // 【模型同步】每次打开智能体（新建对话）都触发一次官网模型配置同步，
            // 30 秒节流防刷（时间戳存 localStorage）；同步失败静默，不影响新建对话。
            try {
                var _now = Date.now();
                var _last = parseInt(localStorage.getItem('zf_model_sync_ts') || '0', 10) || 0;
                if (_now - _last > 30000) {
                    localStorage.setItem('zf_model_sync_ts', String(_now));
                    fetch('/api/models/refresh').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
                        if (!data) return;
                        try {
                            if (Models.load) Models.load();
                            var _cur = null;
                            try { _cur = box._modelId || modelId || ''; } catch (e) {}
                            if (_cur && Models.get && !Models.get(_cur)) {
                                // 当前线路已被官网下架 → 三级优先级找默认（官网下发 → 本地 isDefault），都没有则留空白等用户手选，绝不取第一个
                                var _all = Models.list ? Models.list() : [];
                                var _isZf = function (m) { return !!(m && (m.zfLine || m.zfManaged || m.zfPinned || m.keyRef === 'zf_token' || m.keyRef === 'server' || /127\.0\.0\.1:(8527|8509|8554|8787|8788)/.test(String(m.endpoint || '') + String(m.baseUrl || '')))); };
                                var _def = _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint && _isZf(m); }) || _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint; }) || null;
                                if (_def && box._modelId !== undefined) box._modelId = _def.id;
                            }
                        } catch (e) {}
                    }).catch(function () {});
                }
            } catch (e) {}
            // 【模型同步】同上：每次打开智能体都触发一次，30 秒节流。
            try {
                var _now2 = Date.now();
                var _last2 = parseInt(localStorage.getItem('zf_model_sync_ts') || '0', 10) || 0;
                if (_now2 - _last2 > 30000) {
                    localStorage.setItem('zf_model_sync_ts', String(_now2));
                    fetch('/api/models/refresh')
                        .then(function(res) { return res.json(); })
                        .then(function(r) {
                            if (r && r.ok && typeof Models.load === 'function') {
                                Models.load().then(function() {
                                    // 官网已下架当前线路 → 三级优先级找默认（官网下发 → 本地 isDefault），都没有则留空白等用户手选，绝不取第一个
                                    if (self.modelId && !Models.get(self.modelId)) {
                                        var _all = (typeof Models.list === 'function') ? (Models.list() || []) : (Models.list || []);
                                        var _isZf = (typeof Models !== 'undefined' && Models.isZfOfficial) ? Models.isZfOfficial : function (m) { return !!(m && (m.zfLine || m.zfManaged || m.zfPinned)); };
                                        var _def = _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint && _isZf(m); }) || _all.find(function (m) { return m.isDefault && m.enabled !== false && m.endpoint; }) || null;
                                        if (_def) { self.modelId = _def.id; self._modelIdOverride = _def.modelId || ''; }
                                    }
                                });
                            }
                        })
                        .catch(function() {});
                }
            } catch (e) { /* localStorage 不可用时静默跳过 */ }

            var canvas = canvas0;
            // 对话框 absolute 定位的参照容器就是 canvas（canvasContent），
            // 因此坐标须以 canvas 的 getBoundingClientRect() 为基准（画布可经 transform 平移/缩放）。
            var cRect = cRect0;
            var self = self0;

            var box = document.createElement('div');
            box.className = 'chatbox';
            box.id = this.nextBoxId();
            // 【鼠标跟随 + 视口钳制】未传坐标（或传 0/null）时回退到最近一次鼠标位置；
            // 再钳制到画布可视区内（按 scale 已含在 cRect 中），保证顶部/底部/左右不出屏
            if (!(clientX >= 0) || !(clientY >= 0)) {
                var _m = window.__zfLastMouse || {};
                clientX = (_m.clientX != null) ? _m.clientX : cRect.left + 100;
                clientY = (_m.clientY != null) ? _m.clientY : cRect.top + 60;
            }
            var _M = 8;                 // 屏幕边缘留白
            var _DEF_W = 380, _DEF_H = 140; // 新建框的默认估算尺寸（钳制用）
            // 【修复】画布经 transform: translate+scale(transformOrigin 0 0) 驱动，
            // canvasContent 的局部坐标 = (client坐标 - cRect左上) / scale。
            // 原实现漏除 scale，导致缩放/平移画布后新建框跑偏到原点附近的固定位置。
            var _scale = 1;
            try { _scale = (window.App && typeof App.canvasScale === 'function') ? (App.canvasScale() || 1) : 1; } catch (e) { _scale = 1; }
            if (!(_scale > 0)) _scale = 1;
            var _lx, _ly;
            if (trustedSpawn && typeof clientX === 'number' && typeof clientY === 'number') {
                /* 【信任派单·逻辑坐标】策划师/审核员等程序化派单传入的是画布逻辑坐标
                   （与 chat.el.style.left 同一坐标系），直接使用；
                   不能当屏幕坐标换算+视口钳制，否则画布平移/缩放后子窗跑到老远 */
                _lx = clientX;
                _ly = clientY;
            } else {
                _lx = (clientX - cRect.left) / _scale;
                _ly = (clientY - cRect.top) / _scale;
            }
            // 【修复】钳制基准改为「当前可见区域」的局部坐标范围，而非画布 [0, 全宽]。
            // 旧实现钳在 [8, 全宽-388]：画布平移后鼠标局部坐标（如 3000+）被硬拉回固定边界，
            // 表现为"新建框总出现在固定位置不跟鼠标"。
            // 可见区局部范围：canvasContent 原点在视口的偏移 = -translate，即
            // x ∈ [-tx/scale, (-tx + 可视宽)/scale]，translate 从 computed transform 矩阵读取。
            (function () {
                /* 【信任派单跳过钳制】程序化派单的逻辑坐标不允许被可视区钳制拉回（坐标系不同会跑偏） */
                if (trustedSpawn) return;
                var _tx = 0, _ty = 0;
                try {
                    var _tr = getComputedStyle(canvas).transform;
                    if (_tr && _tr !== 'none') {
                        var _m = _tr.match(/matrix\(([^)]+)\)/);
                        if (_m) { var _p = _m[1].split(','); _tx = parseFloat(_p[4]) || 0; _ty = parseFloat(_p[5]) || 0; }
                    }
                } catch (e) {}
                var _visL = -_tx / _scale, _visT = -_ty / _scale;
                var _visR = _visL + cRect.width / _scale, _visB = _visT + cRect.height / _scale;
                var _EDGE = 8, _ESTW = 380, _ESTH = 140; // 边缘留白/新建框估算尺寸（局部作用域，避免遮蔽外层 _M/_DEF_W/_DEF_H）
                var _minX = Math.min(_visL + _EDGE, _visR - _ESTW - _EDGE);
                var _minY = Math.min(_visT + _EDGE, _visB - _ESTH - _EDGE);
                _lx = Math.max(_minX, Math.min(_lx, _visR - _ESTW - _EDGE));
                _ly = Math.max(_minY, Math.min(_ly, _visB - _ESTH - _EDGE));
            })();
            box.style.left = _lx + 'px';
            box.style.top = _ly + 'px';
            box.style.zIndex = ++this.zCounter;

            // 【用户习惯继承】未显式指定模型线路时，使用上次选择的大模型线路
            // （仅继承线路；模型ID覆盖/思考强度一律取所选线路自身的默认值，不继承上次对话的）
            // （持久化于 private/用户设置/user_settings.json，永久保留；仅影响新对话，不改老对话已有设置）
            var _habit = null;
            try {
                _habit = (window.UserSettings && UserSettings.get) ? UserSettings.get('lastModelSelection', null) : null;
            } catch (e) { _habit = null; }
            if (!modelId && _habit && _habit.modelId) {
                try {
                    if (Models.get(_habit.modelId)) modelId = _habit.modelId;
                } catch (e) { }
            }
            var model = modelId ? Models.get(modelId) : null;
            var boxName = model ? model.name : '未选择模型';
            // 新对话以右侧模型设置为初始快照；后续底部选择器的修改仅作用于本对话。
            // 【分层记忆】优先恢复该线路上次用户记住的 模型ID/思考强度（language 分类），无记忆才用线路默认值，
            // 保证新对话能记住用户上次选择，且模型ID与思考强度始终匹配该线路，不会串台。
            var initialModelIdOverride = model ? (model.modelId || '') : '';
            var initialReasoningEffort = model ? (model.reasoningEffort || ReasoningLevels.defaultValue()) : '';
            if (modelId) {
                try {
                    var _memSel = (window.UserSettings && UserSettings.get) ? (UserSettings.get('modelSelectionMemory', null) || {}) : {};
                    var _rec = (_memSel['language'] && _memSel['language'][modelId]) || null;
                    if (_rec) {
                        if (_rec.modelIdOverride) initialModelIdOverride = String(_rec.modelIdOverride);
                        if (_rec.reasoningEffort) initialReasoningEffort = String(_rec.reasoningEffort);
                    }
                    // 思考强度必须与该模型ID的合法档位匹配，否则回退默认档
                    var _reList = (typeof ReasoningLevels !== 'undefined') ? ReasoningLevels.listFor(initialModelIdOverride, model) : null;
                    if (_reList && _reList.length) {
                        var _ok = _reList.some(function (it) { return it.value === initialReasoningEffort; });
                        if (!_ok) initialReasoningEffort = _reList[0].value;
                    }
                } catch (eMem) {}
            }
            // 修复（5.2.5）：新对话不再盲目继承上一个对话的模型ID覆盖/思考强度
            // （改用 modelSelectionMemory 分层记忆：分类→线路→各自记住的值，跨线路不会串台）。

            // 生成工具分类选择器（与恢复路径一致）
            var _newCatName = Tools.activeCategory || '极简';
            if (!Tools.categories[_newCatName]) _newCatName = '极简';
            Tools.chatCategories[box.id] = _newCatName;
            // 新对话引擎（默认引擎或第一个）→ 分类下拉按引擎过滤
            var _newEngId = '';
            try {
                var _de = (typeof DB !== 'undefined' && DB.getEngines && DB.getEngines().length)
                    ? (DB.getEngines().find(function (en) { return en.default; }) || DB.getEngines()[0]) : null;
                _newEngId = _de ? _de.id : '';
            } catch (e) {}

            box.innerHTML =
                App.buildChatboxPanels({
                    header: App.buildChatboxHeader({
                        title: '对话' + this.chatCounter,
                        headerTitleAttr: '拖拽移动对话；Shift+左键拖拽：按下即在鼠标处复制一个一模一样的对话并跟随拖动',
                        extraBeforeButtons: '<span class="proj-name" style="display:none"></span>'
                    })
                });
                App.fillChatboxConfigWidgets(box, { engineId: '', categoryName: _newCatName });
                // 欢迎消息（新建对话专属，切换语言后自动重渲染）
                box.querySelector('.chatbox-body').innerHTML =
                    '<div class="msg ai" data-welcome="1">' + this._welcomeHtml(box) + '</div>';

            
            // 欢迎语上下文（供切换语言后重渲染使用）
            box._welcomeCtx = { model: model, mid: initialModelIdOverride || '', re: initialReasoningEffort || '', catName: _newCatName || '' };
            // 修复：首次渲染发生在 _welcomeCtx 赋值之前（此时 ctx 为空对象），
            // 导致即便模型已同步命中，欢迎语也会固化"未选择模型"。此处补一次同步重渲染。
            if (model) {
                try {
                    var _wb0 = box.querySelector('[data-welcome]');
                    if (_wb0) _wb0.innerHTML = self0._welcomeHtml(box);
                } catch (e) {}
            }

            // 修复（5.2.5）：Models.load() 为异步，新建对话瞬间模型库可能尚未加载完成，
            // 导致 Models.get() 返回 null → 欢迎语固化"未选择模型"。
            // 此处兜底：模型库加载完成后（轮询等待 _loaded），按 chat 实际模型回填并重渲染欢迎语。
            // 异步兜底：即便初次 model 为 null（模型库未加载完/习惯继承失败），只要存在
            // 期望的模型线路ID（显式传入的或习惯保存的线路），等模型库
            // 加载完成后回填并重渲染欢迎语，避免固化"未选择模型"。
            var _habitMid = (_habit && _habit.modelId) ? String(_habit.modelId) : '';
            if (!model && (initialModelIdOverride || modelId || _habitMid || _habit)) {
                (function _waitModelsReWelcome(tries) {
                    if (tries <= 0) return;
                    if (window.Models && Models._loaded) {
                        try {
                            if (!chat.modelId && _habitMid) chat.modelId = _habitMid;
                            // 修复（5.2.5）：不再用习惯里的 modelIdOverride 覆盖，
                            // 下方按线路默认回填，保证模型ID/思考强度与所选线路匹配。
                            var _m = Models.get(chat._modelIdOverride || chat.modelId) || null;
                            if (!_m && _habitMid) _m = Models.get(_habitMid) || null;
                            if (!_m) {
                                // 仍无具体模型时，尝试用右侧面板/默认模型兜底
                                try {
                                    var _ml = (Models.list && Models.list()) || [];
                                    if (_ml.length) _m = _ml.find(function (x) { return x && x.enabled !== false; }) || _ml[0];
                                } catch (e) {}
                            }
                            if (_m) {
                                chat.modelId = chat.modelId || _m.id;
                                if (!chat._modelIdOverride) chat._modelIdOverride = _m.modelId || '';
                                box._welcomeCtx.model = _m;
                                var _wb2 = box.querySelector('[data-welcome]');
                                if (_wb2) _wb2.innerHTML = self0._welcomeHtml(box);
                            }
                        } catch (e) {}
                        return;
                    }
                    setTimeout(function () { _waitModelsReWelcome(tries - 1); }, 200);
                })(50); // 最多等待 10 秒
            }


            
            try {
                document.addEventListener('i18n:changed', function () {
                    try {
                        var _wb = box.querySelector('[data-welcome]');
                        if (_wb && _wb.parentNode) _wb.innerHTML = self0._welcomeHtml(box);
                    } catch (e) { }
                });
            } catch (e) { }

            canvas.appendChild(box);
            // 【弹出动画】从点击位置缩放弹出的入场动画（transform-only，不影响布局/定位）
            box.classList.add('zf-box-open');
            setTimeout(function() { box.classList.remove('zf-box-open'); }, 300);

            // 新建窗口应用"最后激活窗口"的尺寸（localStorage 记忆，重启后依然生效）
            var lastSize = this.getLastBoxSize();
            if (lastSize) {
                box.style.width = Math.max(280, Math.min(lastSize.w, 5000)) + 'px';
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
                _reasoningEffort: initialReasoningEffort,
                _engine: (typeof DB !== 'undefined' && DB._engine) ? String(DB._engine) : ''
            };
            this.chatBoxes.push(chat);

            // 自动归入项目（5.2.5 改版）：优先继承「上一个焦点对话」的项目，无焦点对话时才回退全局活动项目
            // 修复（5.0.2）：启动竞态窗口内 _activeProjectId 可能尚未从 DB 异步加载完成，
            // 导致新建对话丢失项目归属。兜底层级：
            //   0) 焦点对话的项目（5.2.5 新增：新建对话跟着上一个正在用的对话走）
            //   1) 内存值（正常路径，项目面板已加载）
            //   2) localStorage 同步读取（上次会话写入的永久备份，毫秒级可用）
            //   3) DB 异步拉取 + 延迟补归（前两层都为空时，拉到后回填内存并补归本对话）
            var _activePid = null;
            try {
                for (var _fi = 0; _fi < self.chatBoxes.length; _fi++) {
                    var _fc = self.chatBoxes[_fi];
                    if (_fc && _fc.el && _fc.el.classList.contains('active') && _fc.id !== chat.id) {
                        if (_fc.projectId) { _activePid = _fc.projectId; break; } // 无项目的焦点对话不拦截，继续找下一个
                    }
                }
            } catch (e) {}
            if (!_activePid) _activePid = self._activeProjectId || null;
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

            // 持久化（立即写入，防抖会因快关/刷新丢数据）
            Store.saveChatBox(chat, true);
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
            var srcEngine = srcChat._engine || '';
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
            newChat._engine = srcEngine;
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
                            var catList = Tools.getCategoryList(newChat.id, newChat._engine || '');
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
