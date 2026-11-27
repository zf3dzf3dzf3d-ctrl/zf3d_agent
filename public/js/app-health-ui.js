// ========== app-health-ui.js - 健康守护 UI 模块（提醒弹窗/语音/通知/休息画面/体操动画） ==========
Object.assign(HealthGuard, {
    _showRestReminder: function() {
        var self = this;
        // 本次周期第二次提醒（没用过再干一会儿却到了两次间隔）直接强制锁
        if (self._snoozeUsed) {
            self._showForceLock();
            return;
        }
        self._showRestModal(false);
        self._speak('reminder'); // 语音：主人，请休息一下吧
        self._notifyBackground('⏰ 该休息一下啦', '你已连续工作 ' + self._config.intervalMinutes + ' 分钟，起来活动一下吧~');
        try {
            fetch('/api/health/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'reminder', work_seconds: self._activeWorkSeconds, detail: '休息提醒' })
            }).catch(function() {});
        } catch (e) {}
        if (typeof Store !== 'undefined') {
            Store.addLog('info', '', 'health-reminder',
                '健康守护：休息提醒（每' + self._config.intervalMinutes + '分钟，工作计时仅计活跃时间）');
        }
    },

    // ===== 语音播报（speechSynthesis，纯前端零成本）=====
    // 分级文案随机轮换防机械；无中文语音包或关闭开关时静默跳过。
    _VOICE_LINES: {
        reminder: ['主人，请休息一下吧', '主人，已经工作很久啦，起来活动活动吧', '该休息咯，主人～'],
        grace: ['主人休息吧，你最多再工作十分钟了哦', '最后十分钟啦，主人抓紧收个尾哦', '再给你十分钟，之后可要强制休息了哦'],
        lock: ['好啦，现在必须休息啦', '时间到，主人必须休息啦', '休息时间到，屏幕拜拜～']
    },
    _speak: function(level) {
        var self = this;
        if (!self._config.voiceEnabled) return; // 面板开关（默认开）
        try {
            var lines = self._VOICE_LINES[level] || self._VOICE_LINES.reminder;
            var text = lines[Math.floor(Math.random() * lines.length)];
            // 【2026-09-27】与任务成功播报同款声音：优先走 /api/tts 微软在线合成
            // （默认音色晓萱 zh-CN-XiaoxuanNeural，和 tts.js 一致），失败回退本地 speechSynthesis
            var speakLocal = function() {
                try {
                    if (!('speechSynthesis' in window)) return;
                    var synth = window.speechSynthesis;
                    synth.cancel(); // 清队列，防叠加
                    var pickVoice = function() {
                        var vs = synth.getVoices() || [];
                        for (var i = 0; i < vs.length; i++) {
                            if (/^zh(\b|[-_])/i.test(vs[i].lang)) return vs[i];
                        }
                        return null; // 无中文音色：静默跳过（仍有弹窗+提示音兜底）
                    };
                    var doSpeak = function() {
                        var v = pickVoice();
                        if (!v) return;
                        var u = new SpeechSynthesisUtterance(text);
                        if (v) u.voice = v;
                        u.lang = v ? v.lang : 'zh-CN';
                        u.rate = 1; u.pitch = 1.05; u.volume = 1;
                        synth.speak(u);
                    };
                    // voices 异步加载：首次可能为空，监听 voiceschanged 补发
                    var v0 = pickVoice();
                    if (v0) { doSpeak(); }
                    else {
                        var onVoices = function() {
                            synth.removeEventListener('voiceschanged', onVoices);
                            doSpeak();
                        };
                        synth.addEventListener('voiceschanged', onVoices);
                        setTimeout(function() { synth.removeEventListener('voiceschanged', onVoices); }, 3000);
                    }
                } catch (e) {}
            };
            var speakOnline = function() {
                try {
                    // 【语音排队】挂全局语音队列（与 tts.js 共用 window.__zfVoiceChain），排队依次播，不打架
                    window.__zfVoiceChain = (window.__zfVoiceChain || Promise.resolve()).then(function() {
                        return new Promise(function(resolve) {
                            var done = false;
                            var finish = function() { if (!done) { done = true; resolve(); } };
                            setTimeout(finish, 40000); // 40 秒保险，防单条卡死队列
                            speakOnlineNow(finish);
                        });
                    }).catch(function() {});
                } catch (e) { speakLocal(); }
            };
            var speakOnlineNow = function(onFinish) {
                try {
                    if (!('speechSynthesis' in window)) { speakLocal(); onFinish && onFinish(); return; }
                    // 读 tts.js 同款音色设置（晓萱），拿不到就默认晓萱
                    var voice = null;
                    try { voice = localStorage.getItem('zfagent_tts_voice'); } catch (e) {}
                    if (!voice || voice === 'zh-CN-YaoyaoNeural' || voice === 'zh-CN-XiaoxiaoNeural' || voice === 'zh-CN-XiaoyiNeural') voice = 'zh-CN-XiaoxuanNeural';
                    var ctrl = ('AbortController' in window) ? new AbortController() : null;
                    var timer = ctrl ? setTimeout(function() { try { ctrl.abort(); } catch (e) {} }, 8000) : null;
                    fetch('/api/tts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: text, voice: voice }),
                        signal: ctrl ? ctrl.signal : undefined
                    })
                        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                        .then(function(buf) {
                            if (timer) clearTimeout(timer);
                            try {
                                if (!buf || buf.byteLength < 100) { speakLocal(); onFinish && onFinish(); return; } // 空音频兜底
                                if (window.speechSynthesis) window.speechSynthesis.cancel();
                                var url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
                                var audio = new Audio(url);
                                audio.volume = 1;
                                audio.onended = function() { try { URL.revokeObjectURL(url); } catch (e) {} onFinish && onFinish(); };
                                audio.onerror = function() { try { URL.revokeObjectURL(url); } catch (e) {} speakLocal(); onFinish && onFinish(); };
                                audio.play();
                                window.__healthTtsAudio = audio;
                            } catch (e) { speakLocal(); onFinish && onFinish(); }
                        })
                        .catch(function() {
                            if (timer) clearTimeout(timer);
                            speakLocal();
                            onFinish && onFinish();
                        });
                } catch (e) { speakLocal(); onFinish && onFinish(); }
            };
            speakOnline();
        } catch (e) {}
    },

    // ===== 后台兜底提醒：系统通知 + 标题闪烁（2026-09-23 新增）=====
    // 此前 _notifyBackground 只有调用没有定义（静默 TypeError，通知从未发出过）。
    // 页面被其他软件挡住时，这是唯一能让用户看到提醒的通道。
    _notifyBackground: function(title, body) {
        var self = this;
        // 1) 系统通知（需要权限；首次在任何用户手势时机申请）
        try {
            if ('Notification' in window) {
                if (Notification.permission === 'granted') {
                    var n = new Notification(title, { body: body, tag: 'health-guard', requireInteraction: true });
                    n.onclick = function() { try { window.focus(); n.close(); } catch (e) {} };
                } else if (Notification.permission !== 'denied') {
                    // 未申请过：本次先请求，成功则立即补发这条通知
                    Notification.requestPermission().then(function(p) {
                        if (p === 'granted') {
                            try {
                                var n2 = new Notification(title, { body: body, tag: 'health-guard', requireInteraction: true });
                                n2.onclick = function() { try { window.focus(); n2.close(); } catch (e) {} };
                            } catch (e) {}
                        }
                    }).catch(function() {});
                }
            }
        } catch (e) {}
        // 2) 标题闪烁（页面在后台时浏览器标签页上也能看到）
        if (document.visibilityState !== 'visible') {
            var origTitle = document.title;
            var flash = ['⏰ 该休息了！', '⏰⏰ ' + title];
            var fi = 0;
            if (self._titleFlashTimer) clearInterval(self._titleFlashTimer);
            self._titleFlashTimer = setInterval(function() {
                document.title = flash[fi++ % 2];
                // 人回到页面后停止闪烁并恢复标题
                if (document.visibilityState === 'visible') {
                    clearInterval(self._titleFlashTimer);
                    self._titleFlashTimer = null;
                    document.title = origTitle;
                }
            }, 1000);
        }
        // 3) 声音（系统提示音，失败静默）
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 880; gain.gain.value = 0.08;
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
            osc.stop(ctx.currentTime + 0.6);
            setTimeout(function() { try { ctx.close(); } catch (e) {} }, 1000);
        } catch (e) {}
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
        // 沉浸休息模式（2026-09-09 用户定规则）：强制休息时画面铺满全屏、
        // 背景暗色模糊，形成"该离开屏幕休息了"的沉浸氛围；
        // 网络与对话不中断（不禁用输入、不拦截发送），无按钮，到点自动结束。
        if (isForceLock) {
            modal.classList.add('force-fullscreen');
        }

        var action = self._exerciseActions[self._exerciseAnimIdx % self._exerciseActions.length];

        var buttonsHtml;
        if (isForceLock) {
            // 报时器语义（2026-09-09 用户定规则）：只提醒不强制，人可随时跳过。
            // 不再禁用输入、不影响任何对话——对话系统与此模块完全无关。
            buttonsHtml = ''; // 2026-09-11: 强制休息无按钮，到点自动结束
        } else {
            // 2026-09-26 用户定规则：单按钮单线流程，无可选项。
            // 点了唯一按钮 → 宽限 graceMinutes 倒计时 → 到点必然强制休息。
            buttonsHtml =
                '<button class="health-btn health-btn-primary" id="healthRestClose">知道了（' + self._config.graceMinutes + '分钟后强制休息）</button>';
        }

        modal.innerHTML =
            '<div class="health-rest-box' + (isForceLock ? ' force-lock' : '') + '">' +
                '<div class="health-rest-header">' +
                    (isForceLock
                        ? '<span class="health-rest-title">⏰ 休息时间提醒</span>'
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
                        ? '<div class="health-lock-countdown" id="healthLockCountdown">剩余休息时间: ' + self._config.forceLockMinutes + ':00</div>' +
                          '<div class="health-rest-progress"><div class="health-rest-progress-fill" id="healthRestProgress"></div></div>'
                        : '<div class="health-rest-tip">💡 已连续活跃工作 ' + Math.floor(self._activeWorkSeconds / 60) + ' 分钟（离开电脑的时间不计时）</div>') +
                '</div>' +
                '<div class="health-rest-actions">' + buttonsHtml + '</div>' +
            '</div>';

        document.body.appendChild(modal);

        // 2026-XX 修复：健康弹窗 z-index(2147483647) 高于窗口控制条(2147483000)，
        // 会盖住右上角最小化/最大化/关闭按钮，导致弹窗期间窗口无法操作。
        // 把控制条临时挂到弹窗内部（后插入者在上），弹窗关闭时再放回 body。
        self._dockWinCtrlInto(modal);

        // 启动体操动画切换
        self._startExerciseAnimation();

        if (isForceLock) {
            self._startLockCountdown();
            // 报时器：人可随时跳过休息（立即结束提醒并关弹窗），不强制、不影响对话
            var skipBtn = document.getElementById('healthSkipRestBtn');
            if (skipBtn) {
                skipBtn.addEventListener('click', function() {
                    if (typeof Store !== 'undefined') {
                        Store.addLog('info', '', 'health-skip',
                            '健康守护：用户跳过休息立即继续（报时提醒，不强制）');
                    }
                    self._endForceLock();
                    self._closeRestModal();
                });
            }
        } else {
            // 2026-10-11 修复"知道了（再干一会儿）按钮点不动"：改为弹窗级事件委托。
            // 旧写法逐个 getElementById 绑定，一旦按钮因任何原因被重建/克隆（样式热更新、
            // 框架补丁、防重复渲染等），绑定就丢，按钮看起来完全无响应。
            // 委托绑在弹窗容器上，冒泡天然覆盖任何重建出的同名按钮。
            modal.addEventListener('click', function(ev) {
                var btnId = ev.target && ev.target.id;
                if (btnId !== 'healthRestClose' && btnId !== 'healthSnoozeBtn') return;
                // 2026-09-23 修订：关闭提醒不再直接重置周期（否则永远到不了强制休息）。
                // 无论怎么关，都进入 graceMinutes 宽限倒计时，宽限一到必然强制休息。
                self._snoozeUsed = true;
                self._graceSeconds = 0;
                self._activeWorkSeconds = 0;
                self._closeRestModal();
                self._refreshNavViews();
                self._speak('grace'); // 宽限警告也语音播报（收口修复：grace 级原无调用点）
                if (typeof Store !== 'undefined') {
                    Store.addLog('info', '', 'health-snooze',
                        btnId === 'healthSnoozeBtn'
                            ? '健康守护：选择"再干一会儿"，' + self._config.graceMinutes + '分钟后将强制锁定'
                            : '健康守护：提醒已确认，' + self._config.graceMinutes + '分钟后将强制休息（到点自动停止）');
                }
            });
        }
    },

    // ===== 整周期清零（休息/离开检测共用，消除 _tick 内两处重复赋值） =====
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
        self._speak('lock'); // 语音：好啦，现在必须休息啦
        // 先播 3-2-1 预警动画，让人有心理预期，倒计时结束再进入休息画面
        self._startPreLockCountdown();
    },

    // ===== 3-2-1 预警倒计时（全屏数字动画，数完进入休息画面） =====
});
