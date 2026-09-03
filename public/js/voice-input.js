// ===== 语音输入模块（Web Speech API）=====
// 功能：点击麦克风按钮开始语音识别，识别结果实时流式写入当前对话框的输入框；
//       支持多次说话（识别引擎 onend 自动重启，保持会话），静音数秒后自动停止。
// 依赖：浏览器 SpeechRecognition / webkitSpeechRecognition（Chrome / Edge / Safari）。
(function () {
    'use strict';

    // ===== 防重复加载：同一页面内只允许一个实例 =====
    if (window.__VOICE_INPUT_LOADED__) {
        // 重复加载（热更新重插 script 标签导致），静默跳过，不在控制台刷警告
        return;
    }
    window.__VOICE_INPUT_LOADED__ = true;

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var SILENCE_MS = 6000;          // 静音多少毫秒后自动停止
    // 支持语音输入的容器选择器：普通聊天框、插件面板、小狗守卫聊天窗、模型配置管家聊天窗、Tab 快速创建条
    var BOX_SELECTOR = '.chatbox, [data-voice-box], .dog-guard-chat, .mc-agent-window, #qcQuickBar';

    // ===== 浏览器不支持时：自动移除所有语音按钮（含后续动态创建的） =====
    function pruneUnsupported() {
        if (SR) return;
        var btns = document.querySelectorAll('.voice-btn');
        for (var i = 0; i < btns.length; i++) btns[i].remove();
    }
    pruneUnsupported();
    document.addEventListener('DOMContentLoaded', pruneUnsupported);
    new MutationObserver(pruneUnsupported).observe(document.documentElement, { childList: true, subtree: true });

    var RESTART_DELAY = 50;         // 引擎自动结束后重启延迟（越小接话越快）

    var state = {
        box: null,          // 当前录制的 chatbox 元素
        btn: null,          // 当前按钮
        rec: null,
        active: false,
        wantStop: false,
        baseText: '',       // 开始录音时输入框已有文字
        restartTimer: null,
        silenceTimer: null,
        lastResultAt: 0
    };

    function toast(msg) {
        if (window.App && typeof App.toast === 'function') { App.toast(msg); }
    }

    function getInput(box) { return box && (box.querySelector('textarea') || box.querySelector('input[type="text"]')); }

    function rebase(box) {
        var input = getInput(box);
        if (!input) return;
        state.baseText = (input.value || '').trim();
        if (state.baseText) state.baseText += ' ';
        state.lastWritten = input.value;
    }

    function writeInterim(box, finalText, interim) {
        var input = getInput(box);
        if (!input) return;
        // 已请求停止（如点击发送）后不再写入任何识别结果，避免残留文字回填到已清空的输入框
        if (state.wantStop) return;
        // 输入框内容被外部改动（用户手动编辑、发送清空等）：以当前内容为基准重新追加。
        // 注意不能直接丢弃 finalText/interim，否则正在送达的最终识别结果会丢失
        if (input.value !== state.lastWritten) rebase(box);
        var full = state.baseText + (state.baseText && finalText ? ' ' : '') + finalText;
        input.value = full + (interim ? (full ? ' ' : '') + interim : '');
        state.lastWritten = input.value;
        // 触发与手动输入一致的事件，保证自适应高度/按钮状态更新
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.scrollTop = input.scrollHeight;
        // 光标始终跟踪到文字最后面
        input.focus({ preventScroll: true });
        var len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (e) {}
    }

    // ===== 语音命令发送：识别到「发送/提交」等命令词时自动发送 =====
    // 只有小段话恰好是命令词才触发，避免把普通句子里带"发送"两个字误当成指令
    var SEND_CMD_RE = /^(?:请|帮我|给我|现在)?(?:发送消息|发送一下|发送出去|发送吧|发送|提交|送出|发出去|send)(?:吧|一下|消息)?$/i;

    // 触发判定前先去掉末尾标点/空白：语音引擎常在命令词后补「。，！?」等，导致精确匹配失败
    var TRAIL_PUNCT_RE = /[。．.,，!！?？～~\s]+$/;
    function detectSendCommand(text) {
        return SEND_CMD_RE.test((text || '').replace(TRAIL_PUNCT_RE, '').trim());
    }

    // 触发发送：优先点聊天框的发送按钮，兼容配置面板（data-voice-box）的"发送/停止"按钮
    function triggerSend(box) {
        stop(true); // 先停止录音，避免后续识别文字回填到已填空的输入框
        if (!box) return; // 【修复】录音目标聊天框已不存在（页面切换/热更新重载）时直接放弃，避免报 null 错误
        var btn = box.querySelector('.send-btn') || box.querySelector('.qc-send');
        if (btn) {
            // 【修复】语音命令触发的发送：若 AI 正在回复，应走「排队」而不是「停止当前对话」。
            // 打上语音标记，发送按钮点击逻辑检测到该标记且 chat.isSending 时改为执行 send()（内部自动入队）
            box.__voiceSendPending = true;
            // 兜底：若点击未消费标记（如按钮被替换），100ms 后自动清除
            setTimeout(function() { box.__voiceSendPending = false; }, 100);
            btn.click();
            return;
        }
        var btns = box.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || '').trim();
            if (t === '发送' || t === '停止') { btns[i].click(); return; }
        }
        toast('未找到发送按钮，请手动发送');
    }

    function clearTimers() {
        if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
        if (state.restartTimer) { clearTimeout(state.restartTimer); state.restartTimer = null; }
        if (state.sendCmdTimer) { clearTimeout(state.sendCmdTimer); state.sendCmdTimer = null; }
    }

    // ===== 中间结果即时发送：解决「说完发送要卡几秒才发出去」的问题 =====
    // 原因：Web Speech API 对最终结果(isFinal)的定稿有 1~3 秒延迟，之前只在 isFinal 才检测命令词。
    // 方案：中间结果(interim)一出现完整命令词就启动 350ms 短确认窗口；窗口内若继续说话（文本变长）
    //       则取消，避免把「发送文件给…」这类以"发送"开头的长句误判为指令；窗口到期立即触发发送。
    var SEND_CMD_CONFIRM_MS = 350;
    function armInterimSendCheck(interimText) {
        var text = (interimText || '').replace(TRAIL_PUNCT_RE, '').trim();
        if (!text || !SEND_CMD_RE.test(text)) return false;
        if (state.sendCmdTimer) return true; // 已有等待中的发送确认，不重复启动
        state.sendCmdTimer = setTimeout(function () {
            state.sendCmdTimer = null;
            if (!state.active || state.wantStop) return;
            // 再确认一次：此时输入框里的"尾巴"仍应是命令词（防止后续说话使文本变长却没触发新的 onresult 检查）
            var input = getInput(state.box);
            var tail = ((input && input.value) || '').replace(TRAIL_PUNCT_RE, '').trim();
            var lastSeg = tail.split(/\s+/).pop() || '';
            if (SEND_CMD_RE.test(lastSeg)) {
                writeInterim(state.box, '', '');
                triggerSend(state.box);
            }
        }, SEND_CMD_CONFIRM_MS);
        return true;
    }

    function armSilenceTimer() {
        if (state.silenceTimer) clearTimeout(state.silenceTimer);
        state.lastResultAt = Date.now();
        state.silenceTimer = setTimeout(function () {
            if (state.active) stop(true, true);
        }, SILENCE_MS);
    }

    function setBtnState(recording) {
        var btn = state.btn;
        if (!btn) return;
        btn.classList.toggle('voice-btn--rec', recording);
        btn.title = recording ? '正在听写…（点击停止）' : '语音输入';
        if (state.box) state.box.classList.toggle('voice-listening', recording);
    }

    function start(box, btn) {
        if (!SR) {
            toast('当前浏览器不支持语音识别，请使用 Chrome / Edge');
            return;
        }
        if (state.active) { stop(false); return; }

        state.box = box;
        state.btn = btn;
        state.wantStop = false;
        state.active = true;
        state.baseText = (getInput(box) && getInput(box).value || '').trim();
        if (state.baseText) state.baseText += ' ';
        state.lastWritten = (getInput(box) && getInput(box).value) || '';

        // 开始录音：立即聚焦输入框，并把光标定位到已有文字最后面
        var input = getInput(box);
        if (input) {
            input.focus({ preventScroll: true });
            var len = input.value.length;
            try { input.setSelectionRange(len, len); } catch (e) {}
        }

        var rec;
        try {
            rec = new SR();
        } catch (e) {
            state.active = false;
            toast('语音识别初始化失败：' + e.message);
            return;
        }
        rec.lang = 'zh-CN';
        rec.continuous = true;      // 连续模式：支持多次说话
        rec.interimResults = true;  // 流式：中间结果显示
        rec.maxAlternatives = 1;

        rec.onstart = function () { setBtnState(true); armSilenceTimer(); toast('开始听写，停止说话 ' + (SILENCE_MS / 1000) + ' 秒后自动结束'); };

        rec.onresult = function (e) {
            var finalText = '';
            var interim = '';
            for (var i = e.resultIndex; i < e.results.length; i++) {
                var r = e.results[i];
                if (r.isFinal) finalText += r[0].transcript;
                else interim += r[0].transcript;
            }
            if (finalText) {
                // 语音命令检测：某一段最终识别结果恰好是「发送/提交」→ 触发自动发送
                if (detectSendCommand(finalText)) {
                    writeInterim(state.box, '', ''); // 清掉中间态
                    triggerSend(state.box);
                    return;
                }
                // 命令词夹在句尾（如"……帮我发送"）：截掉命令部分，保留正文（先去尾部标点再匹配）
                var m = finalText.replace(TRAIL_PUNCT_RE, '').match(/^(.+?)(?:请|帮我|给我|现在)?(?:发送消息|发送一下|发送出去|发送吧|发送|提交|送出|发出去)(?:吧|一下|消息)?$/);
                if (m && m[1].trim().length >= 2) {
                    finalText = m[1].replace(/[，,。.\s]+$/, '');
                }
                state.baseText += finalText;
            }
            writeInterim(state.box, '', interim);
            // 中间结果即时发送检测：说完「发送」不等定稿，350ms 确认窗口后立即触发
            if (interim && armInterimSendCheck(interim)) return;
            armSilenceTimer(); // 每次有识别结果都重置静音计时
        };

        rec.onerror = function (e) {
            // not-allowed / service-not-allowed 属于权限问题，必须提示用户
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                toast('麦克风权限被拒绝，请在浏览器设置中允许');
                stop(false);
            } else if (e.error === 'no-speech') {
                // 静音超时，交给 silenceTimer 或由 onend 处理
            }
            // network / audio-capture 等错误不中断会话，等待 onend 重启（不打印，避免控制台噪音）
        };

        // 带退避的重启：start() 失败（麦克风/服务未释放等）不静默放弃，继续重试
        state.retryCount = 0;
        function restart() {
            if (!state.active || state.wantStop) return;
            state.restartTimer = setTimeout(function () {
                if (!state.active || state.wantStop) return;
                try {
                    rec.start();
                    state.retryCount = 0;
                } catch (err) {
                    // InvalidStateError：引擎其实还在运行，无需重启，等下一次 onend 即可
                    if (err && err.name === 'InvalidStateError') return;
                    state.retryCount++;
                    // 重启失败静默重试，成功后会归零；仅在彻底放弃时 toast 提示
                    if (state.retryCount <= 20) {
                        restart(); // 50ms * 2^n，封顶 2 秒间隔，持续重试
                    } else {
                        toast('语音识别已断开，请重新点击麦克风');
                        stop(false);
                    }
                }
            }, Math.min(RESTART_DELAY * Math.pow(2, state.retryCount), 2000));
        }

        rec.onend = function () {
            if (!state.active) return;
            if (state.wantStop) { finish(); return; }
            restart(); // 引擎自动结束（如一段说完）：重启以支持多次说话
        };

        state.rec = rec;
        try {
            rec.start();
        } catch (e) {
            state.active = false;
            toast('无法启动语音识别：' + e.message);
        }
    }

    function finish() {
        var box = state.box;
        var autoSend = state.autoStopped && box && box.classList.contains('dog-guard-chat');
        state.autoStopped = false;
        clearTimers();
        state.active = false;
        state.rec = null;
        setBtnState(false);
        // 只保留最终识别文本，清除中间态；若输入框已被清空（如刚发送），不回填旧文字
        if (box) {
            var input = getInput(box);
            if (input) {
                // 若输入框在录音期间被外部改动（如发送清空），以当前内容为基准，不回填旧文字
                if (input.value !== state.lastWritten) rebase(box);
                input.value = state.baseText;
                state.lastWritten = input.value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        state.box = null;
        state.btn = null;
        // 小狗守卫面板：静音自动结束时识别文本已写入输入框，自动点发送
        if (autoSend && box) {
            var input2 = getInput(box);
            if (input2 && input2.value.trim()) {
                setTimeout(function () {
                    var sendBtn = box.querySelector('.dg-chat-send');
                    if (sendBtn) sendBtn.click();
                }, 150);
            }
        }
    }

    function stop(silent, auto) {
        if (!state.active) return;
        state.wantStop = true;
        state.autoStopped = !!auto; // 静音自动结束（非用户点击），供小狗面板"说完自动发送"判断
        clearTimers();
        try { if (state.rec) state.rec.stop(); } catch (e) {}
        // onend 未触发时的兜底
        setTimeout(function () { if (state.active) finish(); }, 800);
        if (!silent) toast('听写结束');
    }

    // ===== 全局委托：监听所有 .voice-btn 点击 =====
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('.voice-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        // 普通聊天用 .chatbox，插件面板（如模型配置管家）用 [data-voice-box]，小狗守卫用 .dog-guard-chat，Tab 快速创建条用 #qcQuickBar
        var box = btn.closest('.chatbox') || btn.closest('[data-voice-box]') || btn.closest('.dog-guard-chat') || btn.closest('[data-mc-agent-input]') || btn.closest('#qcQuickBar');
        if (!box) return;
        if (state.active && state.box === box) stop(false);
        else if (state.active) { stop(true); start(box, btn); }
        else start(box, btn);
    });

    // ===== 焦点切换：录音期间点击其他对话/画布空白处，自动停止录音 =====
    document.addEventListener('pointerdown', function (e) {
        if (!state.active || !state.box) return;
        // 点击仍在当前录音的对话内（含麦克风按钮）则不处理，交给原逻辑
        if (e.target.closest && (e.target.closest('.chatbox') === state.box || e.target.closest('[data-voice-box]') === state.box || e.target.closest('.dog-guard-chat') === state.box || e.target.closest('#qcQuickBar') === state.box)) return;
        stop(true);
    }, true);

    // 暴露接口（调试/扩展用）
    window.VoiceInput = { start: start, stop: stop, isSupported: !!SR };
})();
