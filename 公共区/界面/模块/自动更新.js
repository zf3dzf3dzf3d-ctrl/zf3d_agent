/**
 * 静默自动更新 — 检查并静默下载新版本
 * 从 逻辑.js 拆分，依赖全局状态+Toast通知
 */

// ============ 静默自动更新 ============
let updateInfo = null;
let updateApplied = false;  // 更新已应用，等待重启

async function checkForUpdate() {
    try {
        const res = await fetch("/api/check-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const d = await res.json();
        if (d.有更新) {
            updateInfo = d;
            // 静默自动下载并更新，不弹窗
            await silentUpdate(d);
        }
    } catch (e) {}
}

async function silentUpdate(info) {
    const btn = document.getElementById("updateBtn");
    btn.style.display = "";
    btn.classList.add("has-update");
    btn.title = `正在静默更新到 ${info.最新版本}...`;
    btn.textContent = "⏳";
    showToast("info", "🔄 发现新版本", `${info.最新版本} 正在后台静默更新...`);
    try {
        const res = await fetch("/api/do-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 下载地址: info.下载地址 || "" }) });
        const d = await res.json();
        if (d.成功) {
            updateApplied = true;
            btn.textContent = "✅";
            btn.classList.remove("has-update");
            btn.title = `已更新到 ${info.最新版本}，点击重启生效`;
            showToast("success", "✅ 已更新到最新版", `${info.最新版本} 更新完成，点击右上角✅重启`);
            btn.onclick = () => { if (confirm("更新已完成，是否立即重启？")) location.reload(); };
        } else {
            btn.textContent = "🔄";
            btn.title = `更新失败: ${d.错误 || "未知"}，点击手动重试`;
            btn.onclick = () => { if (confirm("更新失败，是否重试？")) silentUpdate(info); };
            showToast("error", "❌ 静默更新失败", d.错误 || "点击右上角🔄重试");
        }
    } catch (e) {
        btn.textContent = "🔄";
        btn.title = `更新失败: ${e.message}，点击手动重试`;
        showToast("error", "❌ 静默更新失败", e.message);
    }
}
