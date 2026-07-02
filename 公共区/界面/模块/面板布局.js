/**
 * 面板布局 — 初始化+面板切换+分隔线拖拽
 * 从 逻辑.js 拆分，依赖全局状态
 */

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
    // 权限轮询改为AI任务期间启动（setThinkingState中调用startPermPoll）
    // 此处不再无条件启动pollPending
    const savedRoot = localStorage.getItem("lastFolder");
    // 验证保存的路径是否有效（盘符必须有:\后缀）
    let initPath = "./";
    if (savedRoot) {
        // 如果是单盘符如 "C" 或 "c:" 但没有反斜杠，修正为 "C:\"
        if (/^[A-Za-z]:?$/.test(savedRoot)) {
            initPath = savedRoot.charAt(0).toUpperCase() + ":\\";
        } else {
            initPath = savedRoot;
        }
    }
    openFolder(initPath);
    showGallery(initPath);
    initAudioPlayer();
    initMusicBar();
    initSlideshowSpeed();
    setTimeout(checkPanelNarrow, 100);
    setTimeout(checkForUpdate, 3000);
});

// 关闭页面时只保存对话，不关服务器（服务器靠手动关闭cmd窗口）
window.addEventListener("beforeunload", function() {
    try { navigator.sendBeacon("/api/conversation-save", "{}"); } catch(e) {}
    try { navigator.sendBeacon("/api/tts-stop", "{}"); } catch(e) {}
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

// ============ 对话初始化 ============
function initChat() {
    const input = document.getElementById("userInput");
    const btn = document.getElementById("sendBtn");
    btn.addEventListener("click", () => { isChatting ? stopChat() : sendMessage(); });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    input.addEventListener("input", () => { input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden"; });
}
