/**
 * 语音播报 — TTS文本转语音
 * 从 逻辑.js 拆分，依赖全局状态的 voiceEnabled
 */

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
    fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 文本: 纯文本 }) }).catch(() => {});
}

function stopTTS() {
    fetch("/api/tts-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}
