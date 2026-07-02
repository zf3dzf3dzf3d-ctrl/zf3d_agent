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
