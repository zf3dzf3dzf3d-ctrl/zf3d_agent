// ===== 语音唤醒模块（Wake Word）v3 =====
// 功能：底部状态栏（风筝/守卫右侧）一个 🎙️ 话筒按钮，默认开启。
// 听到唤醒词（如"小风你好"）后：
//   1) TTS 回应"我在"；
//   2) 自动弹出 Tab/右键同款快速创建条（QuickCreate）；
//   3) 自动点它的语音按钮，开始正式听写；
//   4) 说出"发送"两个字 → 自动截掉"发送"并提交，弹出新的对话（快速条发送流程本身就是新建对话）。
// 首次需要用户点一次话筒授权麦克风，之后 localStorage 记住，默认开启。
(function () {
    'use strict';

    if (window.__WAKE_WORD_LOADED__) return;
    window.__WAKE_WORD_LOADED__ = true;

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var TTS = window.speechSynthesis;
    var STORE_KEY = 'zf_wake_enabled';

    // ===== 配置 =====
    var WAKE_PATTERNS = [
        /你好?朱峰社区/, /你好?朱峰/, /朱峰社区你好/, /朱峰社区/,
        // 同音字通配：峰/枫/风/锋/凤/丰 都算（语音识别常把同音字转成不同写法）
        /你好?小[峰枫风锋凤丰]/, /小[峰枫风锋凤丰]你好/, /小[峰枫风锋凤丰]同学/,
        /你好?小z/i, /小z同学/i, /小z你好/i,
        /你好?晓?[峰枫风锋凤丰]/, /晓?[峰枫风锋凤丰]同学/, /你好?晓[峰枫风锋凤丰]/
    ];
    var SEND_WORD = /^发送$/;      // 听写中单独说"发送"→ 提交
    var COOLDOWN_MS = 8000;        // 唤醒后冷却，避免重复触发
    var IDLE_STOP_MS = 10 * 60 * 1000;

    var enabled = (function () {
        var v = null;
        try { v = localStorage.getItem(STORE_KEY); } catch (e) {}
        return v === '1'; // 默认关闭：只有用户显式开启过才启用
    })();
    var rec = null;
    var listening = false;
    var lastWakeAt = 0;
    var idleTimer = null;

    function norm(s) { return (s || '').replace(/[\s,，。.!？?]/g, ''); }

    function hitWakeWord(text) {
        var t = norm(text);
        if (!t) return false;
        for (var i = 0; i < WAKE_PATTERNS.length; i++) {
            if (WAKE_PATTERNS[i].test(t)) return true;
        }
        return false;
    }

    function toast(msg) {
        if (window.App && typeof App.toast === 'function') App.toast(msg);
        else { /* 静默，避免控制台刷屏 */ }
    }

    // ===== 找快速创建条的语音按钮并开始听写 =====
    function startDictationInQuickBar() {
        var bar = document.getElementById('qcQuickBar');
        var btn = bar ? bar.querySelector('.qc-voice') : null;

        // 先把快速创建条打开（若已打开则保持）
        if (window.QuickCreate && typeof QuickCreate.show === 'function') {
            try { QuickCreate.show(); } catch (e) {}
        } else if (bar && !bar.classList.contains('open')) {
            // 兜底：模拟一次 Tab？不，QuickCreate 缺失时直接放弃，回待机
            toast('未找到快速对话条，无法自动唤醒');
            startListen();
            return;
        }

        bar = document.getElementById('qcQuickBar');
        btn = bar ? bar.querySelector('.qc-voice') : null;

        // 等 DOM 稳定后自动点语音按钮（与用户手动点完全同一链路）
        setTimeout(function () {
            if (window.VoiceInput && window.VoiceInput.isSupported && btn) {
                try { btn.click(); } catch (e) {}
                armIdleStop();
            } else {
                startListen(); // 无听写能力则继续待机
            }
        }, 150);
    }

    // ===== 唤醒动作：TTS 回应 + 弹快速条 + 自动录音 =====
    function wake() {
        lastWakeAt = Date.now();
        stopListen(); // 暂停待机监听，把麦克风让给正式听写

        if (TTS) {
            try {
                TTS.cancel();
                var u = new SpeechSynthesisUtterance('我在，请讲');
                u.lang = 'zh-CN';
                u.rate = 1.1;
                TTS.speak(u);
            } catch (e) { /* 忽略 TTS 失败 */ }
        }
        toast('唤醒成功，正在打开对话条并开始录音…');

        // 等 TTS 说完（约1.5秒）再打开快速条，避免把"我在"录进去
        setTimeout(startDictationInQuickBar, 1500);
    }

    // 轮询正式听写是否结束：一结束立即恢复待机监听
    function armIdleStop() {
        if (idleTimer) clearInterval(idleTimer);
        var waited = 0;
        idleTimer = setInterval(function () {
            waited += 1000;
            if (!window.__VOICE_INPUT_ACTIVE__ || waited >= IDLE_STOP_MS) {
                clearInterval(idleTimer);
                idleTimer = null;
                setTimeout(startListen, 300);
            }
        }, 1000);
    }

    // ===== 待机监听 =====
    function startListen() {
        if (!SR || !enabled || listening) return;
        try {
            if (!rec) rec = new SR();
        } catch (e) { return; }
        rec.lang = 'zh-CN';
        rec.continuous = true;
        rec.interimResults = true; // 中间结果也检测，唤醒更快
        rec.maxAlternatives = 1;

        rec.onresult = function (e) {
            var text = '';
            for (var i = e.resultIndex; i < e.results.length; i++) {
                text += e.results[i][0].transcript;
            }
            if (Date.now() - lastWakeAt > COOLDOWN_MS && hitWakeWord(text)) wake();
        };

        rec.onend = function () {
            listening = false;
            if (enabled && !window.__VOICE_INPUT_ACTIVE__) setTimeout(startListen, 300);
        };
        rec.onerror = function (e) {
            listening = false;
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                enabled = false;
                saveEnabled();
                updateBtn();
                toast('语音唤醒已停止：麦克风权限被拒绝');
            } else if (enabled) {
                setTimeout(startListen, 800);
            }
        };

        try { rec.start(); listening = true; } catch (e) { /* already started */ }
    }

    function stopListen() {
        listening = false;
        if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} }
    }

    // ===== 开关按钮 =====
    function saveEnabled() { try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) {} }

    function updateBtn() {
        var btn = document.getElementById('wakeWordBtn');
        if (btn) {
            btn.style.opacity = enabled ? '1' : '0.45';
            btn.title = enabled
                ? '语音唤醒：已开启（默认）。说"你好小峰"（或"小风你好/小峰同学"等）即弹出对话条并自动录音，直接说话即可；说"发送"即可发出。点击关闭。'
                : '语音唤醒：已关闭。点击开启。';
        }
    }

    function setEnabled(v, silent) {
        enabled = !!v;
        saveEnabled();
        if (enabled) { startListen(); if (!silent) toast('语音唤醒已开启，说"你好小峰"即可唤醒'); }
        else { stopListen(); if (!silent) toast('语音唤醒已关闭'); }
        updateBtn();
    }

    function toggle() {
        if (!SR) { toast('当前浏览器不支持语音识别，请用 Chrome / Edge'); return; }
        setEnabled(!enabled);
    }

    // 话筒按钮已在 index.html 状态栏中（风筝/守卫右侧），这里只绑事件
    function ensureBtn() {
        var btn = document.getElementById('wakeWordBtn');
        if (!btn) return;
        btn.addEventListener('click', toggle);
        updateBtn();
        if (enabled && SR) {
            setTimeout(function () { startListen(); }, 1200); // 页面加载后稍等再开待机
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureBtn);
    } else {
        ensureBtn();
    }

    // ===== "发送"语音命令：听写期间说出"发送"→ 自动提交 =====
    // 原理：VoiceInput 是持续识别的，把识别文本写入输入框。这里轮询输入框文本，
    // 若正好是"发送"两个字（或以"发送"结尾且前面有内容），则截掉并提交。
    (function watchSendWord() {
        setInterval(function () {
            if (!window.__VOICE_INPUT_ACTIVE__) return;
            var bar = document.getElementById('qcQuickBar');
            if (!bar || !bar.classList.contains('open')) return;
            var input = bar.querySelector('.qc-input');
            if (!input) return;
            var v = (input.value || '').trim();
            if (!v) return;
            if (SEND_WORD.test(v)) {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                if (window.VoiceInput) { try { VoiceInput.stop(); } catch (e) {} }
                if (window.QuickCreate && typeof QuickCreate.submit === 'function') {
                    toast('收到"发送"，正在发出…');
                    QuickCreate.submit(); // 发送流程本身会新建对话框
                }
            } else if (/发送$/.test(v) && v.replace(/发送$/, '').trim().length > 0) {
                // 内容后面跟了"发送"：截掉后直接提交
                input.value = v.replace(/发送$/, '').trim();
                input.dispatchEvent(new Event('input', { bubbles: true }));
                setTimeout(function () {
                    if (window.VoiceInput) { try { VoiceInput.stop(); } catch (e) {} }
                    if (window.QuickCreate && typeof QuickCreate.submit === 'function') {
                        toast('收到"发送"，正在发出…');
                        QuickCreate.submit();
                    }
                }, 200);
            }
        }, 400);
    })();

    // 对外 API：可从控制台/其他模块控制
    window.WakeWord = {
        enable: function () { if (!enabled) toggle(); },
        disable: function () { if (enabled) toggle(); },
        get enabled() { return enabled; },
        words: WAKE_PATTERNS.map(function (p) { return p.source; })
    };
})();
