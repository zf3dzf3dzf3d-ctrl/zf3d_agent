// ========== app-health.js - 健康守护模式 v2 =========
// 规则：
// 1. 每隔 intervalMinutes（30~60分钟）弹出休息提醒，第一次可以点"再干一会儿"关闭一次
// 2. 关闭后继续工作满 graceMinutes(10分钟) → 强制锁定：全屏置顶弹窗、禁用一切输入，必须休息 forceLockMinutes(默认10分钟)
// 3. 所有计时只在"人在"（有鼠标/键盘活动）时走，人离开计时暂停，回来继续
// 4. 强制锁定倒计时用 Web Worker 计时：人离开电脑也照样走，到点自动消失
// 5. 设置面板可调间隔，仅限 30~60 分钟

var HealthGuard = {

    // ===== 配置（强制启用，间隔可调 30~60） =====
    _config: {
        intervalMinutes: 30,     // 休息提醒间隔（分钟），30~60
        forceLockMinutes: 10,    // 强制锁定（休息）时长（分钟）
        graceMinutes: 10,        // 关闭提醒后继续工作多久触发强制锁定（分钟）
    },

    // ===== 内部状态 =====
    _tickTimer: null,            // 1 秒主循环定时器
    _activeWorkSeconds: 0,       // 累计"活跃工作"秒数（本周期，人在时才累计）
    _graceSeconds: 0,            // 关闭提醒后累计的"再干一会儿"秒数
    _snoozeUsed: false,          // 本次周期是否已用过"再干一会儿"
    _isLocked: false,            // 是否处于强制锁定状态
    _lockRemainSeconds: 0,       // 锁定剩余秒数（人在时递减）
    _countdownTimer: null,       // 锁定倒计时显示定时器
    _exerciseAnimIdx: 0,         // 当前体操动作索引
    _exerciseTimer: null,        // 体操动画切换定时器

    // 活跃检测：超过该秒数无鼠标/键盘活动视为"人离开"
    _IDLE_THRESHOLD_SEC: 60,
    // 用户离开超过该秒数（10分钟）→ 工作计时清零（人已经休息过了）
    _IDLE_RESET_SEC: 600,
    _lastActivityTime: Date.now(),
    _idleSeconds: 0,

    // 体操动作列表（纯 CSS 动画 class 名）
    _exerciseActions: [
        { name: '伸展运动', cssClass: 'ex-stretch', icon: '🙆', tip: '双手向上伸展，深呼吸~' },
        { name: '转颈运动', cssClass: 'ex-neck',    icon: '🔄', tip: '缓慢转动脖子，左右各5次' },
        { name: '扩胸运动', cssClass: 'ex-chest',   icon: '💪', tip: '双手向后扩展，活动肩胛骨' },
        { name: '眼部运动', cssClass: 'ex-eyes',    icon: '👀', tip: '上下左右看，缓解眼疲劳' },
        { name: '扭腰运动', cssClass: 'ex-waist',   icon: '🤸', tip: '双手叉腰，左右扭动腰部' },
        { name: '深蹲运动', cssClass: 'ex-squat',   icon: '🦵', tip: '缓慢深蹲5次，活动下肢' },
    ],

    // ===== 初始化 =====
    init: function() {
        var self = this;
        // 热更新安全：清理旧定时器
        if (self._tickTimer) clearInterval(self._tickTimer);
        if (window.__healthGuardTimerId) {
            clearInterval(window.__healthGuardTimerId);
            window.__healthGuardTimerId = null;
        }
        if (window.__healthGuardOldTimerId) {
            clearInterval(window.__healthGuardOldTimerId);
            window.__healthGuardOldTimerId = null;
        }
        // 活跃监听（鼠标移动/点击/键盘/滚动 = 人在）
        ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function(evt) {
            document.addEventListener(evt, function() {
                self._lastActivityTime = Date.now();
            }, { passive: true });
        });
        this.loadConfig(function() {
            self.startTimer();
        });
    },

    // ===== 人在吗？ =====
    _isUserActive: function() {
        return (Date.now() - this._lastActivityTime) / 1000 < this._IDLE_THRESHOLD_SEC;
    },

    // ===== 加载配置 =====
    loadConfig: function(callback) {
        var self = this;
        fetch('/api/health/config')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.ok && data.config) {
                    var cfg = data.config;
                    if (cfg.intervalMinutes) self._config.intervalMinutes = cfg.intervalMinutes;
                    if (cfg.forceLockMinutes) self._config.forceLockMinutes = cfg.forceLockMinutes;
                    if (cfg.graceMinutes) self._config.graceMinutes = cfg.graceMinutes;
                }
                if (callback) callback();
            })
            .catch(function() {
                if (callback) callback();
            });
    },

    // ===== 保存配置 =====
    saveConfig: function(config, callback) {
        var self = this;
        Object.assign(self._config, config);
        fetch('/api/health/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(self._config)
        })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.ok) {
                    self.restartTimer();
                    if (callback) callback(true);
                } else {
                    if (callback) callback(false);
                }
            })
            .catch(function() {
                if (callback) callback(false);
            });
    },

    // ===== 启动主循环（每秒一跳，人在时才计时） =====
    startTimer: function() {
        var self = this;
        self.stopTimer();
        self._tickTimer = setInterval(function() { self._tick(); }, 1000);
        window.__healthGuardTimerId = self._tickTimer;
    },

    restartTimer: function() {
        this.stopTimer();
        this.startTimer();
    },

    stopTimer: function() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
        if (window.__healthGuardTimerId) {
            clearInterval(window.__healthGuardTimerId);
            window.__healthGuardTimerId = null;
        }
    },

    // ===== 每秒主循环 =====
    _tick: function() {
        var self = this;
        if (self._isLocked) {
            // 锁定中：人在才递减锁定倒计时
            if (self._isUserActive() && self._lockRemainSeconds > 0) {
                self._lockRemainSeconds--;
            }
            return;
        }
        if (self._isUserActive()) {
            // 人回来了，清零离开计时
            self._idleSeconds = 0;
        } else {
            // 人离开：累计离开秒数
            self._idleSeconds++;
            // 离开超过10分钟 → 用户已经休息过了，工作计时清零
            if (self._idleSeconds >= self._IDLE_RESET_SEC) {
                var hadWork = self._activeWorkSeconds > 0;
                self._activeWorkSeconds = 0;
                self._graceSeconds = 0;
                self._snoozeUsed = false;
                self._idleSeconds = 0;
                if (hadWork && typeof Store !== 'undefined') {
                    Store.addLog('info', '', 'health-reset',
                        '健康守护：用户离开超过10分钟，工作计时已清零');
                }
            }
            return; // 人离开，工作计时暂停
        }

        self._activeWorkSeconds++;
        if (self._snoozeUsed) self._graceSeconds++;

        var intervalSec = (self._config.intervalMinutes || 30) * 60;
        var graceSec = (self._config.graceMinutes || 10) * 60;

        // 已用过"再干一会儿"且又干了 graceMinutes → 强制锁定
        if (self._snoozeUsed && self._graceSeconds >= graceSec) {
            self._showForceLock();
            return;
        }
        // 到达提醒间隔
        if (self._activeWorkSeconds >= intervalSec) {
            self._showRestReminder();
        }
    },

    // ===== 显示休息提醒弹窗 =====
    _showRestReminder: function() {
        var self = this;
        // 本次周期第二次提醒（没用过再干一会儿却到了两次间隔）直接强制锁
        if (self._snoozeUsed) {
            self._showForceLock();
            return;
        }
        self._showRestModal(false);
        if (typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-reminder',
                '健康守护：休息提醒（每' + self._config.intervalMinutes + '分钟，工作计时仅计活跃时间）');
        }
    },

    // ===== 显示休息弹窗 =====
    _showRestModal: function(isForceLock) {
        var self = this;
        if (document.getElementById('healthRestModal')) return; // 已存在

        var modal = document.createElement('div');
        modal.id = 'healthRestModal';
        modal.className = 'health-rest-overlay';
        // 强制锁定时保证永远置顶
        if (isForceLock) modal.style.zIndex = '2147483647';

        var action = self._exerciseActions[self._exerciseAnimIdx % self._exerciseActions.length];

        var buttonsHtml;
        if (isForceLock) {
            buttonsHtml = '<span class="health-locked-badge">🔒 已锁定，必须休息</span>';
        } else {
            buttonsHtml =
                (self._snoozeUsed ? '' :
                    '<button class="health-btn health-btn-ghost" id="healthSnoozeBtn">再干一会儿</button>') +
                '<button class="health-btn health-btn-primary" id="healthRestClose">我知道了，去休息</button>';
        }

        modal.innerHTML =
            '<div class="health-rest-box' + (isForceLock ? ' force-lock' : '') + '">' +
                '<div class="health-rest-header">' +
                    (isForceLock
                        ? '<span class="health-rest-title">🔒 强制休息时间到！</span>'
                        : '<span class="health-rest-title">⏰ 该休息一下啦~</span>') +
                '</div>' +
                '<div class="health-rest-body">' +
                    '<div class="health-exercise-figure ' + action.cssClass + '" id="exerciseFigure">' +
                        '<div class="fig-head"></div>' +
                        '<div class="fig-body"></div>' +
                        '<div class="fig-arm-l"></div>' +
                        '<div class="fig-arm-r"></div>' +
                        '<div class="fig-leg-l"></div>' +
                        '<div class="fig-leg-r"></div>' +
                    '</div>' +
                    '<div class="health-exercise-label" id="exerciseLabel"></div>' +
                    '<div class="health-exercise-tip" id="exerciseTip"></div>' +
                    (isForceLock
                        ? '<div class="health-lock-countdown" id="healthLockCountdown">剩余休息时间: ' + self._config.forceLockMinutes + ':00</div>'
                        : '<div class="health-rest-tip">💡 已连续活跃工作 ' + Math.floor(self._activeWorkSeconds / 60) + ' 分钟（离开电脑的时间不计时）</div>') +
                '</div>' +
                '<div class="health-rest-actions">' + buttonsHtml + '</div>' +
            '</div>';

        document.body.appendChild(modal);

        // 启动体操动画切换
        self._startExerciseAnimation();

        if (isForceLock) {
            self._startLockCountdown();
        } else {
            var closeBtn = document.getElementById('healthRestClose');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    // 用户选择去休息：重置整个周期
                    self._resetCycle();
                    self._closeRestModal();
                    if (typeof Store !== 'undefined') {
                        Store.addLog('info', '', 'health-rest', '健康守护：用户选择休息，工作计时已重置');
                    }
                });
            }
            var snoozeBtn = document.getElementById('healthSnoozeBtn');
            if (snoozeBtn) {
                snoozeBtn.addEventListener('click', function() {
                    // 第一次宽限：记录，继续工作 graceMinutes 后强制锁定
                    self._snoozeUsed = true;
                    self._graceSeconds = 0;
                    self._activeWorkSeconds = 0; // 重新按宽限计时
                    self._closeRestModal();
                    self._refreshNavViews();
                    if (typeof Store !== 'undefined') {
                        Store.addLog('info', '', 'health-snooze',
                            '健康守护：选择"再干一会儿"，' + self._config.graceMinutes + '分钟后将强制锁定');
                    }
                });
            }
        }
    },

    // ===== 重置工作周期 =====
    _resetCycle: function() {
        this._activeWorkSeconds = 0;
        this._graceSeconds = 0;
        this._snoozeUsed = false;
        this._lastRestTime = Date.now(); // 兼容状态栏显示
        this._refreshNavViews();
    },

    // ===== 健康弹窗关闭/解锁后强制刷新导航视图 =====
    // 修复：关闭健康守护弹窗后，小地图（右下角导航）的对话方块可能消失不恢复，
    // 需新建对话才触发 updateMinimap 重绘。这里在弹窗生命周期节点主动补刷新。
    _refreshNavViews: function() {
        try {
            if (typeof App === 'undefined') return;
            // 清掉 raf 去重标记，保证本次刷新一定执行绘制
            if (App._mmRaf) { cancelAnimationFrame(App._mmRaf); App._mmRaf = 0; }
            if (typeof App.updateMinimap === 'function') App.updateMinimap();
            // 小地图重绘依赖布局完成，延迟补一次
            setTimeout(function() {
                if (App._mmRaf) { cancelAnimationFrame(App._mmRaf); App._mmRaf = 0; }
                if (typeof App.updateMinimap === 'function') App.updateMinimap();
                if (App._taskPanelOpen && typeof App._renderChatPanel === 'function') App._renderChatPanel();
            }, 350);
        } catch (e) { console.warn('[HealthGuard] 导航刷新失败:', e); }
    },

    // ===== 启动体操动画切换 =====
    _startExerciseAnimation: function() {
        var self = this;
        if (self._exerciseTimer) clearInterval(self._exerciseTimer);
        var render = function() {
            var figure = document.getElementById('exerciseFigure');
            var label = document.getElementById('exerciseLabel');
            var tip = document.getElementById('exerciseTip');
            if (!figure) {
                clearInterval(self._exerciseTimer);
                self._exerciseTimer = null;
                return;
            }
            var action = self._exerciseActions[self._exerciseAnimIdx % self._exerciseActions.length];
            self._exerciseActions.forEach(function(a) {
                figure.classList.remove(a.cssClass);
            });
            figure.classList.add(action.cssClass);
            if (label) {
                label.innerHTML = '<span class="ex-icon">' + action.icon + '</span><span class="ex-name">' + action.name + '</span>';
            }
            if (tip) {
                tip.textContent = action.tip;
            }
        };
        render();
        self._exerciseTimer = setInterval(function() {
            self._exerciseAnimIdx++;
            render();
        }, 5000); // 每5秒切换一个动作
    },

    // ===== 显示强制锁定 =====
    _showForceLock: function() {
        var self = this;
        self._isLocked = true;
        self._lockRemainSeconds = (self._config.forceLockMinutes || 10) * 60;

        // 关闭可能存在的普通提醒弹窗
        var old = document.getElementById('healthRestModal');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        // 显示锁定弹窗（置顶、无法关闭）
        self._showRestModal(true);

        // 禁用一切输入（无法发送）
        self._disableAllInputs();

        // 启动锁定倒计时
        self._startLockCountdown();

        if (typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-force-lock',
                '健康守护：强制锁定触发（关闭提醒后继续工作超' + self._config.graceMinutes + '分钟），须休息' + self._config.forceLockMinutes + '分钟');
        }
    },

    // ===== 锁定倒计时（Web Worker 计时：不受浏览器后台节流，人离开也照样走） =====
    _lockWorker: null,
    _startLockCountdown: function() {
        var self = this;
        if (self._countdownTimer) clearInterval(self._countdownTimer);
        // 用 Blob 内联 Web Worker 作为不受节流的时钟源（后台标签页仍每秒 tick）
        try {
            if (self._lockWorker) self._lockWorker.terminate();
            var blob = new Blob(['var t=null;onmessage=function(e){if(e.data==="start"){t=setInterval(function(){postMessage("tick")},1000)}else{clearInterval(t)}}'], { type: 'application/javascript' });
            self._lockWorker = new Worker(URL.createObjectURL(blob));
            self._lockWorker.onmessage = function() { self._lockTick(); };
            self._lockWorker.postMessage('start');
        } catch (err) {
            // Worker 不可用时退回 setInterval（仅前台正常）
            self._countdownTimer = setInterval(function() { self._lockTick(); }, 1000);
        }
    },
    _lockTick: function() {
        var self = this;
        var el = document.getElementById('healthLockCountdown');
        self._lockRemainSeconds = Math.max(0, self._lockRemainSeconds - 1);
        var mins = Math.floor(self._lockRemainSeconds / 60);
        var secs = self._lockRemainSeconds % 60;
        if (el) el.textContent = '剩余休息时间: ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
        if (self._lockRemainSeconds <= 0) {
            if (self._lockWorker) { self._lockWorker.terminate(); self._lockWorker = null; }
            if (self._countdownTimer) { clearInterval(self._countdownTimer); self._countdownTimer = null; }
            self._endForceLock();
        }
    },

    // ===== 结束强制锁定 =====
    _endForceLock: function() {
        var self = this;
        self._isLocked = false;
        self._lockRemainSeconds = 0;
        self._resetCycle(); // 重置工作计时（内含导航刷新）

        // 恢复所有输入
        self._enableAllInputs();

        // 更新弹窗内容
        var modal = document.getElementById('healthRestModal');
        if (modal) {
            var box = modal.querySelector('.health-rest-box');
            if (box) {
                box.classList.remove('force-lock');
                box.classList.add('unlocking');
                var header = box.querySelector('.health-rest-header');
                if (header) header.innerHTML = '<span class="health-rest-title">✅ 休息完成，继续加油！</span>';
                var countdown = box.querySelector('.health-lock-countdown');
                if (countdown) countdown.innerHTML = '休息时间结束，已解锁 ✓';
                var actions = box.querySelector('.health-rest-actions');
                if (actions) actions.innerHTML = '<button class="health-btn health-btn-primary" id="healthRestClose">继续工作</button>';
                var closeBtn = document.getElementById('healthRestClose');
                if (closeBtn) {
                    closeBtn.addEventListener('click', function() {
                        self._closeRestModal();
                    });
                }
            }
        }

        if (typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-unlock', '健康守护：强制锁定结束，已恢复使用');
        }
    },

    // ===== 关闭休息弹窗 =====
    _closeRestModal: function() {
        var self = this;
        if (self._exerciseTimer) {
            clearInterval(self._exerciseTimer);
            self._exerciseTimer = null;
        }
        var modal = document.getElementById('healthRestModal');
        if (modal) {
            modal.classList.add('closing');
            setTimeout(function() {
                if (modal.parentNode) modal.parentNode.removeChild(modal);
            }, 300);
        }
    },

    // ===== 禁用所有输入（强制锁定时） =====
    _disableAllInputs: function() {
        var inputs = document.querySelectorAll('.chat-input, .quick-input, textarea, input[type="text"]');
        var sendBtns = document.querySelectorAll('.chat-send-btn');
        inputs.forEach(function(el) {
            if (el.closest('#healthRestModal')) return;
            el.setAttribute('disabled', 'true');
            el.setAttribute('data-health-locked', 'true');
            if (el.classList.contains('chat-input')) {
                el.setAttribute('placeholder', '🔒 强制休息中，请先完成休息');
            }
        });
        sendBtns.forEach(function(el) {
            el.setAttribute('disabled', 'true');
            el.setAttribute('data-health-locked', 'true');
        });
    },

    // ===== 恢复所有输入 =====
    _enableAllInputs: function() {
        var els = document.querySelectorAll('[data-health-locked="true"]');
        els.forEach(function(el) {
            el.removeAttribute('disabled');
            el.removeAttribute('data-health-locked');
            if (el.classList.contains('chat-input')) {
                el.removeAttribute('placeholder');
            }
        });
    },

    // ===== 兼容旧接口 =====
    isLocked: function() {
        return this._isLocked === true;
    },

    getLockRemaining: function() {
        return this._lockRemainSeconds || 0; // 秒
    },

    // ===== 状态栏文字 =====
    getStatus: function() {
        if (this._isLocked) {
            var remain = Math.ceil(this._lockRemainSeconds / 60);
            return '强制休息中 (' + remain + '分钟)';
        }
        var nextRest = Math.max(0, Math.ceil(((this._config.intervalMinutes || 30) * 60 - this._activeWorkSeconds) / 60));
        var awayTag = this._isUserActive() ? '' : '（已暂停：人不在）';
        return '活跃工作' + Math.floor(this._activeWorkSeconds / 60) + '分钟 · 下次提醒' + nextRest + '分钟' + awayTag;
    }
};
