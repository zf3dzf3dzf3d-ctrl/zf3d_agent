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
            else if (_evoPollTimer) { clearTimeout(_evoPollTimer); _evoPollTimer = null; }
            if (item.dataset.tab === "tokenstats") loadTokenStats();
            if (item.dataset.tab === "config") loadConfig();
            if (item.dataset.tab === "wheel") loadWheelConfig();
            if (item.dataset.tab === "voice") { loadVoiceConfig(); loadTTSConfig(); }
            if (item.dataset.tab === "cloudimg") loadCloudKeys();
        });
    });
}
function closeSettings() { document.getElementById("settingsOverlay").style.display = "none"; if (_evoPollTimer) { clearTimeout(_evoPollTimer); _evoPollTimer = null; } }
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
    loadEvolutionStatus();
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

// ============ 进化引擎 ============
let _evoPollTimer = null;
async function loadEvolutionStatus() {
    try {
        const res = await fetch("/api/evolution-status");
        const d = await res.json();
        const el = document.getElementById("evolutionPanel");
        if (!el) return;
        if (!d.成功) {
            el.innerHTML = `<div style="padding:12px;">
                <div style="font-size:11px;color:var(--text2);line-height:1.8;margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:6px;">
                    <b style="color:var(--text1);">🧬 三智能体进化引擎</b><br>
                    <b>流程：</b>测试员找问题 → 开发者写修复 → 审查员通过/打回<br>
                    <b>安全：</b>只在工作引擎改代码，不影响运行中的系统<br>
                    <b>使用：</b>启动 → 设目标 → 等审查通过 → 扫描差异 → 执行合并 → 重启生效<br>
                    <b>回滚：</b>合并后不满意 → 查看备份 → 回滚恢复
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="dlg-btn primary" onclick="evoControl('启动')" style="font-size:12px;padding:6px 16px;">🧬 启动进化引擎</button>
                    <button class="dlg-btn" onclick="loadEvolutionHistory()" style="font-size:12px;padding:6px 16px;">📜 历史记录</button>
                    <button class="dlg-btn" onclick="evoReset()" style="font-size:12px;padding:6px 16px;color:#f44336;">🗑 丢弃进化</button>
                </div>
            </div>`;
            return;
        }
        const s = d.状态;
        let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:14px;">🧬</span>
            <span style="font-weight:600;font-size:13px;">三智能体进化引擎</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:10px;${s.暂停?'background:#f39c12;color:#000;':'background:#4caf50;color:#000;'}">${s.暂停?'已暂停':'运行中'}</span>
            <button class="dlg-btn" onclick="evoControl('停止')" style="font-size:11px;padding:2px 8px;">⏹ 停止</button>
            <button class="dlg-btn" onclick="evoReset()" style="font-size:11px;padding:2px 8px;color:#f44336;">🗑 丢弃</button>
        </div>`;
        html += `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px;text-align:center;">
            <div><div style="font-size:18px;font-weight:700;color:var(--blue);">${s.轮次}</div><div style="font-size:10px;color:var(--text2);">轮次</div></div>
            <div><div style="font-size:18px;font-weight:700;color:#f44336;">${s.发现问题数}</div><div style="font-size:10px;color:var(--text2);">发现问题</div></div>
            <div><div style="font-size:18px;font-weight:700;color:#ff9800;">${s.修复数}</div><div style="font-size:10px;color:var(--text2);">修复</div></div>
            <div><div style="font-size:18px;font-weight:700;color:#4caf50;">${s.通过数}</div><div style="font-size:10px;color:var(--text2);">审查通过</div></div>
            <div><div style="font-size:18px;font-weight:700;color:var(--text2);">${s.失败数}</div><div style="font-size:10px;color:var(--text2);">失败</div></div>
        </div>`;
        const mg = !s.目标;
        html += `<div style="display:flex;gap:4px;margin-bottom:8px;">
            <input id="evoGoal" type="text" placeholder="${mg?'请先设置进化目标':''}" value="${s.目标||''}" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--text1);font-size:12px;">
            <button class="dlg-btn primary" onclick="setEvoGoal()" style="font-size:11px;padding:4px 10px;">${mg?'🎯 设目标并开始':'修改目标'}</button>
            ${s.暂停&&!mg?'<button class="dlg-btn" onclick="evoControl(\'恢复\')" style="font-size:11px;padding:4px 10px;background:#4caf50;color:#000;">▶ 恢复</button>':(!s.暂停?'<button class="dlg-btn" onclick="evoControl(\'暂停\')" style="font-size:11px;padding:4px 10px;background:#f39c12;color:#000;">⏸ 暂停</button>':'')}
        </div>`;
        if (mg) html += `<div style="font-size:11px;color:var(--text2);margin-bottom:8px;padding:6px 10px;background:rgba(243,156,18,0.1);border-radius:4px;">⏳ 请先设置进化目标，设置后自动开始</div>`;
        if (s.待合并列表 && s.待合并列表.length > 0) {
            html += `<div style="margin-bottom:8px;">
                <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">📋 修改记录（点击查看详情）:</div>
                ${s.待合并列表.map((m,i)=>`<div style="font-size:11px;padding:4px 6px;margin:2px 0;border:1px solid var(--border);border-radius:4px;cursor:pointer;" onclick="showEvolutionDetail(${i})">✅ <span style="font-family:monospace;">${m.文件}</span><br><span style="color:var(--text2);">${(m.审查意见||'').substring(0,60)}</span></div>`).join('')}
            </div>`;
        }
        window._evoPending = s.待合并列表 || [];
        if (s.日志 && s.日志.length > 0) {
            const jb = {"测试员":"🔍","开发者":"🔧","审查员":"✅","系统":"⚙️"};
            html += `<div style="border-top:1px solid var(--border);padding-top:6px;">
                <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">实时日志:</div>
                <div style="max-height:200px;overflow-y:auto;font-size:11px;font-family:monospace;">
                    ${s.日志.slice(-15).reverse().map(l=>`<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span style="color:var(--text2);">[${l.时间}]</span> <span style="color:${l.发送者==='测试员'?'#4a9eff':l.发送者==='开发者'?'#ff9800':l.发送者==='审查员'?'#4caf50':'var(--text2)'};font-weight:600;">${jb[l.发送者]||'📋'}${l.发送者}</span> <span style="color:var(--text1);">${l.内容}</span></div>`).join('')}
                </div>
            </div>`;
        }
        el.innerHTML = html;
        if (_evoPollTimer) clearTimeout(_evoPollTimer);
        if (!s.暂停) _evoPollTimer = setTimeout(loadEvolutionStatus, 3000);
    } catch(e) {}
}
async function loadEvolutionHistory() {
    try {
        const res = await fetch("/api/evolution-records");
        const d = await res.json();
        const 记录 = d.记录 || [];
        const ov = document.createElement("div");
        ov.id = "evoHistoryOverlay";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;overflow-y:auto;";
        ov.innerHTML = `<div style="max-width:800px;margin:20px auto;padding:20px;background:#1a1a2e;border-radius:8px;">
            <div style="display:flex;align-items:center;margin-bottom:12px;"><h3 style="flex:1;">📜 进化历史记录（${记录.length}条）</h3><button class="dlg-btn" onclick="this.closest('#evoHistoryOverlay').remove()" style="font-size:12px;">关闭</button></div>
            ${记录.length===0?'<p style="color:var(--text2);">暂无记录</p>':记录.map((r,i)=>`<div style="padding:8px;margin-bottom:6px;border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="showEvolutionRecordDetail(${i})">
                <div style="display:flex;gap:8px;align-items:center;"><span style="font-size:11px;padding:1px 6px;border-radius:8px;${r.状态==='审查通过'?'background:#4caf50;color:#000;':r.状态==='审查打回'?'background:#f44336;color:#fff;':'background:#333;color:var(--text2);'}">${r.状态||'-'}</span><span style="font-family:monospace;font-size:12px;">${r.文件||'-'}</span><span style="font-size:11px;color:var(--text2);margin-left:auto;">${r.时间||''} 第${r.轮次||'?'}轮</span></div>
                ${r.问题描述?`<div style="font-size:11px;color:var(--text2);margin-top:4px;">🔍 ${r.问题描述.substring(0,80)}</div>`:''}
                ${r.修改说明?`<div style="font-size:11px;color:var(--text2);margin-top:2px;">🔧 ${r.修改说明.substring(0,80)}</div>`:''}
            </div>`).join('')}
        </div>`;
        window._evoHistory = 记录;
        ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
    } catch(e) { showToast("error","❌ 加载失败",e.message); }
}
function showEvolutionRecordDetail(idx) {
    const r = (window._evoHistory || [])[idx];
    if (!r) return;
    const pop = document.createElement("div");
    pop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;";
    pop.innerHTML = `<div style="padding:16px;max-width:700px;margin:auto;background:#1a1a2e;border-radius:8px;max-height:90vh;overflow-y:auto;">
        <h3 style="margin-bottom:8px;">📋 ${r.文件||'详情'}</h3>
        <div style="font-size:12px;margin-bottom:12px;color:var(--text2);"><b>时间:</b> ${r.时间||'-'}<br><b>轮次:</b> 第${r.轮次||'?'}轮<br><b>目标:</b> ${r.目标||'-'}<br><b>状态:</b> ${r.状态||'-'}<br><b>风险:</b> ${r.风险等级||'-'}</div>
        ${r.问题描述?`<div style="margin-bottom:12px;"><b style="color:#f44336;">🔍 测试员发现问题:</b><pre style="background:#1a0000;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;color:#ff8888;">${r.问题描述}</pre></div>`:''}
        ${r.建议修复?`<div style="margin-bottom:12px;"><b style="color:#ff9800;">💡 建议修复:</b><pre style="background:#222;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:100px;overflow-y:auto;">${r.建议修复}</pre></div>`:''}
        ${r.修改说明?`<div style="margin-bottom:12px;"><b style="color:#ff9800;">🔧 开发者修改:</b><pre style="background:#222;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;">${r.修改说明}</pre></div>`:''}
        ${r.审查意见?`<div style="margin-bottom:12px;"><b style="color:#4caf50;">✅ 审查员意见:</b><pre style="background:#222;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;">${r.审查意见}</pre></div>`:''}
        ${r.原始代码?`<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--text2);">📄 原始代码</summary><pre style="background:#1a0000;padding:8px;border-radius:4px;font-size:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:#ff8888;">${(r.原始代码||'').substring(0,3000)}</pre></details>`:''}
        ${r.完整代码?`<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--text2);">📄 修改后代码</summary><pre style="background:#001a00;padding:8px;border-radius:4px;font-size:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:#88ff88;">${(r.完整代码||'').substring(0,3000)}</pre></details>`:''}
        <button class="dlg-btn" onclick="this.closest('[style*=position]').remove()" style="margin-top:8px;">关闭</button>
    </div>`;
    pop.addEventListener("click", e => { if (e.target === pop) pop.remove(); });
    document.body.appendChild(pop);
}
function showEvolutionDetail(idx) {
    const item = (window._evoPending || [])[idx];
    if (!item) return;
    fetch("/api/evolution-records?关键词=" + encodeURIComponent(item.文件)).then(r=>r.json()).then(d=>{
        const r = (d.记录||[])[0] || {};
        const pop = document.createElement("div");
        pop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;";
        pop.innerHTML = `<div style="padding:16px;max-width:700px;margin:auto;background:#1a1a2e;border-radius:8px;max-height:90vh;overflow-y:auto;">
            <h3 style="margin-bottom:8px;">📋 ${r.文件||item.文件}</h3>
            ${r.问题描述?`<div style="margin-bottom:12px;"><b style="color:#f44336;">🔍 测试员发现问题:</b><pre style="background:#1a0000;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;color:#ff8888;">${r.问题描述}</pre></div>`:''}
            ${r.修改说明?`<div style="margin-bottom:12px;"><b style="color:#ff9800;">🔧 开发者修改:</b><pre style="background:#222;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;">${r.修改说明}</pre></div>`:''}
            ${r.审查意见?`<div style="margin-bottom:12px;"><b style="color:#4caf50;">✅ 审查员意见:</b><pre style="background:#222;padding:8px;border-radius:4px;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;">${r.审查意见}</pre></div>`:''}
            ${r.原始代码?`<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--text2);">📄 原始代码</summary><pre style="background:#1a0000;padding:8px;border-radius:4px;font-size:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:#ff8888;">${(r.原始代码||'').substring(0,3000)}</pre></details>`:''}
            ${r.完整代码?`<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--text2);">📄 修改后代码</summary><pre style="background:#001a00;padding:8px;border-radius:4px;font-size:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:#88ff88;">${(r.完整代码||'').substring(0,3000)}</pre></details>`:''}
            <button class="dlg-btn" onclick="this.closest('[style*=position]').remove()" style="margin-top:8px;">关闭</button>
        </div>`;
        pop.addEventListener("click", e => { if (e.target === pop) pop.remove(); });
        document.body.appendChild(pop);
    }).catch(e=>showToast("error","❌ 查询失败",e.message));
}
async function setEvoGoal() {
    const goal = document.getElementById("evoGoal").value.trim();
    if (!goal) { showToast("error","❌ 目标为空","请输入进化目标"); return; }
    await evoControl("设置目标", goal);
}
async function evoControl(动作, 目标) {
    try {
        const body = {动作};
        if (目标) body.目标 = 目标;
        const res = await fetch("/api/evolution-control", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        const d = await res.json();
        if (d.成功) { showToast("info","🧬 进化引擎",d.消息); loadEvolutionStatus(); }
        else { showToast("error","❌ 操作失败",d.错误); }
    } catch(e) { showToast("error","❌ 请求失败",e.message); }
}
async function evoReset() {
    if (!confirm("确定丢弃当前所有进化进度？\n\n将执行：\n• 停止进化引擎\n• 清空进化记录和待合并列表\n• 从主引擎重新同步工作引擎\n• 删除进化Git标签\n\n此操作不可撤销。")) return;
    try {
        const res = await fetch("/api/evolution-control", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({动作:"重置工作引擎"})});
        const d = await res.json();
        if (d.成功) { showToast("info","🧬 进化引擎",d.消息); loadEvolutionStatus(); }
        else { showToast("error","❌ 操作失败",d.错误); }
    } catch(e) { showToast("error","❌ 请求失败",e.message); }
}

// ============ 轮盘配置 ============
let _wheelConfig = null;
async function loadWheelConfig() {
    try {
        const res = await fetch("/api/wheel-config");
        const d = await res.json();
        if (!d.成功) { showToast("error", "❌ 加载失败", d.错误); return; }
        _wheelConfig = d.配置;
        const c = _wheelConfig;
        document.getElementById("wcTrigger").value = c.触发方式 || "Ctrl+~";
        document.getElementById("wcRadius").value = c.轮盘半径 || 70;
        document.getElementById("wcCenterRadius").value = c.中心圆半径 || 28;
        document.getElementById("wcFontSize").value = c.字体大小 || 12;
        document.getElementById("wcAlpha").value = c.透明度 || 0.85;
        document.getElementById("wcAnimMs").value = c.展开动画毫秒 || 120;
        document.getElementById("wcBgColor").value = c.背景色 || "#1a1a2e";
        document.getElementById("wcSectorColor").value = c.扇区默认色 || "#1c1c28";
        document.getElementById("wcHoverColor").value = c.扇区hover色 || "#3a3a52";
        document.getElementById("wcBorderColor").value = c.边框色 || "#444466";
        document.getElementById("wcTextColor").value = c.文字色 || "#aaaacc";
        document.getElementById("wcTextHoverColor").value = c.文字hover色 || "#ffffff";
        renderWheelSectors(c.扇区 || []);
    } catch(e) { showToast("error", "❌ 加载失败", e.message); }
}
function renderWheelSectors(sectors) {
    const container = document.getElementById("wheelSectors");
    container.innerHTML = sectors.map((s, i) => `
        <div style="display:flex;gap:6px;align-items:center;padding:6px;border:1px solid var(--border);border-radius:4px;">
            <input type="text" value="${s.名称||''}" placeholder="名称" data-sector-name="${i}" class="dialog-input" style="width:80px;font-size:12px;">
            <input type="color" value="${s.颜色||'#333333'}" data-sector-color="${i}" style="width:28px;height:24px;border:none;background:none;cursor:pointer;">
            <input type="text" value="${s.说明||''}" placeholder="说明" data-sector-desc="${i}" class="dialog-input" style="flex:1;font-size:12px;">
            <button class="dlg-btn" onclick="moveWheelSector(${i},-1)" style="font-size:11px;padding:2px 6px;">↑</button>
            <button class="dlg-btn" onclick="moveWheelSector(${i},1)" style="font-size:11px;padding:2px 6px;">↓</button>
            <button class="dlg-btn" onclick="removeWheelSector(${i})" style="font-size:11px;padding:2px 6px;color:#f44336;">✕</button>
        </div>`).join("");
}
function addWheelSector() {
    if (!_wheelConfig) return;
    _wheelConfig.扇区 = _wheelConfig.扇区 || [];
    _wheelConfig.扇区.push({"名称": "空", "颜色": "", "说明": ""});
    renderWheelSectors(_wheelConfig.扇区);
}
function removeWheelSector(idx) {
    if (!_wheelConfig || !_wheelConfig.扇区) return;
    _wheelConfig.扇区.splice(idx, 1);
    renderWheelSectors(_wheelConfig.扇区);
}
function moveWheelSector(idx, dir) {
    if (!_wheelConfig || !_wheelConfig.扇区) return;
    const arr = _wheelConfig.扇区;
    const ni = idx + dir;
    if (ni < 0 || ni >= arr.length) return;
    [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
    renderWheelSectors(arr);
}
async function saveWheelConfig() {
    if (!_wheelConfig) return;
    const sectors = [];
    document.querySelectorAll("[data-sector-name]").forEach(inp => {
        const i = inp.dataset.sectorName;
        sectors.push({
            "名称": inp.value,
            "颜色": document.querySelector(`[data-sector-color="${i}"]`).value,
            "说明": document.querySelector(`[data-sector-desc="${i}"]`).value
        });
    });
    _wheelConfig.扇区 = sectors;
    _wheelConfig.触发方式 = document.getElementById("wcTrigger").value;
    _wheelConfig.轮盘半径 = parseInt(document.getElementById("wcRadius").value) || 70;
    _wheelConfig.中心圆半径 = parseInt(document.getElementById("wcCenterRadius").value) || 28;
    _wheelConfig.字体大小 = parseInt(document.getElementById("wcFontSize").value) || 12;
    _wheelConfig.透明度 = parseFloat(document.getElementById("wcAlpha").value) || 0.85;
    _wheelConfig.展开动画毫秒 = parseInt(document.getElementById("wcAnimMs").value) || 120;
    _wheelConfig.背景色 = document.getElementById("wcBgColor").value;
    _wheelConfig.扇区默认色 = document.getElementById("wcSectorColor").value;
    _wheelConfig.扇区hover色 = document.getElementById("wcHoverColor").value;
    _wheelConfig.边框色 = document.getElementById("wcBorderColor").value;
    _wheelConfig.文字色 = document.getElementById("wcTextColor").value;
    _wheelConfig.文字hover色 = document.getElementById("wcTextHoverColor").value;
    try {
        const res = await fetch("/api/wheel-config", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(_wheelConfig)
        });
        const d = await res.json();
        if (d.成功) showToast("success", "✅ 轮盘配置已保存", "下次呼出轮盘即生效");
        else showToast("error", "❌ 保存失败", d.错误);
    } catch(e) { showToast("error", "❌ 保存失败", e.message); }
}
function resetWheelConfig() {
    _wheelConfig = {
        "启用": true,
        "触发方式": "Ctrl+~",
        "双击间隔毫秒": 400,
        "轮盘半径": 70,
        "中心圆半径": 28,
        "展开动画毫秒": 120,
        "透明度": 0.85,
        "自动朗读": false,
        "背景色": "#1a1a2e",
        "字体大小": 12,
        "扇区默认色": "#1c1c28",
        "扇区hover色": "#3a3a52",
        "边框色": "#444466",
        "中心圆色": "#15151c",
        "中心圆hover色": "#2a2a3a",
        "文字色": "#aaaacc",
        "文字hover色": "#ffffff",
        "扇区": [
            {"名称": "翻译", "颜色": "#4a9eff", "说明": "选中文本翻译"},
            {"名称": "问答", "颜色": "#9b59b6", "说明": "快速提问，带上下文"},
            {"名称": "录音", "颜色": "#e74c3c", "说明": "点击开始录音，再次点击停止"},
            {"名称": "录屏", "颜色": "#2ecc71", "说明": "点击开始录屏，再次点击停止"},
            {"名称": "朗读", "颜色": "#f39c12", "说明": "选中文本语音朗读"},
            {"名称": "截图", "颜色": "#50c878", "说明": "框选区域截图"}
        ],
        "记忆": {"注入用户画像": true, "快速对话缓冲轮数": 5},
        "系统提示词": "你是快速助手，简洁回答。以下是对话历史和用户画像，自行判断是否参考。"
    };
    // 填充表单
    const c = _wheelConfig;
    document.getElementById("wcTrigger").value = c.触发方式;
    document.getElementById("wcRadius").value = c.轮盘半径;
    document.getElementById("wcCenterRadius").value = c.中心圆半径;
    document.getElementById("wcFontSize").value = c.字体大小;
    document.getElementById("wcAlpha").value = c.透明度;
    document.getElementById("wcAnimMs").value = c.展开动画毫秒;
    document.getElementById("wcBgColor").value = c.背景色;
    document.getElementById("wcSectorColor").value = c.扇区默认色;
    document.getElementById("wcHoverColor").value = c.扇区hover色;
    document.getElementById("wcBorderColor").value = c.边框色;
    document.getElementById("wcTextColor").value = c.文字色;
    document.getElementById("wcTextHoverColor").value = c.文字hover色;
    renderWheelSectors(c.扇区);
    showToast("info", "↩️ 已恢复默认", "点击保存按钮写入配置");
}

// ============ 语音输入配置 ============
let _voiceInstallPolling = null;
async function loadVoiceConfig() {
    try {
        // 先查安装状态（判断是否正在下载中）
        let 安装中 = false;
        let 安装步骤 = "";
        try {
            const sr = await fetch("/api/voice-install-status", { method: "POST", headers: {"Content-Type":"application/json"}, body: "{}" });
            const sd = await sr.json();
            if (sd.成功 && !sd.状态.完成 && !sd.状态.错误 && sd.状态.进度 > 0) {
                安装中 = true;
                安装步骤 = sd.状态.步骤 || "安装中";
            }
        } catch(e) {}

        const res = await fetch("/api/voice-status");
        const d = await res.json();
        if (!d.成功) { showToast("error", "❌ 加载失败", d.错误); return; }
        const panel = document.getElementById("voiceConfigPanel");
        const 已安装 = d.已安装;
        const 模型存在 = d.模型存在;
        const 引擎 = d.引擎 || "浏览器";
        const 状态文本 = 已安装 && 模型存在 ? "✅ 已就绪" : (已安装 ? "⚠️ 库已安装，模型未下载" : (安装中 ? "⏳ 安装中..." : "❌ 未安装"));
        const 按钮HTML = 安装中
            ? '<button class="dlg-btn primary" disabled style="opacity:0.6;">⏳ 下载中...</button>'
            : ((!已安装 || !模型存在) ? '<button class="dlg-btn primary" onclick="installLocalSTT()" id="voiceInstallBtn">🔧 自动安装</button>' : '');
        panel.innerHTML = `
            <div style="font-size:13px;line-height:1.8;margin-bottom:16px;">
                <p style="color:var(--text2);">选择语音输入引擎：</p>
                <label style="display:flex;align-items:center;gap:6px;margin:8px 0;cursor:pointer;">
                    <input type="radio" name="voiceEngine" value="浏览器" ${引擎==="浏览器"?"checked":""}>
                    <span>🌐 浏览器引擎</span>
                    <span style="color:var(--text2);font-size:11px;">（Web Speech API，零安装，需联网）</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;margin:8px 0;cursor:pointer;">
                    <input type="radio" name="voiceEngine" value="本地" ${引擎==="本地"?"checked":""}>
                    <span>🖥️ 本地引擎</span>
                    <span style="color:var(--text2);font-size:11px;">（sherpa-onnx，流式识别，边说边出字）</span>
                </label>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
                <h4 style="margin:0 0 8px;font-size:13px;">本地引擎状态</h4>
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                    <span style="font-size:13px;">${状态文本}</span>
                    ${按钮HTML}
                </div>
                <div id="voiceInstallProgress" style="font-size:12px;color:var(--text2);">${安装中 ? 安装步骤 : ''}</div>
                <div style="font-size:11px;color:var(--text2);margin-top:8px;">
                    安装内容：sherpa-onnx 库（~50MB）+ 流式语音模型（~220MB）<br>
                    模型来源：GitHub，多线程加速下载<br>
                    模型存储：本地英文路径，不外泄
                </div>
            </div>
            <div style="margin-top:16px;">
                <button class="dlg-btn primary" onclick="saveVoiceConfig()">💾 保存设置</button>
            </div>
        `;
        // 如果正在安装中，恢复进度显示
        if (_voiceInstallPolling) _startInstallPolling();
    } catch (e) { showToast("error", "❌ 加载失败", e.message); }
}

async function saveVoiceConfig() {
    const 引擎 = document.querySelector('input[name="voiceEngine"]:checked')?.value || "浏览器";
    try {
        // 读取当前系统配置，修改语音输入部分，保存
        const res = await fetch("/api/config");
        const c = await res.json();
        const 系统配置 = c.系统配置 || {};
        if (!系统配置.语音输入) 系统配置.语音输入 = {};
        系统配置.语音输入.引擎 = 引擎;
        await fetch("/api/save-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "名称": "系统配置", "数据": 系统配置, "区域": "公共区" })
        });
        showToast("success", "✅ 语音设置已保存", "切换引擎后刷新页面生效");
    } catch (e) { showToast("error", "❌ 保存失败", e.message); }
}

async function installLocalSTT() {
    // 正在安装中则不重复点击
    if (_voiceInstallPolling) {
        showToast("info", "🔧 正在安装中", "请等待当前下载完成");
        return;
    }
    const btn = document.getElementById("voiceInstallBtn");
    const progress = document.getElementById("voiceInstallProgress");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ 下载中..."; }
    try {
        await fetch("/api/voice-install", { method: "POST", headers: {"Content-Type":"application/json"}, body: "{}" });
        // 立即弹出下载面板
        if (typeof showDownloadPanel === "function") showDownloadPanel();
        // 持续保持面板显示+轮询，直到安装完成
        _keepPanelAlive = true;
        if (typeof startDownloadPolling === "function") startDownloadPolling();
        _startInstallPolling();
    } catch (e) {
        showToast("error", "❌ 启动安装失败", e.message);
        if (btn) { btn.disabled = false; btn.textContent = "🔧 自动安装"; }
    }
}

function _startInstallPolling() {
    if (_voiceInstallPolling) return;
    const progress = document.getElementById("voiceInstallProgress");
    _voiceInstallPolling = setInterval(async () => {
        try {
            const res = await fetch("/api/voice-install-status", { method: "POST", headers: {"Content-Type":"application/json"}, body: "{}" });
            const d = await res.json();
            if (!d.成功) return;
            const s = d.状态;
            if (progress) {
                if (s.错误) {
                    progress.innerHTML = `<span style="color:#f44336;">❌ ${s.错误}</span>`;
                } else if (s.完成) {
                    progress.innerHTML = `<span style="color:#4caf50;">✅ 安装完成！点击保存并刷新页面</span>`;
                } else {
                    progress.innerHTML = `${s.步骤}（${s.进度}%）`;
                }
            }
            if (s.完成 || s.错误) {
                clearInterval(_voiceInstallPolling);
                _voiceInstallPolling = null;
                _keepPanelAlive = false; // 释放下载面板
                const btn2 = document.getElementById("voiceInstallBtn");
                if (btn2) { btn2.disabled = false; btn2.textContent = "🔧 自动安装"; }
                if (s.完成) {
                    // 不立即loadVoiceConfig，避免重新渲染覆盖进度显示
                    // 改为直接更新状态文本
                    if (progress) progress.innerHTML = `<span style="color:#4caf50;">✅ 安装完成！请关闭设置并刷新页面</span>`;
                    showToast("success", "✅ 语音引擎安装完成", "请关闭设置并刷新页面生效");
                }
            }
        } catch (e) {}
    }, 2000);
}

// ============ TTS输出配置 ============
let _ttsInstallPolling = null;
let _tts说话人列表 = [];
let _keepPanelAliveTTS = false;

async function loadTTSConfig() {
    try {
        // 先查安装状态（判断是否正在下载中）
        let 安装中 = false;
        let 安装步骤 = "";
        try {
            const sr = await fetch("/api/tts-install-status");
            const sd = await sr.json();
            if (sd.成功 && !sd.状态.完成 && !sd.状态.错误 && sd.状态.进度 > 0) {
                安装中 = true;
                安装步骤 = sd.状态.步骤 || "安装中";
            }
        } catch(e) {}

        const [cfgRes, voicesRes] = await Promise.all([
            fetch("/api/tts-config"),
            fetch("/api/tts-voices")
        ]);
        const cfg = await cfgRes.json();
        const voices = await voicesRes.json();
        if (!cfg.成功) { showToast("error", "❌ 加载TTS配置失败", cfg.错误); return; }
        if (voices.成功) _tts说话人列表 = voices.数据 || [];
        const panel = document.getElementById("ttsConfigPanel");
        if (!panel) return;
        const 配置 = cfg.配置 || {};
        const 引擎 = 配置.引擎 || "本地";
        const 说话人ID = 配置.说话人ID ?? 47;
        const 语速 = 配置.语速 ?? 1.0;
        const edge音色 = 配置.edge音色 || "zh-CN-XiaoxiaoNeural";
        const 已安装 = cfg.已安装;
        const 模型存在 = cfg.模型存在;
        const 状态文本 = 已安装 && 模型存在 ? "✅ 已就绪" : (已安装 ? "⚠️ 库已安装，模型未下载" : (安装中 ? "⏳ 安装中..." : "❌ 未安装"));
        const 按钮HTML = 安装中
            ? '<button class="dlg-btn primary" disabled style="opacity:0.6;">⏳ 下载中...</button>'
            : ((!已安装 || !模型存在) ? '<button class="dlg-btn primary" onclick="installTTS()" id="ttsInstallBtn">🔧 自动安装</button>' : '');
        // 筛选中文说话人优先显示
        const 中文说话人 = _tts说话人列表.filter(v => v.语言 === "中文");
        const 其他说话人 = _tts说话人列表.filter(v => v.语言 !== "中文");
        const 说话人选项 = [...中文说话人, ...其他说话人]
            .map(v => `<option value="${v.sid}" ${v.sid===说话人ID?'selected':''}>${v.头像||''} ${v.名称}（${v.性别}·${v.语言}）</option>`).join('');
        const edge音色列表 = [
            "zh-CN-XiaoxiaoNeural","zh-CN-YunxiNeural","zh-CN-YunyangNeural","zh-CN-YunjianNeural",
            "zh-CN-XiaoyiNeural","zh-CN-XiaochenNeural","zh-CN-XiaohanNeural","zh-CN-XiaomengNeural",
            "zh-CN-XiaomoNeural","zh-CN-XiaoruiNeural","zh-CN-XiaoshuangNeural","zh-CN-XiaoxuanNeural",
            "zh-CN-XiaoyanNeural","zh-CN-XiaozhenNeural","zh-CN-YunfengNeural","zh-CN-YunhaoNeural",
            "zh-CN-YunxiaNeural","zh-CN-YunzeNeural","zh-CN-liaoning-XiaobeiNeural","zh-CN-shaanxi-XiaoniNeural"
        ];
        const edge选项 = edge音色列表.map(v => `<option value="${v}" ${v===edge音色?'selected':''}>${v}</option>`).join('');
        panel.innerHTML = `
            <div style="font-size:13px;line-height:1.8;margin-bottom:16px;">
                <p style="color:var(--text2);">选择TTS朗读引擎：</p>
                <label style="display:flex;align-items:center;gap:6px;margin:8px 0;cursor:pointer;">
                    <input type="radio" name="ttsEngine" value="本地" ${引擎==="本地"?"checked":""}>
                    <span>🖥️ 本地引擎</span>
                    <span style="color:var(--text2);font-size:11px;">（Kokoro TTS，离线，103个音色）</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;margin:8px 0;cursor:pointer;">
                    <input type="radio" name="ttsEngine" value="edge" ${引擎==="edge"?"checked":""}>
                    <span>🌐 Edge TTS</span>
                    <span style="color:var(--text2);font-size:11px;">（微软在线，需联网，音质好）</span>
                </label>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
                <h4 style="margin:0 0 8px;font-size:13px;">本地引擎状态</h4>
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                    <span style="font-size:13px;">${状态文本}</span>
                    ${按钮HTML}
                </div>
                <div id="ttsInstallProgress" style="font-size:12px;color:var(--text2);">${安装中 ? 安装步骤 : ''}</div>
                <div style="font-size:11px;color:var(--text2);margin-top:8px;">
                    安装内容：Kokoro TTS 模型 int8版（~126MB）<br>
                    模型来源：GitHub，多线程加速下载<br>
                    模型存储：本地英文路径，不外泄
                </div>
            </div>
            <div id="ttsLocalSettings" style="margin-top:12px;${引擎!=='本地'?'display:none':''}">
                <div class="form-group" style="margin-bottom:10px;">
                    <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">说话人（中文优先）</label>
                    <select id="ttsSpeaker" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">
                        ${说话人选项}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom:10px;">
                    <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">语速（${语速}，越大越快）</label>
                    <input type="range" id="ttsSpeed" min="0.5" max="2.0" step="0.1" value="${语速}" style="width:100%" oninput="this.previousElementSibling.textContent='语速（'+this.value+'，越大越快）'">
                </div>
            </div>
            <div id="ttsEdgeSettings" style="margin-top:12px;${引擎!=='edge'?'display:none':''}">
                <div class="form-group" style="margin-bottom:10px;">
                    <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Edge音色</label>
                    <select id="ttsEdgeVoice" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:4px;font-size:13px">
                        ${edge选项}
                    </select>
                </div>
            </div>
            <div style="margin-top:16px;">
                <button class="dlg-btn" onclick="testTTS()" style="margin-right:8px">🔊 试听</button>
                <button class="dlg-btn primary" onclick="saveTTSConfig()">💾 保存设置</button>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
                <div class="form-group" style="margin-bottom:0;">
                    <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">🔊 朗读音量（${ttsVolume}%）</label>
                    <input type="range" id="ttsVolumeSlider" min="0" max="100" value="${ttsVolume}" style="width:100%" oninput="this.previousElementSibling.textContent='🔊 朗读音量（'+this.value+'%）'; ttsVolume=parseInt(this.value); localStorage.setItem('ttsVolume',String(ttsVolume))">
                </div>
            </div>
        `;
        // 引擎切换时显示/隐藏对应设置区
        document.querySelectorAll('input[name="ttsEngine"]').forEach(r => {
            r.addEventListener('change', (e) => {
                document.getElementById('ttsLocalSettings').style.display = e.target.value === '本地' ? '' : 'none';
                document.getElementById('ttsEdgeSettings').style.display = e.target.value === 'edge' ? '' : 'none';
            });
        });
        if (_ttsInstallPolling) _startTTSInstallPolling();
    } catch (e) { showToast("error", "❌ 加载失败", e.message); }
}

async function saveTTSConfig() {
    const 引擎 = document.querySelector('input[name="ttsEngine"]:checked')?.value || "本地";
    const 说话人ID = parseInt(document.getElementById("ttsSpeaker")?.value || "47");
    const 语速 = parseFloat(document.getElementById("ttsSpeed")?.value || "1.0");
    const edge音色 = document.getElementById("ttsEdgeVoice")?.value || "zh-CN-XiaoxiaoNeural";
    try {
        const res = await fetch("/api/config");
        const c = await res.json();
        const 系统配置 = c.系统配置 || {};
        系统配置.语音输出 = { 引擎, 说话人ID, 语速, edge音色 };
        await fetch("/api/save-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "名称": "系统配置", "数据": 系统配置, "区域": "公共区" })
        });
        showToast("success", "✅ TTS设置已保存", "新设置即时生效");
    } catch (e) { showToast("error", "❌ 保存失败", e.message); }
}

function testTTS() {
    const 引擎 = document.querySelector('input[name="ttsEngine"]:checked')?.value || "本地";
    const sid = parseInt(document.getElementById("ttsSpeaker")?.value || "47");
    const 语速 = parseFloat(document.getElementById("ttsSpeed")?.value || "1.0");
    const edge音色 = document.getElementById("ttsEdgeVoice")?.value || "zh-CN-XiaoxiaoNeural";
    fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            文本: "你好，这是语音朗读测试。",
            音量: ttsVolume,
            语音配置: { 引擎, 说话人ID: sid, 语速, edge音色 }
        })
    }).catch(() => {});
}

async function installTTS() {
    if (_ttsInstallPolling) { showToast("info", "🔧 正在安装中", "请等待当前下载完成"); return; }
    const btn = document.getElementById("ttsInstallBtn");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ 下载中..."; }
    try {
        await fetch("/api/tts-install", { method: "POST", headers: {"Content-Type":"application/json"}, body: "{}" });
        // 立即弹出下载面板（左下角断点续传对话框）
        if (typeof showDownloadPanel === "function") showDownloadPanel();
        // 持续保持面板显示+轮询，直到安装完成
        _keepPanelAliveTTS = true;
        if (typeof startDownloadPolling === "function") startDownloadPolling();
        _startTTSInstallPolling();
    } catch (e) {
        showToast("error", "❌ 启动安装失败", e.message);
        if (btn) { btn.disabled = false; btn.textContent = "🔧 自动安装"; }
    }
}

function _startTTSInstallPolling() {
    if (_ttsInstallPolling) return;
    const progress = document.getElementById("ttsInstallProgress");
    _ttsInstallPolling = setInterval(async () => {
        try {
            const res = await fetch("/api/tts-install-status");
            const d = await res.json();
            if (!d.成功) return;
            const s = d.状态;
            if (progress) {
                if (s.错误) {
                    progress.innerHTML = `<span style="color:#f44336;">❌ ${s.错误}</span>`;
                } else if (s.完成) {
                    progress.innerHTML = `<span style="color:#4caf50;">✅ 安装完成！可选择说话人并试听</span>`;
                } else {
                    progress.innerHTML = `${s.步骤}（${s.进度}%）`;
                }
            }
            if (s.完成 || s.错误) {
                clearInterval(_ttsInstallPolling);
                _ttsInstallPolling = null;
                _keepPanelAliveTTS = false; // 释放下载面板
                const btn2 = document.getElementById("ttsInstallBtn");
                if (btn2) { btn2.disabled = false; btn2.textContent = "🔧 自动安装"; }
                if (s.完成) {
                    showToast("success", "✅ Kokoro TTS安装完成", "可在上方选择说话人并试听");
                    loadTTSConfig();
                }
            }
        } catch (e) {}
    }, 2000);
}

// ============ 云端出图密钥 ============
async function loadCloudKeys() {
    try {
        const res = await fetch("/api/config");
        const c = await res.json();
        const cfg = c.系统配置 || {};
        const g = document.getElementById("cloudKey_Google"); if (g) g.value = cfg.Google_API密钥 || "";
        const x = document.getElementById("cloudKey_Grok"); if (x) x.value = cfg.Grok_API密钥 || "";
        const s = document.getElementById("cloudKey_Seedream"); if (s) s.value = cfg.Seedream_API密钥 || "";
        const o = document.getElementById("cloudKey_OpenAI"); if (o) o.value = cfg.OpenAI_Image_API密钥 || "";
    } catch (e) {}
}

async function saveCloudKeys() {
    try {
        const res = await fetch("/api/config");
        const c = await res.json();
        const cfg = c.系统配置 || {};
        const g = document.getElementById("cloudKey_Google"); if (g) cfg.Google_API密钥 = g.value.trim();
        const x = document.getElementById("cloudKey_Grok"); if (x) cfg.Grok_API密钥 = x.value.trim();
        const s = document.getElementById("cloudKey_Seedream"); if (s) cfg.Seedream_API密钥 = s.value.trim();
        const o = document.getElementById("cloudKey_OpenAI"); if (o) cfg.OpenAI_Image_API密钥 = o.value.trim();
        await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "名称": "系统配置", "数据": cfg, "区域": "公共区" })
        });
        showToast("success", "✅ 云端出图密钥已保存", "节点图中的云端出图节点已可使用");
    } catch (e) {
        showToast("error", "❌ 保存失败", String(e));
    }
}
