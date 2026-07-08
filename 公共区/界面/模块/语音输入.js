/**
 * 语音输入 — 双引擎：浏览器Web Speech API / 本地sherpa-onnx流式
 * 本地引擎通过WebSocket实时推音频，边说边出字
 */

let speechRecognition = null;
let isRecording = false;
let _voiceConfirmedText = "";
let _voiceEngine = "浏览器";
let _localInstalled = false;

// 流式引擎相关
let _wsStream = null;       // WebSocket连接
let _wsAudioCtx = null;     // AudioContext
let _wsSource = null;       // 音频源
let _wsProcessor = null;    // ScriptProcessor
let _wsMicStream = null;    // 麦克风流
let _wsPartialText = "";    // 部分识别结果

async function initVoiceInput() {
    const micBtn = document.getElementById("micBtn");
    if (!micBtn) return;

    micBtn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        document.getElementById("settingsOverlay").style.display = "flex";
        document.querySelectorAll(".snav-item").forEach(i => i.classList.remove("active"));
        document.querySelectorAll(".stab").forEach(t => t.classList.remove("active"));
        const voiceNav = document.querySelector('.snav-item[data-tab="voice"]');
        if (voiceNav) voiceNav.classList.add("active");
        document.getElementById("tab_voice").classList.add("active");
        if (typeof loadVoiceConfig === "function") loadVoiceConfig();
    });

    try {
        const res = await fetch("/api/voice-status");
        const d = await res.json();
        if (d.成功) {
            _voiceEngine = d.引擎 || "浏览器";
            _localInstalled = d.已安装 && d.模型存在;
        }
    } catch (e) {}

    if (_voiceEngine === "本地") {
        _initLocalEngine(micBtn);
    } else {
        _initBrowserEngine(micBtn);
    }
}

// ============ 浏览器引擎（Web Speech API）============
function _initBrowserEngine(micBtn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        micBtn.textContent = "❌";
        micBtn.title = "浏览器不支持语音";
        return;
    }
    speechRecognition = new SR();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = "zh-CN";
    speechRecognition.maxAlternatives = 1;

    micBtn.addEventListener("click", function () {
        if (isRecording) stopRecording();
        else startRecording();
    });

    _voiceConfirmedText = "";

    speechRecognition.onresult = function (event) {
        const input = document.getElementById("userInput");
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                _voiceConfirmedText += event.results[i][0].transcript;
            } else {
                interim += event.results[i][0].transcript;
            }
        }
        input.value = _voiceConfirmedText;
        input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
        if (interim) input.placeholder = "🎤 " + interim;
        if (window._micTimer) {
            clearTimeout(window._micTimer);
            window._micTimer = setTimeout(function () {
                if (isRecording) stopRecording();
            }, 15000);
        }
    };

    let _restartTimer = null;
    speechRecognition.onend = function () {
        if (isRecording) {
            if (_restartTimer) clearTimeout(_restartTimer);
            _restartTimer = setTimeout(function () {
                _restartTimer = null;
                if (isRecording && speechRecognition) {
                    try { speechRecognition.start(); } catch (e) {}
                }
            }, 300);
            return;
        }
        const input = document.getElementById("userInput");
        if (_voiceConfirmedText) input.value = _voiceConfirmedText;
        input.placeholder = "输入消息... (Enter发送, Shift+Enter换行)";
        setMicState(false);
    };

    speechRecognition.onerror = function (event) {
        if (event.error === "not-allowed") {
            isRecording = false;
            setMicState(false);
            showToast("error", "🎤 麦克风被拒绝", "在浏览器地址栏左侧 🔒 允许麦克风访问后刷新");
        } else if (event.error === "network") {
            isRecording = false;
            setMicState(false);
            showToast("error", "🎤 语音服务连接失败", "可切换到本地引擎（设置→语音）");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
            isRecording = false;
            setMicState(false);
        }
    };
}

function startRecording() {
    if (_voiceEngine === "本地") {
        _startLocalRecording();
        return;
    }
    if (!_localInstalled && !localStorage.getItem("_voiceSuggested")) {
        localStorage.setItem("_voiceSuggested", "1");
        _showVoiceSuggestion();
    }
    if (!speechRecognition) return;
    if (isChatting) { showToast("info", "🎤 AI 思考中，稍后再试"); return; }
    try {
        const input = document.getElementById("userInput");
        _voiceConfirmedText = input.value || "";
        speechRecognition.start();
        isRecording = true;
        setMicState(true);
        input.focus();
        input.placeholder = "🎤 请说话...";
        if (window._micTimer) clearTimeout(window._micTimer);
        window._micTimer = setTimeout(function () {
            if (isRecording) { showToast("info", "🎤 超时自动停止", "15秒无语音输入"); stopRecording(); }
        }, 15000);
    } catch (e) {
        setTimeout(function () {
            try { speechRecognition.start(); isRecording = true; setMicState(true); }
            catch (e2) { isRecording = false; setMicState(false); showToast("error", "🎤 启动失败", "请稍后再试"); }
        }, 500);
    }
}

function stopRecording() {
    if (_voiceEngine === "本地") {
        _stopLocalRecording();
        return;
    }
    if (!speechRecognition) return;
    isRecording = false;
    if (window._micTimer) { clearTimeout(window._micTimer); window._micTimer = null; }
    try { speechRecognition.stop(); } catch (e) {}
    setMicState(false);
    _voiceConfirmedText = "";
    const input = document.getElementById("userInput");
    input.placeholder = "输入消息... (Enter发送, Shift+Enter换行)";
    input.focus();
}

// ============ 本地引擎（WebSocket流式）============
function _initLocalEngine(micBtn) {
    micBtn.addEventListener("click", function () {
        if (isRecording) _stopLocalRecording();
        else _startLocalRecording();
    });
    console.log("🎤 语音输入就绪（本地流式引擎，按 🎤 说话）");
}

async function _startLocalRecording() {
    if (isChatting) { showToast("info", "🎤 AI 思考中，稍后再试"); return; }
    const input = document.getElementById("userInput");
    _voiceConfirmedText = input.value || "";
    _wsPartialText = "";
    try {
        // 获取麦克风
        _wsMicStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        // 建立WebSocket连接
        const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/voice-stream";
        _wsStream = new WebSocket(wsUrl);
        _wsStream.binaryType = "arraybuffer";
        _wsStream.onmessage = function (event) {
            try {
                const d = JSON.parse(event.data);
                if (d.类型 === "部分") {
                    // 部分结果：已确认文字 + 当前部分文字
                    _wsPartialText = d.文字 || "";
                    input.value = _voiceConfirmedText + _wsPartialText;
                    input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
                } else if (d.类型 === "增量") {
                    // 一句话说完，增量追加到已确认文字
                    _voiceConfirmedText += d.文字 || "";
                    _wsPartialText = "";
                    input.value = _voiceConfirmedText;
                    input.dispatchEvent(new Event("input"));
                } else if (d.类型 === "最终") {
                    // 结束录音，最终结果
                    _voiceConfirmedText = d.文字 || "";
                    _wsPartialText = "";
                    input.value = _voiceConfirmedText;
                    input.dispatchEvent(new Event("input"));
                } else if (d.类型 === "错误") {
                    showToast("error", "🎤 识别错误", d.错误 || "未知错误");
                    _stopLocalRecording();
                }
            } catch (e) {}
        };
        _wsStream.onerror = function () {
            showToast("error", "🎤 连接失败", "无法连接语音服务");
            _stopLocalRecording();
        };
        _wsStream.onopen = function () {
            // WebSocket就绪，开始采集音频
            _wsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            _wsSource = _wsAudioCtx.createMediaStreamSource(_wsMicStream);
            // ScriptProcessor: 每次采集 4096 samples (256ms @16kHz)
            _wsProcessor = _wsAudioCtx.createScriptProcessor(4096, 1, 1);
            _wsProcessor.onaudioprocess = function (e) {
                if (!_wsStream || _wsStream.readyState !== WebSocket.OPEN) return;
                const float32 = e.inputBuffer.getChannelData(0);
                // 直接发送 float32 PCM (little-endian)
                _wsStream.send(float32.buffer);
            };
            _wsSource.connect(_wsProcessor);
            // 连接到静音Gain节点（ScriptProcessor需要连接destination才能触发，但音量设0避免回声）
            const _silentGain = _wsAudioCtx.createGain();
            _silentGain.gain.value = 0;
            _wsProcessor.connect(_silentGain);
            _silentGain.connect(_wsAudioCtx.destination);
        };
        isRecording = true;
        setMicState(true);
        input.focus();
        input.placeholder = "🎤 请说话...";
        // 60秒自动停止
        if (window._micTimer) clearTimeout(window._micTimer);
        window._micTimer = setTimeout(function () {
            if (isRecording) { showToast("info", "🎤 超时自动停止", "60秒"); _stopLocalRecording(); }
        }, 60000);
    } catch (e) {
        showToast("error", "🎤 麦克风启动失败", e.message);
    }
}

function _stopLocalRecording() {
    isRecording = false;
    if (window._micTimer) { clearTimeout(window._micTimer); window._micTimer = null; }
    setMicState(false);
    const input = document.getElementById("userInput");
    input.placeholder = "输入消息... (Enter发送, Shift+Enter换行)";
    // 停止音频处理
    if (_wsProcessor) { try { _wsProcessor.disconnect(); } catch(e){} _wsProcessor = null; }
    if (_wsSource) { try { _wsSource.disconnect(); } catch(e){} _wsSource = null; }
    if (_wsAudioCtx) { try { _wsAudioCtx.close(); } catch(e){} _wsAudioCtx = null; }
    if (_wsMicStream) { _wsMicStream.getTracks().forEach(t => t.stop()); _wsMicStream = null; }
    // 发送结束信号，等待最终结果
    if (_wsStream && _wsStream.readyState === WebSocket.OPEN) {
        try { _wsStream.send("end"); } catch(e){}
        // 给500ms等最终结果回来再关闭
        setTimeout(function () {
            if (_wsStream) { try { _wsStream.close(); } catch(e){} _wsStream = null; }
        }, 500);
    } else {
        _wsStream = null;
    }
    _voiceConfirmedText = "";
    input.focus();
}

// ============ 语音安装建议弹窗 ============
function _showVoiceSuggestion() {
    const c = document.getElementById("toastContainer");
    if (!c) return;
    if (c.querySelector(".voice-suggest-toast")) return;
    const t = document.createElement("div");
    t.className = "toast info voice-suggest-toast";
    t.innerHTML = `<span class="toast-icon">🎤</span>
        <div class="toast-body">
            <div class="toast-title">安装本地语音引擎？</div>
            <div class="toast-msg">离线可用、中文识别精度更高、边说边出字。点击右侧按钮快速安装。</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="_openVoiceSettings()" style="background:var(--blue);color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">前往设置</button>
            <button onclick="this.closest('.toast').remove()" style="background:none;color:var(--text2);border:1px solid var(--border);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;" title="关闭">关闭</button>
        </div>`;
    c.appendChild(t);
}

function _openVoiceSettings() {
    const toast = document.querySelector(".voice-suggest-toast");
    if (toast) toast.remove();
    document.getElementById("settingsOverlay").style.display = "flex";
    document.querySelectorAll(".snav-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".stab").forEach(t => t.classList.remove("active"));
    const voiceNav = document.querySelector('.snav-item[data-tab="voice"]');
    if (voiceNav) voiceNav.classList.add("active");
    document.getElementById("tab_voice").classList.add("active");
    if (typeof loadVoiceConfig === "function") loadVoiceConfig();
}

// ============ 通用 ============
function setMicState(recording) {
    const micBtn = document.getElementById("micBtn");
    if (!micBtn) return;
    if (recording) {
        micBtn.classList.add("recording");
        micBtn.textContent = "🔴";
        micBtn.title = "点击停止";
    } else {
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";
        micBtn.title = "🎤 语音输入";
    }
}
