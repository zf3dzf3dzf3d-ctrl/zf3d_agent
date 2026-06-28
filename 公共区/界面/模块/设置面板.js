/**
 * 设置面板 — 设置面板+记忆/日志/引擎/Token/配置
 * 从 逻辑.js 拆分
 */

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

