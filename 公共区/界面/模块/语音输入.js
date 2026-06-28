/**
 * 语音输入 — Web Speech API语音识别
 * 从 逻辑.js 拆分，依赖全局状态的 isChatting
 */

// ============ 语音输入（Web Speech API）============
let speechRecognition = null;
let isRecording = false;
let _voiceConfirmedText = "";  // 已确认的语音文本

function initVoiceInput() {
    const micBtn = document.getElementById("micBtn");
    if (!micBtn) return;

    // 检测支持
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
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    // 保存已确认的文本，用于 interim 拼接
    _voiceConfirmedText = "";

    // 有结果
    speechRecognition.onresult = function (event) {
        const input = document.getElementById("userInput");
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript;
                _voiceConfirmedText += text;
                console.log("🎤 最终识别:", text);
            } else {
                interim += event.results[i][0].transcript;
            }
        }
        // 实时显示：已确认文本 + 中间结果（灰色提示）
        input.value = _voiceConfirmedText;
        input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
        if (interim) {
            input.placeholder = "🎤 " + interim;
        }
        // 收到结果就重置超时计时器
        if (window._micTimer) {
            clearTimeout(window._micTimer);
            window._micTimer = setTimeout(function () {
                if (isRecording) stopRecording();
            }, 15000);
        }
    };

    // 识别结束
    let _restartTimer = null;
    speechRecognition.onend = function () {
        console.log("🎤 onend, isRecording=", isRecording);
        if (isRecording) {
            // 用户没按停止 → 延迟重启（避免竞态）
            if (_restartTimer) clearTimeout(_restartTimer);
            _restartTimer = setTimeout(function () {
                _restartTimer = null;
                if (isRecording && speechRecognition) {
                    try {
                        speechRecognition.start();
                        console.log("🎤 已自动重启");
                    } catch (e) {
                        console.warn("🎤 重启失败:", e);
                    }
                }
            }, 300);
            return;
        }
        // 确保最终文本写入
        const input = document.getElementById("userInput");
        if (_voiceConfirmedText) {
            input.value = _voiceConfirmedText;
        }
        input.placeholder = "输入消息... (Enter发送, Shift+Enter换行)";
        setMicState(false);
    };

    // 错误处理
    speechRecognition.onerror = function (event) {
        console.warn("🎤 错误:", event.error);
        if (event.error === "not-allowed") {
            isRecording = false;
            setMicState(false);
            showToast("error", "🎤 麦克风被拒绝",
                "在浏览器地址栏左侧 🔒 允许麦克风访问后，刷新页面重试");
        } else if (event.error === "no-speech" || event.error === "aborted") {
            // 没说话或手动停止，忽略
        } else if (event.error === "network") {
            isRecording = false;
            setMicState(false);
            showToast("error", "🎤 语音服务连接失败", "请检查网络后重试");
        } else {
            isRecording = false;
            setMicState(false);
        }
    };

    console.log("🎤 语音输入就绪（按 🎤 说话）");
}

function startRecording() {
    if (!speechRecognition) return;
    if (isChatting) {
        showToast("info", "🎤 AI 思考中，稍后再试");
        return;
    }
    try {
        // 如果输入框已有内容，保留并追加；否则从头开始
        const input = document.getElementById("userInput");
        _voiceConfirmedText = input.value || "";
        speechRecognition.start();
        isRecording = true;
        setMicState(true);
        input.placeholder = "🎤 请说话...";
        // 15 秒无结果自动停（收到结果会重置此计时器）
        if (window._micTimer) clearTimeout(window._micTimer);
        window._micTimer = setTimeout(function () {
            if (isRecording) {
                showToast("info", "🎤 超时自动停止", "15秒无语音输入");
                stopRecording();
            }
        }, 15000);
    } catch (e) {
        console.warn("🎤 启动失败:", e);
        // 可能是上一个会话还没释放，延迟重试一次
        setTimeout(function () {
            try {
                speechRecognition.start();
                isRecording = true;
                setMicState(true);
            } catch (e2) {
                console.warn("🎤 重试失败:", e2);
                isRecording = false;
                setMicState(false);
                showToast("error", "🎤 启动失败", "请稍后再试");
            }
        }, 500);
    }
}

function stopRecording() {
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
