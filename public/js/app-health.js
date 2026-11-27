// ========== app-health.js - 健康守护（纯报时器模式） =========
// 规则（2026-09-09 定：与对话系统完全解耦，只是给"人"的报时提醒）：
// 1. 每隔 intervalMinutes（30~60分钟）弹出休息提醒，单按钮：点击后进入宽限期
// 2. 关闭后继续工作满 graceMinutes(10分钟) → 弹出强制休息倒计时（无按钮，到点自动结束）
//    ——不再禁用任何输入、不拦截发送、不暂停 Agent 循环；对话照常可用
// 3. 所有计时只在"人在"（有鼠标/键盘活动）时走，人离开计时暂停，回来继续
// 4. 倒计时用 Web Worker 计时：人离开电脑也照样走，到点自动消失
// 5. 设置面板可调间隔，仅限 30~60 分钟

var HealthGuard = {

    // ===== 配置（强制启用，间隔可调 30~60） =====
    _config: {
        intervalMinutes: 30,     // 休息提醒间隔（分钟），30~60
        forceLockMinutes: 10,    // 强制锁定（休息）时长（分钟）
        voiceEnabled: true,      // 语音播报开关（默认开，多实例只有抢到锁的实例发声）
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
    _isCountingDown: false,      // 是否处于 3-2-1 预警倒计时阶段
    _preLockFailsafeTimer: null, // 3-2-1 预警硬兜底定时器（时钟源全挂时强制收口）
    _lockTotalSeconds: 0,        // 本次锁定总时长（进度条用）
    _titleFlashTimer: null,      // 后台标题闪烁定时器

    // 人在不在检测（2026-09-23 修订 2：修复"人在其他软件工作、网页整天在后台→一天不提醒"）：
    // 浏览器收不到 OS 级输入事件，网页在后台时 input 事件天然为零——
    // 若依赖"零输入→人离开"，用户在别的软件干活时会永远被判离开、计时暂停。
    // 因此：只有页面【可见】时的输入才用于判活；页面不可见时，
    // 一律视为"人在电脑前"（久坐提醒恰恰针对这种场景），照常计时、照常提醒，
    // 靠 系统通知 + 标题闪烁 + 声音 兜底（页面被挡住时人能看到通知）。
    // 真正离开（锁屏/合盖离开电脑）时页面也不可见，计时会继续——这是有意取舍：
    // 宁可多提醒一次，也不能整天不提醒。彻底离开可手动点"离开一下"暂停。
    _IDLE_THRESHOLD_SEC: 300,
    // 用户离开超过该秒数（10分钟）→ 工作计时清零（人已经休息过了）
    _IDLE_RESET_SEC: 600,
    _lastActivityTime: Date.now(),
    _lastInputTs: 0,
    _lastTickTime: 0,
    _lastVisibilityState: 'visible',

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
                // 节流：1 秒内多次输入只记录一次，减少高频 mousemove 的开销
                var now = Date.now();
                if (now - self._lastInputTs > 1000) {
                    self._lastInputTs = now;
                    self._lastActivityTime = now;
                    self._restResetDone = false; // 人回来了，休息清零标志复位，下个周期可再次触发
                }
            }, { passive: true });
        });
        // 首次用户手势时机预申请系统通知权限（2026-09-23 新增）：
        // Notification.requestPermission 必须在用户手势上下文调用才可靠，
        // 提前到用户第一次点击/按键时就申请，到点提醒才能直接弹系统通知
        if ('Notification' in window && Notification.permission === 'default') {
            var _reqPerm = function() {
                try { Notification.requestPermission().catch(function() {}); } catch (e) {}
                ['mousedown', 'keydown', 'touchstart'].forEach(function(evt) {
                    document.removeEventListener(evt, _reqPerm);
                });
            };
            ['mousedown', 'keydown', 'touchstart'].forEach(function(evt) {
                document.addEventListener(evt, _reqPerm, { once: false, passive: true });
            });
        }
        this.loadConfig(function() {
            // 数据库持久化：启动时从服务端恢复今日已活跃秒数（跨刷新累计，跨天清零）
            try {
                fetch('/api/health/state').then(function(r) { return r.json(); }).then(function(d) {
                    if (d && d.ok && d.active_seconds > self._activeWorkSeconds) {
                        self._activeWorkSeconds = d.active_seconds;
                    }
                }).catch(function() {});
            } catch (e) {}
            self.startTimer();
        });
    },

    // ===== 人在吗？ =====
    // 规则（2026-09-25 修订：修复"睡觉/离开后回来计时不清零→秒弹提醒"）：
    // 页面可见 → 用真实输入判活：连续 _IDLE_THRESHOLD_SEC(15分钟) 无鼠标/键盘/滚动
    //   → 判定人已离开（睡觉/看视频/走开了），工作计时走 _tick 的清零分支；
    // 页面在后台（用户在用其他软件工作，网页被挡住/最小化）→ 仍然算"人在电脑前"，
    //   浏览器收不到 OS 级输入，不能靠"零输入"判离开；
    //   久坐提醒恰恰针对这种场景，不能因为网页在后台就暂停计时；
    // 页面后台到点提醒时，通过 系统通知 + 标题闪烁 + 声音 提醒（弹窗切回来也能看到）。
    _IDLE_THRESHOLD_SEC: 900,

    _isUserActive: function() {
        // 页面在后台 → 人在用其他软件，算"人在电脑前"（久坐提醒主场景）
        if (document.visibilityState !== 'visible') return true;
        // 页面可见 → 用真实输入判活（可见时浏览器能收到鼠标/键盘/滚动事件，
        // _lastActivityTime 会被持续刷新；零输入超过 15 分钟 = 人走开/睡觉了）
        return (Date.now() - this._lastActivityTime) < this._IDLE_THRESHOLD_SEC * 1000;
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
                    if (cfg.voiceEnabled !== undefined) self._config.voiceEnabled = !!cfg.voiceEnabled;
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
        // 5 秒一次主循环（增量计时，降低定时器/判空开销，监测精度仍为秒级）
        self._lastTickTime = Date.now();
        self._tickTimer = setInterval(function() { self._tick(); }, 5000);
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
        if (self._isCountingDown) return; // 3-2-1 预警期间不计锁定时间
        if (self._isLocked) {
            // 锁定中：倒计时由 Web Worker/降级定时器（_lockTick）统一每秒递减，这里不重复递减。
            // 但要防"时钟源全部静默死亡"：超 5 秒无 tick（或从未 tick 过——2026-11-07 修复，
            // 旧逻辑 _lastLockTickTs 为空时看门狗永远不启动，导致剩余时间一直不减）就强制补 setInterval 兜底
            var nowTs = Date.now();
            var lastTick = self._lastLockTickTs || (self._lockDeadlineTs ? self._lockDeadlineTs - self._lockTotalSeconds * 1000 : 0);
            if (self._lockRemainSeconds > 0 && !self._countdownTimer
                && nowTs - lastTick > 5000) {
                self._stopLockClock();
                self._countdownTimer = setInterval(function() { self._lockTick(); }, 1000);
                self._lockTick();
            }
            return;
        }
        // 【2026-09-28 休息即清零】页面可见 + 鼠标/键盘零输入满 _IDLE_RESET_SEC(10分钟)
        // = 人已经离开休息过了（画布 x/y 停着不动）。无论当前处于正常周期还是
        // "再干一会儿"宽限期（_snoozeUsed），一律整周期清零 + 给回来缓冲，
        // 防"休息完一回来干一会儿又被要求再次休息"。
        // 注意：必须独立于 _isUserActive() 的 15 分钟判活阈值提前判断，
        // 否则 10~15 分钟之间的休息检测不到，宽限状态会残留到人回来。
        if (document.visibilityState === 'visible') {
            var restSec = (Date.now() - self._lastActivityTime) / 1000;
            if (restSec >= self._IDLE_RESET_SEC && !self._restResetDone) {
                self._restResetDone = true; // 一次性标志：休息完成清零只执行一次
                var hadCycle = self._activeWorkSeconds > 0 || self._snoozeUsed;
                self._zeroCycle(hadCycle,
                    '健康守护：检测到人已离开休息超过10分钟，本周期（含宽限状态）已清零，回来后重新计时');
                self._lastTickTime = Date.now();
                return;
            }
        }
        if (self._isUserActive()) {
            // 人回来了，清零离开计时
            self._idleSeconds = 0;
        } else {
            // 人离开：不靠逐秒累加（后台标签页定时器会被浏览器节流/暂停，
            // 累加永远到不了阈值），改为用真实时间戳直接计算离开时长
            var idleSec = (Date.now() - self._lastActivityTime) / 1000;
            if (idleSec >= self._IDLE_RESET_SEC) {
                var hadWork = self._activeWorkSeconds > 0;
                self._zeroCycle(hadWork, '健康守护：用户离开超过10分钟，工作计时已清零');
            }
            // 离开期间同步推进基准时间，防止回来后第一轮 delta 被封顶误加 10 秒
            self._lastTickTime = Date.now();
            return; // 人离开，工作计时暂停
        }

        // 增量计时：用两次 tick 的真实间隔累加，5 秒循环也保持秒级精度
        var now = Date.now();
        var delta = Math.min(Math.round((now - self._lastTickTime) / 1000), 10);
        self._lastTickTime = now;
        self._activeWorkSeconds += delta;
        // 数据库心跳：每 30 秒把活跃秒数上报服务端落库（失败静默，不影响本地计时）
        self._hbCount = (self._hbCount || 0) + delta;
        if (self._hbCount >= 30) {
            self._hbCount = 0;
            try {
                fetch('/api/health/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active_seconds: self._activeWorkSeconds })
                }).catch(function() {});
            } catch (e) {}
        }
        if (self._snoozeUsed) self._graceSeconds += delta;

        var intervalSec = (self._config.intervalMinutes || 30) * 60;
        var graceSec = (self._config.graceMinutes || 10) * 60;

        // 回来缓冲（2026-09-25）：离开被清零后，至少重新干满 20 分钟才允许提醒
        var BACK_BUFFER_SEC = 20 * 60;
        if (self._backBufferSeconds !== undefined && self._backBufferSeconds !== null) {
            self._backBufferSeconds += delta;
            if (self._backBufferSeconds < BACK_BUFFER_SEC) {
                return; // 缓冲期内不弹提醒、不进入宽限
            }
            self._backBufferSeconds = null; // 缓冲结束，恢复正常提醒
        }

        // 已用过"再干一会儿"且又干了 graceMinutes → 强制锁定
        if (self._snoozeUsed && self._graceSeconds >= graceSec) {
            self._showForceLock();
            return;
        }
        // 到达提醒间隔：先向服务端抢全局冷却锁（多实例对齐）
        // 只有抢到锁的实例弹窗+语音，其他实例/端口静默顺延 5 分钟
        if (self._activeWorkSeconds >= intervalSec) {
            self._acquireRemindLock(function(acquired) {
                if (acquired) {
                    self._showRestReminder();
                } else {
                    // 未抢到：顺延 5 分钟后再试，本轮工作计时退回 5 分钟
                    self._activeWorkSeconds = Math.max(0, self._activeWorkSeconds - 300);
                }
            });
        }
    },

    // ===== 多实例冷却锁：到点弹窗前先抢服务端全局锁 =====
    _acquireRemindLock: function(callback) {
        var self = this;
        try {
            fetch('/api/health/remind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ intervalMinutes: self._config.intervalMinutes || 30 })
            })
                .then(function(res) { return res.json(); })
                .then(function(data) { callback(!!(data && data.acquired)); })
                .catch(function() { callback(true); }); // 接口故障放行，不影响主功能
        } catch (e) { callback(true); }
    },

    // ===== 显示休息提醒弹窗 =====
    _zeroCycle: function(needLog, logMsg) {
        this._activeWorkSeconds = 0;
        this._graceSeconds = 0;
        this._snoozeUsed = false;
        this._idleSeconds = 0;
        // 回来缓冲：清零后至少重新干满 20 分钟才允许再提醒（防"离开半天刚坐下就被赶走"）
        this._backBufferSeconds = 0;
        if (needLog && typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-reset', logMsg);
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
        var awayTag = ''; // 2026-09-23：后台不再判"人不在"，始终计时
        return '活跃工作' + Math.floor(this._activeWorkSeconds / 60) + '分钟 · 下次提醒' + nextRest + '分钟' + awayTag;
    }
};
