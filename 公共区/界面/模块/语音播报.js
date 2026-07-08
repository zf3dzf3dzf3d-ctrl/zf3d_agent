/**
 * 语音播报 — TTS文本转语音
 * 从 逻辑.js 拆分，依赖全局状态的 voiceEnabled
 * 左键：切换开关；右键：打开设置→语音tab
 */

// ============ 语音播报 ============
let ttsVolume = Math.min(100, parseInt(localStorage.getItem("ttsVolume") || "100"));

function initTTS() {
    const btn = document.getElementById("ttsToggleBtn");
    if (!btn) return;
    更新语音按钮();

    // 左键：切换开关
    btn.addEventListener("click", (e) => {
        voiceEnabled = !voiceEnabled;
        localStorage.setItem("voiceEnabled", voiceEnabled ? "true" : "false");
        更新语音按钮();
        if (!voiceEnabled) {
            fetch("/api/tts-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
        }
        showToast("info", voiceEnabled ? "🔊 语音播报已开启" : "🔇 语音播报已关闭", voiceEnabled ? "AI回复后将朗读结果" : "已停止语音播报");
    });

    // 右键：打开设置→语音tab（同语音输入的mic按钮）
    btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        document.getElementById("settingsOverlay").style.display = "flex";
        document.querySelectorAll(".snav-item").forEach(i => i.classList.remove("active"));
        document.querySelectorAll(".stab").forEach(t => t.classList.remove("active"));
        const voiceNav = document.querySelector('.snav-item[data-tab="voice"]');
        if (voiceNav) voiceNav.classList.add("active");
        document.getElementById("tab_voice").classList.add("active");
        if (typeof loadVoiceConfig === "function") loadVoiceConfig();
        if (typeof loadTTSConfig === "function") loadTTSConfig();
    });
}

function 更新语音按钮() {
    const btn = document.getElementById("ttsToggleBtn");
    if (!btn) return;
    btn.textContent = voiceEnabled ? "🔊" : "🔇";
    btn.title = voiceEnabled ? "语音播报：开（左键关闭·右键设置）" : "语音播报：关（左键开启·右键设置）";
    btn.classList.toggle("active", voiceEnabled);
}

function speakText(text) {
    if (!voiceEnabled || !text) return;
    let 纯文本 = text
        .replace(/```[\s\S]*?```/g, '代码块')
        .replace(/`[^`]+`/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/^\s*>\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
        .replace(/^---+$/gm, '')
        .replace(/^\s*\|.*\|\s*$/gm, '')
        .replace(/[⚡🤔💭✅❌🔧✏️🗑️📌📖📂📄🖼️💡📋🔍🚀⚠️🎓🛑🔇🔊]/g, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    if (纯文本.length < 2) return;
    let 员工名 = (typeof 当前员工名 !== 'undefined') ? 当前员工名 : '';
    fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 文本: 纯文本, 音量: ttsVolume, 员工名: 员工名 }) }).catch(() => {});
}

function stopTTS() {
    fetch("/api/tts-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}
