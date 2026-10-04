// ========== app-dog-guard.js - 🐕 小狗守卫 ==========
// 一只可爱的小狗在画布上巡逻，逐个跳到对话框上感知状态：
// - 空闲且完成 → 摇尾巴跳过
// - 已停止/出错 → 调查该对话（用户提问 + 当前状态），生成改进提示语并自动发回继续干活
// - 绿灯超时（交警放行后无进展）→ 注入修改方法让它继续
// 【交警红绿灯联动】（v6）：每轮巡逻先查 /api/gate/active 拿每个对话的闸门状态：
// - 红灯（排队/间隔等待）：交警让他停 → 小狗守卫一分钱时间都不计，绝不干预
// - 绿灯（放行中）或无票（前端本地阶段）：交警让他走 → 他不走才计时管理、才介入
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
    _dogGuardHp: 100,             // ❤️ 血量（满血 100，被炸弹命中扣血，归零后自动回满）
    _dogGuardHpHideTimer: null,   // 满血后血条自动隐藏定时器
    // 【人在岗检测】用户在时不巡逻，用户离开后恢复巡逻
    _dogGuardLastActive: Date.now(), // 最近一次用户活动时间
    _dogGuardAwayMs: 60000,          // 无活动超过 60 秒 = 用户离开
    _dogGuardPresenceBound: false,   // 监听是否已绑定（防重复）

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
        this._dogGuardUpdateButton(); // 先刷灯，防止后续异常导致开关无反馈
        try {
            if (this._dogGuardEnabled) {
                this._dogGuardStart();
                if (typeof this._showStormToast === 'function') this._showStormToast('🐕 小狗守卫上岗啦！', '#27ae60');
            } else {
                this._dogGuardStop();
                if (typeof this._showStormToast === 'function') this._showStormToast('🐕 小狗守卫下班休息~', '#2980ff');
            }
        } catch (err) {
            console.error('[dog-guard] toggle 异常:', err);
        }
    },

    _dogGuardUpdateButton: function() {
        var btn = document.getElementById('dogGuardBtn');
        if (!btn) return;
        btn.classList.toggle('dog-guard-btn--on', !!this._dogGuardEnabled);
        // 指示灯：文字后小灯，绿=开，灰=关
        var dot = btn.querySelector('.tk-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'tk-dot';
            btn.appendChild(dot);
        }
        dot.classList.toggle('on', !!this._dogGuardEnabled);
        if (this._dogGuardEnabled) {
            btn.title = '小狗管家：已开启巡逻。左键=关闭巡逻，右键=和我聊天';
        } else {
            btn.title = '小狗管家：已停止巡逻。左键=开始巡逻，右键=和我聊天';
        }
    },

    _dogGuardStart: function() {
        this._dogGuardStop(); // 防重复
        this._dogGuardBindPresence();
        this._dogGuardCreateDog();
        this._dogGuardPatrolLoop();
    },

    // ===== 【人在岗检测】监听用户活动：在→小狗休息，离开→恢复巡逻 =====
    _dogGuardBindPresence: function() {
        if (this._dogGuardPresenceBound) return;
        this._dogGuardPresenceBound = true;
        var self = this;
        var mark = function() { self._dogGuardLastActive = Date.now(); };
        ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function(ev) {
            document.addEventListener(ev, mark, { passive: true });
        });
        // 页面切走/最小化 = 视为离开；切回来 = 视为在
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                self._dogGuardLastActive = 0; // 离开
            } else {
                mark();
            }
        });
    },

    // 用户是否在场：页面可见且最近有活动
    _dogGuardUserPresent: function() {
        return !document.hidden && (Date.now() - this._dogGuardLastActive) < this._dogGuardAwayMs;
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
              '<span class="dog-guard-paw">🐾</span>' /* 爪子emoji */ +
              '<span class="dog-guard-tail"></span>' +
            '</div>' +
            '<div class="dog-hp-bar" style="display:none;"><i class="dog-hp-ghost"></i><i class="dog-hp-fill"></i></div>' +
            '<div class="dog-guard-bubble" style="display:none;"></div>';
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
        // 右键：弹出小狗管家对话框（与按钮右键一致）
        dog.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.DogGuardChat === 'object' && DogGuardChat.open) {
                DogGuardChat.open(e.clientX, e.clientY);
            }
        });
        var dragging = false, moved = false;
        var ox = 0, oy = 0;
        var body = dog.querySelector('.dog-guard-body') || dog;

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
                // 单击 = 叫一声 + 摇尾巴，然后打开通用角色对话框（与主脑/风筝同款）
                self._dogGuardBark();
                if (window.DogGuardChat && DogGuardChat.open) {
                    var r = dog.getBoundingClientRect();
                    DogGuardChat.open(r.left + r.width / 2, r.bottom);
                }
            }
        }
    },

    // ===== 点击叫唤 =====
    // ===== 血条：被炸弹命中扣血 =====
    _dogGuardDamage: function(dmg) {
        if (dmg == null || dmg <= 0) dmg = 25;
        this._dogGuardHp = Math.max(0, this._dogGuardHp - dmg);
        var dog = this._dogGuardEl;
        if (!dog || !dog.isConnected) { if (this._dogGuardHp <= 0) this._dogGuardHp = 100; return; }
        var bar = dog.querySelector('.dog-hp-bar');
        if (!bar) { if (this._dogGuardHp <= 0) this._dogGuardHp = 100; return; }
        bar.style.display = 'block';
        var fill = bar.querySelector('.dog-hp-fill');
        var ghost = bar.querySelector('.dog-hp-ghost');
        var pct = this._dogGuardHp;
        fill.style.width = pct + '%';
        fill.classList.remove('dog-hp-full');
        // 受击闪白
        bar.classList.remove('dog-hp-hit'); void bar.offsetWidth; bar.classList.add('dog-hp-hit');
        var self = this;
        // 残影条 1.4s 慢速跟随（游戏式渐渐变少效果）
        clearTimeout(bar._ghostTimer);
        bar._ghostTimer = setTimeout(function(){ ghost.style.width = pct + '%'; }, 260);
        if (this._dogGuardHp <= 0) {
            fill.style.width = '0%';
            // 血量归零：叫一声，随后自动回满
            setTimeout(function(){
                self._dogGuardBark();
                self._dogGuardSay('呜……我没血了！马上回满！', 1800);
            }, 420);
            setTimeout(function(){
                self._dogGuardHp = 100;
                fill.style.transition = 'width .8s ease-out';
                fill.style.width = '100%';
                ghost.style.transition = 'width .8s ease-out';
                ghost.style.width = '100%';
                fill.classList.add('dog-hp-full');
                setTimeout(function(){
                    fill.style.transition = ''; ghost.style.transition = '';
                    self._dogGuardHpScheduleHide(bar);
                }, 900);
            }, 1400);
        } else {
            this._dogGuardHpScheduleHide(bar);
        }
    },

    // 满血且未被攻击 6 秒后自动隐藏血条
    _dogGuardHpScheduleHide: function(bar) {
        clearTimeout(this._dogGuardHpHideTimer);
        var self = this;
        this._dogGuardHpHideTimer = setTimeout(function(){
            if (self._dogGuardHp >= 100) bar.style.display = 'none';
        }, 6000);
    },

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

    // ===== 小狗专用模型：填充下拉框（默认语言大模型优先，持久化 UserSettings: dogGuardModelId）=====

    // ===== 取小狗当前选中的模型（下拉框选择 > 保存的设置 > 默认语言大模型 > activeId > 第一个可见）=====

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




    // ===== 极简工具执行器：解析回复中的 [TOOL:xxx] 指令并执行 =====

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

    // ===== 【交警红绿灯联动】每轮巡逻先同步各对话的闸门状态 =====
    // 每个对话独立维护状态（交警说停就停表，交警放行不走才计时）：
    //   c._dgLight     'red'（闸门排队/间隔等待）| 'green'（放行中）| 'none'（无票=前端本地阶段）| 'unknown'（接口失败）
    //   c._dgNoProgMs  计费时间：绿灯/本地阶段且无进展的累计毫秒（红灯冻结、进展清零）
    //   c._dgTick      上次计费结算时刻；c._dgRunNow/_dgWaitNow/_dgQueuePos 展示用
    _dogGuardSyncGate: function(boxes, done) {
        var self = this;
        var now = Date.now();
        var sending = boxes.filter(function(c) { return c && c.isSending; });
        var settle = function() {
            sending.forEach(function(c) {
                var dt = now - (c._dgTick || now);
                // 进展检测：history 增长 = 收到新响应/工具结果 → 计费清零重新计时
                var histLen = Array.isArray(c.history) ? c.history.length : 0;
                if (histLen !== (c._dgHistLen || 0)) {
                    // 【工具间隔检测】新增的历史里若有工具调用/工具结果 → 记录一次"工具到达"时刻。
                    // 用于估算该对话两个工具之间的典型间隔：间隔有规律 = 正在正常干活，
                    // 介入阈值应随之放宽（工具本身就是耗时操作，不算"无进展"）。
                    var oldLen = c._dgHistLen || 0;
                    var isToolMsg = false;
                    for (var _k = oldLen; _k < histLen; _k++) {
                        var _m = c.history[_k];
                        if (_m && (_m.role === 'tool' || _m.role === 'tool_use' || _m.tool_call ||
                                   (_m.role === 'assistant' && _m.tool_calls && _m.tool_calls.length))) { isToolMsg = true; break; }
                    }
                    if (isToolMsg) {
                        c._dgToolTimes = c._dgToolTimes || [];
                        c._dgToolTimes.push(now);
                        if (c._dgToolTimes.length > 6) c._dgToolTimes.shift();  // 保留最近 6 次
                    }
                    c._dgHistLen = histLen;
                    c._dgLastProgress = now;
                    c._dgNoProgMs = 0;
                }
                if (c._dgLight === 'green' || c._dgLight === 'none') {
                    c._dgNoProgMs = (c._dgNoProgMs || 0) + dt;   // 交警让他走 → 计时
                }
                // 红灯：dt 直接丢弃（冻结不计、保留存量）；unknown：保守不动
                c._dgTick = now;
            });
            if (done) done();
        };
        if (!sending.length) { settle(); return; }
        fetch('/api/gate/active', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(j) {
                var map = {};
                ((j && j.active) || []).forEach(function(a) { if (a && a.box) map[a.box] = a; });
                sending.forEach(function(c) {
                    var t = map[c.id];
                    if (t) {
                        c._dgLight = (t.state === 'running') ? 'green' : 'red';
                        c._dgRunNow = t.run_now || 0;
                        c._dgWaitNow = t.wait_now || 0;
                        c._dgQueuePos = t.queue_pos || 0;
                        c._dgLane = t.lane || 0;
                    } else {
                        c._dgLight = 'none';
                        c._dgRunNow = 0; c._dgWaitNow = 0; c._dgQueuePos = 0;
                    }
                });
                settle();
            })
            .catch(function() {
                // 接口失败：标 unknown，本轮保守不计费（宁可漏报不误报，用户在意误报）
                sending.forEach(function(c) { if (c._dgLight !== 'red' && c._dgLight !== 'green' && c._dgLight !== 'none') c._dgLight = 'unknown'; });
                settle();
            });
    },

    // ===== 巡逻主循环 =====
    _dogGuardPatrolLoop: function() {
        var self = this;
        var boxes = (this.chatBoxes || []).filter(function(c) { return c && c.el && c.el.style.display !== 'none'; });
        // 【人在不巡逻】用户在场时小狗原地睡觉休息，离开后自动恢复巡逻
        if (this._dogGuardUserPresent()) {
            window.__dogGuardTimer = setTimeout(function() { self._dogGuardPatrolLoop(); }, this._dogGuardInterval);
            return;
        }
        if (!boxes.length || this._dogGuardBusy || !this._dogGuardEnabled) {
            window.__dogGuardTimer = setTimeout(function() { self._dogGuardPatrolLoop(); }, this._dogGuardInterval);
            return;
        }
        // 【交警红绿灯联动】选目标前先同步闸门状态（一次轻量 fetch 覆盖所有发送中对话）：
        // 红灯排队不计时；绿灯放行且无进展才计费，超阈值才介入
        this._dogGuardSyncGate(boxes, function() {
            // 挑一个最该看的目标：优先已停止/出错的 → 绿灯超时的 → 轮询空闲的
            var now = Date.now();
            var target = null, targetType = '';
            for (var i = 0; i < boxes.length; i++) {
                var c = boxes[i];
                // 🐕 循环预警升级（Agent 循环检测器打了 _loopEscalated 标记）→ 最高优先级提前介入，不等超时
                if (c.isSending && c._loopEscalated &&
                    (now - c._loopEscalated > 600000) && // 2026-09 修复：升级后先给模型 10 分钟自救（原版立即停止=长任务误杀根源）
                    (!self._dogGuardActions[c.id] || now - self._dogGuardActions[c.id] > 1800000)) {
                    target = c; targetType = 'timeout'; break;
                }
                if (c._stopped && !c._dgUserStopped) { target = c; targetType = 'stopped'; break; }
                // 【交警红绿灯联动】超时判定 = 计费时间超阈值：
                //   - 红灯（闸门排队/间隔等待）：交警让他停 → 一分钱不计时，绝不作为目标——排队不是偷懒
                //   - 绿灯（放行中）/无票（前端本地阶段）：交警让他走 → 他不走才计时，超时才介入
                // 旧的"任务总时长超限"条件已废除：排队等待时间天然被排除，总时长不再有意义
                // 【工具间隔动态阈值】取该对话最近几次工具调用之间的典型间隔，
                // 阈值 = max(基础超时, 典型间隔 × 2.5 + 20000)。
                // 工作中的对话两个工具之间本来就有等待（服务端执行/长思考），
                // 间隔有实测数据时按实测放宽，绝不把正常工作节奏误判为"无进展"。
                var _dgTimeout = self._dogGuardToolTimeout;
                var _dgTT = c._dgToolTimes || [];
                if (_dgTT.length >= 2) {
                    var _dgGaps = [];
                    for (var _g = 1; _g < _dgTT.length; _g++) _dgGaps.push(_dgTT[_g] - _dgTT[_g - 1]);
                    _dgGaps.sort(function(a, b) { return a - b; });
                    var _dgMedian = _dgGaps[Math.floor(_dgGaps.length / 2)];   // 中位数抗离群
                    _dgTimeout = Math.max(_dgTimeout, _dgMedian * 2.5 + 20000);
                }
                if (c.isSending && (c._dgLight === 'green' || c._dgLight === 'none') &&
                    (c._dgNoProgMs || 0) > _dgTimeout &&
                    (!self._dogGuardActions[c.id] || now - self._dogGuardActions[c.id] > 900000)) {
                    target = c; targetType = 'timeout'; break;
                }
                // 空闲太久没动静（有历史但超过5分钟没任何消息）→ 也算需要关心
                // 但任务已确认完成、或已对它停滞干预过2次的 → 直接跳过，不再当目标
                // 【2026-09 修复】追加"AI未接话"判断：只有最后一条消息是用户发的（AI还没回应、确实卡住）才算真停滞。
                // 如果最后一条是 AI 回复，说明对话在等主人回话（正常闲聊停顿），小狗不该插嘴催继续。
                if (!c.isSending && c._dogGuardLastActivity &&
                    (now - c._dogGuardLastActivity) > 600000 &&
                    (!self._dogGuardActions[c.id] || now - self._dogGuardActions[c.id] > 900000) &&
                    !self._dogGuardStaleDone[c.id] &&
                    (self._dogGuardStaleCount[c.id] || 0) < 2 &&
                    !self._dogGuardIsTaskDone(c) &&
                    self._dogGuardIsAwaitingReply(c)) {
                    target = c; targetType = 'stale'; break;
                }
            }
            if (!target) {
                // 无异常目标 → 顺序轮询没看过的
                for (var j = 0; j < boxes.length; j++) {
                    var cc = boxes[j];
                    if (!self._dogGuardVisited[cc.id] || now - self._dogGuardVisited[cc.id] > 60000) { target = cc; targetType = 'idle'; break; }
                }
                if (!target) target = boxes[Math.floor(Math.random() * boxes.length)], targetType = 'idle';
            }

            self._dogGuardBusy = true;
            self._dogGuardVisit(target, targetType, function() {
                self._dogGuardBusy = false;
                window.__dogGuardTimer = setTimeout(function() { self._dogGuardPatrolLoop(); }, self._dogGuardInterval);
            });
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
        /* 【FPS 自动降级】全局帧率过低时小狗直接瞬移到目标点，跳过飞行动画 */
        if (window.FpsGuard && !window.FpsGuard.allow('dog')) { el.style.left = x2 + 'px'; el.style.top = y2 + 'px'; if (cb) cb(); return; }
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
            'timeout': '绿灯放行后长时间无进展（交警已放行，上游通信停滞/疑似死循环）',
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
            // 【2026-09 修复】最后一条是 AI 回复 = 对话在等主人说话（正常闲聊停顿），小狗不插嘴
            if (!this._dogGuardIsAwaitingReply(chat)) {
                this._dogGuardSay('（' + title + '）正等你说话呢，不打扰~', 2000);
                if (done) done();
                return;
            }
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
            // 同一对话最多干预 1 次（原来允许2次造成巡查报告写两遍），防止对同一个问题反复轰炸
            var cnt = this._dogGuardStaleCount[chat.id] || 0;
            if (cnt >= 1) {
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
            // 【交警红绿灯联动】绿灯放行后长时间无进展（或循环预警升级）→ 注入修改方法继续
            // 【修复】与 stale 分支一样加干预次数上限（最多 2 次），防止守卫反复杀同一对话造成"停止→注入→再循环"死循环
            var _timeoutCnt = (this._dogGuardTimeoutCount = this._dogGuardTimeoutCount || {})[chat.id] || 0;
            if (_timeoutCnt >= 1) {
                this._dogGuardSay('「' + title + '」已经暂停提醒过啦，交给主人处理~', 2000);
                if (done) done();
                return;
            }
            // 【D修复 2026-09-10】活跃Turn的"无进展"注入跳过：该框在闸门/池里还有活跃Turn
            // （绿灯=上游运行中/红灯=排队中）→ 不塞竞争消息、不消耗干预次数，只重置计费时钟
            //（下一窗口仍无进展再议）。22:20:28 事故：守卫往正在跑的框里注入排队消息，随后与
            // 用户自己的新消息形成双方互相收割的风暴。循环预警升级（_loopEscalated）不受此限
            //——那是"AI原地打转"的独立检测，恰需在运行中介入。
            if (!chat._loopEscalated && (chat._dgLight === 'green' || chat._dgLight === 'red')) {
                chat._dgNoProgMs = 0;
                this._dogGuardSay('「' + title + '」Turn还在跑，我不插嘴~', 1800);
                if (done) done();
                return;
            }
            this._dogGuardTimeoutCount[chat.id] = _timeoutCnt + 1;
            var _dgRun = chat._dgRunNow || Math.round((chat._dgNoProgMs || 0) / 1000);
            var _loopReason = chat._loopEscalated ? '循环预警升级（警告后仍在原地打转）' : inspectReasons.timeout;
            delete chat._loopEscalated; // 处理后清除标记
            this._dogGuardLogBook(chat, (_loopReason === inspectReasons.timeout ? '绿灯放行 ' + _dgRun + ' 秒无进展' : '循环任务预警升级') + '，已注入修改方法让它继续', '守护原因：' + _loopReason);
            this._dogGuardSay('「' + title + '」绿灯放行 ' + _dgRun + ' 秒没进展，我来管管！（不停止对话）', 2500);
            var prompt2 = this._dogGuardBuildPrompt(chat, '已获闸门放行（绿灯）但长时间无进展：疑似上游通信停滞或死循环。请总结已尝试的内容，明确说明卡点，换一种方法继续，或用 task_complete 结束任务');
            // 【用户要求】只提醒不停止：直接注入改进提示，不调用 stopSending
            setTimeout(function() {
                Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：绿灯放行后无进展，已注入提醒（对话保持运行）');
                self._dogGuardIntervene(chat, prompt2);
                if (done) done();
            }, 1800);
        } else {
            // 空闲：判断是否完成
            // 【交警红绿灯联动】发送中但红灯 = 在闸门排队等放行：不催不管，友好播报排队位次
            if (chat.isSending && chat._dgLight === 'red') {
                this._dogGuardSay('「' + title + '」在闸门排队等放行（第' + (chat._dgQueuePos || '?') + '位），红灯时间不计入巡查~', 2200);
                if (done) done();
                return;
            }
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

    // ===== 【2026-09 新增】判断对话是否"在等 AI 接话"（真停滞） =====
    // 依据：最后一条消息是用户发的 → AI 还没回应，可能卡住/被遗忘 → 守卫可以干预
    //       最后一条是 AI 回复 → 对话在等主人说话（正常闲聊停顿）→ 守卫不该插嘴
    _dogGuardIsAwaitingReply: function(chat) {
        if (!chat || !chat.history || !chat.history.length) return false;
        var last = chat.history[chat.history.length - 1];
        return last && last.role === 'user';
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
                if (/(任务完成|任务已完成|彻底完成|二次验证成功)/.test(t)) return true;
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
            '【重要】对话历史中的工具结果若显示 [存档#N ...]，说明该步骤已执行过，不要重复执行；如需详情用 get_tool_result 取回即可。\n' +
            '请你：1）简要总结目前进度（包括已读取/修改过的文件路径）；2）找出卡住/未完成的原因；3）换一种方法继续干活，不要重复之前已做过且失败的搜索/命令，直到任务完成。';
    },

    // ===== 干预：把提示语发回该对话 =====
    _dogGuardIntervene: function(chat, prompt) {
        if (!chat || !chat.el) return;
        // 【人在休息】主人在场时小狗不干预、不排队—— intervention 只该发生在主人离岗期间
        if (this._dogGuardUserPresent()) {
            Store.addLog('info', chat.id, 'dog-guard', '🐕 小狗守卫：主人在场，休息中，不干预不排队');
            return;
        }
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
    btn.title = '小狗管家：左键=巡逻开/关，右键=和我聊天';
    btn.innerHTML = '<span class="tk-label">守卫</span><span class="tk-dot"></span>';
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
            // 单击 → 打开/关闭小狗守卫（巡逻开关）
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                App._dogGuardToggle();
            });
            // 右键 → 与主脑/风筝同款：在鼠标位置呼出「小狗管家」普通对话框
            btn.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof window.DogGuardChat === 'object' && DogGuardChat.open) {
                    DogGuardChat.open(e.clientX, e.clientY);
                }
            });
        }
    }, 1500);
});
