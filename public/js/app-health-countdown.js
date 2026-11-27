// ========== app-health-countdown.js - 健康守护倒计时模块（3-2-1预警/时钟工厂/强制锁定） ==========
Object.assign(HealthGuard, {
    _startPreLockCountdown: function() {
        var self = this;
        var overlay = self._buildCountdownOverlay();
        if (!overlay) return; // 已有预警遮罩则不重复启动
        self._runCountdownClock(overlay);
    },

    // ===== 构建 3-2-1 预警遮罩（DOM 创建 + 窗口控制条 dock，返回遮罩元素） =====
    _buildCountdownOverlay: function() {
        var self = this;
        if (document.getElementById('healthCountdownOverlay')) return null;

        // 移除可能存在的普通提醒弹窗（先还原窗口控制条，防止随弹窗一起被删）
        var old = document.getElementById('healthRestModal');
        if (old && old.parentNode) { self._undockWinCtrl(); old.parentNode.removeChild(old); }

        self._isCountingDown = true;
        var overlay = document.createElement('div');
        overlay.id = 'healthCountdownOverlay';
        overlay.className = 'health-countdown-overlay';
        overlay.innerHTML = '<div class="health-countdown-num" id="healthCountdownNum">3</div>';
        document.body.appendChild(overlay);
        // 3-2-1 预警同样全屏盖住窗口控制条，临时挪进来保证按钮可点
        self._dockWinCtrlInto(overlay);
        return overlay;
    },

    // ===== 驱动 3-2-1 倒计时状态机（时钟接入 + 幂等 finish + 8 秒硬兜底） =====
    _runCountdownClock: function(overlay) {
        var self = this;
        var n = 3;
        var numEl = document.getElementById('healthCountdownNum');
        // 幂等 finish + 硬兜底：无论 Worker/降级定时器哪条路挂了（含后台标签页被浏览器冻结定时器），
        // 8 秒内没数完 3 个数就强制收口进入休息画面，绝不卡在 3-2-1（2026-11-07 修复卡在"3"）
        var finished = false;
        var finish = function() {
            if (finished) return;
            finished = true;
            if (self._preLockFailsafeTimer) { clearTimeout(self._preLockFailsafeTimer); self._preLockFailsafeTimer = null; }
            self._stopWarnWorkerClock(); // 停掉预警时钟，防止 finish 被重复触发导致锁定无限重置
            overlay.classList.add('health-countdown-out');
            setTimeout(function() {
                // 先还原窗口控制条再删遮罩，防止控制条随遮罩一起被移出 DOM（消失 bug 根因）
                self._undockWinCtrl();
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                self._isCountingDown = false;
                self._enterForceLock();
            }, 450);
        };
        var step = function() {
            n--;
            if (n <= 0) { finish(); return; }
            if (numEl) {
                numEl.textContent = String(n);
                numEl.classList.remove('pop');
                void numEl.offsetWidth; // 重置动画
                numEl.classList.add('pop');
            }
        };
        // 3-2-1 预警也用 Web Worker 计时：setInterval 在后台标签页会被浏览器节流/暂停，
        // 导致切窗口后数字卡住不动；Worker 不受节流，切到任何窗口都照常倒数。
        if (numEl) numEl.classList.add('pop');
        self._startWarnWorkerClock(step);
        // 硬兜底：预警总共只需 3 秒，给 8 秒上限。若时钟源全部失效（Worker 静默死亡 + 后台定时器被冻结），
        // 到点直接强制收口，画面不会永远停在"3"
        if (self._preLockFailsafeTimer) clearTimeout(self._preLockFailsafeTimer);
        self._preLockFailsafeTimer = setTimeout(finish, 8000);
    },

    // ===== 不受节流的时钟源工厂（Blob 内联 Web Worker + 看门狗降级，预警/锁定共用） =====
    // 背景：setInterval 在后台标签页会被浏览器节流/暂停；Worker 不受节流但个别 WebView 会静默失联。
    // 工厂统一封装：Worker 创建 → 3 秒内无 tick 自动降级 setInterval → stop() 统一清理。
    _makeThrottleProofClock: function(onTick) {
        var worker = null, fallbackTimer = null, watchdogTimer = null, stopped = false;
        var stop = function() {
            stopped = true;
            if (worker) { worker.terminate(); worker = null; }
            if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
            if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
        };
        var startFallback = function() {
            if (stopped || fallbackTimer) return;
            fallbackTimer = setInterval(onTick, 1000);
        };
        try {
            // 【已审计】Blob 内联 Worker 时钟源：代码为固定字符串字面量（仅 setInterval 计时），无外部输入，安全
            var blob = new Blob(['var t=null;onmessage=function(e){if(e.data==="start"){t=setInterval(function(){postMessage("tick")},1000)}else{clearInterval(t)}}'], { type: 'application/javascript' });
            var wUrl = URL.createObjectURL(blob);
            worker = new Worker(wUrl);
            try { URL.revokeObjectURL(wUrl); } catch (e) {}
            // 看门狗：Worker 创建成功但 3 秒内收不到 tick（静默失联）时，自动停掉 Worker 降级 setInterval
            var gotTick = false;
            worker.onmessage = function() {
                gotTick = true;
                if (!stopped) onTick();
            };
            worker.postMessage('start');
            watchdogTimer = setTimeout(function() {
                if (!gotTick && worker && !stopped) {
                    worker.terminate(); worker = null;
                    startFallback();
                }
            }, 3000);
        } catch (e) {
            // Worker 不可用时退回 setInterval（仅前台正常，极端兼容场景）
            startFallback();
        }
        return { stop: stop };
    },

    // ===== 预警时钟（工厂实例化） =====
    _warnClock: null,
    _startWarnWorkerClock: function(onTick) {
        this._stopWarnWorkerClock();
        this._warnClock = this._makeThrottleProofClock(onTick);
    },
    _stopWarnWorkerClock: function() {
        if (this._warnClock) { this._warnClock.stop(); this._warnClock = null; }
    },

    // ===== 进入强制休息（全屏沉浸画面） =====
    _enterForceLock: function() {
        var self = this;
        self._isLocked = true;
        self._lockTotalSeconds = (self._config.forceLockMinutes || 10) * 60;
        self._lockRemainSeconds = self._lockTotalSeconds;
        // 【2026-11-07 修复"剩余休息时间一直是10分钟不减少"】：改为截止时间戳计算剩余秒数。
        // 旧实现靠 _lockTick 每秒递减 1，一旦时钟源静默死亡且看门狗因 _lastLockTickTs
        // 为空无法启动，剩余秒数永远不动。现在哪怕 tick 被节流/暂停，任何一次恢复的
        // tick 都能按真实时间算出正确剩余值，不会卡死。
        self._lockDeadlineTs = Date.now() + self._lockTotalSeconds * 1000;
        self._lastLockTickTs = Date.now(); // 立即赋初值，保证 _tick 看门狗始终可用

        // 显示锁定弹窗（全屏沉浸、置顶）
        self._showRestModal(true);

        // 报时器（2026-09-09 用户定规则）：不禁用任何输入。
        // 网络继续、对话继续、AI 循环照常可用——画面只是提醒人去休息。

        // 启动锁定倒计时
        self._startLockCountdown();

        if (typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-force-lock',
                '健康守护：休息提醒触发（关闭提醒后连续工作超' + self._config.graceMinutes + '分钟），建议休息' + self._config.forceLockMinutes + '分钟（全屏沉浸提醒，可跳过，不影响对话）');
        }
        try {
            fetch('/api/health/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'force_lock', work_seconds: self._activeWorkSeconds, detail: '强制休息' + self._config.forceLockMinutes + '分钟' })
            }).catch(function() {});
        } catch (e) {}
    },

    // ===== 锁定倒计时（共用时钟工厂：Worker 计时，不受浏览器后台节流） =====
    _lockClock: null,
    _startLockCountdown: function() {
        var self = this;
        self._stopLockClock();
        self._lockClock = self._makeThrottleProofClock(function() { self._lockTick(); });
    },
    _stopLockClock: function() {
        if (this._lockClock) { this._lockClock.stop(); this._lockClock = null; }
    },
    _lockTick: function() {
        var self = this;
        // 【中途死亡看门狗】记录每次 tick 时间；主循环 _tick 检测锁定状态下超 5 秒无 tick
        // （Worker 中途静默死亡 + 降级定时器也被冻结）时自动切到 setInterval 兜底
        self._lastLockTickTs = Date.now();
        // 【2026-11-07 修复"剩余休息时间不减少"】按截止时间戳计算，不依赖逐次递减：
        // 时钟被节流后某一次恢复的 tick 也能算出真实剩余时间，避免一直显示满值
        var remainByDeadline = Math.round((self._lockDeadlineTs - Date.now()) / 1000);
        self._lockRemainSeconds = Math.max(0, Math.min(self._lockRemainSeconds - 1, remainByDeadline));
        var el = document.getElementById('healthLockCountdown');
        var mins = Math.floor(self._lockRemainSeconds / 60);
        var secs = self._lockRemainSeconds % 60;
        if (el) el.textContent = '剩余休息时间: ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
        // 休息进度条（随剩余时间推进）
        var bar = document.getElementById('healthRestProgress');
        if (bar && self._lockTotalSeconds > 0) {
            var pct = Math.min(100, ((self._lockTotalSeconds - self._lockRemainSeconds) / self._lockTotalSeconds) * 100);
            bar.style.width = pct + '%';
        }
        if (self._lockRemainSeconds <= 0) {
            self._stopLockClock();
            if (self._countdownTimer) { clearInterval(self._countdownTimer); self._countdownTimer = null; }
            self._endForceLock();
        }
    },

    // ===== 结束强制锁定 =====
    _endForceLock: function() {
        var self = this;
        // 统一收口锁定时钟：无论自然结束还是"跳过休息"，都停掉 Worker/定时器，
        // 防止跳过后残留的 _lockTick 再次触发 _endForceLock（重复日志/重复重置）
        self._stopLockClock();
        if (self._countdownTimer) { clearInterval(self._countdownTimer); self._countdownTimer = null; }
        self._isLocked = false;
        self._lockRemainSeconds = 0;
        self._resetCycle(); // 重置工作计时（内含导航刷新）

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

    // ===== 健康弹窗期间保持窗口控制条可点 =====
    // 兼容两种注入形态（2026-10-11 修复：控制按钮已改由 dom-topbar.js 注入顶栏右侧
    // .topbar-right（topbarMinBtn/topbarMaxBtn/topbarCloseBtn），#zfWinCtrl 已不存在——
    // 旧逻辑找不到目标就放弃，弹窗全屏遮罩(z 2147483647)盖住顶栏右侧(z 2147483001)，
    // 最小化/最大化/关闭被黑底挡住点不了。现在优先找 #zfWinCtrl，找不到则找 .topbar-right，
    // 弹窗期间临时移入遮罩内部（后插入者在上），关闭时移回原位。
    _winCtrlOriginalParent: null,
    _getWinCtrlBar: function() {
        return document.getElementById('zfWinCtrl') ||
               (document.body.classList.contains('zf-client')
                   ? document.querySelector('.topbar-right') : null);
    },
    _dockWinCtrlInto: function(container) {
        var bar = this._getWinCtrlBar();
        if (!bar || !container) return;
        if (this._winCtrlOriginalParent) return; // 已停靠，勿重复记录原父节点
        this._winCtrlOriginalParent = bar.parentNode;
        container.appendChild(bar); // appendChild 会自动从原位置搬移
    },
    _undockWinCtrl: function() {
        var bar = this._getWinCtrlBar();
        if (bar && this._winCtrlOriginalParent && bar.parentNode !== this._winCtrlOriginalParent) {
            this._winCtrlOriginalParent.appendChild(bar);
        }
        this._winCtrlOriginalParent = null;
        // 兜底：若控制条已不在 DOM 中（被遮罩连带给删了），按原样式重建一份放回 body，
        // 保证健康弹窗关闭后右上角最小化/最大化/关闭按钮一定还在。
        if (!this._getWinCtrlBar() && typeof window.zfRebuildWinCtrl === 'function') {
            try { window.zfRebuildWinCtrl(); } catch (e) {}
        }
    },

    // ===== 关闭休息弹窗 =====
    _closeRestModal: function() {
        var self = this;
        if (self._exerciseTimer) {
            clearInterval(self._exerciseTimer);
            self._exerciseTimer = null;
        }
        // 清理 3-2-1 预警（防止热更新/跳过时残留全屏遮罩）
        var warnOverlay = document.getElementById('healthCountdownOverlay');
        if (warnOverlay && warnOverlay.parentNode) warnOverlay.parentNode.removeChild(warnOverlay);
        self._stopWarnWorkerClock();
        if (self._preLockFailsafeTimer) { clearTimeout(self._preLockFailsafeTimer); self._preLockFailsafeTimer = null; }
        self._isCountingDown = false;

        var modal = document.getElementById('healthRestModal');
        if (modal) {
            // 先还原窗口控制条再删弹窗，防止控制条随弹窗一起被移出 DOM（消失 bug 根因）
            self._undockWinCtrl();
            modal.classList.add('closing');
            setTimeout(function() {
                if (modal.parentNode) modal.parentNode.removeChild(modal);
            }, 300);
        } else {
            // 弹窗已不存在（可能被硬删），仍尝试还原控制条
            self._undockWinCtrl();
        }
    }
});
