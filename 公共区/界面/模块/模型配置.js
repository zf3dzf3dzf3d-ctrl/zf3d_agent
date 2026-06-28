/**
 * 模型配置 — 模型配置+工具密钥+Tavily配置+系统状态
 * 从 逻辑.js 拆分
 */

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
        // 加载工具密钥
        loadToolKeys();
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

// ============ 工具密钥管理 ============
async function loadToolKeys() {
    try {
        const res = await fetch("/api/tool-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (!d.成功) return;
        const editor = document.getElementById("toolKeyEditor");
        if (!editor) return;
        editor.innerHTML = "";
        for (const t of (d.工具列表 || [])) {
            const card = document.createElement("div");
            card.style.cssText = "padding:8px 12px;border:1px solid var(--border);border-radius:6px;";
            const statusText = t.已配置 ? `✅ 已配置 (${t.掩码值})` : "❌ 未配置";
            card.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-weight:600;font-size:13px;">${t.名称}</span>
                    <span style="font-size:11px;color:${t.已配置 ? 'var(--green)' : 'var(--text2)'};">${statusText}</span>
                </div>
                <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">${t.描述}</div>
                <input type="password" data-tool="${t.名称}" class="dialog-input" placeholder="${t.已配置 ? '输入新密钥覆盖' : '输入API Key'}" style="width:100%;" />
                <button class="dlg-btn primary" onclick="saveToolKey('${t.名称}')" style="margin-top:6px;">💾 保存${t.名称}密钥</button>
            `;
            editor.appendChild(card);
        }
    } catch (e) {}
}

async function saveToolKey(工具名) {
    const input = document.querySelector(`#toolKeyEditor input[data-tool="${工具名}"]`);
    if (!input || !input.value.trim()) {
        showToast("info", "ℹ️ 密钥为空", "请输入API Key");
        return;
    }
    try {
        const res = await fetch("/api/tool-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 工具: 工具名, 密钥: input.value.trim() }) });
        const d = await res.json();
        if (d.成功) {
            showToast("success", "✅ 密钥已保存", d.消息 || "");
            input.value = "";
            loadToolKeys();
        } else {
            showToast("error", "❌ 保存失败", d.错误 || "");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

// ============ Tavily快捷配置（对话面板） ============
async function toggleTavilyBar() {
    const bar = document.getElementById("tavilyBar");
    if (bar.style.display === "none") {
        bar.style.display = "flex";
        await loadTavilyStatus();
    } else {
        bar.style.display = "none";
    }
}

async function loadTavilyStatus() {
    const el = document.getElementById("tavilyStatus");
    const btn = document.getElementById("tavilyBtn");
    if (!el) return;
    el.textContent = "🔍 Tavily: 加载中...";
    el.className = "tavily-status";
    try {
        const res = await fetch("/api/tool-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.成功) {
            const t = (d.工具列表 || []).find(x => x.名称 === "Tavily");
            if (t && t.已配置) {
                el.textContent = `✅ Tavily: ${t.掩码值}`;
                el.className = "tavily-status active";
                btn.style.color = "var(--green)";
            } else {
                el.textContent = "⚠️ Tavily: 未配置（回退Bing）";
                el.className = "tavily-status inactive";
                btn.style.color = "var(--text2)";
            }
        }
    } catch (e) {
        el.textContent = "🔍 Tavily: 连接失败";
    }
}

async function saveTavilyKeyFromBar() {
    const input = document.getElementById("tavilyKeyInput");
    if (!input || !input.value.trim()) {
        showToast("info", "ℹ️ 密钥为空", "请输入Tavily API Key");
        return;
    }
    try {
        const res = await fetch("/api/tool-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 工具: "Tavily", 密钥: input.value.trim() }) });
        const d = await res.json();
        if (d.成功) {
            showToast("success", "✅ Tavily密钥已保存", "搜索已升级为Tavily");
            input.value = "";
            loadTavilyStatus();
        } else {
            showToast("error", "❌ 保存失败", d.错误 || "");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

async function loadSystemStatus() {
    try {
        const res = await fetch("/api/status"); const s = await res.json();
        document.getElementById("statusInfo").textContent = `模式: ${s.对话?.工作模式 || "商量"} | 模型: ${s.当前模型 || "默认"}`;
    } catch (e) {}
}

