// ========== app-health.js - 健康守护模式：定时休息提醒 + 体操动画 + 超时强制锁定 ==========
// 保护身体和用眼，不可关闭，间隔时间可调

var HealthGuard = {

    // ===== 配置（强制启用，间隔可调） =====
    _config: {
        intervalMinutes: 30,     // 休息提醒间隔（分钟），默认30
        forceLockHours: 4,       // 连续工作多少小时后强制锁定
        forceLockMinutes: 10,   // 强制锁定时长（分钟）
    },

    // ===== 内部状态 =====
    _timer: null,               // 休息提醒定时器
    _workStart: Date.now(),     // 本次工作开始时间
    _lastRestTime: Date.now(),  // 上次休息时间
    _isLocked: false,           // 是否处于强制锁定状态
    _lockEndTime: 0,            // 强制锁定结束时间
    _lockTimer: null,           // 锁定倒计时定时器
    _exerciseAnimIdx: 0,        // 当前体操动作索引
    _exerciseTimer: null,       // 体操动画切换定时器
    _countdownTimer: null,      // 倒计时显示定时器

    // 体操动作列表（纯 CSS 动画 class 名）
    _exerciseActions: [
        { name: '伸展运动', cssClass: 'ex-stretch', icon: '🙆', tip: '双手向上伸展，深呼吸~' },
        { name: '转颈运动', cssClass: 'ex-neck',    icon: '🔄', tip: '缓慢转动脖子，左右各5次' },
        { name: '扩胸运动', cssClass: 'ex-chest',   icon: '💪', tip: '双手向后扩展，活动肩胛骨' },
        { name: '眼部运动', cssClass: 'ex-eyes',    icon: '👀', tip: '上下左右看，缓解眼疲劳' },
        { name: '扭腰运动', cssClass: 'ex-waist',   icon: ' twisting', tip: '双手叉腰，左右扭动腰部' },
        { name: '深蹲运动', cssClass: 'ex-squat',   icon: '🦵', tip: '缓慢深蹲5次，活动下肢' },
    ],

    // ===== 初始化 =====
    init: function() {
        var self = this;
        // 热更新安全：先清理上一实例的定时器
        if (self._timer) clearInterval(self._timer);
        if (window.__healthGuardTimerId) {
            clearInterval(window.__healthGuardTimerId);
            window.__healthGuardTimerId = null;
        }
        // 如果已经有旧实例，清理它的定时器
        if (window.__healthGuardOldTimerId) {
            clearInterval(window.__healthGuardOldTimerId);
            window.__healthGuardOldTimerId = null;
        }
        this.loadConfig(function() {
            self.startTimer();
        });
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
                    if (cfg.forceLockHours) self._config.forceLockHours = cfg.forceLockHours;
                    if (cfg.forceLockMinutes) self._config.forceLockMinutes = cfg.forceLockMinutes;
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

    // ===== 启动定时器 =====
    startTimer: function() {
        var self = this;
        // 清理旧定时器（包括热更新后上一实例遗留的）
        if (self._timer) clearInterval(self._timer);
        if (window.__healthGuardTimerId) {
            clearInterval(window.__healthGuardTimerId);
            window.__healthGuardTimerId = null;
        }
        var intervalMs = (self._config.intervalMinutes || 30) * 60 * 1000;
        self._timer = setInterval(function() {
            self._showRestReminder();
        }, intervalMs);
        window.__healthGuardTimerId = self._timer;
        var nextTime = new Date(Date.now() + intervalMs);
        var nextStr = nextTime.getHours() + ':' + (nextTime.getMinutes() < 10 ? '0' : '') + nextTime.getMinutes();
    },

    // ===== 重启定时器 =====
    restartTimer: function() {
        this.stopTimer();
        this.startTimer();
    },

    stopTimer: function() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (window.__healthGuardTimerId) {
            clearInterval(window.__healthGuardTimerId);
            window.__healthGuardTimerId = null;
        }
    },

    // ===== 显示休息提醒弹窗 =====
    _showRestReminder: function() {
        var self = this;

        // 记录提醒时间
        self._lastRestTime = Date.now();

        // 检查是否需要强制锁定
        var workDuration = (Date.now() - self._workStart) / 1000 / 60; // 分钟
        var forceLockMinutes = (self._config.forceLockHours || 4) * 60;
        if (workDuration >= forceLockMinutes && !self._isLocked) {
            self._showForceLock();
            return;
        }

        // 显示普通休息弹窗
        self._showRestModal(false);
    },

    // ===== 显示休息弹窗 =====
    _showRestModal: function(isForceLock) {
        var self = this;
        if (document.getElementById('healthRestModal')) return; // 已存在

        var modal = document.createElement('div');
        modal.id = 'healthRestModal';
        modal.className = 'health-rest-overlay';

        var action = self._exerciseActions[self._exerciseAnimIdx % self._exerciseActions.length];

        modal.innerHTML =
            '<div class="health-rest-box' + (isForceLock ? ' force-lock' : '') + '">' +
                '<div class="health-rest-header">' +
                    '<span class="health-rest-title">' + (isForceLock ? '🚨 强制休息时间' : '🧘 该休息一下了') + '</span>' +
                '</div>' +
                '<div class="health-rest-message">' +
                    (isForceLock
                        ? '您已连续工作 <b>' + self._config.forceLockHours + ' 小时</b>以上，身体需要休息！<br>系统已强制锁定，请完成休息后继续。'
                        : '您已工作 ' + (self._config.intervalMinutes || 30) + ' 分钟，站起来活动一下身体吧！<br>保护视力，预防颈椎病。') +
                '</div>' +
                '<div class="health-exercise-area">' +
                    '<div class="health-exercise-figure ' + action.cssClass + '" id="exerciseFigure">' +
                        '<div class="fig-head"></div>' +
                        '<div class="fig-body"></div>' +
                        '<div class="fig-arm-l"></div>' +
                        '<div class="fig-arm-r"></div>' +
                        '<div class="fig-leg-l"></div>' +
                        '<div class="fig-leg-r"></div>' +
                    '</div>' +
                    '<div class="health-exercise-label" id="exerciseLabel">' +
                        '<span class="ex-icon">' + action.icon + '</span>' +
                        '<span class="ex-name">' + action.name + '</span>' +
                    '</div>' +
                    '<div class="health-exercise-tip" id="exerciseTip">' + action.tip + '</div>' +
                '</div>' +
                (isForceLock
                    ? '<div class="health-lock-countdown" id="healthLockCountdown">剩余休息时间: ' + self._config.forceLockMinutes + ':00</div>'
                    : '<div class="health-rest-tip">💡 每隔一段时间休息，是保护身体最好的方式</div>'
                ) +
                '<div class="health-rest-actions">' +
                    (isForceLock
                        ? '<span class="health-locked-badge">🔒 已锁定</span>'
                        : '<button class="health-btn health-btn-primary" id="healthRestClose">我知道了，去休息</button>'
                    ) +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);

        // 启动体操动画切换
        self._startExerciseAnimation();

        if (isForceLock) {
            self._startLockCountdown();
        } else {
            // 普通休息：点击关闭
            var closeBtn = document.getElementById('healthRestClose');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    self._closeRestModal();
                });
            }
            // 10秒后自动可关闭（但弹窗不自动消失）
            setTimeout(function() {
                if (closeBtn) {
                    closeBtn.textContent = '✅ 去休息';
                    closeBtn.classList.add('ready');
                }
            }, 5000);
        }

        // 记录日志
        if (typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-reminder',
                isForceLock ? '健康守护：强制锁定触发（连续工作超' + self._config.forceLockHours + '小时）'
                            : '健康守护：休息提醒（每' + self._config.intervalMinutes + '分钟）');
        }
    },

    // ===== 启动体操动画切换 =====
    _startExerciseAnimation: function() {
        var self = this;
        if (self._exerciseTimer) clearInterval(self._exerciseTimer);
        self._exerciseTimer = setInterval(function() {
            var figure = document.getElementById('exerciseFigure');
            var label = document.getElementById('exerciseLabel');
            var tip = document.getElementById('exerciseTip');
            if (!figure) {
                clearInterval(self._exerciseTimer);
                self._exerciseTimer = null;
                return;
            }
            self._exerciseAnimIdx++;
            var action = self._exerciseActions[self._exerciseAnimIdx % self._exerciseActions.length];
            // 移除所有动作 class
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
        }, 5000); // 每5秒切换一个动作
    },

    // ===== 显示强制锁定 =====
    _showForceLock: function() {
        var self = this;
        self._isLocked = true;
        self._lockEndTime = Date.now() + (self._config.forceLockMinutes || 10) * 60 * 1000;

        // 显示锁定弹窗
        self._showRestModal(true);

        // 隐藏所有输入区域（禁用发送）
        self._disableAllInputs();

        // 启动锁定倒计时
        self._startLockCountdown();
    },

    // ===== 启动锁定倒计时 =====
    _startLockCountdown: function() {
        var self = this;
        if (self._countdownTimer) clearInterval(self._countdownTimer);
        self._countdownTimer = setInterval(function() {
            var remaining = Math.max(0, self._lockEndTime - Date.now());
            var mins = Math.floor(remaining / 60000);
            var secs = Math.floor((remaining % 60000) / 1000);
            var el = document.getElementById('healthLockCountdown');
            if (el) {
                el.textContent = '剩余休息时间: ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
            }
            if (remaining <= 0) {
                clearInterval(self._countdownTimer);
                self._countdownTimer = null;
                self._endForceLock();
            }
        }, 500);
    },

    // ===== 结束强制锁定 =====
    _endForceLock: function() {
        var self = this;
        self._isLocked = false;
        self._lockEndTime = 0;
        self._workStart = Date.now(); // 重置工作开始时间

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
        // 重置工作开始时间
        self._lastRestTime = Date.now();
    },

    // ===== 禁用所有输入（强制锁定时） =====
    _disableAllInputs: function() {
        // 禁用所有对话框的输入框和发送按钮
        var inputs = document.querySelectorAll('.chat-input');
        var sendBtns = document.querySelectorAll('.chat-send-btn');
        var quickInputs = document.querySelectorAll('.quick-input');
        inputs.forEach(function(el) {
            el.setAttribute('disabled', 'true');
            el.setAttribute('placeholder', '🔒 强制休息中，请先完成休息');
        });
        sendBtns.forEach(function(el) {
            el.setAttribute('disabled', 'true');
            el.style.opacity = '0.5';
            el.style.pointerEvents = 'none';
        });
        quickInputs.forEach(function(el) {
            el.setAttribute('disabled', 'true');
        });
    },

    // ===== 恢复所有输入 =====
    _enableAllInputs: function() {
        var inputs = document.querySelectorAll('.chat-input');
        var sendBtns = document.querySelectorAll('.chat-send-btn');
        var quickInputs = document.querySelectorAll('.quick-input');
        inputs.forEach(function(el) {
            el.removeAttribute('disabled');
            el.setAttribute('placeholder', '输入消息，Enter发送...');
        });
        sendBtns.forEach(function(el) {
            el.removeAttribute('disabled');
            el.style.opacity = '';
            el.style.pointerEvents = '';
        });
        quickInputs.forEach(function(el) {
            el.removeAttribute('disabled');
        });
    },

    // ===== 检查是否被锁定（供 sendToModel 调用） =====
    isLocked: function() {
        return this._isLocked;
    },

    // ===== 获取剩余锁定时间（秒） =====
    getLockRemaining: function() {
        if (!this._isLocked) return 0;
        return Math.max(0, Math.floor((this._lockEndTime - Date.now()) / 1000));
    },

    // ===== 获取状态摘要 =====
    getStatusText: function() {
        var elapsed = Math.floor((Date.now() - this._workStart) / 60000);
        var nextRest = (this._config.intervalMinutes || 30) - Math.floor((Date.now() - this._lastRestTime) / 60000);
        if (this._isLocked) {
            var remain = Math.ceil(this.getLockRemaining() / 60);
            return '强制休息中 (' + remain + '分钟)';
        }
        return '工作' + elapsed + '分钟 · 下次提醒' + Math.max(0, nextRest) + '分钟';
    }
};
