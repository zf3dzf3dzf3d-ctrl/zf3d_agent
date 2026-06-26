/**
 * ZF3D Agent v2 — VS Code风格前端逻辑
 * 左:文件树 | 中:多Tab编辑器 | 右:对话 | 三个面板可切换
 * 支持AI实时修改编辑器内容，带diff高亮
 */

// ============ 全局状态 ============
let editorInstance = null;
let openFiles = [];     // [{path, name, content, dirty}]
let activeFileIdx = -1;

// ============ API鉴权（自动注入令牌到所有fetch请求） ============
const _原始fetch = window.fetch;
window.fetch = function(url, options = {}) {
    const token = localStorage.getItem("zf3d_auth_token");
    if (token && typeof url === "string" && url.startsWith("/api/")) {
        options.headers = options.headers || {};
        if (!options.headers["Authorization"]) {
            options.headers["Authorization"] = "Bearer " + token;
        }
    }
    return _原始fetch.call(this, url, options);
};
let currentRoot = null;
let currentRootDisplay = "";
let galleryPath = null;
let currentViewFile = null;
let galleryImages = [];
let currentImageIdx = -1;
let slideshowTimer = null;
let slideshowInterval = 3000;
let audioPlaylist = [];
let currentAudioIdx = -1;
let audioSeeking = false;
let videoPlaylist = [];
let currentVideoIdx = -1;
let galleryViewMode = localStorage.getItem("galleryView") || "grid";
let gallerySortKey = localStorage.getItem("gallerySortKey") || "名称";
let gallerySortAsc = localStorage.getItem("gallerySortAsc") !== "false";
let galleryItemsCache = [];
let logList = [];
let isChatting = false;
let chatAbortController = null;   // 对话中断控制器
let thinkingAnimTimer = null;     // 思考状态定时器
let editorSelection = null; // {text, start, end}
let selectedItems = new Map();  // 选中项: path -> {名称, 类型, 路径}
let diffMarkers = [];       // [{start, end, type:"add"|"del", text, timer}]
let reasoningPollTimer = null;   // 推理流轮询定时器
let reasoningIndex = 0;          // 推理流已读索引
let voiceEnabled = localStorage.getItem("voiceEnabled") === "true"; // 语音播报开关

// ============ 自定义撤销/重做栈 ============
let undoStack = [];   // [{fileIdx, oldContent, newContent, label}]
let redoStack = [];
const UNDO_MAX = 50;

function pushUndo(fileIdx, oldContent, newContent, label) {
    undoStack.push({ fileIdx, oldContent, newContent, label: label || "编辑" });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = []; // 新操作清空redo
}

function editorUndo() {
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') return;
    const ta = document.getElementById("codeInput");
    if (!ta) return;
    // 优先用自定义栈
    if (undoStack.length > 0) {
        const entry = undoStack.pop();
        // 恢复旧内容
        if (entry.fileIdx === activeFileIdx && editorInstance) {
            const current = ta.value;
            redoStack.push({ fileIdx: entry.fileIdx, oldContent: current, newContent: entry.oldContent, label: entry.label });
            editorInstance.设置内容(entry.oldContent);
            if (openFiles[entry.fileIdx]) openFiles[entry.fileIdx].content = entry.oldContent;
            renderTabs();
            return;
        }
    }
    // 回退到浏览器原生undo
    ta.focus();
    document.execCommand("undo");
}

function editorRedo() {
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') return;
    const ta = document.getElementById("codeInput");
    if (!ta) return;
    if (redoStack.length > 0) {
        const entry = redoStack.pop();
        if (entry.fileIdx === activeFileIdx && editorInstance) {
            const current = ta.value;
            undoStack.push({ fileIdx: entry.fileIdx, oldContent: current, newContent: entry.newContent, label: entry.label });
            editorInstance.设置内容(entry.newContent);
            if (openFiles[entry.fileIdx]) openFiles[entry.fileIdx].content = entry.newContent;
            renderTabs();
            return;
        }
    }
    ta.focus();
    document.execCommand("redo");
}

// ============ 路径工具 ============
function joinPath(base, name) {
    if (!base) return name;
    return base.replace(/[\/\\]+$/, "") + "/" + name;
}

// ============ 初始化 ============
document.addEventListener("DOMContentLoaded", () => {
    initPanels();
    initChat();
    initTTS();
    initVoiceInput();
    initEditor();
    initDividers();
    initSettings();
    initToast();
    initGallerySelection();
    loadSystemStatus();
    // 每次打开页面都自动新建对话，不恢复上次对话
    loadConvList();
    newConversation();
    pollPending();
    const savedRoot = localStorage.getItem("lastFolder");
    const initPath = savedRoot || "./";
    openFolder(initPath);
    showGallery(initPath);
    initAudioPlayer();
    initSlideshowSpeed();
    setTimeout(checkPanelNarrow, 100);
});

// 关闭页面时只保存对话，不关服务器（服务器靠手动关闭cmd窗口）
window.addEventListener("beforeunload", function() {
    try { navigator.sendBeacon("/api/conversation-save", "{}"); } catch(e) {}
});

// 预判面板宽度，窄则自动隐藏文字
function checkPanelNarrow() {
    const 阈值 = 280;
    ["filesPanel", "editorPanel", "chatPanel"].forEach(id => {
        const p = document.getElementById(id);
        if (p && !p.classList.contains("hidden")) {
            p.classList.toggle("panel-narrow", p.offsetWidth < 阈值);
        }
    });
}
window.addEventListener("resize", checkPanelNarrow);

// ============ 面板切换 ============
function initPanels() {
    document.getElementById("toggleFiles").addEventListener("click", () => togglePanel("filesPanel", "toggleFiles"));
    document.getElementById("toggleEditor").addEventListener("click", () => togglePanel("editorPanel", "toggleEditor"));
    document.getElementById("toggleChat").addEventListener("click", () => togglePanel("chatPanel", "toggleChat"));
    ["toggleFiles", "toggleEditor", "toggleChat"].forEach(id => document.getElementById(id).classList.add("active"));
}

function togglePanel(panelId, btnId) {
    const panel = document.getElementById(panelId);
    panel.classList.toggle("hidden");
    panel.classList.remove("panel-narrow");
    document.getElementById(btnId).classList.toggle("active");
    updateDividers();
    setTimeout(checkPanelNarrow, 50);
}

function updateDividers() {
    document.querySelectorAll(".divider").forEach(d => {
        const lH = document.getElementById(d.dataset.left)?.classList.contains("hidden");
        const rH = document.getElementById(d.dataset.right)?.classList.contains("hidden");
        d.style.display = (lH || rH) ? "none" : "";
    });
}

// ============ 分隔线拖拽 ============
function initDividers() {
    document.querySelectorAll(".divider").forEach(d => {
        d.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const leftId = d.dataset.left, rightId = d.dataset.right;
            const leftP = document.getElementById(leftId), rightP = document.getElementById(rightId);
            const startX = e.clientX, startLW = leftP.offsetWidth, startRW = rightP.offsetWidth;
            const 隐藏阈值 = 280;
            const 关闭阈值 = 60;
            const onMove = (e) => {
                const dx = e.clientX - startX;
                if (leftId === "editorPanel" || leftId === "stockPanel") {
                    const newW = Math.max(关闭阈值, startRW - dx);
                    rightP.style.width = newW + "px";
                    rightP.classList.toggle("panel-narrow", newW < 隐藏阈值);
                    leftP.classList.toggle("panel-narrow", leftP.offsetWidth < 隐藏阈值);
                    if (newW <= 关闭阈值) { collapsePanel(rightId, leftId); onUp(); }
                    else if (leftP.offsetWidth <= 关闭阈值) { collapsePanel(leftId, rightId); onUp(); }
                } else {
                    const newW = Math.max(关闭阈值, startLW + dx);
                    leftP.style.width = newW + "px";
                    leftP.classList.toggle("panel-narrow", newW < 隐藏阈值);
                    rightP.classList.toggle("panel-narrow", rightP.offsetWidth < 隐藏阈值);
                    if (newW <= 关闭阈值) { collapsePanel(leftId, rightId); onUp(); }
                    else if (rightP.offsetWidth <= 关闭阈值) { collapsePanel(rightId, leftId); onUp(); }
                }
            };
            const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    });
}

function collapsePanel(panelId, otherId) {
    const panel = document.getElementById(panelId);
    if (panel.classList.contains("hidden")) return;
    panel.classList.add("hidden");
    panel.style.width = "";
    panel.classList.remove("panel-narrow");
    const btnMap = { "filesPanel": "toggleFiles", "editorPanel": "toggleEditor", "chatPanel": "toggleChat" };
    const btnId = btnMap[panelId];
    if (btnId) document.getElementById(btnId).classList.remove("active");
    updateDividers();
}

// ============ 对话 ============
function initChat() {
    const input = document.getElementById("userInput");
    const btn = document.getElementById("sendBtn");
    btn.addEventListener("click", () => { isChatting ? stopChat() : sendMessage(); });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    input.addEventListener("input", () => { input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden"; });
}

// ============ 语音播报 ============
function initTTS() {
    const btn = document.getElementById("ttsToggleBtn");
    if (!btn) return;
    更新语音按钮();
    btn.addEventListener("click", () => {
        voiceEnabled = !voiceEnabled;
        localStorage.setItem("voiceEnabled", voiceEnabled ? "true" : "false");
        更新语音按钮();
        if (!voiceEnabled) {
            fetch("/api/tts-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
        }
        showToast("info", voiceEnabled ? "🔊 语音播报已开启" : "🔇 语音播报已关闭", voiceEnabled ? "AI回复后将朗读结果" : "已停止语音播报");
    });
}

function 更新语音按钮() {
    const btn = document.getElementById("ttsToggleBtn");
    if (!btn) return;
    btn.textContent = voiceEnabled ? "🔊" : "🔇";
    btn.title = voiceEnabled ? "语音播报：开（点击关闭）" : "语音播报：关（点击开启）";
    btn.classList.toggle("active", voiceEnabled);
}

function speakText(text) {
    if (!voiceEnabled || !text) return;
    let 纯文本 = text
        .replace(/```[\s\S]*?```/g, '代码块')
        .replace(/`[^`]+`/g, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/[⚡🤔💭✅❌🔧✏️🗑️📌📖📂📄🖼️]/g, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    if (纯文本.length < 2) return;
    fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 文本: 纯文本 }) }).catch(() => {});
}

function stopTTS() {
    fetch("/api/tts-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

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

function setThinkingState(thinking) {
    const input = document.getElementById("userInput");
    const btn = document.getElementById("sendBtn");
    const indicator = document.getElementById("thinkingIndicator");
    if (thinking) {
        input.disabled = true;
        input.placeholder = "AI思考中...";
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>';
        btn.title = "停止生成";
        btn.classList.add("stop");
        if (indicator) indicator.classList.add("show");
        startThinkingAnim();
    } else {
        input.disabled = false;
        input.placeholder = "输入消息... (Enter发送, Shift+Enter换行)";
        btn.disabled = false;
        btn.innerHTML = '➤';
        btn.title = "发送";
        btn.classList.remove("stop");
        if (indicator) indicator.classList.remove("show");
        stopThinkingAnim();
        // 清理生成进度条
        const genBar = document.getElementById("genProgressBar");
        if (genBar) genBar.remove();
        input.focus();
    }
}

// 思考状态：基于真实推理流事件驱动，不再使用随机动画
let _thinkTimer = null;
let _thinkStartTime = 0;

function startThinkingAnim() {
    _thinkStartTime = Date.now();
    stopThinkingAnim();
    _updateThinkingDisplay("等待", "连接AI中...", 0);
    // 轻量计时器：只显示已等待时间，不伪造进度
    _thinkTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _thinkStartTime) / 1000);
        const elNum = document.getElementById("thinkingNum");
        if (elNum) elNum.textContent = elapsed + "s";
        // 进度条做不确定效果：0→30%缓慢爬升，永不到100%
        const pct = Math.min(elapsed * 3, 30);
        const elTrack = document.getElementById("thinkingTrack");
        if (elTrack) elTrack.style.width = pct + "%";
    }, 500);
}

function _updateThinkingDisplay(cat, phrase, progress) {
    const elCat = document.getElementById("thinkingCat");
    const elPhrase = document.getElementById("thinkingPhrase");
    const elNum = document.getElementById("thinkingNum");
    const elTrack = document.getElementById("thinkingTrack");
    if (elCat) elCat.textContent = cat;
    if (elPhrase) elPhrase.textContent = phrase;
    if (elTrack) elTrack.style.width = progress + "%";
}

function stopThinkingAnim() {
    if (_thinkTimer) { clearInterval(_thinkTimer); _thinkTimer = null; }
}

function stopChat() {
    if (chatAbortController) {
        chatAbortController.abort();
        chatAbortController = null;
    }
    stopTTS();
    // 通知后端取消并立即保存对话
    fetch("/api/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    fetch("/api/conversation-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

async function sendMessage() {
    if (isChatting) return;
    const input = document.getElementById("userInput");
    const text = input.value.trim();
    if (!text) return;
    // 停止当前朗读，准备读下一个输出
    stopTTS();
    addMsg("user", text);
    input.value = "";
    isChatting = true;
    setThinkingState(true);
    // 显示推理流容器（SSE模式下推理事件直接推送）
    showReasoningPanel();
    reasoningIndex = 0;
    // 收集上下文
    const 上下文 = {};
    if (activeFileIdx >= 0 && openFiles[activeFileIdx] && openFiles[activeFileIdx].type !== 'document') {
        上下文.当前文件 = {
            路径: openFiles[activeFileIdx].path,
            名称: openFiles[activeFileIdx].name,
            内容: editorInstance ? editorInstance.获取内容() : openFiles[activeFileIdx].content
        };
    }
    if (openFiles.length > 0) {
        上下文.打开的文件列表 = openFiles.map(f => ({ 路径: f.path, 名称: f.name, 已修改: f.dirty }));
    }
    if (currentRoot) 上下文.当前文件夹 = currentRoot;
    if (currentViewFile) 上下文.当前预览文件 = currentViewFile;
    // 框选文件上下文
    if (selectedItems.size > 0) {
        上下文.选中文件 = Array.from(selectedItems.values());
    }
    // 构建工作环境摘要（注入用户消息，模型对用户消息关注度更高）
    let 环境摘要 = "";
    if (currentRoot) 环境摘要 += `📂 工作目录: ${currentRoot}\n`;
    if (currentViewFile) 环境摘要 += `👁️ 正在预览: ${currentViewFile.名称} (${currentViewFile.路径}) [${currentViewFile.类型}]\n`;
    if (openFiles.length > 0) {
        环境摘要 += `📄 打开文件: ${openFiles.map(f => f.name + (f.dirty ? "(已修改)" : "")).join(", ")}\n`;
    }
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]) {
        const f = openFiles[activeFileIdx];
        if (f.type === 'document') 环境摘要 += `📖 当前文档: ${f.name} (${f.path})\n`;
        else 环境摘要 += `✏️ 当前编辑: ${f.name} (${f.path})\n`;
    }
    if (selectedItems.size > 0) {
        环境摘要 += `📋 已选中${selectedItems.size}个文件/文件夹: ${Array.from(selectedItems.values()).map(i => i.名称).join(", ")}\n`;
    }
    // 框选文本上下文
    let 发送消息 = text;
    if (editorSelection && editorSelection.text) {
        const isDocSel = currentViewFile && document.getElementById("docViewer") && document.getElementById("docViewer").style.display !== "none";
        const selPath = isDocSel ? currentViewFile.路径 : (openFiles[activeFileIdx]?.path || "");
        const selName = isDocSel ? currentViewFile.名称 : (openFiles[activeFileIdx]?.name || "");
        上下文.框选文本 = {
            内容: editorSelection.text,
            起始位置: editorSelection.start,
            结束位置: editorSelection.end,
            所在文件: selPath,
            所在文件名: selName
        };
        发送消息 = `[用户在文件「${selName}」中选中了以下文本，要求你对此文本执行操作]\n---\n${editorSelection.text}\n---\n文件路径: ${selPath}\n\n用户指令: ${text}`;
    } else if (环境摘要) {
        // 无框选时，在用户消息前加环境摘要
        发送消息 = `${环境摘要}\n用户: ${text}`;
    }
    try {
        chatAbortController = new AbortController();
        const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 消息: 发送消息, 上下文 }), signal: chatAbortController.signal });

        // SSE流式读取
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let streamEl = null;
        let streamBody = null;
        let streamText = "";
        let hasFileChange = false;
        let docChanges = [];
        let gotComplete = false;
        liveDiffHandled = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });

            const events = sseBuffer.split("\n\n");
            sseBuffer = events.pop();

            for (const event of events) {
                if (!event.startsWith("data: ")) continue;
                let data;
                try { data = JSON.parse(event.slice(6)); } catch(e) { continue; }

                if (data.类型 === "推理流") {
                    for (const rec of data.记录) {
                        // 流式回复token → 直接追加到消息元素，不进推理面板
                        if (rec.类型 === "流式回复" && rec.内容?.内容) {
                            // 收到首个token时更新思考状态
                            if (!streamEl) {
                                _updateThinkingDisplay("生成", "AI回复中...", 60);
                            }
                            if (!streamEl) {
                                streamEl = document.createElement("div");
                                streamEl.className = "msg assistant";
                                streamBody = document.createElement("div");
                                streamBody.className = "msg-body";
                                streamEl.appendChild(streamBody);
                                document.getElementById("msgList").appendChild(streamEl);
                            }
                            streamText += rec.内容.内容;
                            // 增量渲染：仅追加新文本，不全量重渲染
                            streamBody.innerHTML = escapeHtml(streamText).replace(/\n/g, '<br>') + '<span class="stream-cursor"></span>';
                            document.getElementById("msgList").scrollTop = document.getElementById("msgList").scrollHeight;
                            continue; // 不进推理面板
                        }

                        // 根据真实事件更新思考状态显示
                        if (rec.类型 === "操作调用" && rec.内容?.操作) {
                            _updateThinkingDisplay("执行", rec.内容.操作, 40);
                        } else if (rec.类型 === "操作结果" && rec.内容?.操作) {
                            _updateThinkingDisplay("观察", "分析结果...", 50);
                        } else if (rec.类型 === "思考") {
                            _updateThinkingDisplay("思考", `第${rec.内容.步数}步推理`, 20);
                        }

                        // 其他推理记录 → 进推理面板
                        reasoningStreamContent.push(rec);
                        appendReasoningRecord(rec);

                        // 实时文件变更检测（同原pollReasoningStream逻辑）
                        if (rec.类型 === "操作结果" && rec.内容?.操作 && rec.内容?.成功) {
                            const 文件变更操作 = ["删除文件", "写入文件", "替换文本", "创建文件", "追加文件", "重命名",
                                "多线程下载", "下载网页图片", "ComfyUI一键生图", "ComfyUI获取图片", "ComfyUI图片修改", "ComfyUI视频生成",
                                "替换Word文本", "替换Excel文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档",
                                "运行命令", "压缩文件", "解压文件"];
                            if (文件变更操作.includes(rec.内容.操作)) {
                                hasFileChange = true;
                                refreshTree();
                                if (galleryPath) showGallery(galleryPath);
                            }
                        }
                    }
                } else if (data.类型 === "完成") {
                    gotComplete = true;
                    const d = data.结果;
                    if (d.成功) {
                        // 最终Markdown渲染：平滑过渡而非突然替换
                        if (streamEl && streamText) {
                            // 先淡出纯文本
                            streamBody.style.transition = "opacity 0.15s ease";
                            streamBody.style.opacity = "0.5";
                            // 渲染完整Markdown
                            streamBody.innerHTML = renderMsg(d.回复 || streamText);
                            // 淡入Markdown
                            requestAnimationFrame(() => {
                                streamBody.style.opacity = "1";
                            });
                            document.getElementById("msgList").scrollTop = document.getElementById("msgList").scrollHeight;
                            if (voiceEnabled) speakText(d.回复);
                        } else {
                            // 无流式token的回退：直接显示，不再用假打字机
                            addMsg("assistant", d.回复);
                            if (voiceEnabled) speakText(d.回复);
                        }

                        // 处理推理过程中的文件修改操作（从完整结果补充检测）
                        if (d.推理过程?.length > 0 && !hasFileChange) {
                            for (const s of d.推理过程) {
                                if (s.类型 === "操作" && s.成功 && ["写入文件", "替换文本", "删除文件", "追加文件", "创建文件", "替换Word文本", "替换Excel文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档", "多线程下载", "下载网页图片", "ComfyUI一键生图", "ComfyUI获取图片", "ComfyUI图片修改", "ComfyUI视频生成"].includes(s.操作)) {
                                    hasFileChange = true;
                                }
                                if (s.操作 === "替换文本" && s.成功 && s.参数 && !liveDiffHandled) {
                                    applyLiveDiff(s.参数["旧文本"] || "", s.参数["新文本"] || "");
                                }
                                if (s.成功 && s.参数) {
                                    if (s.操作 === "替换Word文本" || s.操作 === "替换Excel文本") {
                                        docChanges.push({操作: s.操作, 旧文本: s.参数["旧文本"] || "", 新文本: s.参数["新文本"] || ""});
                                    } else if (s.操作 === "追加Word段落" || s.操作 === "插入Word段落") {
                                        docChanges.push({操作: s.操作, 旧文本: "", 新文本: s.参数["内容"] || ""});
                                    } else if (s.操作 === "删除Word段落") {
                                        docChanges.push({操作: s.操作, 旧文本: s.结果 || "", 新文本: ""});
                                    }
                                }
                            }
                        }

                        if (hasFileChange) {
                            await refreshAllOpenFiles(true);
                            refreshTree();
                            if (galleryPath) showGallery(galleryPath);
                            if (docChanges.length > 0) highlightDocChanges(docChanges);
                        } else {
                            await refreshAllOpenFiles(false);
                        }
                    } else {
                        if (streamEl) { streamEl.remove(); }
                        addMsg("assistant", `❌ ${d.错误 || "对话失败"}`);
                    }
                }
            }
            if (gotComplete) {
                try { reader.cancel(); } catch(e) {}
                break;
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            addMsg("system", "⏹ 已停止生成");
        } else {
            addMsg("assistant", `❌ 连接错误: ${e.message}`);
        }
    }
    // 停止推理流轮询（SSE模式下不再需要，但保留兼容）
    if (reasoningPollTimer) { clearInterval(reasoningPollTimer); reasoningPollTimer = null; }
    hideReasoningPanel();
    isChatting = false;
    chatAbortController = null;
    setThinkingState(false);
    // 刷新对话列表（标题可能已自动更新）
    if (convListOpen) loadConvList();
}

// ============ 实时推理流 ============
let reasoningStreamContent = [];

function showReasoningPanel() {
    reasoningStreamContent = [];
    let panel = document.getElementById("reasoningPanel");
    if (!panel) {
        const chatMsg = document.getElementById("msgList");
        panel = document.createElement("div");
        panel.id = "reasoningPanel";
        panel.className = "reasoning-panel";
        panel.innerHTML = '<div class="reasoning-header">⚡ AI推理过程</div><div class="reasoning-body" id="reasoningBody"></div>';
        chatMsg.parentNode.insertBefore(panel, chatMsg.nextSibling);
    }
    panel.style.display = "block";
    document.getElementById("reasoningBody").innerHTML = "";
}

function hideReasoningPanel() {
    const panel = document.getElementById("reasoningPanel");
    if (panel) panel.style.display = "none";
}

async function pollReasoningStream() {
    if (!isChatting) return;
    try {
        const res = await fetch(`/api/reasoning-stream?index=${reasoningIndex}`);
        const d = await res.json();
        if (d.成功 && d.记录?.length > 0) {
            reasoningIndex = d.当前索引 || reasoningIndex + d.记录.length;
            for (const rec of d.记录) {
                reasoningStreamContent.push(rec);
                appendReasoningRecord(rec);
                // 检测文件变更操作，提前刷新文件夹（不用等最终响应）
                if (rec.类型 === "操作结果" && rec.内容?.操作 && rec.内容?.成功) {
                    const 文件变更操作 = ["删除文件", "写入文件", "替换文本", "创建文件", "追加文件", "重命名",
                        "多线程下载", "下载网页图片", "ComfyUI一键生图", "ComfyUI获取图片", "ComfyUI图片修改", "ComfyUI视频生成",
                        "替换Word文本", "替换Excel文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档",
                        "运行命令", "压缩文件", "解压文件"];
                    if (文件变更操作.includes(rec.内容.操作)) {
                        refreshTree();
                        if (galleryPath) showGallery(galleryPath);
                    }
                }
            }
        }
    } catch (e) { /* 静默忽略 */ }
}

function appendReasoningRecord(rec) {
    const body = document.getElementById("reasoningBody");
    if (!body) return;
    const div = document.createElement("div");
    div.className = "reasoning-card";
    switch (rec.类型) {
        case "开始":
            div.className += " rc-start";
            div.innerHTML = `<div class="rc-icon">💬</div><div class="rc-content"><span class="rc-label">开始</span> ${escapeHtml(rec.内容.消息 || "")}</div>`; break;
        case "思考":
            div.className += " rc-thinking";
            div.innerHTML = `<div class="rc-icon">🤔</div><div class="rc-content"><span class="rc-label">步骤 ${rec.内容.步数}</span> 思考中...</div>`; break;
        case "操作调用":
            div.className += " rc-action";
            const p = Object.entries(rec.内容.参数||{}).map(([k,v])=>`<span class="rc-param">${escapeHtml(k)}=<span class="rc-val">${escapeHtml(String(v).substring(0,40))}</span></span>`).join(" ");
            div.innerHTML = `<div class="rc-icon">🔧</div><div class="rc-content"><span class="rc-label rc-op-name">${escapeHtml(rec.内容.操作)}</span><div class="rc-params">${p}</div></div>`;
            // 朗读操作时更新思考状态
            if (rec.内容.操作 === "普通话") {
                _updateThinkingDisplay("朗读", "语音播报中...", 80);
            }
            break;
        case "操作结果":
            div.className += " rc-result" + (rec.内容.成功 ? " rc-success" : " rc-fail");
            // 如果之前在等待生成，清理进度条
            if (document.getElementById("genProgressBar")) {
                document.getElementById("genProgressBar").remove();
            }
            // 朗读结束后恢复思考状态
            const elCat = document.getElementById("thinkingCat");
            if (elCat && elCat.textContent === "朗读") {
                _updateThinkingDisplay("思考", "继续推理...", 50);
            }
            const resultText = escapeHtml((rec.内容.结果||"").substring(0,200));
            div.innerHTML = `<div class="rc-icon">${rec.内容.成功 ? "✅" : "❌"}</div><div class="rc-content">${resultText}</div>`;
            break;
        case "下载进度": {
            const p = rec.内容;
            let progBar = document.getElementById("downloadProgressBar");
            if (!progBar) {
                progBar = document.createElement("div");
                progBar.id = "downloadProgressBar";
                progBar.className = "reasoning-card rc-progress download-progress";
                progBar.innerHTML = `<div class="dl-header">⬇️ <span class="dl-name">${escapeHtml(p.文件名||'下载中')}</span></div><div class="dl-bar-container"><div class="dl-bar-fill" style="width:${p.百分比||0}%"></div></div><div class="dl-info"><span class="dl-pct">${p.百分比||0}%</span><span class="dl-size">${p.已下载MB||0}/${p.总大小MB||0} MB</span><span class="dl-speed">${p.速度MB每秒||0} MB/s</span><span class="dl-chunks">${p.已完成分块||''}</span></div>`;
                body.appendChild(progBar);
            } else {
                progBar.querySelector(".dl-name").textContent = p.文件名 || '下载中';
                progBar.querySelector(".dl-bar-fill").style.width = (p.百分比||0) + "%";
                progBar.querySelector(".dl-pct").textContent = (p.百分比||0) + "%";
                progBar.querySelector(".dl-size").textContent = `${p.已下载MB||0}/${p.总大小MB||0} MB`;
                progBar.querySelector(".dl-speed").textContent = `${p.速度MB每秒||0} MB/s`;
                progBar.querySelector(".dl-chunks").textContent = p.已完成分块 || '';
                if ((p.百分比||0) >= 100) {
                    progBar.querySelector(".dl-bar-fill").classList.add("complete");
                    progBar.removeAttribute("id");
                    refreshTree();
                    if (galleryPath) showGallery(galleryPath);
                }
            }
            body.scrollTop = body.scrollHeight;
            return;
        }
        case "最终回复":
            if (document.getElementById("genProgressBar")) {
                document.getElementById("genProgressBar").remove();
            }
            div.className += " rc-reply";
            div.innerHTML = `<div class="rc-icon">💬</div><div class="rc-content">${escapeHtml((rec.内容.内容||"").substring(0,300))}</div>`; break;
        case "生成进度":
        case "启动进度": {
            const p = rec.内容;
            const isGen = rec.类型 === "生成进度";
            const label = isGen ? "ComfyUI生成中" : "ComfyUI启动中";
            const elapsed = p.已耗时秒 || 0;
            _updateThinkingDisplay("等待", `${label}... ${elapsed}秒`, 70);
            let progBar = document.getElementById("genProgressBar");
            if (!progBar) {
                progBar = document.createElement("div");
                progBar.id = "genProgressBar";
                progBar.className = "reasoning-card rc-progress gen-progress";
                progBar.innerHTML = `<div class="gen-header">⏳ ${label}... <span class="gen-elapsed">${elapsed}秒</span></div><div class="gen-bar-container"><div class="gen-bar-fill" style="width:100%"></div></div>`;
                body.appendChild(progBar);
            } else {
                const header = progBar.querySelector(".gen-header");
                if (header) header.innerHTML = `⏳ ${label}... <span class="gen-elapsed">${elapsed}秒</span>`;
            }
            body.scrollTop = body.scrollHeight;
            return;
        }
        default:
            div.innerHTML = `<div class="rc-icon">•</div><div class="rc-content">${escapeHtml(rec.类型)}: ${escapeHtml(JSON.stringify(rec.内容).substring(0,100))}</div>`;
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

// ============ 编辑器内容刷新 ============
// ============ Toast通知系统 ============
// ============ Toast通知 → 已拆分到 模块/Toast通知.js ============
// initToast, showToast, showEditorModifiedBanner, flashEditorLines 已移至独立文件

async function refreshAllOpenFiles(force) {
    // 刷新所有打开的文件内容（force=true时即使内容相同也更新编辑器+显示反馈）
    for (let i = 0; i < openFiles.length; i++) {
        const f = openFiles[i];
        if (f.type === 'document') {
            if (force) await renderDocumentContent(i);
            continue;
        }
        try {
            const res = await fetch("/api/file-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: f.path }) });
            const d = await res.json();
            if (d.成功 && (force || d.内容 !== f.content)) {
                const 旧内容 = f.content;
                const 新内容 = d.内容;
                // 找diff行范围
                const 旧行 = 旧内容.split("\n");
                const 新行 = 新内容.split("\n");
                let startLine = -1, endLine = -1;
                const maxLen = Math.max(旧行.length, 新行.length);
                for (let li = 0; li < maxLen; li++) {
                    if (li >= 旧行.length || li >= 新行.length || 旧行[li] !== 新行[li]) {
                        if (startLine === -1) startLine = li;
                        endLine = li;
                    }
                }
                // 更新内容
                f.content = 新内容;
                if (i === activeFileIdx && editorInstance) {
                    // 记录撤销
                    pushUndo(i, 旧内容, 新内容, "AI修改");
                    editorInstance.设置内容(新内容);
                    // 内容变化后清除框选状态（位置已失效）
                    if (旧内容 !== 新内容) {
                        editorSelection = null;
                        hideSelectionHint();
                        if (editorInstance) editorInstance.清除选区高亮();
                        // 高亮新增文本（字符级）— applyLiveDiff已处理时跳过，避免用全文件diff覆盖精确的块级diff
                        if (!liveDiffHandled) {
                            const added = computeAddedRange(旧内容, 新内容);
                            if (added) highlightNewText(editorInstance, added.start, added.end);
                        }
                    }
                    // 闪烁+提示（仅当前Tab）
                    if (startLine >= 0) {
                        const isDelete = 新行.length < 旧行.length;
                        const opType = isDelete ? "delete" : "modify";
                        const opLabel = isDelete ? "已删除" : "已修改";
                        flashEditorLines(startLine, endLine, opType);
                        showEditorModifiedBanner(`AI${opLabel} (第${startLine + 1}-${endLine + 1}行)`, opType);
                        showToast(opType, `${isDelete ? "🗑️" : "✏️"} 文件${opLabel}`, `${f.name} 第${startLine + 1}-${endLine + 1}行`);
                        const ta = document.getElementById("codeInput");
                        if (ta) {
                            const 行高 = parseFloat(getComputedStyle(ta).lineHeight) || 19.5;
                            ta.scrollTop = Math.max(0, startLine * 行高 - 60);
                        }
                    } else if (force) {
                        // 内容未变化但需要反馈
                        showToast("info", "🔄 已刷新", `${f.name} 内容无变化`);
                    }
                }
                f.dirty = true;
                renderTabs();
            }
        } catch (e) {}
    }
}

// ============ 实时Diff系统 ============

// 计算新增文本的字符范围（公共前缀/后缀法）
// 返回 {start, end} 或 null（纯删除/无变化）
function computeAddedRange(oldText, newText) {
    if (oldText === newText) return null;
    if (!newText) return null; // 纯删除
    // 找公共前缀
    let prefix = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;
    // 找公共后缀
    let suffix = 0;
    while (suffix < minLen - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
    const addedStart = prefix;
    const addedEnd = newText.length - suffix;
    if (addedStart >= addedEnd) return null;
    return { start: addedStart, end: addedEnd };
}

// 高亮新增文本并自动淡出
let highlightClearTimer = null;
let liveDiffHandled = false;  // applyLiveDiff是否已处理高亮
function highlightNewText(editor, start, end) {
    if (!editor || start < 0 || end <= start) return;
    editor.设置新增高亮(start, end);
    if (highlightClearTimer) clearTimeout(highlightClearTimer);
    highlightClearTimer = setTimeout(() => { editor.清除新增高亮(); }, 5000);
}

function applyLiveDiff(旧文本, 新文本) {
    if (activeFileIdx < 0 || !editorInstance) return;
    const ta = document.getElementById("codeInput");
    const 当前内容 = ta.value;
    const 位置 = 当前内容.indexOf(旧文本);
    if (位置 === -1) {
        // 编辑器中找不到旧文本（可能已被之前的操作修改），清除框选状态防止过期
        editorSelection = null;
        hideSelectionHint();
        if (editorInstance) editorInstance.清除选区高亮();
        return;
    }

    // 直接在textarea中替换
    const 新内容 = 当前内容.substring(0, 位置) + 新文本 + 当前内容.substring(位置 + 旧文本.length);
    const isDelete = 新文本 === "";
    // 记录撤销
    pushUndo(activeFileIdx, 当前内容, 新内容, isDelete ? "AI删除" : "AI替换");
    ta.value = 新内容;
    editorInstance.设置内容(新内容);

    // 更新openFiles
    openFiles[activeFileIdx].content = 新内容;
    openFiles[activeFileIdx].dirty = true;
    renderTabs();

    // 清除框选状态
    editorSelection = null;
    hideSelectionHint();
    if (editorInstance) editorInstance.清除选区高亮();

    // 高亮新增文本（字符级，仅对比替换块的差异）
    if (!isDelete && editorInstance) {
        const added = computeAddedRange(旧文本, 新文本);
        if (added) {
            highlightNewText(editorInstance, 位置 + added.start, 位置 + added.end);
            liveDiffHandled = true;
        }
    }

    // 计算修改行范围并闪烁
    const 替换前内容 = 当前内容.substring(0, 位置);
    const startLine = 替换前内容.split("\n").length - 1;
    const 新行数 = 新文本.split("\n").length - 1;
    const endLine = startLine + 新行数;
    const opType = isDelete ? "delete" : "modify";
    flashEditorLines(startLine, endLine, opType);

    // 修改提示（颜色区分）
    const 操作描述 = isDelete ? `删除「${旧文本.substring(0, 25)}${旧文本.length > 25 ? "..." : ""}」` : `→「${新文本.substring(0, 30)}${新文本.length > 30 ? "..." : ""}」`;
    const toastType = isDelete ? "delete" : "modify";
    const toastIcon = isDelete ? "🗑️" : "✏️";
    showEditorModifiedBanner(`第${startLine + 1}行 ${操作描述}`, opType);
    showToast(toastType, `${toastIcon} ${isDelete ? "已删除" : "已替换"}`, `${openFiles[activeFileIdx].name} 第${startLine + 1}行 ${操作描述}`);

    // 显示diff高亮
    showDiffOverlay(位置, 旧文本, 新文本, 新内容);
}

function showDiffOverlay(position, 旧文本, 新文本, 新内容) {
    const container = document.getElementById("editorContainer");
    const ta = document.getElementById("codeInput");
    if (!container || !ta) return;

    // 计算替换起始行号
    const 替换前内容 = 新内容.substring(0, position);
    const startLine = 替换前内容.split("\n").length - 1;
    const 行高 = parseFloat(getComputedStyle(ta).lineHeight) || 19.5;
    const scrollTop = ta.scrollTop || 0;
    const containerRect = container.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    const offsetY = taRect.top - containerRect.top;
    const topPx = startLine * 行高 + offsetY - scrollTop;

    // 创建diff信息浮层（贴在修改行右侧）
    const highlightLayer = document.createElement("div");
    highlightLayer.className = "diff-highlight-layer";
    highlightLayer.innerHTML = `<div class="diff-change-info">
        <span class="diff-del-badge">−${旧文本.length}字</span>
        <span class="diff-add-badge">+${新文本.length}字</span>
        <span class="diff-accept" onclick="this.parentElement.parentElement.remove()">✕</span>
    </div>`;
    highlightLayer.style.top = (topPx - 24) + "px";
    container.appendChild(highlightLayer);

    // 在编辑器背景中添加高亮条（标记被修改的行区域）
    const 新行数 = 新文本.split("\n").length;
    const 行高亮 = document.createElement("div");
    行高亮.className = "diff-line-highlight";
    行高亮.style.cssText = `position:absolute;left:48px;right:0;top:${topPx}px;height:${新行数 * 行高}px;background:rgba(233,30,126,0.06);border-left:3px solid #E91E63;z-index:1;pointer-events:none;transition:opacity 2s;`;
    container.appendChild(行高亮);

    // 5秒后自动淡出
    setTimeout(() => {
        if (highlightLayer.parentElement) {
            highlightLayer.style.opacity = "0";
            setTimeout(() => highlightLayer.remove(), 1000);
        }
        if (行高亮.parentElement) {
            行高亮.style.opacity = "0";
            setTimeout(() => 行高亮.remove(), 2000);
        }
    }, 5000);

    // 滚动到修改位置
    ta.scrollTop = Math.max(0, topPx - 60);
}

// ============ 消息显示 ============
function addMsg(role, text, time) {
    const list = document.getElementById("msgList");
    const el = document.createElement("div");
    el.className = `msg ${role === "user" ? "user" : role === "system" ? "system" : "assistant"}`;
    // 时间戳标签
    if (time) {
        const t = document.createElement("div");
        t.className = "msg-time";
        t.textContent = time;
        el.appendChild(t);
    }
    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = renderMsg(text);
    el.appendChild(body);
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
}

// 快速流式输出（Claude Code风格：文字快速涌入）
function renderMsg(text) {
    if (typeof marked !== 'undefined') {
        try {
            // 配置 marked
            marked.setOptions({
                breaks: true,
                gfm: true
            });
            let html = marked.parse(text);
            // 代码高亮
            if (typeof hljs !== 'undefined') {
                // 给代码块添加复制按钮
                const tmp = document.createElement('div');
                tmp.innerHTML = html;
                tmp.querySelectorAll('pre code').forEach(block => {
                    try { hljs.highlightElement(block); } catch(e) {}
                    // 添加复制按钮
                    const pre = block.parentElement;
                    const btn = document.createElement('button');
                    btn.className = 'code-copy-btn';
                    btn.textContent = '📋';
                    btn.onclick = function() {
                        navigator.clipboard.writeText(block.textContent);
                        btn.textContent = '✅';
                        setTimeout(() => btn.textContent = '📋', 1000);
                    };
                    pre.style.position = 'relative';
                    pre.appendChild(btn);
                });
                html = tmp.innerHTML;
            }
            // LaTeX公式渲染（在Markdown渲染之后，避免与代码块冲突）
            if (typeof renderMathInElement !== 'undefined') {
                const tmp2 = document.createElement('div');
                tmp2.innerHTML = html;
                renderMathInElement(tmp2, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ],
                    throwOnError: false
                });
                html = tmp2.innerHTML;
            }
            return html;
        } catch(e) {
            // 降级到简单渲染
        }
    }
    // 降级：简单渲染
    let html = escapeHtml(text);
    html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:var(--bg);padding:8px;border-radius:4px;margin:4px 0;overflow-x:auto;font-size:12px">$1</pre>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^&gt;\s?(.+)$/gm, '<div style="border-left:3px solid var(--blue);padding:2px 8px;margin:2px 0;color:var(--text2)">$1</div>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function clearChat() { document.getElementById("msgList").innerHTML = ""; fetch("/api/clear-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }

// ============ 多对话管理 ============
let currentConvID = null;
let convListOpen = false;

async function loadConvList() {
    try {
        const res = await fetch("/api/conversations");
        const d = await res.json();
        const list = d.对话列表 || [];
        currentConvID = d.当前ID;
        const container = document.getElementById("convListItems");
        if (!container) return;
        container.innerHTML = "";
        if (list.length === 0) {
            container.innerHTML = '<div style="padding:8px 10px;color:var(--text2);font-size:11px;text-align:center">暂无对话</div>';
            return d;
        }
        for (const c of list) {
            const el = document.createElement("div");
            el.className = `conv-item${c.id === currentConvID ? " active" : ""}`;
            const time = c.更新时间 ? c.更新时间.substring(5, 16).replace("T", " ") : "";
            el.innerHTML = `<span class="conv-title" title="${c.标题}">${c.标题}</span><span style="color:var(--text2);font-size:10px">${time}</span><span class="conv-del" onclick="event.stopPropagation();deleteConv('${c.id}')" title="删除此对话">✕</span>`;
            el.addEventListener("click", () => switchConv(c.id));
            container.appendChild(el);
        }
        return d;
    } catch (e) {}
    return null;
}

function toggleConvList() {
    convListOpen = !convListOpen;
    document.getElementById("convList").style.display = convListOpen ? "block" : "none";
    if (convListOpen) loadConvList();
}

// 点击对话列表外的空白处自动收回
document.addEventListener("click", (e) => {
    if (!convListOpen) return;
    const convList = document.getElementById("convList");
    const toggleBtn = document.querySelector('.bar-btn[onclick="toggleConvList()"]');
    if (convList && !convList.contains(e.target) && !(toggleBtn && toggleBtn.contains(e.target))) {
        convListOpen = false;
        convList.style.display = "none";
    }
});

async function newConversation() {
    try {
        const res = await fetch("/api/conversation-new", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.成功) {
            document.getElementById("msgList").innerHTML = "";
            currentConvID = d.对话?.id;
            // 只刷新对话列表，不自动展开
            if (convListOpen) loadConvList();
            showToast("success", "✅ 新建对话", `对话 ${d.对话?.标题 || "新对话"} 已创建`);
        } else {
            showToast("error", "❌ 新建失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

async function switchConv(id) {
    if (id === currentConvID) return;
    try {
        const res = await fetch("/api/conversation-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        const d = await res.json();
        if (d.成功) {
            currentConvID = id;
            document.getElementById("msgList").innerHTML = "";
            loadConvList();
            // 加载并渲染该对话的历史消息
            loadConvMessages();
        } else {
            showToast("error", "❌ 切换失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

async function deleteConv(id) {
    if (!confirm("确定删除此对话？")) return;
    try {
        const res = await fetch("/api/conversation-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        const d = await res.json();
        if (d.成功) {
            document.getElementById("msgList").innerHTML = "";
            currentConvID = null;
            loadConvList();
            showToast("success", "🗑️ 已删除", "对话已删除");
        } else {
            showToast("error", "❌ 删除失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

// 加载当前对话的历史消息到界面
async function loadConvMessages() {
    try {
        const res = await fetch("/api/conversation-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: currentConvID }) });
        const d = await res.json();
        if (d.成功 && d.历史) {
            const list = document.getElementById("msgList");
            list.innerHTML = "";
            for (const msg of d.历史) {
                addMsg(msg.角色 || "assistant", msg.内容 || "", msg.时间 || "");
            }
        }
    } catch (e) {}
}

// ============ 模型配置管理 ============
let modelConfigData = null;  // 缓存模型配置

async function loadModelConfig() {
    try {
        const res = await fetch("/api/model-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (!d.成功) {
            const curEl = document.getElementById("currentModelName");
            if (curEl) curEl.textContent = "加载失败";
            showToast("error", "❌ 模型配置加载失败", d.错误 || "未知错误");
            return;
        }
        modelConfigData = d;
        // 显示当前模型
        const curEl = document.getElementById("currentModelName");
        if (curEl) curEl.textContent = d.当前模型 || "未设置";
        // 渲染模型列表（国内|国外 两列分区布局）
        const list = document.getElementById("modelList");
        if (!list) return;
        list.innerHTML = "";
        list.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;";
        const 国内模型 = ["DeepSeek(深度求索)", "通义千问(阿里云)", "智谱大模型(GLM)", "Kimi(月之暗面)", "豆包(火山大模型)"];
        const allModels = d.模型列表 || [];
        // 左列：国内，右列：国外+自定义
        const 左列 = allModels.filter(m => 国内模型.includes(m.名称));
        const 右列 = allModels.filter(m => !国内模型.includes(m.名称));
        const maxRows = Math.max(左列.length, 右列.length);
        for (let i = 0; i < maxRows; i++) {
            // 左列
            if (i < 左列.length) {
                const m = 左列[i];
                const isCurrent = m.名称 === d.当前模型;
                const el = document.createElement("div");
                el.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--border);" + (isCurrent ? "border-color:var(--blue);background:rgba(33,150,243,0.08);" : "");
                el.innerHTML = `<span style="font-size:14px;">${isCurrent ? "✅" : "⚪"}</span><span style="font-weight:600;font-size:13px;">${m.名称}</span>`;
                el.addEventListener("click", () => switchModel(m.名称));
                list.appendChild(el);
            } else {
                const ph = document.createElement("div");
                list.appendChild(ph);
            }
            // 右列
            if (i < 右列.length) {
                const m = 右列[i];
                const isCurrent = m.名称 === d.当前模型;
                const el = document.createElement("div");
                el.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--border);" + (isCurrent ? "border-color:var(--blue);background:rgba(33,150,243,0.08);" : "");
                el.innerHTML = `<span style="font-size:14px;">${isCurrent ? "✅" : "⚪"}</span><span style="font-weight:600;font-size:13px;">${m.名称}</span>`;
                el.addEventListener("click", () => switchModel(m.名称));
                list.appendChild(el);
            } else {
                const ph = document.createElement("div");
                list.appendChild(ph);
            }
        }
        // 渲染密钥编辑器
        renderModelKeyEditor(d);
    } catch (e) {
        const curEl = document.getElementById("currentModelName");
        if (curEl) curEl.textContent = "连接失败";
        showToast("error", "❌ 无法连接服务器", e.message);
    }
}

function renderModelKeyEditor(d) {
    const editor = document.getElementById("modelKeyEditor");
    if (!editor) return;
    editor.innerHTML = "";
    // 只渲染当前选中模型的密钥配置
    const 当前模型名 = d.当前模型;
    const m = (d.模型列表 || []).find(x => x.名称 === 当前模型名);
    if (!m) {
        editor.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:8px;">请先选择一个模型</div>';
        return;
    }
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:8px 12px;border:1px solid var(--border);border-radius:6px;";
    const 密钥配置 = m.已配置密钥 || {};
    const 环境变量 = m.环境变量 || {};
    let inputs = "";
    for (const [变量名, 环境键] of Object.entries(环境变量)) {
        const 已有 = 密钥配置[变量名] || "";
        const placeholder = 已有 ? `已配置: ${已有}` : "未配置";
        inputs += `<div style="margin-top:6px;"><label style="font-size:11px;color:var(--text2);">${变量名}</label><input type="password" data-model="${m.名称}" data-key="${变量名}" class="dialog-input" placeholder="${placeholder}" style="width:100%;margin-top:2px;" /></div>`;
    }
    const 已有模型名 = 密钥配置["模型名称"] || "";
    wrap.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">${m.名称} — 模型名</div><input type="text" data-model="${m.名称}" data-key="_模型名称" class="dialog-input" placeholder="如 deepseek-chat" value="${已有模型名}" style="width:100%;" />${inputs}`;
    editor.appendChild(wrap);
}

async function switchModel(模型名) {
    try {
        const res = await fetch("/api/switch-model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 模型: 模型名 }) });
        const d = await res.json();
        if (d.成功) {
            showToast("success", "✅ 模型已切换", `当前: ${模型名}`);
            loadModelConfig(); // 刷新UI
        } else {
            showToast("error", "❌ 切换失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

async function saveModelConfig() {
    if (!modelConfigData) return;
    // 收集所有输入框的值
    const inputs = document.querySelectorAll("#modelKeyEditor input[data-model]");
    const 保存数据 = {};  // {模型名: {密钥变量: 值}}
    for (const inp of inputs) {
        const 模型 = inp.dataset.model;
        const 键 = inp.dataset.key;
        const 值 = inp.value.trim();
        if (值) {
            if (!保存数据[模型]) 保存数据[模型] = {};
            if (键 === "_模型名称") {
                保存数据[模型]["模型名称"] = 值;
            } else {
                保存数据[模型][键] = 值;
            }
        }
    }
    // 逐个模型保存
    let 成功数 = 0;
    for (const [模型名, 密钥] of Object.entries(保存数据)) {
        try {
            const res = await fetch("/api/model-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 模型: 模型名, 密钥 }) });
            const d = await res.json();
            if (d.成功) 成功数++;
        } catch (e) {}
    }
    if (成功数 > 0) {
        showToast("success", "✅ 密钥已保存", `${成功数}个模型配置已更新`);
        loadModelConfig();
    } else {
        showToast("info", "ℹ️ 无变更", "没有填写新的密钥");
    }
}

async function loadSystemStatus() {
    try {
        const res = await fetch("/api/status"); const s = await res.json();
        document.getElementById("statusInfo").textContent = `模式: ${s.对话?.工作模式 || "商量"} | 模型: ${s.当前模型 || "默认"}`;
    } catch (e) {}
}

// ============ 文件树 ============
async function openFolderDialog() {
    document.getElementById("openFolderOverlay").style.display = "flex";
    document.getElementById("openFolderPath").value = "";
    document.getElementById("openFolderPath").focus();
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        const list = document.getElementById("driveList");
        list.innerHTML = "";
        // 智能体根目录快捷按钮
        const agentBtn = document.createElement("button");
        agentBtn.className = "drive-btn";
        agentBtn.style.background = "var(--accent-soft)";
        agentBtn.textContent = "🏠 智能体根目录";
        agentBtn.title = "打开智能体根目录";
        agentBtn.addEventListener("click", () => { document.getElementById("openFolderPath").value = "."; doOpenFolder(); });
        list.appendChild(agentBtn);
        for (const drv of (d.驱动器 || [])) {
            const btn = document.createElement("button");
            btn.className = "drive-btn";
            btn.textContent = `${drv.图标 || "💾"} ${drv.盘符}`;
            btn.title = `打开 ${drv.路径}`;
            btn.addEventListener("click", () => { document.getElementById("openFolderPath").value = drv.路径; doOpenFolder(); });
            list.appendChild(btn);
        }
    } catch (e) {}
}
function doOpenFolder() {
    const path = document.getElementById("openFolderPath").value.trim();
    if (!path) return;
    document.getElementById("openFolderOverlay").style.display = "none";
    openFolder(path);
}
async function browseFolder() {
    try {
        showToast("info", "📂 打开文件夹选择器", "请在弹出的对话框中选择文件夹...");
        const res = await fetch("/api/folder-dialog", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.路径) {
            document.getElementById("openFolderPath").value = d.路径;
            doOpenFolder();
        } else {
            showToast("info", "ℹ️ 已取消", "未选择文件夹");
        }
    } catch (e) { showToast("error", "❌ 无法打开对话框", e.message); }
}
function openFolderByPath() { const p = document.getElementById("folderPathInput").value.trim(); if (p) openFolder(p); }

async function openFolder(path) {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    currentRoot = path.replace(/[\/\\]+$/, "");
    currentRootDisplay = currentRoot === "." ? "项目根目录" : currentRoot;
    if (currentRoot !== ".") localStorage.setItem("lastFolder", currentRoot);
    try {
        const res = await fetch(`/api/file-tree?path=${encodeURIComponent(currentRoot)}&depth=3`);
        const d = await res.json();
        if (d.成功) {
            const tree = document.getElementById("fileTree");
            tree.innerHTML = "";
            // 我的电脑快捷入口（始终置顶）
            const mcItem = document.createElement("div");
            mcItem.className = "ti";
            mcItem.style.borderBottom = "1px solid var(--border)";
            mcItem.innerHTML = `<span class="arr"> </span><span class="ico">💻</span><span class="nm">我的电脑</span>`;
            mcItem.addEventListener("click", e => { e.stopPropagation(); openMyComputer(); });
            tree.appendChild(mcItem);
            const root = d.树;
            root.名称 = root.名称 || currentRootDisplay;
            const rootEl = document.createElement("div");
            const rootItem = document.createElement("div");
            rootItem.className = "ti active";
            rootItem.innerHTML = `<span class="arr">▼</span><span class="ico">📁</span><span class="nm">${root.名称}</span><button class="ren-btn" title="重命名此文件夹">✏️</button><button class="exp-btn" title="在Windows资源管理器中打开此文件夹">🗂️</button><button class="del-btn" title="删除此文件夹及其所有内容">🗑️</button>`;
            rootEl.appendChild(rootItem);
            rootItem.addEventListener("click", e => {
                if (e.target.classList.contains("exp-btn")) { e.stopPropagation(); openInExplorer(currentRoot); return; }
                if (e.target.classList.contains("del-btn")) { e.stopPropagation(); deleteItem(currentRoot, root.名称, true); return; }
                if (e.target.classList.contains("ren-btn")) { e.stopPropagation(); renameItem(currentRoot, root.名称); return; }
                e.stopPropagation();
                showGallery(currentRoot);
            });
            const rootKids = document.createElement("div");
            rootKids.className = "tc open";
            if (root.子项) for (const c of root.子项) rootKids.appendChild(buildTreeNode(c, currentRoot));
            rootEl.appendChild(rootKids);
            tree.appendChild(rootEl);
        } else {
            document.getElementById("fileTree").innerHTML = `<div class="tree-hint">❌ ${d.错误 || "无法打开"}</div>`;
        }
    } catch (e) {
        document.getElementById("fileTree").innerHTML = `<div class="tree-hint">❌ 连接错误</div>`;
    }
}

async function openMyComputer() {
    currentRoot = null;
    galleryPath = null;
    const tree = document.getElementById("fileTree");
    tree.innerHTML = "";
    const mcEl = document.createElement("div");
    const mcItem = document.createElement("div");
    mcItem.className = "ti active";
    mcItem.innerHTML = `<span class="arr">▼</span><span class="ico">💻</span><span class="nm">我的电脑</span>`;
    mcEl.appendChild(mcItem);
    mcItem.addEventListener("click", e => { e.stopPropagation(); openMyComputer(); });
    const mcKids = document.createElement("div");
    mcKids.className = "tc open";
    mcEl.appendChild(mcKids);
    tree.appendChild(mcEl);
    // 画廊显示磁盘列表
    showMediaView();
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "none";
    document.getElementById("galleryHeader").style.display = "flex";
    document.getElementById("galleryCurrentPath").textContent = "我的电脑";
    updateViewToggleButtons();
    const grid = document.getElementById("galleryGrid");
    grid.innerHTML = '<div class="gallery-empty">加载中...</div>';
    document.getElementById("galleryList").style.display = "none";
    grid.style.display = "";
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        const drives = d.驱动器 || [];
        galleryItemsCache = drives.map(drv => ({ 名称: drv.标签 || drv.盘符, 类型: "目录", 后缀: "", 大小: 0, 创建时间: "" }));
        galleryImages = [];
        audioPlaylist = [];
        videoPlaylist = [];
        grid.innerHTML = "";
        mcKids.innerHTML = "";
        for (const drv of drives) {
            const label = drv.标签 || drv.盘符;
            // 左侧树：磁盘作为可点击子项
            const ti = document.createElement("div");
            ti.className = "ti";
            ti.innerHTML = `<span class="arr"> </span><span class="ico">📁</span><span class="nm">${label}</span>`;
            ti.addEventListener("click", e => { e.stopPropagation(); openFolder(drv.路径); showGallery(drv.路径); });
            mcKids.appendChild(ti);
            // 中间画廊：统一用文件夹图标
            const item = document.createElement("div");
            item.className = "gallery-item";
            item.title = `打开 ${drv.路径}`;
            item.innerHTML = `<div class="gallery-thumb">📁</div><div class="gallery-name">${label}</div>`;
            item.addEventListener("click", () => { openFolder(drv.路径); showGallery(drv.路径); });
            grid.appendChild(item);
        }
        if (drives.length === 0) grid.innerHTML = '<div class="gallery-empty">未找到磁盘</div>';
    } catch (e) {
        grid.innerHTML = '<div class="gallery-empty">❌ 无法获取磁盘列表</div>';
    }
}

function buildTreeNode(node, path) {
    const el = document.createElement("div");
    const isDir = node.类型 === "目录";
    if (isDir) {
        const item = document.createElement("div");
        item.className = "ti";
        const hasKids = (node.子项?.length > 0) || node.截断;
        const fullPath = joinPath(path, node.名称);
        const truncated = !!node.截断;
        item.innerHTML = `<span class="arr">${hasKids ? "▶" : " "}</span><span class="ico">📁</span><span class="nm">${node.名称}</span><button class="ren-btn" title="重命名此文件夹">✏️</button><button class="exp-btn" title="在Windows资源管理器中打开此文件夹">🗂️</button><button class="del-btn" title="删除此文件夹及其所有内容">🗑️</button>`;
        el.appendChild(item);
        const kids = document.createElement("div");
        kids.className = "tc";
        if (node.子项) for (const c of node.子项) kids.appendChild(buildTreeNode(c, fullPath));
        el.appendChild(kids);
        item.addEventListener("click", e => {
            if (e.target.classList.contains("exp-btn")) { e.stopPropagation(); openInExplorer(fullPath); return; }
            if (e.target.classList.contains("del-btn")) { e.stopPropagation(); deleteItem(fullPath, node.名称, true); return; }
            if (e.target.classList.contains("ren-btn")) { e.stopPropagation(); renameItem(fullPath, node.名称); return; }
            e.stopPropagation();
            showGallery(fullPath);
            // 同步更新currentRoot，确保AI上下文正确
            currentRoot = fullPath;
            // 截断的文件夹需要懒加载子项
            if (truncated && !kids.dataset.loaded) {
                const arr = item.querySelector(".arr");
                if (arr) arr.textContent = "⏳";
                fetch(`/api/file-tree?path=${encodeURIComponent(fullPath)}&depth=1`).then(r => r.json()).then(d => {
                    if (d.成功 && d.树) {
                        kids.innerHTML = "";
                        const 子节点列表 = d.树.子项 || [];
                        for (const c of 子节点列表) kids.appendChild(buildTreeNode(c, fullPath));
                        kids.dataset.loaded = "1";
                    }
                    const open = kids.classList.toggle("open");
                    if (arr) arr.textContent = open ? "▼" : "▶";
                    item.classList.toggle("active", open);
                }).catch(() => {
                    if (arr) arr.textContent = "▶";
                });
                return;
            }
            const open = kids.classList.toggle("open");
            const arr = item.querySelector(".arr");
            if (arr) arr.textContent = open ? "▼" : (hasKids ? "▶" : " ");
            item.classList.toggle("active", open);
        });
        item.addEventListener("dblclick", e => { e.stopPropagation(); openFolder(fullPath); showGallery(fullPath); });
    } else {
        const item = document.createElement("div");
        const fullPath = joinPath(path, node.名称);
        item.className = "ti";
        item.innerHTML = `<span class="arr"> </span><span class="ico">${fileIcon(node.后缀 || "")}</span><span class="nm">${node.名称}</span><button class="del-btn" title="删除此文件">🗑️</button>`;
        item.addEventListener("click", e => {
            if (e.target.classList.contains("del-btn")) { e.stopPropagation(); deleteItem(fullPath, node.名称, false); return; }
            e.stopPropagation();
            if (isImage(node.后缀 || "")) { showImage(fullPath, node.名称); return; }
            if (isAudio(node.后缀 || "")) { showAudio(fullPath, node.名称); return; }
            if (isVideo(node.后缀 || "")) { const idx = videoPlaylist.findIndex(v => v.路径 === fullPath); showVideo(fullPath, node.名称, idx); return; }
            if (isDocument(node.后缀 || "")) { showDocument(fullPath, node.名称); return; }
            const ext = (node.后缀 || "").toLowerCase();
            const 可编辑 = [".py",".js",".css",".html",".json",".md",".bat",".sh",".txt",".cs",".java",".ts",".tsx",".jsx",".vue",".go",".rs",".cpp",".h",".yml",".yaml",".toml",".ini",".env",".gitignore"].includes(ext);
            if (!可编辑) { showToast("info", "🔒 不支持的格式", `「${node.名称}」无法在此应用中打开`); return; }
            hideMediaView();
            openFileInEditor(path, node.名称);
        });
        el.appendChild(item);
    }
    return el;
}

async function deleteItem(path, name, isDir) {
    const typeHint = isDir ? "文件夹（含所有内容）" : "文件";
    if (!confirm(`确定要删除${typeHint}「${name}」吗？\n此操作不可撤销！`)) return;
    try {
        const res = await fetch("/api/file-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path }) });
        const d = await res.json();
        if (d.成功) {
            // 如果删除的文件正在编辑器中打开，关闭对应Tab
            const idx = openFiles.findIndex(f => f.path === path);
            if (idx >= 0) closeTab(idx);
            refreshTree();
        } else {
            alert("删除失败: " + (d.错误 || "未知错误"));
        }
    } catch (e) {
        alert("删除失败: " + e.message);
    }
}

async function renameItem(path, name) {
    const 新名称 = prompt("请输入新名称：", name);
    if (!新名称 || 新名称 === name) return;
    try {
        const res = await fetch("/api/file-rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path, 新名称 }) });
        const d = await res.json();
        if (d.成功) {
            // 更新打开的文件标签路径
            const idx = openFiles.findIndex(f => f.path === path);
            if (idx >= 0) { openFiles[idx].path = joinPath(path.replace(/[\\/][^\\/]+$/, ""), 新名称); openFiles[idx].name = 新名称; renderTabs(); }
            refreshTree();
        } else {
            alert("重命名失败: " + (d.错误 || "未知错误"));
        }
    } catch (e) {
        alert("重命名失败: " + e.message);
    }
}

function fileIcon(ext) {
    const m = {".py":"🐍",".js":"📜",".css":"🎨",".html":"🌐",".json":"📋",".md":"📝",".bat":"⚙️",".sh":"⚙️",".txt":"📄",".cs":"🔵",".java":"☕",".ts":"🔷",".tsx":"⚛️",".jsx":"⚛️",".vue":"💚",".go":"🔹",".rs":"🦀",".cpp":"⚙️",".h":"📄",".yml":"📋",".yaml":"📋",".toml":"📋",".ini":"📋",".env":"🔒",".gitignore":"🚫",".png":"🖼️",".jpg":"🖼️",".jpeg":"🖼️",".gif":"🖼️",".webp":"🖼️",".bmp":"🖼️",".svg":"🖼️",".mp3":"🎵",".wav":"🎵",".ogg":"🎵",".m4a":"🎵",".flac":"🎵",".aac":"🎵",".opus":"🎵",".wma":"🎵",".mp4":"🎬",".webm":"🎬",".mkv":"🎬",".avi":"🎬",".wmv":"🎬",".mov":"🎬",".flv":"🎬",".ts":"🎬",".docx":"📄",".doc":"📄",".xlsx":"📊",".xls":"📊",".csv":"📊",".pdf":"📕"};
    return m[ext] || "📄";
}

const 图片后缀 = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
function isImage(ext) { return 图片后缀.includes(ext.toLowerCase()); }

const 音频后缀 = [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus", ".wma"];
function isAudio(ext) { return 音频后缀.includes(ext.toLowerCase()); }

const 视频后缀 = [".mp4", ".webm", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".ts"];
function isVideo(ext) { return 视频后缀.includes(ext.toLowerCase()); }

const 文档后缀 = [".docx", ".doc", ".xlsx", ".xls", ".csv", ".pdf"];
function isDocument(ext) { return 文档后缀.includes(ext.toLowerCase()); }

function showMediaView() {
    document.getElementById("editorContainer").style.display = "none";
    document.getElementById("editorToolbar").style.display = "none";
    document.getElementById("tabBar").style.display = "none";
    const mv = document.getElementById("mediaView");
    mv.style.display = "flex";
    mv.style.overflowY = "auto";
    mv.style.padding = "0 12px 12px 12px";
}
function hideMediaView() {
    document.getElementById("mediaView").style.display = "none";
    document.getElementById("editorContainer").style.display = "";
    document.getElementById("editorToolbar").style.display = "";
    document.getElementById("tabBar").style.display = "";
    hideAudioPlayer();
    hideVideoPlayer();
    hideDocViewer();
    currentViewFile = null;
}

async function showGallery(folderPath) {
    if (selectedItems.size > 0) clearFileSelection();
    galleryPath = folderPath;
    const ep = document.getElementById("editorPanel");
    const eb = document.getElementById("toggleEditor");
    if (ep.classList.contains("hidden")) { ep.classList.remove("hidden"); eb.classList.add("active"); updateDividers(); }
    showMediaView();
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "none";
    document.getElementById("docViewer").style.display = "none";
    document.getElementById("galleryHeader").style.display = "";
    document.getElementById("galleryCurrentPath").textContent = folderPath;
    updateViewToggleButtons();
    const grid = document.getElementById("galleryGrid");
    const list = document.getElementById("galleryList");
    grid.innerHTML = '<div class="gallery-empty">加载中...</div>';
    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(folderPath)}`);
        const d = await res.json();
        if (!d.成功) { grid.innerHTML = `<div class="gallery-empty">❌ ${d.错误 || "无法读取"}</div>`; return; }
        const items = d.内容 || [];
        galleryItemsCache = items;
        galleryImages = items.filter(i => i.类型 === "文件" && isImage(i.后缀 || "")).map(i => ({ 名称: i.名称, 路径: joinPath(folderPath, i.名称) }));
        audioPlaylist = items.filter(i => i.类型 === "文件" && isAudio(i.后缀 || "")).map(i => ({ 名称: i.名称, 路径: joinPath(folderPath, i.名称) }));
        videoPlaylist = items.filter(i => i.类型 === "文件" && isVideo(i.后缀 || "")).map(i => ({ 名称: i.名称, 路径: joinPath(folderPath, i.名称) }));
        if (items.length === 0) {
            grid.innerHTML = '<div class="gallery-empty">📂 此文件夹为空</div>';
            list.innerHTML = '<div class="gallery-empty">📂 此文件夹为空</div>';
            return;
        }
        renderGallery();
    } catch (e) {
        grid.innerHTML = `<div class="gallery-empty">❌ 连接错误</div>`;
    }
}

function renderGallery() {
    if (galleryViewMode === "list") {
        document.getElementById("galleryGrid").style.display = "none";
        document.getElementById("galleryList").style.display = "";
        renderGalleryList();
    } else {
        document.getElementById("galleryGrid").style.display = "";
        document.getElementById("galleryList").style.display = "none";
        renderGalleryGrid();
    }
}

function updateViewToggleButtons() {
    document.getElementById("viewBtnGrid").style.display = galleryViewMode === "list" ? "" : "none";
    document.getElementById("viewBtnList").style.display = galleryViewMode === "grid" ? "" : "none";
    updateSortButtons();
}

function updateSortButtons() {
    document.getElementById("sortBtn").textContent = gallerySortKey;
    document.getElementById("sortOrderBtn").textContent = gallerySortAsc ? "▲" : "▼";
}

function cycleSortKey() {
    const keys = ["名称", "大小", "类型", "创建时间"];
    const i = keys.indexOf(gallerySortKey);
    gallerySortKey = keys[(i + 1) % keys.length];
    gallerySortAsc = true;
    localStorage.setItem("gallerySortKey", gallerySortKey);
    localStorage.setItem("gallerySortAsc", "true");
    updateSortButtons();
    renderGallery();
}

function toggleSortOrder() {
    gallerySortAsc = !gallerySortAsc;
    localStorage.setItem("gallerySortAsc", gallerySortAsc ? "true" : "false");
    updateSortButtons();
    renderGallery();
}

function toggleGalleryView(mode) {
    galleryViewMode = mode;
    localStorage.setItem("galleryView", mode);
    updateViewToggleButtons();
    renderGallery();
}

function getSortedItems() {
    const items = [...galleryItemsCache];
    items.sort((a, b) => {
        if (a.类型 !== b.类型) return a.类型 === "目录" ? -1 : 1;
        let va = a[gallerySortKey], vb = b[gallerySortKey];
        if (gallerySortKey === "大小") { va = a.大小; vb = b.大小; }
        if (gallerySortKey === "类型") { va = a.后缀 || ""; vb = b.后缀 || ""; }
        if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase(); }
        if (va < vb) return gallerySortAsc ? -1 : 1;
        if (va > vb) return gallerySortAsc ? 1 : -1;
        return 0;
    });
    return items;
}

function formatSize(bytes) {
    if (!bytes) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(1) + " GB";
}

function renderGalleryGrid() {
    const grid = document.getElementById("galleryGrid");
    const items = getSortedItems();
    grid.innerHTML = "";
    for (const node of items) {
        if (node.类型 === "目录") {
            const fullPath = joinPath(galleryPath, node.名称);
            const item = document.createElement("div");
            item.className = "gallery-item";
            if (selectedItems.has(fullPath)) item.classList.add("selected");
            item.dataset.path = fullPath;
            item.dataset.name = node.名称;
            item.dataset.type = "目录";
            item.title = `进入文件夹: ${node.名称}`;
            item.innerHTML = `<div class="gallery-thumb">📁</div><div class="gallery-name">${node.名称}</div>`;
            item.addEventListener("click", () => { const p = joinPath(galleryPath, node.名称); openFolder(p); showGallery(p); });
            grid.appendChild(item);
        } else {
            const fullPath = joinPath(galleryPath, node.名称);
            const ext = node.后缀 || "";
            const item = document.createElement("div");
            item.className = "gallery-item";
            if (selectedItems.has(fullPath)) item.classList.add("selected");
            item.dataset.path = fullPath;
            item.dataset.name = node.名称;
            item.dataset.type = "文件";
            if (isImage(ext)) {
                item.title = `查看图片: ${node.名称}`;
                item.innerHTML = `<div class="gallery-thumb"><img src="/api/image?path=${encodeURIComponent(fullPath)}" loading="lazy" /></div><div class="gallery-name">${node.名称}</div>`;
                item.addEventListener("click", () => {
                    const idx = galleryImages.findIndex(g => g.路径 === fullPath);
                    showImage(fullPath, node.名称, idx);
                });
            } else if (isAudio(ext)) {
                item.title = `播放音频: ${node.名称}`;
                item.innerHTML = `<div class="gallery-thumb gallery-thumb-text">🎵</div><div class="gallery-name">${node.名称}</div>`;
                item.addEventListener("click", () => {
                    const idx = audioPlaylist.findIndex(a => a.路径 === fullPath);
                    showAudio(fullPath, node.名称, idx);
                });
            } else if (isVideo(ext)) {
                item.title = `播放视频: ${node.名称}`;
                item.innerHTML = `<div class="gallery-thumb"><video src="/api/video?path=${encodeURIComponent(fullPath)}" preload="metadata" muted playsinline></video><div class="gallery-play-overlay">▶</div></div><div class="gallery-name">${node.名称}</div>`;
                const vEl = item.querySelector('video');
                if (vEl) {
                    vEl.addEventListener('loadedmetadata', () => {
                        vEl.currentTime = Math.min(1, (vEl.duration || 1) * 0.1);
                    });
                    vEl.addEventListener('error', () => {
                        vEl.style.display = 'none';
                        const overlay = item.querySelector('.gallery-play-overlay');
                        if (overlay) overlay.textContent = '🎬';
                    });
                }
                item.addEventListener("click", () => { showVideo(fullPath, node.名称); });
            } else if (isDocument(ext)) {
                item.title = `预览文档: ${node.名称}`;
                const docIcon = ext === ".pdf" ? "📕" : (ext === ".xlsx" || ext === ".xls" || ext === ".csv" ? "📊" : "📄");
                item.innerHTML = `<div class="gallery-thumb gallery-thumb-text">${docIcon}</div><div class="gallery-name">${node.名称}</div>`;
                item.addEventListener("click", () => { showDocument(fullPath, node.名称); });
            } else {
                const icon = fileIcon(ext);
                const 可编辑 = [".py",".js",".css",".html",".json",".md",".bat",".sh",".txt",".cs",".java",".ts",".tsx",".jsx",".vue",".go",".rs",".cpp",".h",".yml",".yaml",".toml",".ini",".env",".gitignore"].includes(ext.toLowerCase());
                if (可编辑) {
                    item.title = `在编辑器中打开: ${node.名称}`;
                    item.innerHTML = `<div class="gallery-thumb gallery-thumb-text">${icon}</div><div class="gallery-name">${node.名称}</div>`;
                    item.addEventListener("click", () => { hideMediaView(); openFileInEditor(galleryPath, node.名称); });
                } else {
                    item.innerHTML = `<div class="gallery-thumb gallery-thumb-locked">🔒</div><div class="gallery-name">${node.名称}</div>`;
                    item.className = "gallery-item gallery-item-locked";
                    if (selectedItems.has(fullPath)) item.classList.add("selected");
                    item.title = "此文件格式不支持打开";
                }
            }
            grid.appendChild(item);
        }
    }
}

function renderGalleryList() {
    const list = document.getElementById("galleryList");
    list.innerHTML = "";
    // 表头
    const header = document.createElement("div");
    header.className = "gallery-list-header";
    const cols = [
        { key: "名称", label: "名称", flex: true },
        { key: "大小", label: "大小", width: "80px" },
        { key: "类型", label: "类型", width: "70px" },
        { key: "创建时间", label: "修改日期", width: "120px" }
    ];
    for (const col of cols) {
        const cell = document.createElement("div");
        if (!col.flex) cell.style.width = col.width;
        else cell.style.flex = "1";
        cell.innerHTML = `${col.label}<span class="glh-sort">${gallerySortKey === col.key ? (gallerySortAsc ? "▲" : "▼") : ""}</span>`;
        cell.addEventListener("click", () => {
            if (gallerySortKey === col.key) gallerySortAsc = !gallerySortAsc;
            else { gallerySortKey = col.key; gallerySortAsc = true; }
            localStorage.setItem("gallerySortKey", gallerySortKey);
            localStorage.setItem("gallerySortAsc", gallerySortAsc ? "true" : "false");
            updateSortButtons();
            renderGalleryList();
        });
        header.appendChild(cell);
    }
    list.appendChild(header);
    // 数据行
    const items = getSortedItems();
    for (const node of items) {
        const row = document.createElement("div");
        row.className = "gallery-list-row";
        const isDir = node.类型 === "目录";
        const fullPath = joinPath(galleryPath, node.名称);
        const icon = isDir ? "📁" : fileIcon(node.后缀 || "");
        const isSelected = selectedItems.has(fullPath);
        if (isSelected) row.classList.add("selected");
        row.dataset.path = fullPath;
        row.dataset.name = node.名称;
        row.dataset.type = node.类型;
        const checkIcon = isSelected ? "☑" : "☐";
        row.innerHTML = `<span class="glr-check">${checkIcon}</span><span class="glr-icon">${icon}</span><span class="glr-name">${node.名称}</span><span class="glr-size">${isDir ? "-" : formatSize(node.大小)}</span><span class="glr-type">${isDir ? "文件夹" : (node.后缀 || "")}</span><span class="glr-date">${node.创建时间 || "-"}</span>`;
        row.addEventListener("click", () => {
            if (isDir) { const p = joinPath(galleryPath, node.名称); openFolder(p); showGallery(p); return; }
            const ext = node.后缀 || "";
            if (isImage(ext)) { const idx = galleryImages.findIndex(g => g.路径 === fullPath); showImage(fullPath, node.名称, idx); return; }
            if (isAudio(ext)) { const idx = audioPlaylist.findIndex(a => a.路径 === fullPath); showAudio(fullPath, node.名称, idx); return; }
            if (isVideo(ext)) { const idx = videoPlaylist.findIndex(v => v.路径 === fullPath); showVideo(fullPath, node.名称, idx); return; }
            if (isDocument(ext)) { showDocument(fullPath, node.名称); return; }
            const 可编辑 = [".py",".js",".css",".html",".json",".md",".bat",".sh",".txt",".cs",".java",".ts",".tsx",".jsx",".vue",".go",".rs",".cpp",".h",".yml",".yaml",".toml",".ini",".env",".gitignore"].includes(ext.toLowerCase());
            if (可编辑) { hideMediaView(); openFileInEditor(galleryPath, node.名称); }
            else { showToast("info", "🔒 不支持的格式", `「${node.名称}」无法在此应用中打开`); }
        });
        list.appendChild(row);
    }
}

function showImage(fullPath, name, idx) {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    currentViewFile = { 路径: fullPath, 名称: name, 类型: "图片" };
    showMediaView();
    const mv = document.getElementById("mediaView");
    mv.style.overflowY = "hidden";
    mv.style.padding = "0";
    document.getElementById("galleryGrid").style.display = "none";
    document.getElementById("galleryList").style.display = "none";
    document.getElementById("galleryHeader").style.display = "none";
    const viewer = document.getElementById("imageViewer");
    viewer.style.display = "flex";
    imageTransforms = {};
    currentImageIdx = idx >= 0 ? idx : galleryImages.findIndex(g => g.路径 === fullPath);
    const img = document.getElementById("imageViewerImg");
    const back = document.getElementById("imageViewerImgBack");
    img.onload = null;
    img.style.transition = "none";
    img.style.opacity = "1";
    back.style.opacity = "0";
    back.src = "";
    img.src = `/api/image?path=${encodeURIComponent(fullPath)}`;
    img.alt = name;
    restoreTransform(currentImageIdx);
    updateImageCounter();
}

function updateImageCounter() {
    const counter = document.getElementById("imageCounter");
    const prevBtn = document.getElementById("imgNavPrev");
    const nextBtn = document.getElementById("imgNavNext");
    if (galleryImages.length > 0 && currentImageIdx >= 0) {
        counter.textContent = `${currentImageIdx + 1} / ${galleryImages.length}`;
        prevBtn.style.display = galleryImages.length > 1 ? "" : "none";
        nextBtn.style.display = galleryImages.length > 1 ? "" : "none";
    } else {
        counter.textContent = "";
        prevBtn.style.display = "none";
        nextBtn.style.display = "none";
    }
}

function resetImageTransform() {
    const img = document.getElementById("imageViewerImg");
    img.dataset.x = "0"; img.dataset.y = "0"; img.dataset.scale = "1";
    if (window._updateImgTransform) window._updateImgTransform();
    else img.style.transform = "translate(0px,0px) scale(1)";
}

let imageTransforms = {};

function saveCurrentTransform() {
    if (currentImageIdx >= 0) {
        const img = document.getElementById("imageViewerImg");
        imageTransforms[currentImageIdx] = {
            x: img.dataset.x || "0",
            y: img.dataset.y || "0",
            scale: img.dataset.scale || "1"
        };
    }
}

function restoreTransform(idx) {
    const img = document.getElementById("imageViewerImg");
    const t = imageTransforms[idx] || { x: "0", y: "0", scale: "1" };
    img.dataset.x = t.x; img.dataset.y = t.y; img.dataset.scale = t.scale;
    if (window._updateImgTransform) window._updateImgTransform();
    else img.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.scale})`;
}

function fadeToImage(newIdx) {
    const img = document.getElementById("imageViewerImg");
    const fading = !!slideshowTimer;
    const fadeTime = fading ? 500 : 100;
    img.style.transition = `opacity ${fading ? 0.5 : 0.1}s ease`;
    img.style.opacity = "0";
    setTimeout(() => {
        currentImageIdx = newIdx;
        const g = galleryImages[currentImageIdx];
        img.onload = () => {
            restoreTransform(currentImageIdx);
            updateImageCounter();
            requestAnimationFrame(() => { img.style.opacity = "1"; });
        };
        img.src = `/api/image?path=${encodeURIComponent(g.路径)}`;
        img.alt = g.名称;
    }, fadeTime);
}

function prevImage() {
    if (galleryImages.length === 0) return;
    saveCurrentTransform();
    fadeToImage((currentImageIdx - 1 + galleryImages.length) % galleryImages.length);
    resetSlideshowTimer();
}

function nextImage() {
    if (galleryImages.length === 0) return;
    saveCurrentTransform();
    fadeToImage((currentImageIdx + 1) % galleryImages.length);
    resetSlideshowTimer();
}

function toggleSlideshow() {
    const btn = document.getElementById("slideshowBtn");
    if (slideshowTimer) {
        stopSlideshow();
    } else {
        if (galleryImages.length < 2) return;
        btn.classList.add("active");
        btn.textContent = "⏸️ 停止";
        const slider = document.getElementById("slideshowSpeedSlider");
        slideshowInterval = parseFloat(slider.value) * 1000;
        slideshowTimer = setInterval(() => { nextImage(); }, slideshowInterval);
    }
}

function initSlideshowSpeed() {
    const slider = document.getElementById("slideshowSpeedSlider");
    const display = document.getElementById("slideshowSpeedValue");
    slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        display.textContent = val.toFixed(1) + "s";
        slideshowInterval = val * 1000;
        if (slideshowTimer) {
            clearInterval(slideshowTimer);
            slideshowTimer = setInterval(() => { nextImage(); }, slideshowInterval);
        }
    });
}

function stopSlideshow() {
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
        const btn = document.getElementById("slideshowBtn");
        if (btn) { btn.classList.remove("active"); btn.textContent = "▶️ 幻灯片"; }
    }
}

function resetSlideshowTimer() {
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = setInterval(() => { nextImage(); }, slideshowInterval);
    }
}

function backToGallery() {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    // 文档标签页：关闭当前标签
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') {
        closeTab(activeFileIdx);
        return;
    }
    hideDocViewer();
    currentViewFile = null;
    if (galleryPath) showGallery(galleryPath);
}

// ============ 音频播放器 ============
function showAudio(fullPath, name, idx) {
    stopSlideshow();
    currentViewFile = { 路径: fullPath, 名称: name, 类型: "音频" };
    showMediaView();
    const mv = document.getElementById("mediaView");
    mv.style.overflowY = "auto";
    mv.style.padding = "12px";
    document.getElementById("galleryGrid").style.display = "none";
    document.getElementById("galleryList").style.display = "none";
    document.getElementById("galleryHeader").style.display = "none";
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "flex";

    currentAudioIdx = idx >= 0 ? idx : audioPlaylist.findIndex(a => a.路径 === fullPath);
    document.getElementById("audioFileName").textContent = name;
    const audio = document.getElementById("audioElement");
    audio.src = `/api/audio?path=${encodeURIComponent(fullPath)}`;
    audio.play().catch(() => {});
    updateAudioPlayBtn(true);
    updateAudioNavBtns();
}

function initAudioPlayer() {
    const audio = document.getElementById("audioElement");
    const progress = document.getElementById("audioProgress");
    const fill = document.getElementById("audioProgressFill");
    const handle = document.getElementById("audioProgressHandle");
    const volumeSlider = document.getElementById("audioVolumeSlider");

    audio.addEventListener("loadedmetadata", () => {
        document.getElementById("audioTotalTime").textContent = formatTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
        if (audioSeeking) return;
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        fill.style.width = pct + "%";
        handle.style.left = pct + "%";
        document.getElementById("audioCurrentTime").textContent = formatTime(audio.currentTime);
    });
    audio.addEventListener("ended", () => { updateAudioPlayBtn(false); });
    audio.addEventListener("play", () => { updateAudioPlayBtn(true); });
    audio.addEventListener("pause", () => { updateAudioPlayBtn(false); });

    // 进度条拖拽seek
    let dragging = false;
    function seekTo(e) {
        const rect = progress.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (audio.duration) audio.currentTime = pct * audio.duration;
        fill.style.width = (pct * 100) + "%";
        handle.style.left = (pct * 100) + "%";
    }
    progress.addEventListener("mousedown", (e) => {
        audioSeeking = true; dragging = true; seekTo(e);
    });
    document.addEventListener("mousemove", (e) => { if (dragging) seekTo(e); });
    document.addEventListener("mouseup", () => { if (dragging) { dragging = false; audioSeeking = false; } });

    // 音量控制
    volumeSlider.addEventListener("input", () => {
        audio.volume = volumeSlider.value / 100;
        document.getElementById("audioVolumeIcon").textContent = audio.volume == 0 ? "🔇" : (audio.volume < 0.5 ? "🔉" : "🔊");
    });

    // 键盘空格播放/暂停
    document.addEventListener("keydown", (e) => {
        if (document.getElementById("audioPlayer").style.display === "none") return;
        if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
            e.preventDefault(); toggleAudioPlay();
        }
    });
}

function toggleAudioPlay() {
    const audio = document.getElementById("audioElement");
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
}

function updateAudioPlayBtn(playing) {
    document.getElementById("audioPlayBtn").textContent = playing ? "⏸" : "▶";
}

function updateAudioNavBtns() {
    const prevBtn = document.getElementById("audioPrevBtn");
    const nextBtn = document.getElementById("audioNextBtn");
    prevBtn.style.display = audioPlaylist.length > 1 ? "" : "none";
    nextBtn.style.display = audioPlaylist.length > 1 ? "" : "none";
}

function prevAudio() {
    if (audioPlaylist.length === 0) return;
    currentAudioIdx = (currentAudioIdx - 1 + audioPlaylist.length) % audioPlaylist.length;
    const a = audioPlaylist[currentAudioIdx];
    const audio = document.getElementById("audioElement");
    document.getElementById("audioFileName").textContent = a.名称;
    audio.src = `/api/audio?path=${encodeURIComponent(a.路径)}`;
    audio.play().catch(() => {});
}

function nextAudio() {
    if (audioPlaylist.length === 0) return;
    currentAudioIdx = (currentAudioIdx + 1) % audioPlaylist.length;
    const a = audioPlaylist[currentAudioIdx];
    const audio = document.getElementById("audioElement");
    document.getElementById("audioFileName").textContent = a.名称;
    audio.src = `/api/audio?path=${encodeURIComponent(a.路径)}`;
    audio.play().catch(() => {});
}

function toggleMute() {
    const audio = document.getElementById("audioElement");
    const slider = document.getElementById("audioVolumeSlider");
    if (audio.volume > 0) {
        audio._lastVolume = audio.volume;
        audio.volume = 0; slider.value = 0;
        document.getElementById("audioVolumeIcon").textContent = "🔇";
    } else {
        const v = audio._lastVolume || 1;
        audio.volume = v; slider.value = v * 100;
        document.getElementById("audioVolumeIcon").textContent = v < 0.5 ? "🔉" : "🔊";
    }
}

function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function hideAudioPlayer() {
    const audio = document.getElementById("audioElement");
    if (!audio.paused) audio.pause();
    document.getElementById("audioPlayer").style.display = "none";
}

// ============ 视频播放器 ============
function showVideo(fullPath, name, idx) {
    stopSlideshow();
    hideAudioPlayer();
    currentViewFile = { 路径: fullPath, 名称: name, 类型: "视频" };
    showMediaView();
    const mv = document.getElementById("mediaView");
    mv.style.overflowY = "hidden";
    mv.style.padding = "0";
    document.getElementById("galleryGrid").style.display = "none";
    document.getElementById("galleryList").style.display = "none";
    document.getElementById("galleryHeader").style.display = "none";
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "flex";
    document.getElementById("videoFileName").textContent = name;
    currentVideoIdx = idx >= 0 ? idx : videoPlaylist.findIndex(v => v.路径 === fullPath);
    updateVideoNavBtns();
    const video = document.getElementById("videoElement");
    video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
    video.style.transform = "";
    video.src = `/api/video?path=${encodeURIComponent(fullPath)}`;
    video.play().catch(() => {});
}

function updateVideoNavBtns() {
    const prevBtn = document.getElementById("videoPrevBtn");
    const nextBtn = document.getElementById("videoNextBtn");
    const counter = document.getElementById("videoCounter");
    if (videoPlaylist.length > 1 && currentVideoIdx >= 0) {
        prevBtn.style.display = "";
        nextBtn.style.display = "";
        counter.textContent = `${currentVideoIdx + 1} / ${videoPlaylist.length}`;
    } else {
        prevBtn.style.display = "none";
        nextBtn.style.display = "none";
        counter.textContent = "";
    }
}

function prevVideo() {
    if (videoPlaylist.length === 0) return;
    currentVideoIdx = (currentVideoIdx - 1 + videoPlaylist.length) % videoPlaylist.length;
    const v = videoPlaylist[currentVideoIdx];
    const video = document.getElementById("videoElement");
    video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
    video.style.transform = "";
    video.src = `/api/video?path=${encodeURIComponent(v.路径)}`;
    document.getElementById("videoFileName").textContent = v.名称;
    updateVideoNavBtns();
    video.play().catch(() => {});
}

function nextVideo() {
    if (videoPlaylist.length === 0) return;
    currentVideoIdx = (currentVideoIdx + 1) % videoPlaylist.length;
    const v = videoPlaylist[currentVideoIdx];
    const video = document.getElementById("videoElement");
    video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
    video.style.transform = "";
    video.src = `/api/video?path=${encodeURIComponent(v.路径)}`;
    document.getElementById("videoFileName").textContent = v.名称;
    updateVideoNavBtns();
    video.play().catch(() => {});
}

function hideVideoPlayer() {
    const video = document.getElementById("videoElement");
    if (!video.paused) video.pause();
    video.removeAttribute("src");
    video.load();
    document.getElementById("videoPlayer").style.display = "none";
}

function hideDocViewer() {
    document.getElementById("docViewer").style.display = "none";
    const el = document.getElementById("docContent");
    while (el.firstChild) el.removeChild(el.firstChild);
}

// ============ 文档预览器 ============
async function showDocument(fullPath, name) {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    // 已打开则切换
    const existIdx = openFiles.findIndex(f => f.path === fullPath && f.type === 'document');
    if (existIdx >= 0) { if (existIdx !== activeFileIdx) switchTab(existIdx); return; }
    // 确保编辑器面板可见
    const ep = document.getElementById("editorPanel");
    const eb = document.getElementById("toggleEditor");
    if (ep.classList.contains("hidden")) { ep.classList.remove("hidden"); eb.classList.add("active"); updateDividers(); }
    // 创建文档标签页
    openFiles.push({ path: fullPath, name, content: "", dirty: false, type: 'document', docNodes: null, selection: null });
    const newIdx = openFiles.length - 1;
    switchTab(newIdx);
    await renderDocumentContent(newIdx);
}

// 文档内容渲染（可复用于初次打开、刷新、AI修改后自动更新）
async function renderDocumentContent(idx) {
    const f = openFiles[idx];
    if (!f || f.type !== 'document') return;
    const isActive = (idx === activeFileIdx);
    const target = isActive ? document.getElementById("docContent") : document.createElement("div");
    if (isActive) target.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">加载中...</div>';
    try {
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        if (ext === "pdf") {
            if (!window.pdfjsLib) throw new Error("PDF.js 未加载");
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
            const res = await fetch(`/api/file-content?path=${encodeURIComponent(f.path)}`);
            if (!res.ok) throw new Error("无法读取PDF文件");
            const buf = await res.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
            target.innerHTML = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.cssText = "display:block;margin:0 auto 12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
                target.appendChild(canvas);
                await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            }
        } else {
            const res = await fetch(`/api/file-content?path=${encodeURIComponent(f.path)}`);
            if (!res.ok) throw new Error("无法读取文件");
            const buf = await res.arrayBuffer();
            if (ext === "doc") {
                const res2 = await fetch(`/api/doc-content?path=${encodeURIComponent(f.path)}`);
                const d = await res2.json();
                if (!d.成功) throw new Error(d.错误 || "无法读取");
                target.innerHTML = d.html;
            } else if (ext === "xlsx" || ext === "xls") {
                const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
                let html = "";
                for (const sheetName of wb.SheetNames) {
                    const ws = wb.Sheets[sheetName];
                    let tableHtml = XLSX.utils.sheet_to_html(ws, { editable: false });
                    // sheet_to_html可能返回空，回退到sheet_to_json
                    if (!tableHtml || tableHtml.trim() === "<table></table>") {
                        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                        if (rows.length > 0) {
                            tableHtml = "<table>";
                            for (const row of rows) {
                                tableHtml += "<tr>" + row.map(c => `<td>${String(c ?? "").replace(/</g,"&lt;")}</td>`).join("") + "</tr>";
                            }
                            tableHtml += "</table>";
                        }
                    }
                    html += `<h3 style="margin:16px 0 8px;">工作表: ${sheetName}</h3>`;
                    html += tableHtml || "<p>（空工作表）</p>";
                }
                target.innerHTML = html || "<p>（空表格）</p>";
            } else if (ext === "csv") {
                const text = new TextDecoder("utf-8").decode(buf);
                const rows = text.split(/\r?\n/).filter(r => r.trim());
                let html = "<table>";
                for (const row of rows) {
                    const cells = row.split(",");
                    html += "<tr>" + cells.map(c => `<td>${c.replace(/</g,"&lt;")}</td>`).join("") + "</tr>";
                }
                html += "</table>";
                target.innerHTML = html;
            } else if (ext === "docx") {
                const res2 = await fetch(`/api/docx-content?path=${encodeURIComponent(f.path)}`);
                const d = await res2.json();
                if (!d.成功) throw new Error(d.错误 || "无法读取");
                target.innerHTML = d.html;
            } else {
                target.innerHTML = "<p>不支持的文档格式</p>";
            }
        }
        f.docNodes = Array.from(target.childNodes);
    } catch (e) {
        target.innerHTML = `<div style="color:#c00;text-align:center;padding:40px;">❌ 无法加载文档: ${e.message}</div>`;
        f.docNodes = Array.from(target.childNodes);
    }
}

// ============ 文档修改高亮（类似代码编辑器的diff动画） ============
function highlightDocChanges(changes) {
    // 仅对当前激活的文档标签页生效
    if (activeFileIdx < 0 || openFiles[activeFileIdx]?.type !== 'document') return;
    const content = document.getElementById("docContent");
    if (!content) return;

    for (const change of changes) {
        const isDelete = !change.新文本 || change.新文本.trim() === "";
        const opType = isDelete ? "delete" : "modify";
        const opLabel = isDelete ? "已删除" : "已替换";
        const opIcon = isDelete ? "🗑️" : "✏️";

        // 在渲染的HTML中查找新文本并高亮
        if (!isDelete) {
            highlightDocText(content, change.新文本);
        }

        // 显示Banner
        showDocModifiedBanner(content, change, opType);

        // Toast
        const fname = openFiles[activeFileIdx]?.name || "";
        const textPreview = (isDelete ? change.旧文本 : change.新文本).substring(0, 30);
        const ellipsis = (isDelete ? change.旧文本 : change.新文本).length > 30 ? "..." : "";
        showToast(opType, `${opIcon} ${opLabel}`, `${fname}: ${textPreview}${ellipsis}`);
    }
}

// 在文档HTML中查找并高亮文本
function highlightDocText(content, searchText) {
    if (!searchText || searchText.length === 0) return;

    // TreeWalker遍历所有文本节点
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
    const matches = [];
    while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(searchText)) {
            matches.push(walker.currentNode);
        }
    }

    // 未找到精确匹配时，尝试用前50字符（mammoth可能拆分了文本节点）
    if (matches.length === 0 && searchText.length > 50) {
        const short = searchText.substring(0, 50);
        while (walker.currentNode) walker.previousNode(); // 重置
        const walker2 = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
        while (walker2.nextNode()) {
            if (walker2.currentNode.textContent.includes(short)) {
                matches.push(walker2.currentNode);
            }
        }
        if (matches.length > 0) searchText = short;
    }

    let firstMatch = null;
    for (const node of matches) {
        const text = node.textContent;
        const idx = text.indexOf(searchText);
        if (idx === -1) continue;

        const before = document.createTextNode(text.substring(0, idx));
        const span = document.createElement('span');
        span.className = 'doc-flash-highlight';
        span.textContent = searchText;
        const after = document.createTextNode(text.substring(idx + searchText.length));

        const parent = node.parentNode;
        parent.insertBefore(before, node);
        parent.insertBefore(span, node);
        parent.insertBefore(after, node);
        parent.removeChild(node);

        if (!firstMatch) firstMatch = span;

        // 5秒后淡出并恢复
        setTimeout(() => {
            span.classList.add('fade-out');
            setTimeout(() => {
                if (span.parentNode) {
                    const txt = document.createTextNode(span.textContent);
                    span.parentNode.replaceChild(txt, span);
                    txt.parentNode.normalize();
                }
            }, 1000);
        }, 5000);
    }

    // 滚动到第一个匹配
    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 文档修改Banner
function showDocModifiedBanner(content, change, opType) {
    const docViewer = document.getElementById("docViewer");
    if (!docViewer) return;
    // 清除旧banner
    docViewer.querySelectorAll(".doc-modified-banner").forEach(b => b.remove());

    const isDelete = opType === "delete";
    const icon = isDelete ? "🗑️" : "✏️";
    const label = isDelete ? "已删除" : "已替换";
    const textPreview = (isDelete ? change.旧文本 : change.新文本).substring(0, 30);
    const ellipsis = (isDelete ? change.旧文本 : change.新文本).length > 30 ? "..." : "";

    const banner = document.createElement("div");
    banner.className = `doc-modified-banner ${opType}`;
    banner.innerHTML = `<span>${icon} ${label}: 「${textPreview}${ellipsis}」</span><span class="banner-close" onclick="this.parentElement.remove()">✕</span>`;
    docViewer.appendChild(banner);

    setTimeout(() => {
        if (banner.parentElement) {
            banner.style.opacity = "0";
            banner.style.transition = "opacity 0.5s";
            setTimeout(() => banner.remove(), 500);
        }
    }, 4000);
}

// ============ 视频缩放/平移交互 ============
(function() {
    const stage = document.getElementById("videoStage");
    const video = document.getElementById("videoElement");

    function updateVideoTransform() {
        const x = parseFloat(video.dataset.x || 0);
        const y = parseFloat(video.dataset.y || 0);
        const s = parseFloat(video.dataset.scale || 1);
        video.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    }

    stage.addEventListener("wheel", (e) => {
        if (document.getElementById("videoPlayer").style.display === "none") return;
        e.preventDefault();
        const rect = video.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const oldScale = parseFloat(video.dataset.scale || 1);
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newScale = Math.max(0.1, Math.min(20, oldScale * delta));
        const ratio = newScale / oldScale;
        const oldX = parseFloat(video.dataset.x || 0);
        const oldY = parseFloat(video.dataset.y || 0);
        video.dataset.x = oldX - (cx * ratio - cx);
        video.dataset.y = oldY - (cy * ratio - cy);
        video.dataset.scale = newScale;
        updateVideoTransform();
    }, { passive: false });

    let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    let lastMidClick = 0;
    stage.addEventListener("mousedown", (e) => {
        if (document.getElementById("videoPlayer").style.display === "none") return;
        if (e.button === 1) {
            e.preventDefault();
            const now = Date.now();
            if (now - lastMidClick < 300) {
                lastMidClick = 0;
                panning = false;
                video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
                updateVideoTransform();
                return;
            }
            lastMidClick = now;
            panning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            panOrigX = parseFloat(video.dataset.x || 0);
            panOrigY = parseFloat(video.dataset.y || 0);
        }
    });
    document.addEventListener("mousemove", (e) => {
        if (!panning) return;
        video.dataset.x = panOrigX + (e.clientX - panStartX);
        video.dataset.y = panOrigY + (e.clientY - panStartY);
        updateVideoTransform();
    });
    document.addEventListener("mouseup", (e) => {
        if (e.button === 1) panning = false;
    });
    stage.addEventListener("dblclick", (e) => {
        if (document.getElementById("videoPlayer").style.display === "none") return;
        video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
        updateVideoTransform();
    });
})();

// ============ 图片查看器交互 ============
(function() {
    const viewer = document.getElementById("imageViewer");
    const stage = document.getElementById("imageViewerStage");
    const img = document.getElementById("imageViewerImg");

    function updateTransform() {
        const x = parseFloat(img.dataset.x || 0);
        const y = parseFloat(img.dataset.y || 0);
        const s = parseFloat(img.dataset.scale || 1);
        img.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    }
    window._updateImgTransform = updateTransform;

    stage.addEventListener("wheel", (e) => {
        if (viewer.style.display === "none") return;
        e.preventDefault();
        const rect = img.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const oldScale = parseFloat(img.dataset.scale || 1);
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newScale = Math.max(0.1, Math.min(20, oldScale * delta));
        const ratio = newScale / oldScale;
        const oldX = parseFloat(img.dataset.x || 0);
        const oldY = parseFloat(img.dataset.y || 0);
        img.dataset.x = oldX - (cx * ratio - cx);
        img.dataset.y = oldY - (cy * ratio - cy);
        img.dataset.scale = newScale;
        updateTransform();
        saveCurrentTransform();
    }, { passive: false });

    let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    let lastRClick = 0;
    viewer.addEventListener("mousedown", (e) => {
        if (viewer.style.display === "none") return;
        if (e.target.tagName === "BUTTON") return;
        if (e.button === 1) {
            e.preventDefault();
            panning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            panOrigX = parseFloat(img.dataset.x || 0);
            panOrigY = parseFloat(img.dataset.y || 0);
        } else if (e.button === 0) {
            prevImage();
        } else if (e.button === 2) {
            const now = Date.now();
            if (now - lastRClick < 300) { lastRClick = 0; backToGallery(); }
            else { lastRClick = now; nextImage(); }
        }
    });
    viewer.addEventListener("contextmenu", (e) => {
        if (viewer.style.display !== "none") e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
        if (!panning) return;
        img.dataset.x = panOrigX + (e.clientX - panStartX);
        img.dataset.y = panOrigY + (e.clientY - panStartY);
        updateTransform();
        saveCurrentTransform();
    });
    document.addEventListener("mouseup", (e) => {
        if (e.button === 1) panning = false;
    });
    stage.addEventListener("dblclick", (e) => {
        if (viewer.style.display === "none") return;
        img.dataset.x = 0; img.dataset.y = 0; img.dataset.scale = 1;
        updateTransform();
        saveCurrentTransform();
    });
    // 键盘左右切换
    document.addEventListener("keydown", (e) => {
        if (viewer.style.display === "none") return;
        if (e.key === "ArrowLeft") prevImage();
        else if (e.key === "ArrowRight") nextImage();
        else if (e.key === "Escape") { stopSlideshow(); backToGallery(); }
    });
})();

// 双击右键返回画廊（音频/视频播放器）
(function() {
    let lastRClick = 0;
    ["audioPlayer", "videoPlayer"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("contextmenu", (e) => { e.preventDefault(); });
        el.addEventListener("mousedown", (e) => {
            if (e.button !== 2) return;
            if (el.style.display === "none") return;
            const now = Date.now();
            if (now - lastRClick < 300) { lastRClick = 0; backToGallery(); }
            else { lastRClick = now; }
        });
    });
})();

// 禁用 mediaView 内所有区域的浏览器右键菜单（统一拦截，防止遗漏子元素）
document.getElementById("mediaView").addEventListener("contextmenu", (e) => e.preventDefault());
// 文件树也禁用
document.getElementById("fileTree").addEventListener("contextmenu", (e) => e.preventDefault());

function goUpFolder() {
    if (!currentRoot) return;
    // 如果已经是盘符根目录（如 C:\ D:\ E:\），往上进入"此电脑"视图
    const 盘符匹配 = currentRoot.match(/^([A-Za-z]):[\/\\]?$/);
    if (盘符匹配) {
        // 切换到"此电脑"驱动器列表
        loadDriveList();
        return;
    }
    const parent = currentRoot.replace(/[\/\\]+$/, "").replace(/[\/\\][^\/\\]+$/, "");
    if (parent && parent !== currentRoot) {
        // 如果上级变成了盘符根目录（如 C:\），也允许进入
        openFolder(parent);
        showGallery(parent);
    }
}

function goUpGallery() {
    if (!galleryPath) return;
    // 如果已经是盘符根目录，往上进入"此电脑"视图
    const 盘符匹配 = galleryPath.match(/^([A-Za-z]):[\/\\]?$/);
    if (盘符匹配) {
        loadDriveList();
        return;
    }
    const parent = galleryPath.replace(/[\/\\]+$/, "").replace(/[\/\\][^\/\\]+$/, "");
    if (parent && parent !== galleryPath) {
        openFolder(parent);
        showGallery(parent);
    }
}

// 加载驱动器列表（"此电脑"视图）
async function loadDriveList() {
    const tree = document.getElementById("fileTree");
    tree.innerHTML = '<div class="tree-loading">加载驱动器...</div>';
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        if (d.成功 && d.驱动器列表) {
            currentRoot = null;
            tree.innerHTML = "";
            const header = document.createElement("div");
            header.className = "tree-folder";
            header.style.fontWeight = "bold";
            header.style.color = "var(--text2)";
            header.innerHTML = '💻 此电脑';
            tree.appendChild(header);
            for (const drv of d.驱动器列表) {
                const item = document.createElement("div");
                item.className = "tree-folder";
                item.style.paddingLeft = "12px";
                item.innerHTML = `💽 ${escapeHtml(drv.盘符)}: <span class="tree-meta">${escapeHtml(drv.类型 || '')} ${drv.可用空间 ? '(' + drv.可用空间 + ' 可用)' : ''}</span>`;
                item.onclick = () => openFolder(drv.盘符 + "\\");
                tree.appendChild(item);
            }
        } else {
            tree.innerHTML = '<div class="tree-empty">无法获取驱动器列表</div>';
        }
    } catch (e) {
        tree.innerHTML = '<div class="tree-empty">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
}

function refreshTree() { if (currentRoot) openFolder(currentRoot); }

async function openInExplorer(path) {
    try {
        const res = await fetch("/api/open-in-explorer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path }) });
        const d = await res.json();
        if (!d.成功) showToast("error", "❌ 无法打开", d.错误 || "未知错误");
    } catch (e) { showToast("error", "❌ 无法打开", e.message); }
}

async function newItem(type) {
    if (!currentRoot) { alert("请先打开一个文件夹"); return; }
    if (type === "folder") {
        const name = prompt("文件夹名:");
        if (!name) return;
        const res = await fetch("/api/file-mkdir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: joinPath(currentRoot, name) }) });
        const d = await res.json();
        if (d.成功) refreshTree(); else alert(d.错误 || "创建失败");
        return;
    }
    document.getElementById("newFileOverlay").style.display = "flex";
    document.getElementById("newFileName").value = "";
    document.getElementById("newFileName").focus();
}
function closeNewFile() { document.getElementById("newFileOverlay").style.display = "none"; }
async function doNewFile() {
    const name = document.getElementById("newFileName").value.trim();
    const ext = document.getElementById("newFileType").value;
    if (!name) return;
    const fullName = name.includes(".") ? name : name + ext;
    const fullPath = joinPath(currentRoot, fullName);
    document.getElementById("newFileOverlay").style.display = "none";
    const res = await fetch("/api/file-create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: fullPath }) });
    const d = await res.json();
    if (d.成功) { refreshTree(); openFileInEditor(currentRoot, fullName); }
    else alert(d.错误 || "创建失败");
}

async function openFileInEditor(path, name) {
    const ep = document.getElementById("editorPanel");
    const eb = document.getElementById("toggleEditor");
    if (ep.classList.contains("hidden")) { ep.classList.remove("hidden"); eb.classList.add("active"); updateDividers(); }
    const fullPath = joinPath(path, name);
    const existIdx = openFiles.findIndex(f => f.path === fullPath && f.type !== 'document');
    if (existIdx >= 0) { if (existIdx !== activeFileIdx) switchTab(existIdx); return; }
    try {
        const res = await fetch("/api/file-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: fullPath }) });
        const d = await res.json();
        if (d.成功) {
            openFiles.push({ path: fullPath, name, content: d.内容, dirty: false, type: 'code', selection: null });
            switchTab(openFiles.length - 1);
            renderTabs();
        } else {
            showToast("error", "❌ 无法打开文件", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

// ============ 多Tab编辑器 ============
function renderTabs() {
    const bar = document.getElementById("tabBar");
    bar.innerHTML = "";
    openFiles.forEach((f, i) => {
        const tab = document.createElement("div");
        tab.className = `tab${i === activeFileIdx ? " active" : ""}`;
        const icon = f.type === 'document' ? '📄 ' : '';
        tab.innerHTML = `<span class="tab-name">${f.dirty ? "● " : ""}${icon}${f.name}</span><span class="close" data-idx="${i}" title="关闭此文件标签">✕</span>`;
        tab.addEventListener("click", (e) => {
            if (e.target.classList.contains("close")) { closeTab(parseInt(e.target.dataset.idx)); return; }
            switchTab(i);
        });
        bar.appendChild(tab);
    });
    if (openFiles.length === 0) bar.innerHTML = '';
    // 滚动到当前激活的tab
    if (activeFileIdx >= 0) {
        const activeTab = bar.children[activeFileIdx];
        if (activeTab) activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
}

function updateToolbarForTab() {
    const isDoc = activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document';
    const btns = document.querySelectorAll('#editorToolbar .toolbar-btn');
    btns.forEach(btn => {
        const isRefresh = btn.getAttribute('onclick')?.includes('reloadCurrentFile');
        btn.disabled = isDoc && !isRefresh;
    });
}

function switchTab(idx, skipSave) {
    // 保存当前标签页状态
    if (!skipSave && activeFileIdx >= 0 && openFiles[activeFileIdx]) {
        const cur = openFiles[activeFileIdx];
        if (cur.type !== 'document' && editorInstance) cur.content = editorInstance.获取内容();
        if (cur.type === 'document') {
            const el = document.getElementById("docContent");
            cur.docNodes = Array.from(el.childNodes);
            while (el.firstChild) el.removeChild(el.firstChild);
        }
        cur.selection = editorSelection || null;
    }
    activeFileIdx = idx;
    if (idx >= 0 && idx < openFiles.length) {
        const f = openFiles[idx];
        if (f.type === 'document') {
            // 文档标签页：显示docViewer+工具栏，保留tabBar
            document.getElementById("editorContainer").style.display = "none";
            document.getElementById("editorToolbar").style.display = "";
            document.getElementById("tabBar").style.display = "";
            const mv = document.getElementById("mediaView");
            mv.style.display = "flex";
            mv.style.overflowY = "hidden";
            mv.style.padding = "0";
            document.getElementById("galleryGrid").style.display = "none";
            document.getElementById("galleryList").style.display = "none";
            document.getElementById("galleryHeader").style.display = "none";
            document.getElementById("imageViewer").style.display = "none";
            document.getElementById("audioPlayer").style.display = "none";
            document.getElementById("videoPlayer").style.display = "none";
            document.getElementById("docViewer").style.display = "flex";
            document.getElementById("docFileName").textContent = f.name;
            const contentEl = document.getElementById("docContent");
            while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
            if (f.docNodes) f.docNodes.forEach(n => contentEl.appendChild(n));
            currentViewFile = { 路径: f.path, 名称: f.name, 类型: "文档" };
            const pathEl = document.getElementById("editorFilePath");
            if (pathEl) pathEl.textContent = f.path;
            updateToolbarForTab();
        } else {
            // 代码标签页：显示编辑器
            hideMediaView();
            if (editorInstance) {
                editorInstance.设置内容(f.content);
                const ext = (f.name.split(".").pop() || "").toLowerCase();
                const langMap = { json: "json", py: "python", js: "javascript", ts: "javascript", cs: "javascript", css: "json", html: "json", md: "json", txt: "json", bat: "json" };
                editorInstance.设置语言(langMap[ext] || "json");
            }
            const pathEl = document.getElementById("editorFilePath");
            if (pathEl) pathEl.textContent = f.path;
            updateToolbarForTab();
        }
        // 恢复该标签页的框选
        if (f.selection) {
            editorSelection = f.selection;
            showSelectionHint(f.selection.text);
            if (f.type !== 'document' && editorInstance) editorInstance.设置选区高亮(f.selection.start, f.selection.end);
        } else {
            editorSelection = null;
            hideSelectionHint();
            if (f.type !== 'document' && editorInstance) editorInstance.清除选区高亮();
        }
    }
    renderTabs();
}

function closeTab(idx) {
    const wasActive = (idx === activeFileIdx);
    openFiles.splice(idx, 1);
    if (wasActive) {
        if (activeFileIdx >= openFiles.length) activeFileIdx = openFiles.length - 1;
        if (activeFileIdx >= 0) switchTab(activeFileIdx, true);
        else { if (editorInstance) editorInstance.设置内容(""); activeFileIdx = -1; showGallery(galleryPath || currentRoot || "./"); }
    } else if (idx < activeFileIdx) {
        activeFileIdx--;
    }
    renderTabs();
}

async function saveEditorContent() {
    if (activeFileIdx < 0) return;
    const f = openFiles[activeFileIdx];
    if (f.type === 'document') return;
    f.content = editorInstance.获取内容();
    await fetch("/api/file-write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: f.path, 内容: f.content }) });
    f.dirty = false;
    renderTabs();
}

function editorUndo2() {} // 已移至上方自定义实现
function editorRedo2() {} // 已移至上方自定义实现
async function reloadCurrentFile() {
    if (activeFileIdx < 0) return;
    const f = openFiles[activeFileIdx];
    if (f.type === 'document') {
        await renderDocumentContent(activeFileIdx);
        showToast("info", "🔄 已刷新", `${f.name} 已重新读取`);
        return;
    }
    await refreshAllOpenFiles();
    showToast("info", "🔄 已刷新", `${openFiles[activeFileIdx]?.name || ""} 已重新读取`);
}

// ============ 编辑器初始化 ============
function initEditor() {
    const container = document.getElementById("editorContainer");
    const textarea = document.getElementById("codeInput");
    const preview = document.getElementById("codePreview");
    const lineNums = document.getElementById("lineNumbers");
    if (container && textarea && preview && lineNums) {
        editorInstance = new 编辑器引擎(container, textarea, preview, lineNums);
        textarea.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveEditorContent(); }
            setTimeout(() => {
                if (activeFileIdx >= 0 && openFiles[activeFileIdx]) {
                    openFiles[activeFileIdx].dirty = true;
                    renderTabs();
                }
            }, 50);
        });
        textarea.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
        textarea.addEventListener("keyup", () => setTimeout(captureSelection, 0));
    }
    // 文档预览器框选追踪
    const docContent = document.getElementById("docContent");
    if (docContent) {
        docContent.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
        docContent.addEventListener("keyup", () => setTimeout(captureSelection, 0));
    }
    // Tab栏鼠标滚轮横向滚动
    const tabBar = document.getElementById("tabBar");
    if (tabBar) {
        tabBar.addEventListener("wheel", (e) => {
            if (tabBar.scrollWidth > tabBar.clientWidth) {
                e.preventDefault();
                tabBar.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }
}

// ============ 文件框选模式 ============

function toggleSelectAll() {
    if (selectedItems.size > 0) {
        clearFileSelection();
    } else {
        selectAllGalleryItems();
    }
}

function toggleItemSelection(path, name, type) {
    if (selectedItems.has(path)) {
        selectedItems.delete(path);
    } else {
        selectedItems.set(path, { 名称: name, 类型: type, 路径: path });
    }
    updateGallerySelectionVisual();
    showFileSelectionHint();
}

function selectAllGalleryItems() {
    const items = getSortedItems();
    for (const node of items) {
        const fullPath = joinPath(galleryPath, node.名称);
        selectedItems.set(fullPath, { 名称: node.名称, 类型: node.类型, 路径: fullPath });
    }
    updateGallerySelectionVisual();
    showFileSelectionHint();
}

function clearFileSelection() {
    selectedItems.clear();
    updateGallerySelectionVisual();
    showFileSelectionHint();
}

function updateGallerySelectionVisual() {
    const grid = document.getElementById("galleryGrid");
    if (grid) {
        grid.querySelectorAll(".gallery-item").forEach(item => {
            const path = item.dataset.path;
            if (path && selectedItems.has(path)) {
                item.classList.add("selected");
            } else {
                item.classList.remove("selected");
            }
        });
    }
    const list = document.getElementById("galleryList");
    if (list) {
        list.querySelectorAll(".gallery-list-row").forEach(row => {
            const path = row.dataset.path;
            if (path && selectedItems.has(path)) {
                row.classList.add("selected");
                const check = row.querySelector(".glr-check");
                if (check) check.textContent = "☑";
            } else {
                row.classList.remove("selected");
                const check = row.querySelector(".glr-check");
                if (check) check.textContent = "☐";
            }
        });
    }
}

function showFileSelectionHint() {
    // 更新全选/取消按钮
    const toggleBtn = document.getElementById("toggleSelectAllBtn");
    if (toggleBtn) {
        if (selectedItems.size > 0) {
            toggleBtn.textContent = "☐ 不选";
            toggleBtn.title = "取消所有选择 (Ctrl+D)";
        } else {
            toggleBtn.textContent = "☑ 全选";
            toggleBtn.title = "全选当前文件夹 (Ctrl+A)";
        }
    }
    let hint = document.getElementById("fileSelectionHint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "fileSelectionHint";
        hint.className = "file-selection-hint";
        const inputArea = document.querySelector(".chat-input-area");
        if (inputArea) inputArea.insertBefore(hint, inputArea.firstChild);
    }
    if (selectedItems.size === 0) {
        hint.style.display = "none";
        return;
    }
    let 文件数 = 0, 文件夹数 = 0;
    const paths = [];
    for (const [path, item] of selectedItems) {
        if (item.类型 === "目录") 文件夹数++; else 文件数++;
        paths.push(item.名称);
    }
    const 预览 = paths.length > 10 ? paths.slice(0, 10).join(", ") + ` ...等${paths.length}项` : paths.join(", ");
    hint.innerHTML = `📋 已选中 <span class="fs-count">${selectedItems.size}</span> 项（${文件数}文件, ${文件夹数}文件夹）<span class="fs-clear" onclick="clearFileSelection()">✕</span><div class="fs-list">${escapeHtml(预览)}</div>`;
    hint.style.display = "block";
}

// ============ 拖拽框选 ============
let dragState = null;
let justDragged = false;

function initGallerySelection() {
    const mv = document.getElementById("mediaView");
    if (mv) {
        mv.addEventListener("mousedown", onDragStart);
        mv.addEventListener("click", onSelectionClick, true);
        mv.addEventListener("dblclick", onSelectionDblClick);
    }
    document.addEventListener("keydown", onSelectionKeyDown);
}

function isGalleryMode() {
    const gh = document.getElementById("galleryHeader");
    return gh && gh.style.display !== "none";
}

function onSelectionDblClick(e) {
    if (!isGalleryMode()) return;
    const item = e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row");
    if (item) return;
    if (selectedItems.size > 0) {
        clearFileSelection();
    }
}

function onSelectionClick(e) {
    // 拖拽刚结束，吞掉click防止打开文件
    if (justDragged) {
        justDragged = false;
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (!e.ctrlKey && !e.metaKey) return;
    const item = e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row");
    if (!item) return;
    const path = item.dataset.path;
    if (!path) return;
    e.preventDefault();
    e.stopPropagation();
    toggleItemSelection(path, item.dataset.name || "", item.dataset.type || "文件");
}

function onSelectionKeyDown(e) {
    const galleryHeader = document.getElementById("galleryHeader");
    if (!galleryHeader || galleryHeader.style.display === "none") return;
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "a" || e.key === "A") {
            e.preventDefault();
            selectAllGalleryItems();
        } else if (e.key === "d" || e.key === "D") {
            e.preventDefault();
            clearFileSelection();
        }
    }
}

function onDragStart(e) {
    if (!isGalleryMode()) return;
    if (e.button !== 0) return;
    e.preventDefault(); // 屏蔽浏览器原生拖拽行为
    // Ctrl=加选模式, Alt=减选模式, 无修饰=普通框选(替换)
    const mode = e.altKey ? "remove" : "add";

    const container = e.currentTarget;
    container.style.position = "relative";
    const rect = container.getBoundingClientRect();
    dragState = {
        startX: e.clientX - rect.left + container.scrollLeft,
        startY: e.clientY - rect.top + container.scrollTop,
        container: container,
        mode: mode,
        dragging: false,
        clearFirst: !e.ctrlKey && !e.metaKey && !e.altKey  // 普通拖拽先清空
    };

    const box = document.createElement("div");
    box.className = "drag-selection-box";
    box.style.display = "none";
    if (mode === "remove") {
        box.style.borderColor = "var(--red)";
        box.style.background = "rgba(244,67,54,0.1)";
    }
    container.appendChild(box);
    dragState.box = box;

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
}

function onDragMove(e) {
    if (!dragState) return;
    const container = dragState.container;
    const rect = container.getBoundingClientRect();
    const curX = e.clientX - rect.left + container.scrollLeft;
    const curY = e.clientY - rect.top + container.scrollTop;

    const x = Math.min(dragState.startX, curX);
    const y = Math.min(dragState.startY, curY);
    const w = Math.abs(curX - dragState.startX);
    const h = Math.abs(curY - dragState.startY);

    if (w > 3 || h > 3) {
        if (!dragState.dragging) {
            dragState.dragging = true;
            // 普通拖拽：开始时清空已有选择
            if (dragState.clearFirst) {
                selectedItems.clear();
            }
        }
        dragState.box.style.display = "block";
    }
    if (!dragState.dragging) return;

    dragState.box.style.left = x + "px";
    dragState.box.style.top = y + "px";
    dragState.box.style.width = w + "px";
    dragState.box.style.height = h + "px";

    const boxRect = { left: x, top: y, right: x + w, bottom: y + h };
    container.querySelectorAll(".gallery-item, .gallery-list-row").forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const itemX = itemRect.left - rect.left + container.scrollLeft;
        const itemY = itemRect.top - rect.top + container.scrollTop;
        const itemW = itemRect.width;
        const itemH = itemRect.height;
        const intersects = boxRect.left < itemX + itemW && boxRect.right > itemX &&
            boxRect.top < itemY + itemH && boxRect.bottom > itemY;
        item.classList.remove("drag-hover-add", "drag-hover-remove");
        if (intersects) {
            item.classList.add(dragState.mode === "remove" ? "drag-hover-remove" : "drag-hover-add");
        }
    });
}

function onDragEnd(e) {
    if (!dragState) return;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);

    const container = dragState.container;

    if (dragState.dragging) {
        // 真正发生了拖拽框选
        const hoverClass = dragState.mode === "remove" ? "drag-hover-remove" : "drag-hover-add";
        container.querySelectorAll("." + hoverClass).forEach(item => {
            item.classList.remove(hoverClass);
            const path = item.dataset.path;
            if (path) {
                if (dragState.mode === "remove") {
                    selectedItems.delete(path);
                } else {
                    const name = item.dataset.name || "";
                    const type = item.dataset.type || "文件";
                    selectedItems.set(path, { 名称: name, 类型: type, 路径: path });
                }
            }
        });
        justDragged = true;
    }

    if (dragState.box && dragState.box.parentNode) {
        dragState.box.parentNode.removeChild(dragState.box);
    }
    dragState = null;

    updateGallerySelectionVisual();
    showFileSelectionHint();
}

// ============ 框选追踪 ============
function captureSelection() {
    // 文档预览器中的选区
    const docContent = document.getElementById("docContent");
    if (docContent && document.getElementById("docViewer").style.display !== "none") {
        const sel = window.getSelection().toString();
        if (sel && sel.length > 0) {
            editorSelection = { text: sel, start: 0, end: sel.length };
            if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = editorSelection;
            showSelectionHint(sel);
            return;
        }
        editorSelection = null;
        if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = null;
        hideSelectionHint();
        return;
    }
    // 代码编辑器中的选区
    const ta = document.getElementById("codeInput");
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    if (sel.length > 0) {
        editorSelection = { text: sel, start: ta.selectionStart, end: ta.selectionEnd };
        if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = editorSelection;
        showSelectionHint(sel);
        if (editorInstance) editorInstance.设置选区高亮(ta.selectionStart, ta.selectionEnd);
    } else {
        editorSelection = null;
        if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = null;
        hideSelectionHint();
        if (editorInstance) editorInstance.清除选区高亮();
    }
}

function showSelectionHint(text) {
    let hint = document.getElementById("selectionHint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "selectionHint";
        hint.className = "selection-hint";
        const inputArea = document.querySelector(".chat-input-area");
        inputArea.insertBefore(hint, inputArea.firstChild);
    }
    const preview = text.length > 200 ? text.substring(0, 200) + `... (${text.length}字)` : text;
    const fname = (currentViewFile && currentViewFile.名称) || openFiles[activeFileIdx]?.name || "";
    const 行数 = text.split("\n").length;
    hint.innerHTML = `📌 <code>${fname}</code> 选中${text.length}字 · ${行数}行 <span class="sel-clear" onclick="clearSelection()">✕</span><pre class="sel-preview">${escapeHtml(preview)}</pre>`;
    hint.style.display = "block";
}

function hideSelectionHint() { const h = document.getElementById("selectionHint"); if (h) h.style.display = "none"; }
function clearSelection() {
    editorSelection = null;
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = null;
    hideSelectionHint();
    if (editorInstance) editorInstance.清除选区高亮();
    if (window.getSelection) window.getSelection().removeAllRanges();
}
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ============ 设置面板 ============
function initSettings() {
    document.getElementById("settingsBtn").addEventListener("click", () => { document.getElementById("settingsOverlay").style.display = "flex"; loadMemory(); });
    document.querySelectorAll(".snav-item[data-tab]").forEach(item => {
        item.addEventListener("click", () => {
            document.querySelectorAll(".snav-item").forEach(i => i.classList.remove("active"));
            document.querySelectorAll(".stab").forEach(t => t.classList.remove("active"));
            item.classList.add("active");
            document.getElementById("tab_" + item.dataset.tab).classList.add("active");
            if (item.dataset.tab === "memory") loadMemory();
            if (item.dataset.tab === "logs") loadLogs();
            if (item.dataset.tab === "models") loadModelConfig();
            if (item.dataset.tab === "engine") loadEngineInfo();
            if (item.dataset.tab === "tokenstats") loadTokenStats();
            if (item.dataset.tab === "config") loadConfig();
        });
    });
}
function closeSettings() { document.getElementById("settingsOverlay").style.display = "none"; }
async function loadMemory() {
    try { const res = await fetch("/api/config"); const c = await res.json();
        if (c.记忆库) { document.getElementById("currentEvent").textContent = c.记忆库.当前事件 || "无"; const l = c.记忆库.事件列表 || {}; document.getElementById("eventList").innerHTML = Object.entries(l).map(([id, ev]) => `<div style="padding:4px 0;border-bottom:1px solid var(--border)">${id}: ${ev.事件标题 || "未命名"} (${ev.状态})</div>`).join("") || "暂无"; }
        if (c.用户画像) document.getElementById("userProfile").textContent = JSON.stringify(c.用户画像, null, 2);
    } catch (e) {}
}
function loadLogs() {
    document.getElementById("logContent").innerHTML = logList.length === 0 ? '<p style="color:var(--text2)">暂无日志</p>' :
        logList.map(l => `<div class="log-entry"><span class="time">${l.时间}</span><strong>${l.方向}</strong><pre style="margin-top:4px;font-size:11px">${JSON.stringify(l.数据, null, 2)}</pre></div>`).reverse().join("");
}
async function loadEngineInfo() {
    try { const res = await fetch("/api/config"); const c = await res.json();
        if (c.引擎配置) { document.getElementById("mainVer").textContent = c.引擎配置.主引擎.版本; document.getElementById("mainStatus").textContent = c.引擎配置.主引擎.状态; document.getElementById("workVer").textContent = c.引擎配置.工作引擎.版本; document.getElementById("workStatus").textContent = c.引擎配置.工作引擎.状态; }
        if (c.合并日志) document.getElementById("mergeHistory").innerHTML = (c.合并日志.记录 || []).map(r => `<div style="padding:3px 0;border-bottom:1px solid var(--border);font-size:12px">${r.时间} ${r.方向} ${r.变更摘要 || ""}</div>`).join("") || "暂无";
    } catch (e) {}
}
async function loadEngineDiff() {
    try {
        const res = await fetch("/api/engine-diff");
        const d = await res.json();
        if (!d.成功) { document.getElementById("engineDiff").innerHTML = `<p style="color:#f44336;">${d.错误}</p>`; return; }
        if (d.提示) { document.getElementById("engineDiff").innerHTML = `<p style="color:var(--text2);font-size:12px;">${d.提示}</p>`; return; }
        const items = [...(d.新增||[]).map(f=>({f,s:"🟢 新增"})), ...(d.修改||[]).map(f=>({f,s:"🟡 修改"})), ...(d.删除||[]).map(f=>({f,s:"🔴 删除"}))];
        if (items.length === 0) { document.getElementById("engineDiff").innerHTML = `<p style="color:var(--text2);font-size:12px;">无差异（${d.未变||0} 个文件未变）</p>`; document.getElementById("mergeBtn").disabled = true; return; }
        let html = `<div style="margin-bottom:6px;font-size:12px;color:var(--text2);">新增${(d.新增||[]).length} 修改${(d.修改||[]).length} 删除${(d.删除||[]).length} 未变${d.未变||0} · 勾选要合并的文件</div>`;
        html += items.map(item => `<label style="display:flex;align-items:center;padding:3px 0;font-size:12px;cursor:pointer;">
            <input type="checkbox" value="${item.f}" data-diff-file style="margin-right:6px;">
            <span style="width:50px;color:var(--text2);">${item.s}</span>
            <span style="font-family:monospace;word-break:break-all;">${item.f}</span>
        </label>`).join("");
        html += `<div style="margin-top:6px;"><button class="dlg-btn" onclick="document.querySelectorAll('[data-diff-file]').forEach(c=>c.checked=true)" style="font-size:11px;padding:2px 8px;">全选</button> <button class="dlg-btn" onclick="document.querySelectorAll('[data-diff-file]').forEach(c=>c.checked=false)" style="font-size:11px;padding:2px 8px;">取消</button></div>`;
        document.getElementById("engineDiff").innerHTML = html;
        document.getElementById("mergeBtn").disabled = false;
    } catch (e) { document.getElementById("engineDiff").innerHTML = `<p style="color:#f44336;">加载失败: ${e.message}</p>`; }
}
async function doEngineMerge() {
    const checked = document.querySelectorAll("[data-diff-file]:checked");
    if (checked.length === 0) { showToast("error", "❌ 未选择文件", "请先勾选要合并的文件"); return; }
    const files = Array.from(checked).map(c => c.value);
    try {
        const res = await fetch("/api/engine-merge", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({文件列表: files, 执行: false}) });
        const d = await res.json();
        if (!d.成功) { showToast("error", "❌ 检测未通过", d.错误); document.getElementById("engineDiff").innerHTML += `<div style="color:#f44336;margin-top:8px;font-size:12px;">${d.错误}</div>`; return; }
        // 检测通过，执行合并
        const res2 = await fetch("/api/engine-merge", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({文件列表: files, 执行: true}) });
        const d2 = await res2.json();
        if (d2.成功) { showToast("success", "✅ 合并完成", `已合并 ${d2.合并数} 个文件，备份: ${d2.备份}`); loadEngineInfo(); loadEngineDiff(); }
        else { showToast("error", "❌ 合并失败", d2.错误); }
    } catch (e) { showToast("error", "❌ 合并请求失败", e.message); }
}
async function loadEngineBackups() {
    try {
        const res = await fetch("/api/engine-backups");
        const d = await res.json();
        if (!d.成功) { document.getElementById("engineDiff").innerHTML = `<p style="color:#f44336;">${d.错误}</p>`; return; }
        if (!d.备份列表 || d.备份列表.length === 0) { document.getElementById("engineDiff").innerHTML = `<p style="color:var(--text2);font-size:12px;">暂无备份</p>`; return; }
        document.getElementById("engineDiff").innerHTML = `<div style="margin-bottom:6px;font-size:12px;color:var(--text2);">选择备份进行回滚：</div>` +
            d.备份列表.map(b => `<div style="display:flex;align-items:center;padding:4px 0;font-size:12px;border-bottom:1px solid var(--border);">
                <span style="flex:1;font-family:monospace;">${b.名称}</span>
                <span style="color:var(--text2);margin-right:8px;">${b.文件数}文件</span>
                <button class="dlg-btn" onclick="doEngineRollback('${b.名称}')" style="font-size:11px;padding:2px 8px;">回滚</button>
            </div>`).join("");
    } catch (e) { document.getElementById("engineDiff").innerHTML = `<p style="color:#f44336;">加载失败: ${e.message}</p>`; }
}
async function doEngineRollback(备份名) {
    if (!confirm(`确定要回滚到备份 [${备份名}] 吗？这将覆盖主引擎中的对应文件。`)) return;
    try {
        const res = await fetch("/api/engine-rollback", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({备份: 备份名}) });
        const d = await res.json();
        if (d.成功) { showToast("success", "✅ 回滚完成", `已恢复 ${d.恢复数} 个文件`); loadEngineInfo(); loadEngineBackups(); }
        else { showToast("error", "❌ 回滚失败", d.错误); }
    } catch (e) { showToast("error", "❌ 回滚请求失败", e.message); }
}
async function loadConfig() {
    try { const res = await fetch("/api/config"); const c = await res.json();
        document.getElementById("configContent").innerHTML = Object.entries(c).map(([n, d]) => `<div class="scard"><h3>${n}</h3><pre>${JSON.stringify(d, null, 2)}</pre></div>`).join("");
    } catch (e) {}
    // 加载已保存的令牌
    const token = localStorage.getItem("zf3d_auth_token");
    if (token) document.getElementById("authTokenInput").value = token;
}
function saveAuthToken() {
    const token = document.getElementById("authTokenInput").value.trim();
    if (token) { localStorage.setItem("zf3d_auth_token", token); showToast("success", "✅ 令牌已保存", "后续API请求将自动携带令牌"); }
    else { showToast("error", "❌ 令牌为空", "请输入有效令牌"); }
}
function clearAuthToken() {
    localStorage.removeItem("zf3d_auth_token");
    document.getElementById("authTokenInput").value = "";
    showToast("success", "✅ 令牌已清除", "API请求将不再携带令牌");
}
async function loadTokenStats() {
    try {
        const res = await fetch("/api/token-stats");
        const d = await res.json();
        if (!d.成功) return;
        const s = d.统计 || {};
        document.getElementById("tsTotalCalls").textContent = s.总调用次数 || 0;
        document.getElementById("tsPromptTokens").textContent = (s.总提示tokens || 0).toLocaleString();
        document.getElementById("tsGenTokens").textContent = (s.总生成tokens || 0).toLocaleString();
        const ms = s.总耗时毫秒 || 0;
        document.getElementById("tsTotalTime").textContent = ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
        // 按模型聚合
        const history = s.调用历史 || [];
        const modelMap = {};
        for (const h of history) {
            const m = h.模型 || "未知";
            if (!modelMap[m]) modelMap[m] = {调用: 0, 提示: 0, 生成: 0, 耗时: 0};
            modelMap[m].调用++;
            modelMap[m].提示 += h.提示tokens || 0;
            modelMap[m].生成 += h.生成tokens || 0;
            modelMap[m].耗时 += h.耗时毫秒 || 0;
        }
        const modelEntries = Object.entries(modelMap).sort((a, b) => b[1].调用 - a[1].调用);
        const maxCalls = Math.max(1, ...modelEntries.map(e => e[1].调用));
        document.getElementById("tsModelStats").innerHTML = modelEntries.length === 0
            ? '<p style="color:var(--text2);font-size:12px;">暂无数据</p>'
            : modelEntries.map(([name, st]) => {
                const pct = Math.round(st.调用 / maxCalls * 100);
                return `<div style="margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
                        <span>${name}</span>
                        <span style="color:var(--text2);">${st.调用}次 · ${(st.提示+st.生成).toLocaleString()}tokens</span>
                    </div>
                    <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--blue),var(--cyan));border-radius:3px;"></div>
                    </div>
                </div>`;
            }).join("");
        // 最近调用表格
        document.getElementById("tsHistory").innerHTML = history.length === 0
            ? '<p style="color:var(--text2);font-size:12px;">暂无调用记录</p>'
            : '<table class="token-table"><thead><tr><th>时间</th><th>模型</th><th>提示</th><th>生成</th><th>耗时</th><th>流式</th></tr></thead><tbody>'
            + history.slice(-50).reverse().map(h => `<tr>
                <td style="color:var(--text2);">${h.时间 || ""}</td>
                <td>${h.模型 || ""}</td>
                <td>${(h.提示tokens || 0).toLocaleString()}</td>
                <td>${(h.生成tokens || 0).toLocaleString()}</td>
                <td>${h.耗时毫秒 || 0}ms</td>
                <td>${h.流式 ? "✅" : "—"}</td>
            </tr>`).join("") + "</tbody></table>";
    } catch (e) {
        document.getElementById("tsHistory").innerHTML = '<p style="color:#f44336;font-size:12px;">加载失败: ' + e.message + "</p>";
    }
}

// ============ 权限轮询 ============
let _shownPermPaths = new Set();
async function pollPending() {
    try {
        const res = await fetch("/api/pending");
        const d = await res.json();
        if (d.待确认 && d.待确认.length > 0) {
            for (const req of d.待确认) {
                if (!_shownPermPaths.has(req.路径)) {
                    _shownPermPaths.add(req.路径);
                    showPermissionDialog(req);
                }
            }
        }
    } catch (e) {}
    setTimeout(pollPending, 2000);
}

function showPermissionDialog(req) {
    const overlay = document.getElementById("permissionOverlay");
    document.getElementById("permPath").textContent = req.路径 || "";
    const actionMap = {"读":"读取","写":"写入","创建":"创建","删除":"删除"};
    document.getElementById("permAction").textContent = actionMap[req.操作] || req.操作 || "操作";
    overlay.style.display = "flex";
}

async function respondPermission(choice) {
    const overlay = document.getElementById("permissionOverlay");
    const path = document.getElementById("permPath").textContent;
    const actionRaw = document.getElementById("permAction").textContent;
    const actionMap = {"读取":"读","写入":"写","创建":"创建","删除":"删除"};
    const action = actionMap[actionRaw] || actionRaw;
    overlay.style.display = "none";
    _shownPermPaths.delete(path);
    try {
        await fetch("/api/permission", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({路径: path, 操作: action, 选择: choice})
        });
        const labels = {"允许一次":"单次授权","永久允许":"永久授权此文件","永久授权文件夹":"已授权整个文件夹","拒绝":"已拒绝"};
        showToast("success", "🔐 " + (labels[choice]||choice), path);
    } catch (e) {
        showToast("error", "❌ 授权响应失败", e.message);
    }
}

// ============ 股票模式 ============
let stockModeActive = false;
let stockCurrentView = 'panel';
let stockRefreshTimer = null;
let stockCurrentCode = '';

function toggleStockMode() {
    stockModeActive = !stockModeActive;
    const filesPanel = document.getElementById('filesPanel');
    const editorPanel = document.getElementById('editorPanel');
    const stockPanel = document.getElementById('stockPanel');
    const dividers = document.querySelectorAll('.divider');
    const btn = document.getElementById('stockModeBtn');

    if (stockModeActive) {
        // 隐藏文件面板和编辑器面板
        filesPanel.style.display = 'none';
        editorPanel.style.display = 'none';
        // 隐藏第一个分隔线（filesPanel↔editorPanel）
        if (dividers[0]) dividers[0].style.display = 'none';
        // 第二个分隔线改为 stockPanel↔chatPanel
        if (dividers[1]) dividers[1].dataset.left = 'stockPanel';
        // 显示股票面板（清理可能因拖拽折叠残留的 hidden 类）
        stockPanel.classList.remove('hidden');
        stockPanel.style.width = '';
        stockPanel.style.display = 'flex';
        stockPanel.style.flex = '1';
        btn.style.color = 'var(--blue)';
        btn.textContent = '📁';
        btn.title = '切换回文件夹模式';
        // 加载盘面数据
        switchStockView('panel');
    } else {
        // 恢复文件面板和编辑器面板
        filesPanel.style.display = 'flex';
        editorPanel.style.display = 'flex';
        if (dividers[0]) dividers[0].style.display = '';
        // 第二个分隔线恢复为 editorPanel↔chatPanel
        if (dividers[1]) dividers[1].dataset.left = 'editorPanel';
        // 清理可能因拖拽折叠残留的 hidden 类
        filesPanel.classList.remove('hidden');
        editorPanel.classList.remove('hidden');
        chatPanel.classList.remove('hidden');
        filesPanel.style.width = '';
        editorPanel.style.width = '';
        stockPanel.style.display = 'none';
        btn.style.color = '';
        btn.textContent = '📊';
        btn.title = '切换到股票模式';
        // 停止刷新
        if (stockRefreshTimer) { clearInterval(stockRefreshTimer); stockRefreshTimer = null; }
    }
}

function switchStockView(view) {
    stockCurrentView = view;
    // 更新标签高亮
    document.querySelectorAll('.stock-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
    // 切换视图显示
    document.getElementById('stockViewPanel').style.display = view === 'panel' ? 'block' : 'none';
    document.getElementById('stockViewKline').style.display = view === 'kline' ? 'block' : 'none';
    document.getElementById('stockViewMinute').style.display = view === 'minute' ? 'block' : 'none';

    // 停止之前的刷新
    if (stockRefreshTimer) { clearInterval(stockRefreshTimer); stockRefreshTimer = null; }

    if (view === 'panel') {
        loadStockPanel();
        // 每10秒刷新
        stockRefreshTimer = setInterval(loadStockPanel, 10000);
    } else if (view === 'kline' && stockCurrentCode) {
        loadStockKline(stockCurrentCode);
    } else if (view === 'minute' && stockCurrentCode) {
        loadStockMinute(stockCurrentCode);
    }
}

async function searchStock() {
    const input = document.getElementById('stockCodeInput');
    const code = input.value.trim();
    if (!code) return;
    stockCurrentCode = code;
    // 根据当前视图加载对应数据
    if (stockCurrentView === 'kline') {
        loadStockKline(code);
    } else if (stockCurrentView === 'minute') {
        loadStockMinute(code);
    } else {
        // 在盘面视图下搜索，切换到K线
        switchStockView('kline');
    }
}

// 盘面列表
async function loadStockPanel() {
    const container = document.getElementById('stockViewPanel');
    container.innerHTML = '<div class="sp-loading">⏳ 加载盘面数据...</div>';
    try {
        const res = await fetch('/api/stock-panel');
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        let html = '<div class="sp-refresh-bar">';
        html += '<div class="sp-idx-row">';
        // 指数快览
        for (const idx of (d.指数 || [])) {
            const cls = idx.涨跌幅 >= 0 ? 'sp-up' : 'sp-down';
            const arrow = idx.涨跌幅 >= 0 ? '▲' : '▼';
            html += `<span class="sp-idx" onclick="stockCurrentCode='${idx.代码}';switchStockView('kline')">${idx.名称} ${idx.最新价} <span class="${cls}">${arrow}${Math.abs(idx.涨跌幅).toFixed(2)}%</span></span>`;
        }
        html += '</div>';
        html += `<span class="sp-last-update">更新: ${d.时间 || ''} (10s刷新)</span>`;
        html += '</div>';

        // 涨幅榜
        html += '<table class="sp-table"><thead><tr>';
        html += '<th>代码</th><th>名称</th><th>最新价</th><th>涨幅%</th><th>涨速</th><th>主力净流入</th><th>成交额</th><th>量比</th>';
        html += '</tr></thead><tbody>';
        for (const s of (d.涨幅榜 || [])) {
            const cls = s.涨幅 >= 0 ? 'sp-up' : 'sp-down';
            const code = s.代码 || '';
            html += `<tr onclick="stockCurrentCode='${code}';switchStockView('kline')" style="cursor:pointer">`;
            html += `<td class="sp-code">${code}</td>`;
            html += `<td class="sp-name">${escapeHtml(s.名称 || '')}</td>`;
            html += `<td class="${cls}">${s.最新价 || '-'}</td>`;
            html += `<td class="${cls}">${(s.涨幅 || 0).toFixed(2)}</td>`;
            html += `<td>${s.涨速 != null ? s.涨速.toFixed(2) : '-'}</td>`;
            const flow = s.主力净流入;
            const flowCls = flow >= 0 ? 'sp-up' : 'sp-down';
            html += `<td class="${flowCls}">${flow != null ? (flow >= 0 ? '+' : '') + flow.toFixed(2) + '亿' : '-'}</td>`;
            html += `<td>${s.成交额 || '-'}</td>`;
            html += `<td>${s.量比 != null ? s.量比.toFixed(2) : '-'}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';

        // 跌幅榜
        if (d.跌幅榜 && d.跌幅榜.length > 0) {
            html += '<table class="sp-table" style="margin-top:8px;"><thead><tr>';
            html += '<th>代码</th><th>名称</th><th>最新价</th><th>跌幅%</th><th>主力净流入</th><th>成交额</th>';
            html += '</tr></thead><tbody>';
            for (const s of d.跌幅榜) {
                const cls = s.涨幅 >= 0 ? 'sp-up' : 'sp-down';
                const code = s.代码 || '';
                html += `<tr onclick="stockCurrentCode='${code}';switchStockView('kline')" style="cursor:pointer">`;
                html += `<td class="sp-code">${code}</td>`;
                html += `<td class="sp-name">${escapeHtml(s.名称 || '')}</td>`;
                html += `<td class="${cls}">${s.最新价 || '-'}</td>`;
                html += `<td class="${cls}">${(s.涨幅 || 0).toFixed(2)}</td>`;
                const flow = s.主力净流入;
                const flowCls = flow >= 0 ? 'sp-up' : 'sp-down';
                html += `<td class="${flowCls}">${flow != null ? (flow >= 0 ? '+' : '') + flow.toFixed(2) + '亿' : '-'}</td>`;
                html += `<td>${s.成交额 || '-'}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ 连接失败: ' + escapeHtml(e.message) + '</div>';
    }
}

// K线图
async function loadStockKline(code) {
    const container = document.getElementById('stockViewKline');
    container.innerHTML = '<div class="sp-loading">⏳ 加载K线数据...</div>';
    try {
        const res = await fetch('/api/stock-kline?code=' + encodeURIComponent(code));
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        const data = d.数据 || [];
        if (data.length === 0) {
            container.innerHTML = '<div class="sp-loading">无数据</div>';
            return;
        }
        // 用Canvas绘制简易K线图
        let html = '<div class="stock-kline-container">';
        html += '<div class="stock-kline-header">';
        const info = d.股票信息 || {};
        const cls = (info.涨跌幅 || 0) >= 0 ? 'sp-up' : 'sp-down';
        html += `<span class="sk-name">${escapeHtml(info.名称 || code)} <span style="font-size:12px;color:var(--text2)">${code}</span></span>`;
        html += `<div class="sk-info">`;
        html += `<span class="${cls}" style="font-size:16px;font-weight:bold">${info.最新价 || '-'}</span>`;
        html += `<span class="${cls}">${(info.涨跌幅 || 0) >= 0 ? '+' : ''}${(info.涨跌幅 || 0).toFixed(2)}%</span>`;
        html += `<span>MA5:${info.MA5 || '-'}</span><span>MA20:${info.MA20 || '-'}</span>`;
        html += `</div></div>`;
        html += `<canvas class="stock-kline-canvas" id="klineCanvas"></canvas>`;
        html += '</div>';
        container.innerHTML = html;
        // 绘制K线
        drawKline('klineCanvas', data);
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(e.message) + '</div>';
    }
}

function drawKline(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);

    if (data.length === 0) return;
    const maxPrice = Math.max(...data.map(d => d.高));
    const minPrice = Math.min(...data.map(d => d.低));
    const range = maxPrice - minPrice || 1;
    const padLeft = 8, padRight = 50, padTop = 10, padBottom = 60;
    const chartW = w - padLeft - padRight, chartH = h - padTop - padBottom;
    const candleW = Math.max(2, chartW / data.length * 0.7);
    const gap = chartW / data.length;

    // 网格线
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padTop + chartH * i / 4;
        ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y); ctx.stroke();
        // 价格刻度
        const price = maxPrice - range * i / 4;
        ctx.fillStyle = '#666'; ctx.font = '10px Consolas';
        ctx.fillText(price.toFixed(2), padLeft + chartW + 4, y + 3);
    }

    // K线
    data.forEach((d, i) => {
        const x = padLeft + i * gap + gap / 2;
        const openY = padTop + (maxPrice - d.开) / range * chartH;
        const closeY = padTop + (maxPrice - d.收) / range * chartH;
        const highY = padTop + (maxPrice - d.高) / range * chartH;
        const lowY = padTop + (maxPrice - d.低) / range * chartH;
        const isUp = d.收 >= d.开;
        const color = isUp ? '#f14c4c' : '#4EC9B0';

        // 影线
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke();
        // 实体
        const bodyTop = Math.min(openY, closeY);
        const bodyH = Math.max(1, Math.abs(closeY - openY));
        if (isUp) {
            ctx.strokeStyle = color; ctx.strokeRect(x - candleW/2, bodyTop, candleW, bodyH);
        } else {
            ctx.fillStyle = color; ctx.fillRect(x - candleW/2, bodyTop, candleW, bodyH);
        }
    });

    // 成交量
    const volMax = Math.max(...data.map(d => d.量 || 0)) || 1;
    const volH = 40;
    const volTop = h - padBottom + 10;
    data.forEach((d, i) => {
        const x = padLeft + i * gap + gap / 2;
        const vh = (d.量 || 0) / volMax * volH;
        const isUp = d.收 >= d.开;
        ctx.fillStyle = isUp ? 'rgba(241,76,76,0.5)' : 'rgba(78,201,176,0.5)';
        ctx.fillRect(x - candleW/2, volTop + volH - vh, candleW, vh);
    });
}

// 分时图
async function loadStockMinute(code) {
    const container = document.getElementById('stockViewMinute');
    container.innerHTML = '<div class="sp-loading">⏳ 加载分时数据...</div>';
    try {
        const res = await fetch('/api/stock-minute?code=' + encodeURIComponent(code));
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        const data = d.数据 || [];
        if (data.length === 0) {
            container.innerHTML = '<div class="sp-loading">无数据</div>';
            return;
        }
        let html = '<div class="stock-minute-container">';
        html += '<div class="stock-minute-header">';
        const info = d.股票信息 || {};
        const cls = (info.涨跌幅 || 0) >= 0 ? 'sp-up' : 'sp-down';
        html += `<span class="sm-name">${escapeHtml(info.名称 || code)} <span style="font-size:12px;color:var(--text2)">${code}</span></span>`;
        html += `<span class="sm-price ${cls}">${info.最新价 || '-'} (${(info.涨跌幅 || 0) >= 0 ? '+' : ''}${(info.涨跌幅 || 0).toFixed(2)}%)</span>`;
        html += '</div>';
        html += `<canvas class="stock-minute-canvas" id="minuteCanvas"></canvas>`;
        html += '</div>';
        container.innerHTML = html;
        drawMinute('minuteCanvas', data, d.昨收价);
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(e.message) + '</div>';
    }
}

function drawMinute(canvasId, data, prevClose) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);

    if (data.length === 0) return;
    const prices = data.map(d => d.价格);
    const maxP = Math.max(...prices, prevClose || 0);
    const minP = Math.min(...prices, prevClose || prices[0]);
    const range = Math.max(maxP - minP, prevClose * 0.01, 0.01);
    const padL = 8, padR = 50, padT = 10, padB = 30;
    const cW = w - padL - padR, cH = h - padT - padB;

    // 网格+刻度
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padT + cH * i / 4;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke();
        // 涨跌幅
        const pct = (1 - i / 4) * range / (prevClose || 1) * 100;
        ctx.fillStyle = pct >= 0 ? '#f14c4c' : '#4EC9B0';
        ctx.font = '10px Consolas';
        ctx.fillText((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%', padL + cW + 4, y + 3);
    }

    // 昨收线
    if (prevClose) {
        const yPrev = padT + (maxP - prevClose) / range * cH;
        ctx.strokeStyle = '#555'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(padL, yPrev); ctx.lineTo(padL + cW, yPrev); ctx.stroke();
        ctx.setLineDash([]);
    }

    // 分时线
    ctx.strokeStyle = '#d4d4d4'; ctx.lineWidth = 1;
    ctx.beginPath();
    data.forEach((d, i) => {
        const x = padL + i / (data.length - 1) * cW;
        const y = padT + (maxP - d.价格) / range * cH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 均价线（如果有）
    if (data[0].均价 != null) {
        ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 1;
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = padL + i / (data.length - 1) * cW;
            const y = padT + (maxP - d.均价) / range * cH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // 成交量柱
    const volMax = Math.max(...data.map(d => d.量 || 0)) || 1;
    const volH = 25;
    const volTop = h - padB + 5;
    data.forEach((d, i) => {
        const x = padL + i / (data.length - 1) * cW;
        const vh = (d.量 || 0) / volMax * volH;
        const isUp = d.价格 >= (prevClose || d.价格);
        ctx.fillStyle = isUp ? 'rgba(241,76,76,0.3)' : 'rgba(78,201,176,0.3)';
        ctx.fillRect(x - 1, volTop + volH - vh, 2, vh);
    });
}
