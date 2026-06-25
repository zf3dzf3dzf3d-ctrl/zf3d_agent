/**
 * Toast通知 — 通知+编辑器闪烁+修改Banner
 * 从 逻辑.js 拆分，保持全局函数兼容（onclick可用）
 */
function initToast() {
    const c = document.createElement("div");
    c.className = "toast-container";
    c.id = "toastContainer";
    document.body.appendChild(c);
}

function showToast(type, title, msg, duration) {
    duration = duration || 4000;
    const c = document.getElementById("toastContainer");
    if (!c) return;
    const icons = { success: "✅", error: "❌", info: "ℹ️" };
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type] || "ℹ️"}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div><span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add("fade-out"); setTimeout(() => t.remove(), 300); }, duration);
}

function showEditorModifiedBanner(message, type) {
    const container = document.getElementById("editorContainer");
    if (!container) return;
    container.querySelectorAll(".editor-modified-banner").forEach(b => b.remove());
    const cls = type === "delete" ? "editor-modified-banner delete" : "editor-modified-banner modify";
    const icon = type === "delete" ? "🗑️" : "✏️";
    const banner = document.createElement("div");
    banner.className = cls;
    banner.innerHTML = `<span>${icon} ${message}</span><span class="banner-close" onclick="this.parentElement.remove()">✕</span>`;
    container.appendChild(banner);
    setTimeout(() => { if (banner.parentElement) { banner.style.opacity = "0"; banner.style.transition = "opacity 0.5s"; setTimeout(() => banner.remove(), 500); } }, 4000);
}

function flashEditorLines(startLine, endLine, type) {
    const container = document.getElementById("editorContainer");
    if (!container) return;
    const ta = document.getElementById("codeInput");
    if (!ta) return;
    const 行高 = parseFloat(getComputedStyle(ta).lineHeight) || 19.5;
    const scrollTop = ta.scrollTop || 0;
    const containerRect = container.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    const offsetY = taRect.top - containerRect.top;
    const cls = type === "delete" ? "editor-flash-line delete" : "editor-flash-line modify";
    const maxLines = 15;
    const flashEnd = Math.min(endLine, startLine + maxLines - 1);
    for (let i = startLine; i <= flashEnd; i++) {
        const flash = document.createElement("div");
        flash.className = cls;
        flash.style.top = (i * 行高 + offsetY - scrollTop) + "px";
        flash.style.height = 行高 + "px";
        container.appendChild(flash);
        flash.style.animationDelay = ((i - startLine) * 60) + "ms";
        setTimeout(() => flash.remove(), 2800);
    }
}
