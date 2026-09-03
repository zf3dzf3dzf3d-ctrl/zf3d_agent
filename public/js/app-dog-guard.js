// ========== app-dog-guard.js - 🐕 小狗守卫 ==========
// 一只可爱的小狗在画布上巡逻，逐个跳到对话框上感知状态：
// - 空闲且完成 → 摇尾巴跳过
// - 已停止/出错 → 调查该对话（用户提问 + 当前状态），生成改进提示语并自动发回继续干活
// - 思考中超时（工具调用频率异常）→ 先停止该对话，再注入修改方法让它继续
// 开关持久化到 UserSettings，键: dogGuardEnabled / dogGuardInterval / dogGuardToolTimeout
Object.assign(App, {

    _dogGuardEnabled: false,      // 开关
    _dogGuardEl: null,            // 小狗 DOM
    _dogGuardPatrolTimer: null,   // 巡逻定时器
    _dogGuardBusy: false,         // 是否正在执行一次巡逻
    _dogGuardInterval: 15000,     // 每个对话框之间移动间隔 ms（15秒挪一格）
    _dogGuardToolTimeout: 600000, // 工具调用停滞/卡死判定 10分钟
    _dogGuardVisited: {},         // 本次巡逻记录 {chatId: ts}
    _dogGuardActions: {},         // 已干预记录 {chatId: ts} 防止反复干预同一对话
    _dogGuardStaleDone: {},       // 已对"空闲停滞"干预过且确认完成的对话，永久跳过 {chatId: true}
    _dogGuardStaleCount: {},      // 对同一对话的停滞干预次数（上限2次，防止轰炸）

    // ===== 开关 =====
    _initDogGuard: function() {
        var saved = UserSettings.get('dogGuardEnabled');
        this._dogGuardEnabled = saved === '1';
        var iv = parseInt(UserSettings.get('dogGuardInterval'), 10);
        if (Number.isFinite(iv) && iv >= 4000) this._dogGuardInterval = iv;
        var tt = parseInt(UserSettings.get('dogGuardToolTimeout'), 10);
        if (Number.isFinite(tt) && tt >= 15000) this._dogGuardToolTimeout = tt;
        // 热更新安全：清理幽灵定时器
        if (window.__dogGuardTimer) { clearTimeout(window.__dogGuardTimer); window.__dogGuardTimer = null; }
        if (this._dogGuardEl && this._dogGuardEl.parentNode) this._dogGuardEl.parentNode.removeChild(this._dogGuardEl);
        if (this._dogGuardEnabled) this._dogGuardStart();
    },

    _dogGuardToggle: function() {
        this._dogGuardEnabled = !this._dogGuardEnabled;
        UserSettings.set('dogGuardEnabled', this._dogGuardEnabled ? '1' : '0');
        if (this._dogGuardEnabled) {
            this._dogGuardStart();
            if (typeof this._showStormToast === 'function') this._showStormToast('🐕 小狗守卫上岗啦！', '#27ae60');
        } else {
            this._dogGuardStop();
            if (typeof this._showStormToast === 'function') this._showStormToast('🐕 小狗守卫下班休息~', '#2980ff');
        }
        this._dogGuardUpdateButton();
    },

    _dogGuardUpdateButton: function() {
        var btn = document.getElementById('dogGuardBtn');
        if (!btn) return;
        btn.classList.toggle('dog-guard-btn--on', !!this._dogGuardEnabled);
        // 角标：明确显示 开/关 状态
        var badge = btn.querySelector('.dog-guard-state-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dog-guard-state-badge';
            btn.appendChild(badge);
        }
        if (this._dogGuardEnabled) {
            badge.textContent = '开';
            badge.classList.add('dog-guard-state-badge--on');
            badge.classList.remove('dog-guard-state-badge--off');
            btn.title = '小狗守卫：已开启（正在巡逻各对话，发现问题自动督促改进）。点击关闭';
        } else {
            badge.textContent = '关';
            badge.classList.add('dog-guard-state-badge--off');
            badge.classList.remove('dog-guard-state-badge--on');
            btn.title = '小狗守卫：已关闭（不巡逻）。点击开启';
        }
    },

    _dogGuardStart: function() {
        this._dogGuardStop(); // 防重复
        this._dogGuardCreateDog();
        this._dogGuardPatrolLoop();
    },

    _dogGuardStop: function() {
        if (window.__dogGuardTimer) { clearTimeout(window.__dogGuardTimer); window.__dogGuardTimer = null; }
        if (this._dogGuardEl && this._dogGuardEl.parentNode) this._dogGuardEl.parentNode.removeChild(this._dogGuardEl);
        this._dogGuardEl = null;
        this._dogGuardBusy = false;
    },

    // ===== 创建小狗 DOM =====
    _dogGuardCreateDog: function() {
        if (this._dogGuardEl && this._dogGuardEl.parentNode) return;
        var dog = document.createElement('div');
        dog.className = 'dog-guard';
        dog.innerHTML =
            '<div class="dog-guard-body">' +
              '<span class="dog-guard-face">🐶</span>' +
              '<span class="dog-guard-paw">🐾</span>' +
              '<span class="dog-guard-tail"></span>' +
            '</div>' +
            '<div class="dog-guard-bubble" style="display:none;"></div>' +
            '<div class="dog-guard-chat" data-voice-box style="display:none;">' +
              '<div class="dog-guard-chat-head"><span class="dg-chat-title">🐕 守卫对话</span><button class="dg-chat-logbook" title="查看今日守护账本">📒 账本</button><select class="dg-chat-model" title="小狗专用大模型"></select><span class="dg-chat-close" title="收起">✕</span></div>' +
              '<div class="dog-guard-chat-msgs"></div>' +
              '<div class="dog-guard-chat-input"><input type="text" placeholder="跟小狗说点什么…"/><button class="voice-btn dg-chat-voice dg-voice-auto" type="button" title="语音输入（说完自动发送）"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button><button class="dg-chat-send">发送</button></div>' +
            '</div>';
        var area = document.getElementById('canvasArea');
        if (!area) return;
        area.appendChild(dog);
        this._dogGuardEl = dog;
        this._dogGuardBindInteract(dog, area);
        // 记忆上次被拖到的位置
        var sx = parseFloat(UserSettings.get('dogGuardX')), sy = parseFloat(UserSettings.get('dogGuardY'));
        if (Number.isFinite(sx) && Number.isFinite(sy)) {
            dog.style.left = Math.min(sx, area.clientWidth - 60) + 'px';
            dog.style.top = Math.min(sy, area.clientHeight - 60) + 'px';
        } else {
            dog.style.left = '40px';
            dog.style.top = (area.clientHeight - 70) + 'px';
        }
    },

    // ===== 点击叫唤 + 拖拽 =====
    _dogGuardBindInteract: function(dog, area) {
        if (dog.dataset.dogWired) return;
        dog.dataset.dogWired = '1';
        var self = this;
        var body = dog.querySelector('.dog-guard-body');
        // 聊天面板交互（阻止冒泡，避免触发拖拽/叫唤）
        var chatPanel = dog.querySelector('.dog-guard-chat');
        if (chatPanel) {
            chatPanel.addEventListener('mousedown', function(e){ e.stopPropagation(); });
            chatPanel.addEventListener('click', function(e){ e.stopPropagation(); });
            var closeBtn = chatPanel.querySelector('.dg-chat-close');
            if (closeBtn) closeBtn.addEventListener('click', function(){ chatPanel.style.display = 'none'; });
            var logBtn = chatPanel.querySelector('.dg-chat-logbook');
            if (logBtn) logBtn.addEventListener('click', function(){ self._dogGuardShowLogBook(); });
            var sendBtn = chatPanel.querySelector('.dg-chat-send');
            var input = chatPanel.querySelector('input');
            function doSend(){ self._dogGuardChatSend(); }
            if (sendBtn) sendBtn.addEventListener('click', doSend);
            if (input) input.addEventListener('keydown', function(e){ if (e.key === 'Enter') doSend(); });
            var modelSel = chatPanel.querySelector('.dg-chat-model');
            if (modelSel) modelSel.addEventListener('change', function(){
                UserSettings.set('dogGuardModelId', modelSel.value);
                self._dogGuardSay('汪！换好大脑了~', 1500);
            });
        }
        var dragging = false, moved = false;
        var ox = 0, oy = 0;

        body.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            dragging = true; moved = false;
            var rect = dog.getBoundingClientRect();
            var aRect = area.getBoundingClientRect();
            ox = e.clientX - rect.left;
            oy = e.clientY - rect.top;
            dog._dgBaseX = rect.left - aRect.left;
            dog._dgBaseY = rect.top - aRect.top;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        function onMove(e) {
            if (!dragging) return;
            moved = true;
            dog.classList.add('dog-guard--dragging');
            var aRect = area.getBoundingClientRect();
            var nx = e.clientX - aRect.left - ox;
            var ny = e.clientY - aRect.top - oy;
            nx = Math.max(0, Math.min(nx, area.clientWidth - 60));
            ny = Math.max(0, Math.min(ny, area.clientHeight - 60));
            dog.style.left = nx + 'px';
            dog.style.top = ny + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!dragging) return;
            dragging = false;
            dog.classList.remove('dog-guard--dragging');
            if (moved) {
                // 保存位置，巡逻会从这里继续出发
                self._dogGuardStopMoving = true;
                UserSettings.set('dogGuardX', dog.style.left);
                UserSettings.set('dogGuardY', dog.style.top);
                self._dogGuardSay('汪！就在这里站岗~', 2000);
            } else {
                // 单击 = 叫一声 + 摇尾巴 + 挥爪，然后打开聊天面板
                self._dogGuardBark();
                self._dogGuardChatToggle();
            }
        }
    },

    // ===== 点击叫唤 =====
    _dogGuardBark: function() {
        var dog = this._dogGuardEl;
        if (!dog) return;
        // 强制重启动画：先移除 class 再强制回流，避免定时器节流导致 class 残留后永远没有动画
        dog.classList.remove('dog-guard--barking');
        void dog.offsetWidth;
        dog.classList.add('dog-guard--barking');
        var words = ['汪汪！一切正常！', '汪！本汪在巡逻！', '汪汪汪！！', '汪~主人放心~', '汪！摸头收好了~', '汪！叫我干嘛呀？'];
        this._dogGuardSay(words[Math.floor(Math.random() * words.length)], 1800, true);
        var paw = dog.querySelector('.dog-guard-paw');
        if (paw) {
            paw.classList.remove('dg-paw-wave');
            void paw.offsetWidth;
            paw.classList.add('dg-paw-wave');
        }
        var self = this;
        setTimeout(function() { dog.classList.remove('dog-guard--barking'); }, 1300);
    },

    // ===== 小狗聊天面板：点击打开，输入消息走 AI 回复（带工作记忆） =====
    _dogGuardChatToggle: function() {
        var dog = this._dogGuardEl;
        if (!dog) return;
        var panel = dog.querySelector('.dog-guard-chat');
        if (!panel) return;
        var show = panel.style.display === 'none' || !panel.style.display;
        panel.style.display = show ? 'block' : 'none';
        if (show) {
            var input = panel.querySelector('input');
            if (input) setTimeout(function(){ input.focus(); }, 50);
            var msgs = panel.querySelector('.dog-guard-chat-msgs');
            if (msgs && !msgs.children.length) {
                this._dogGuardChatAppend('dog', '汪汪！我是小狗守卫，你可以问我今天做了哪些工作哦~ 🐾');
            }
            this._dogGuardChatFillModels();
        }
    },

    // ===== 小狗专用模型：填充下拉框（默认语言大模型优先，持久化 UserSettings: dogGuardModelId）=====
    _dogGuardChatFillModels: function() {
        var sel = this._dogGuardEl && this._dogGuardEl.querySelector('.dg-chat-model');
        if (!sel || !window.Models) return;
        var self = this;
        var fill = function() {
            var list = (Models.list || []).filter(function(m){ return m && m.endpoint; }); // 小狗守卫显示所有模型（含不可见）
            if (!list.length) { sel.innerHTML = '<option value="">未配置模型</option>'; return; }
            // 排序：默认语言大模型放最前
            var def = Models.getDefaultFor ? Models.getDefaultFor('language') : null;
            if (def) {
                list = [def].concat(list.filter(function(m){ return m.id !== def.id; }));
            }
            sel.innerHTML = list.map(function(m){
                return '<option value="' + String(m.id).replace(/"/g,'&quot;') + '">' + (m.name || m.id) + (def && m.id===def.id ? '（默认语言）' : '') + '</option>';
            }).join('');
            var saved = UserSettings.get('dogGuardModelId');
            var ids = list.map(function(m){ return String(m.id); });
            sel.value = (saved && ids.indexOf(saved) >= 0) ? saved : (def ? String(def.id) : ids[0]);
        };
        if (Models._loaded) fill();
        else { try { Models.load().then(fill).catch(function(){}); } catch(e) {} }
    },

    // ===== 取小狗当前选中的模型（下拉框选择 > 保存的设置 > 默认语言大模型 > activeId > 第一个可见）=====
    _dogGuardPickModel: function() {
        var sel = this._dogGuardEl && this._dogGuardEl.querySelector('.dg-chat-model');
        if (sel && sel.value) {
            try { var m = Models.get(String(sel.value)); if (m && m.endpoint) return m; } catch(e) {}
        }
        var saved = UserSettings.get('dogGuardModelId');
        if (saved) {
            try { var m2 = Models.get(saved); if (m2 && m2.endpoint) return m2; } catch(e) {}
        }
        if (window.Models && Models.getDefaultFor) {
            var d = Models.getDefaultFor('language');
            if (d && d.endpoint) return d;
        }
        try {
            var act = Models.activeId && Models.get ? Models.get(Models.activeId) : null;
            if (act && act.endpoint) return act;
        } catch(e) {}
        try {
            var vis = (Models.list || []).filter(function(m){ return m && m.endpoint && m.visible !== false; });
            return vis[0] || null;
        } catch(e) { return null; }
    },

    // ===== 📒 守护账本：写一条守护记录到数据库（/api/worklog）=====
    // reason: 为什么守护，如"对话被停止""超时卡住""空闲停滞"；title 用标题第一行
    _dogGuardLogBook: function(chat, reason, extra) {
        try {
            var title = '';
            try {
                var box = chat && chat.el;
                var tEl = box && box.querySelector('.chatbox-header .title');
                if (tEl) title = tEl.textContent || '';
                if (!title && chat && chat.title) title = chat.title;
            } catch(e) {}
            // 只取标题第一行，最多 30 字
            title = String(title).split('\n')[0].replace(/<[^>]+>/g, '').trim().substring(0, 30);
            var summary = '守护「' + (title || '未命名对话') + '」：' + reason + (extra ? '（' + extra + '）' : '');
            fetch('/api/worklog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary: summary,
                    chatId: chat ? String(chat.id || '') : '',
                    success: true,
                    source: 'dog-guard'
                })
            }).catch(function(){});
        } catch(e) {}
    },

    // ===== 📒 守护账本：读取今日记录并展示 =====
    _dogGuardShowLogBook: function() {
        var self = this;
        var dog = this._dogGuardEl; if (!dog) return;
        var panel = dog.querySelector('.dog-guard-chat');
        if (!panel) return;
        // 先打开聊天面板
        if (panel.style.display === 'none' || !panel.style.display) {
            this._dogGuardChatToggle();
        }
        var msgs = panel.querySelector('.dog-guard-chat-msgs');
        if (!msgs) return;
        this._dogGuardChatAppend('dog', '📒 翻账本中…');
        var thinkEl = msgs.lastChild;
        fetch('/api/worklog?days=7').then(function(r){ return r.json(); }).then(function(j){
            if (!thinkEl || !thinkEl.parentNode) return;
            var today = new Date(); var pad = function(n){ return (n<10?'0':'')+n; };
            var todayKey = today.getFullYear() + '-' + pad(today.getMonth()+1) + '-' + pad(today.getDate());
            var items = (j && j.ok && j.log) ? (j.log[todayKey] || []) : [];
            if (!items.length) {
                thinkEl.textContent = '📒 今天账本还是空的，汪~ 我还没守护过任何对话。';
                return;
            }
            thinkEl.remove();
            self._dogGuardChatAppend('dog', '📒 今日守护账本（共 ' + items.length + ' 条）：');
            items.forEach(function(it) {
                var line = (it.time || '') + ' · ' + (it.summary || '');
                if (it.success === false) line += ' ❌';
                self._dogGuardChatAppend('log', line);
            });
        }).catch(function(){
            if (thinkEl) thinkEl.textContent = '汪？账本打不开了…';
        });
    },

    _dogGuardChatAppend: function(who, text) {
        var dog = this._dogGuardEl; if (!dog) return;
        var msgs = dog.querySelector('.dog-guard-chat-msgs');
        if (!msgs) return;
        var div = document.createElement('div');
        div.className = 'dg-msg dg-msg--' + who + (who === 'log' ? ' dg-msg--logbook' : '');
        div.textContent = text;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    },

    _dogGuardChatSend: function() {
        var dog = this._dogGuardEl; if (!dog) return;
        var panel = dog.querySelector('.dog-guard-chat');
        var input = panel.querySelector('input');
        var text = (input.value || '').trim();
        if (!text) return;
        input.value = '';
        this._dogGuardChatAppend('user', text);
        var self = this;
        var thinking = true;
        this._dogGuardChatAppend('dog', '…想一想');
        var thinkEl = panel.querySelector('.dog-guard-chat-msgs').lastChild;
        // 拉最新工作记忆 → 调 AI → 替换"想一想"
        var worklogCtx = '';
        try {
            fetch('/api/worklog?days=7').then(function(r){ return r.json(); }).then(function(j){
                if (j && j.ok && j.log && j.total) {
                    var keys = Object.keys(j.log).sort().reverse().slice(0, 3);
                    var lines = [];
                    keys.forEach(function(d){ (j.log[d]||[]).slice(-15).forEach(function(it){
                        lines.push((it.time||'') + ' ' + (it.summary||'') + (it.success===false?'（失败）':''));
                    }); });
                    if (lines.length) worklogCtx = '\n\n## 你的近期工作记录（小狗守卫视角的自动记录，用户问今天做了什么时请如实回答）\n' + lines.join('\n');
                }
                self._dogGuardChatAsk(text, worklogCtx, thinkEl);
            }).catch(function(){ self._dogGuardChatAsk(text, '', thinkEl); });
        } catch(e) { this._dogGuardChatAsk(text, '', thinkEl); }
    },

    _dogGuardChatAsk: function(text, worklogCtx, thinkEl) {
        var self = this;
        // 小狗专用模型：下拉框选择 > 保存设置 > 默认语言大模型 > activeId > 第一个可见
        var model = this._dogGuardPickModel ? this._dogGuardPickModel() : null;
        // 兜底：App.getActiveModel
        if (!model || !model.endpoint) {
            try { model = (typeof this.getActiveModel === 'function') ? this.getActiveModel() : (window.App && App.getActiveModel && App.getActiveModel()); } catch(e) {}
        }
        if (!model || !model.endpoint) {
            // Models 可能尚未异步加载完成，加载后再重试一次
            try {
                if (window.Models && typeof Models.load === 'function' && !Models._loaded) {
                    Models.load().then(function() { self._dogGuardChatAsk(text, worklogCtx, thinkEl); }).catch(function(){});
                    return;
                }
            } catch(e) {}
            thinkEl.textContent = '汪？我没找到可用的模型配置，先去设置里配好模型再聊吧~';
            return;
        }
        var payload = {
            model: model.modelId || model.model || model.id || '',
            messages: [
                { role: 'system', content: '你是画布上的小狗守卫🐕，性格活泼忠诚，回答简短可爱（不超过80字），喜欢用"汪"开头。你可以根据工作记忆回答用户关于今天/最近工作进展的问题。\n\n## 你可以执行的极简工具\n用户让你查看/操作对话框时，先在回答里输出一行工具指令（一行一条，会被自动执行）：\n- [TOOL:list] —— 探测所有对话框（id、标题、模型、是否发送中）\n- [TOOL:arrange] —— 按状态排列所有对话框\n- [TOOL:stop:对话id] —— 停止某个正在发送的对话框\n- [TOOL:send:对话id:消息内容] —— 向某对话框发送一条消息\n执行结果会以 [TOOL_RESULT] 开头告诉你，然后你再简短汇报。' + worklogCtx },
                { role: 'user', content: text }
            ],
            stream: false
        };
        var headers = { 'Content-Type': 'application/json' };
        try { var _k = model.apiKey || model.key; if (_k) headers['Authorization'] = 'Bearer ' + _k; } catch(e) {}
        var endpoint = model.endpoint;
        var useProxy = false;
        try { useProxy = /^https?:/.test(endpoint || '') && endpoint.indexOf(location.origin) !== 0; } catch(e) { useProxy = true; }
        var url = useProxy ? '/api/proxy' : endpoint;
        if (useProxy) payload = { _target_url: endpoint, _method: 'POST', _headers: headers, _body: payload };
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            .then(function(r){ return r.json().catch(function(){ return { __nonJson: true }; }).then(function(j){ return { status: r.status, j: j }; }); })
            .then(function(res){
                var j = res.j || {};
                var reply = '';
                var d = useProxy ? (j.data || j) : j;
                try {
                    var msg = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message : null;
                    if (msg) reply = msg.content || msg.reasoning_content || '';
                    if (!reply && d.choices && d.choices[0] && d.choices[0].text) reply = d.choices[0].text;
                    if (!reply) reply = d.reply || d.content || d.text || d.output || d.response || '';
                    if (reply) reply = String(reply).replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '').trim();
                } catch(e) {}
                if (reply) {
                    thinkEl.textContent = '汪！' + String(reply).replace(/^汪*[!！。.~\s]*/, '');
                    if (self._dogGuardRunTools) self._dogGuardRunTools(String(reply), thinkEl);
                } else {
                    var err = (d.error && (d.error.message || d.error)) || j.message || j.msg || '';
                    var raw = '';
                    try { raw = JSON.stringify(j).substring(0, 120); } catch(e) {}
                    thinkEl.textContent = '汪呜…没能想出回答' +
                        (j.__nonJson ? '（接口返回不是JSON）' : '') +
                        (err ? ('（' + String(err).slice(0, 80) + '）') : ('（HTTP ' + res.status + (raw ? ' | ' + raw : '') + '）')) +
                        '，再问我一次？';
                }
            })
            .catch(function(e){ thinkEl.textContent = '汪呜…网络出错了（' + String(e && e.message || e).slice(0, 60) + '），稍后再问我~'; });
    },

    // ===== 极简工具执行器：解析回复中的 [TOOL:xxx] 指令并执行 =====
    _dogGuardRunTools: function(reply, thinkEl) {
        var self = this;
        var lines = reply.split('\n').map(function(s){ return s.trim(); });
        var toolLines = lines.filter(function(s){ return s.indexOf('[TOOL:') === 0 && s.indexOf(']') > 6; });
        if (!toolLines.length) return;
        var results = [];
        var runOne = function(i) {
            if (i >= toolLines.length) {
                if (!results.length) return;
                // 把结果回传给小狗，让它汇报
                self._dogGuardChatAppend('user', '[TOOL_RESULT]\n' + results.join('\n'));
                var panel = self._dogGuardEl && self._dogGuardEl.querySelector('.dog-guard-chat');
                var tEl = panel && panel.querySelector('.dog-guard-chat-msgs');
                if (tEl) {
                    self._dogGuardChatAppend('dog', '…汪，看一下');
                    var nEl = tEl.lastChild;
                    self._dogGuardChatAsk('[TOOL_RESULT]\n' + results.join('\n') + '\n\n请根据以上结果简短汇报给用户（80字内）。', '', nEl);
                }
                return;
            }
            var m = toolLines[i].match(/^\[TOOL:([a-z]+)(?::([^\]]*))?(?::([\s\S]*))?\]$/i);
            var next = function(res) { if (res) results.push(res); runOne(i + 1); };
            if (!m) { next(null); return; }
            var act = m[1].toLowerCase();
            try {
                if (act === 'list') {
                    var boxes = (self.chatBoxes || []).map(function(c) {
                        return '[' + c.id + '] ' + (c.title || '') + ' | ' + (c.modelId || '无模型') + (c.isSending ? ' | 发送中' : ' | 空闲');
                    });
                    next(boxes.length ? boxes.join('\n') : '当前没有对话框');
                } else if (act === 'arrange') {
                    if (typeof self.arrangeChatBoxes === 'function') self.arrangeChatBoxes();
                    next('已排列 ' + (self.chatBoxes || []).length + ' 个对话框');
                } else if (act === 'stop') {
                    var c = (self.chatBoxes || []).find(function(x){ return x.id === m[2]; });
                    if (!c) { next('未找到对话 ' + m[2]); return; }
                    if (typeof self.stopSending === 'function') self.stopSending(c);
                    else { c._stopped = true; c.isSending = false; }
                    next('已停止对话 ' + m[2]);
                } else if (act === 'send') {
                    var sc = (self.chatBoxes || []).find(function(x){ return x.id === m[2]; });
                    if (!sc) { next('未找到对话 ' + m[2]); return; }
                    var msg = (m[3] || '').trim();
                    if (!msg) { next('send 缺少消息内容'); return; }
                    if (sc.isSending) { next('对话 ' + m[2] + ' 正在发送中，未发送'); return; }
                    self.addMsg(sc.el, msg, 'user', sc.modelId);
                    self.showQueryPin(sc.el, msg);
                    self.updateChatTitle(sc.el, msg);
                    sc.history.push({ role: 'user', content: msg });
                    self.sendToModel(sc.el, sc);
                    next('已向对话 ' + m[2] + ' 发送：' + msg.substring(0, 60));
                } else {
                    next(null);
                }
            } catch(e) { next('工具执行出错：' + e.message); }
        };
        runOne(0);
    },

    _dogGuardSay: function(text, holdMs, isBark) {
        if (!this._dogGuardEl) return;
        var bubble = this._dogGuardEl.querySelector('.dog-guard-bubble');
        if (!bubble) return;
        bubble.textContent = text;
        bubble.style.display = 'block';
        bubble.classList.toggle('dog-guard-bubble--bark', !!isBark);
        var self = this;
        clearTimeout(this._dogGuardSayTimer);
        this._dogGuardSayTimer = setTimeout(function() {
            if (bubble) bubble.style.display = 'none';
        }, holdMs || 3000);
    },

    // ===== 巡逻主循环 =====
    _dogGuardPatrolLoop: function() {
        var self = this;
        // 🐾 聊天面板开着（正在和小狗对话）时，小狗原地待命不巡逻，等面板关了再继续
        var chatPanelOpen = this._dogGuardEl &&
            this._dogGuardEl.querySelector('.dog-guard-chat') &&
            this._dogGuardEl.querySelector('.dog-guard-chat').style.display !== 'none';
        if (chatPanelOpen) {
            window.__dogGuardTimer = setTimeout(function() { self._dogGuardPatrolLoop(); }, this._dogGuardInterval);
            return;
        }
        var boxes = (this.chatBoxes || []).filter(function(c) { return c && c.el && c.el.style.display !== 'none'; });
        if (!boxes.length || this._dogGuardBusy || !this._dogGuardEnabled) {
            window.__dogGuardTimer = setTimeout(function() { self._dogGuardPatrolLoop(); }, this._dogGuardInterval);
            return;
        }
        // 挑一个最该看的目标：优先已停止/出错的 → 超时忙碌的 → 轮询空闲的
        var now = Date.now();
        var target = null, targetType = '';
        for (var i = 0; i < boxes.length; i++) {
            var c = boxes[i];
            // 🐕 循环预警升级（Agent 循环检测器打了 _loopEscalated 标记）→ 最高优先级提前介入，不等超时
            if (c.isSending && c._loopEscalated &&
                (!this._dogGuardActions[c.id] || now - this._dogGuardActions[c.id] > 900000)) {
                target = c; targetType = 'timeout'; break;
            }
            if (c._stopped && !c._dgUserStopped) { target = c; targetType = 'stopped'; break; }
            if (c.isSending && (now - (c._taskStartTime || 0)) > this._dogGuardToolTimeout &&
                (!this._dogGuardActions[c.id] || now - this._dogGuardActions[c.id] > 900000)) {
                target = c; targetType = 'timeout'; break;
            }
            // 空闲太久没动静（有历史但超过5分钟没任何消息）→ 也算需要关心
            // 但任务已确认完成、或已对它停滞干预过2次的 → 直接跳过，不再当目标
            if (!c.isSending && c._dogGuardLastActivity &&
                (now - c._dogGuardLastActivity) > 600000 &&
                (!this._dogGuardActions[c.id] || now - this._dogGuardActions[c.id] > 900000) &&
                !this._dogGuardStaleDone[c.id] &&
                (this._dogGuardStaleCount[c.id] || 0) < 2 &&
                !this._dogGuardIsTaskDone(c)) {
                target = c; targetType = 'stale'; break;
            }
        }
        if (!target) {
            // 无异常目标 → 顺序轮询没看过的
            for (var j = 0; j < boxes.length; j++) {
                var cc = boxes[j];
                if (!this._dogGuardVisited[cc.id] || now - this._dogGuardVisited[cc.id] > 60000) { target = cc; targetType = 'idle'; break; }
            }
            if (!target) target = boxes[Math.floor(Math.random() * boxes.length)], targetType = 'idle';
        }

        this._dogGuardBusy = true;
        this._dogGuardVisit(target, targetType, function() {
            self._dogGuardBusy = false;
            window.__dogGuardTimer = setTimeout(function() { self._dogGuardPatrolLoop(); }, self._dogGuardInterval);
        });
    },

    // ===== 小狗跑到某个对话框（跑跑跳跳动画）=====
    _dogGuardVisit: function(chat, type, done) {
        var self = this;
        var dog = this._dogGuardEl;
        if (!dog || !chat.el || !chat.el.parentNode) { if (done) done(); return; }
        // 用户刚拖拽过 → 尊重位置，跳过本次移动
        if (this._dogGuardStopMoving) {
            this._dogGuardStopMoving = false;
            if (done) done();
            return;
        }
        var area = document.getElementById('canvasArea');
        if (!area) { if (done) done(); return; }
        this._dogGuardVisited[chat.id] = Date.now();

        var areaRect = area.getBoundingClientRect();
        var rect = chat.el.getBoundingClientRect();
        var startX = parseFloat(dog.style.left) || 40;
        var startY = parseFloat(dog.style.top) || areaRect.height - 60;
        // 目标：对话框左下角前方
        var endX = rect.left - areaRect.left - 34;
        var endY = rect.top - areaRect.top + rect.height - 10;
        var midX = (startX + endX) / 2;
        var midY = Math.min(startY, endY) - 60; // 中途跳起

        dog.classList.add('dog-guard--running');
        this._dogGuardAnimateHop(dog, startX, startY, midX, midY, 450, function() {
            self._dogGuardAnimateHop(dog, midX, midY, endX, endY, 450, function() {
                dog.classList.remove('dog-guard--running');
                dog.classList.add('dog-guard--inspecting');
                self._dogGuardInspect(chat, type, function() {
                    dog.classList.remove('dog-guard--inspecting');
                    if (done) done();
                });
            });
        });
    },

    // 贝塞尔跳跃动画
    _dogGuardAnimateHop: function(el, x1, y1, x2, y2, dur, cb) {
        var start = null;
        function frame(ts) {
            if (!start) start = ts;
            var t = Math.min((ts - start) / dur, 1);
            var cx = (x1 + x2) / 2, cy = Math.min(y1, y2) - 40;
            var px = (1-t)*(1-t)*x1 + 2*(1-t)*t*cx + t*t*x2;
            var py = (1-t)*(1-t)*y1 + 2*(1-t)*t*cy + t*t*y2;
            el.style.left = px + 'px';
            el.style.top = py + 'px';
            if (t < 1) requestAnimationFrame(frame);
            else if (cb) cb();
        }
        requestAnimationFrame(frame);
    },

    // ===== 感知对话框状态并做出反应 =====
    _dogGuardInspect: function(chat, type, done) {
        var self = this;
        var box = chat.el;
        var title = '';
        var titleEl = box.querySelector('.chatbox-header .title');
        if (titleEl) title = titleEl.textContent;

        var inspectReasons = {
            'stopped': '对话被停止，任务未完成',
            'timeout': '运行超时（工具调用停滞/疑似死循环）',
            'stale': '空闲太久没动静，可能被遗忘或停滞',
            'idle': '日常巡逻检查'
        };

        if (type === 'stopped') {
            // 已停止 → 判断：用户刚主动停止的不打扰，等 5 分钟后弹询问确认是否继续
            var _dgStopGap = Date.now() - (chat._dgUserStopped || 0);
            if (_dgStopGap < 300000) {
                this._dogGuardSay('「' + title + '」是主人自己停的，我不打扰~', 2000);
                if (done) done();
                return;
            }
            this._dogGuardLogBook(chat, '发现对话被停止，守护原因：' + inspectReasons.stopped);
            this._dogGuardSay('发现「' + title + '」停了挺久，我来问问主人！', 2500);
            var prompt = this._dogGuardBuildPrompt(chat, '该对话被停止，任务未完成');
            setTimeout(function() {
                self._dogGuardAskConfirm(chat, title, prompt, done);
            }, 1800);
        } else if (type === 'stale') {
            // 空闲太久没动静 → 先判断任务是否实际已完成（最后一条 AI 回复是否含完成标记）
            if (this._dogGuardIsTaskDone(chat)) {
                // 已确认完成：摇尾巴，且永久不再对它发停滞报告
                this._dogGuardStaleDone[chat.id] = true;
                this._dogGuardLogBook(chat, '巡查确认任务已完成，摇尾巴', '空闲停滞');
                this._dogGuardSay('「' + title + '」任务已完成，汪！摇尾巴~', 2000);
                var dgx = this._dogGuardEl;
                if (dgx) dgx.classList.add('dog-guard--happy');
                setTimeout(function() { if (dgx) dgx.classList.remove('dog-guard--happy'); }, 1500);
                if (done) done();
                return;
            }
            // 同一对话最多干预 2 次，防止对同一个问题反复轰炸
            var cnt = this._dogGuardStaleCount[chat.id] || 0;
            if (cnt >= 2) {
                this._dogGuardSay('「' + title + '」已经提醒过啦，不再打扰~', 2000);
                if (done) done();
                return;
            }
            this._dogGuardSay('「' + title + '」好久没动静了，我来看看！', 2500);
            var msgCount2 = 0;
            if (chat.history) chat.history.forEach(function(m) { if (m.role === 'user') msgCount2++; });
            if (msgCount2 > 0) {
                this._dogGuardStaleCount[chat.id] = cnt + 1;
                this._dogGuardLogBook(chat, '空闲太久没动静，注入改进提示让它继续', '守护原因：' + inspectReasons.stale);
                var prompt3 = this._dogGuardBuildPrompt(chat, '已经很久没有新消息了，可能被遗忘或停滞');
                setTimeout(function() {
                    self._dogGuardIntervene(chat, prompt3);
                    if (done) done();
                }, 1800);
            } else {
                if (done) done();
            }
        } else if (type === 'timeout') {
            // 思考/工具超时 → 先停止，再注入修改方法继续
            var _loopReason = chat._loopEscalated ? '循环预警升级（警告后仍在原地打转）' : inspectReasons.timeout;
            delete chat._loopEscalated; // 处理后清除标记
            this._dogGuardLogBook(chat, (_loopReason === inspectReasons.timeout ? '运行超时' : '循环任务预警升级') + '，已暂停并注入修改方法让它继续', '守护原因：' + _loopReason);
            this._dogGuardSay('「' + title + '」在原地打转！先暂停，帮它想想办法', 2500);
            var prompt2 = this._dogGuardBuildPrompt(chat, '该对话疑似陷入循环：反复调用相同工具但无实质进展。请总结已尝试的内容，明确说明卡点，换一种方法继续，或用 task_complete 结束任务');
            setTimeout(function() {
                self.stopSending(chat);
                Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：检测到超时，已停止对话');
                setTimeout(function() {
                    self._dogGuardIntervene(chat, prompt2);
                    if (done) done();
                }, 800);
            }, 1800);
        } else {
            // 空闲：判断是否完成
            var msgCount = 0;
            if (chat.history) chat.history.forEach(function(m) { if (m.role === 'user') msgCount++; });
            var isCompleted = msgCount > 0 && !chat.isSending && !chat._stopped;
            // 日常巡逻记录节流：同一对话 2 小时内只记一笔（含"任务完成"，防止账本刷屏）
            this._dogGuardLogIdleThrottle = this._dogGuardLogIdleThrottle || {};
            if (!this._dogGuardLogIdleThrottle[chat.id] || Date.now() - this._dogGuardLogIdleThrottle[chat.id] > 7200000) {
                this._dogGuardLogIdleThrottle[chat.id] = Date.now();
                this._dogGuardLogBook(chat, isCompleted ? '日常巡逻：任务完成，状态正常' : '日常巡逻：对话空闲检查', '守护原因：' + inspectReasons.idle);
            }
            if (isCompleted) {
                this._dogGuardSay('「' + title + '」完成得不错，汪！', 1800);
                var dg = this._dogGuardEl;
                if (dg) dg.classList.add('dog-guard--happy');
                setTimeout(function() { if (dg) dg.classList.remove('dog-guard--happy'); }, 1500);
            } else {
                this._dogGuardSay('「' + title + '」好像还没任务，先标记一下~', 1800);
            }
            if (done) done();
        }
    },

    // ===== 判断某对话的任务是否实际已完成 =====
    // 依据：最后一条 AI 回复含"任务完成"标记（如 ✅ 任务完成 / 任务完成），且未在发送中
    _dogGuardIsTaskDone: function(chat) {
        if (!chat || chat.isSending) return false;
        if (!chat.history || !chat.history.length) return false;
        for (var i = chat.history.length - 1; i >= 0; i--) {
            var m = chat.history[i];
            if (m.role === 'assistant') {
                var t = String(m.content || '');
                // 剥掉 HTML 标签后再判断
                t = t.replace(/<[^>]+>/g, '');
                if (/(任务完成|任务已完成|彻底完成)/.test(t)) return true;
                return false;
            }
        }
        return false;
    },

    // ===== 构造给 AI 的改进提示语 =====
    _dogGuardBuildPrompt: function(chat, statusDesc) {
        var lastQ = '', lastA = '';
        if (chat.history && chat.history.length) {
            for (var i = chat.history.length - 1; i >= 0; i--) {
                var _h = chat.history[i];
                // 【修复】跳过守卫自己注入的巡查报告、验证轮/继续轮消息，找用户真实提问
                var _isGuardMsg = _h.role === 'user' && (String(_h.content || '').indexOf('🐕【小狗守卫巡查报告】') === 0 || _h._dogGuardInjected);
                var _isSysRound = _h.role === 'user' && (_h._verifyRound || _h._continueRound);
                if (_h.role === 'user' && !_isGuardMsg && !_isSysRound && !lastQ) lastQ = _h.content || '';
                if (_h.role === 'assistant' && !lastA) lastA = (_h.content || '').substring(0, 600);
                if (lastQ && lastA) break;
            }
        }
        var strip = function(s) { return String(s).replace(/<[^>]+>/g, '').substring(0, 400); };
        // 剥离用户消息里注入的【当前项目上下文】前缀，只显示真实提问
        var ctxRe = /^【当前项目上下文】[\s\S]*?\n\n/;
        if (lastQ) lastQ = String(lastQ).replace(ctxRe, '');
        return '🐕【小狗守卫巡查报告】\n' +
            '我发现你的任务「' + statusDesc + '」。\n' +
            '用户提问是：' + strip(lastQ) + '\n' +
            '你上次的回答（截取）：' + strip(lastA) + '\n' +
            '请你：1）简要总结目前进度；2）找出卡住/未完成的原因；3）给出改进方法；4）然后继续干活，直到任务完成。';
    },

    // ===== 干预：把提示语发回该对话 =====
    _dogGuardIntervene: function(chat, prompt) {
        if (!chat || !chat.el) return;
        this._dogGuardActions[chat.id] = Date.now();
        // 用快速发送逻辑：忙则排队，闲则直发
        this._quickSendToChat(chat.id, prompt, { isGuardInject: true });
        Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫已注入改进提示');
    },

    // ===== 用户主动停止的对话：5 分钟后弹窗询问是否继续 =====
    _dogGuardAskConfirm: function(chat, title, prompt, done) {
        var self = this;
        this._dogGuardActions[chat.id] = Date.now();
        this.askUser({
            question: '🐕 小狗守卫：「' + title + '」的对话被停止超过 5 分钟了，任务可能还没完成。要继续吗？',
            fields: [{
                type: 'radio',
                label: '处理方式',
                name: 'action',
                options: [
                    { value: 'continue', label: '继续干活（注入改进提示）' },
                    { value: 'skip', label: '不用了，主人自己处理' }
                ],
                default: 'skip'
            }]
        }, chat.el, chat).then(function(res) {
            var ans = res && res.answer;
            // 表单模式 answer 是对象 {action: 'continue'|'skip'}；兜底匹配文本内容
            var act = '';
            if (ans && typeof ans === 'object' && !Array.isArray(ans)) act = ans.action || '';
            else act = String(ans || '');
            if (act === 'skip') {
                self._dogGuardSay('汪~那我就不操心了');
                Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：主人选择不继续，跳过干预');
            } else if (act.indexOf('continue') >= 0 || act.indexOf('继续') >= 0) {
                self._dogGuardSay('汪！收到，让它继续干活！');
                self._dogGuardIntervene(chat, prompt);
                Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：主人确认继续，已注入改进提示');
            } else {
                self._dogGuardSay('没看懂主人的选择，先不动了~');
                Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：询问结果不明确，跳过干预');
            }
            if (done) done();
        }).catch(function() {
            // 弹窗失败/超时：不打扰，跳过本次
            self._dogGuardSay('主人没回应，那我先不管了~');
            Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：询问无响应，跳过干预');
            if (done) done();
        });
    }
});

// ===== 启动 & 按钮绑定（按钮缺失时自动补建兜底） =====
function _ensureDogGuardBtn() {
    var btn = document.getElementById('dogGuardBtn');
    if (btn) return btn;
    var group = document.querySelector('.tp-fab-group');
    if (!group) {
        group = document.createElement('div');
        group.className = 'tp-fab-group';
        group.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9000;display:flex;gap:8px;';
        document.body.appendChild(group);
    }
    btn = document.createElement('button');
    btn.id = 'dogGuardBtn';
    btn.className = 'dog-guard-btn';
    btn.title = '小狗守卫开关：巡逻各对话，发现问题自动督促改进';
    btn.innerHTML = '<span>🐕</span>';
    btn.style.cssText = 'cursor:pointer;font-size:16px;padding:4px;border-radius:24px;border:none;background:transparent;box-shadow:none;';
    group.insertBefore(btn, group.firstChild);
    return btn;
}

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        if (typeof App !== 'undefined' && App._initDogGuard) {
            App._initDogGuard();
        }
        var btn = _ensureDogGuardBtn();
        if (btn && typeof App !== 'undefined' && App._dogGuardUpdateButton) {
            App._dogGuardUpdateButton(); // 按钮存在后再刷新状态角标
        }
        if (btn && typeof App !== 'undefined' && !btn.dataset.dogGuardWired) {
            btn.dataset.dogGuardWired = '1';
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                App._dogGuardToggle();
            });
        }
    }, 1500);
});
