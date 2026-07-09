/**
 * 模型配置 — 模型配置+工具密钥+Tavily配置+系统状态
 * 从 逻辑.js 拆分
 */

// ============ 模型注册/充值指南 ============
const _模型购买指南 = {
    "DeepSeek(深度求索)": {
        url: "https://platform.deepseek.com/",
        注册: "手机号一键注册，无需实名",
        充值: "控制台 → 充值 → 支付宝/微信，最低¥10",
        价格: "约¥1/百万Token（极便宜）",
        免费: "注册送¥10体验金",
        推荐: "⭐推荐新手首选，最便宜"
    },
    "通义千问(阿里云)": {
        url: "https://bailian.console.aliyun.com/",
        注册: "支付宝/阿里云账号直接登录",
        充值: "控制台 → 费用 → 充值，最低¥1",
        价格: "约¥4/百万Token",
        免费: "新用户免费Token额度",
        推荐: "支持图片识别，国内速度快"
    },
    "智谱大模型(GLM)": {
        url: "https://open.bigmodel.cn/",
        注册: "手机号注册",
        充值: "财务中心 → 在线充值 → 支付宝/微信",
        价格: "glm-4-flash免费，glm-4约¥0.1/千次",
        免费: "glm-4-flash模型完全免费",
        推荐: "有免费模型可用"
    },
    "Kimi(月之暗面)": {
        url: "https://platform.moonshot.cn/",
        注册: "手机号注册",
        充值: "财务管理 → 充值 → 支付宝",
        价格: "约¥12/百万Token",
        免费: "注册送¥15体验金",
        推荐: "长文本处理强"
    },
    "豆包(火山大模型)": {
        url: "https://www.volcengine.com/product/ark",
        注册: "手机号注册 + 实名认证",
        充值: "费用中心 → 充值 → 支付宝/微信",
        价格: "约¥0.8/百万Token",
        免费: "新用户送¥20体验金",
        推荐: "便宜，同支持Seedream出图"
    },
    "OpenAI(ChatGPT)": {
        url: "https://platform.openai.com/",
        注册: "邮箱注册，需海外手机号验证",
        充值: "Billing → Add payment → 国际信用卡",
        价格: "gpt-4o-mini约$0.15/百万Token",
        免费: "无免费额度",
        推荐: "需科学上网+海外信用卡"
    },
    "Claude(Anthropic)": {
        url: "https://console.anthropic.com/",
        注册: "邮箱注册",
        充值: "Settings → Billing → 信用卡",
        价格: "claude-3.5约$3/百万Token",
        免费: "新用户$5免费额度",
        推荐: "代码能力最强，需科学上网"
    },
    "Gemini(Google)": {
        url: "https://aistudio.google.com/apikey",
        注册: "Google账号登录",
        充值: "无需充值，免费额度内使用",
        价格: "超出免费额度约$0.075/千次",
        免费: "免费$10/天",
        推荐: "免费额度大，需科学上网"
    },
    "OpenRouter(路由器)": {
        url: "https://openrouter.ai/",
        注册: "Google/GitHub账号登录",
        充值: "Credits → Add credits → 信用卡",
        价格: "按模型不同，约$0.2-5/百万Token",
        免费: "部分模型免费",
        推荐: "一个Key用400+模型，需科学上网"
    },
    "硅基流动(国内聚合)": {
        url: "https://siliconflow.cn/",
        注册: "手机号/GitHub注册",
        充值: "控制台 → 充值 → 支付宝/微信",
        价格: "约¥1-4/百万Token",
        免费: "注册送¥14体验金",
        推荐: "⭐国内聚合，一个Key用多个开源模型"
    },
    "AgnesAI(全模态免费)": {
        url: "https://platform.agnes-ai.com/",
        注册: "邮箱注册",
        充值: "免费额度充足，暂无需充值",
        价格: "免费",
        免费: "免费文本+生图+生视频",
        推荐: "全免费，支持生图"
    },
    "本地Qwen3(Ollama)": {
        url: "https://ollama.com/",
        注册: "无需注册，完全本地",
        充值: "无需充值",
        价格: "免费",
        免费: "完全免费，但需要16GB+内存",
        推荐: "零费用零隐私，需好电脑"
    }
};

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
        // 渲染模型列表（国内|国外|本地 三列分区布局）
        const list = document.getElementById("modelList");
        if (!list) return;
        list.innerHTML = "";
        list.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;";
        const 国内模型 = ["DeepSeek(深度求索)", "通义千问(阿里云)", "智谱大模型(GLM)", "Kimi(月之暗面)", "豆包(火山大模型)"];
        const 本地模型 = ["本地Qwen3(Ollama)"];
        const allModels = d.模型列表 || [];
        // 左列：国内，中列：国外，右列：本地+自定义
        const 左列 = allModels.filter(m => 国内模型.includes(m.名称));
        const 右列 = allModels.filter(m => 本地模型.includes(m.名称));
        const 中列 = allModels.filter(m => !国内模型.includes(m.名称) && !本地模型.includes(m.名称));
        const maxRows = Math.max(左列.length, 中列.length, 右列.length);
        for (let i = 0; i < maxRows; i++) {
            // 左列（国内）
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
            // 中列（国外）
            if (i < 中列.length) {
                const m = 中列[i];
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
            // 右列（本地+自定义）
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
    const 默认模型名 = m.默认模型名称 || "";
    let inputs = "";
    for (const [变量名, 环境键] of Object.entries(环境变量)) {
        // 有默认模型名的模型跳过"模型名称"输入框（已在上方提示）
        if (变量名 === "模型名称" && 默认模型名) continue;
        const 已有 = 密钥配置[变量名] || "";
        const placeholder = 已有 ? `已配置: ${已有}` : "未配置";
        inputs += `<div style="margin-top:6px;"><label style="font-size:11px;color:var(--text2);">${变量名}</label><input type="password" data-model="${m.名称}" data-key="${变量名}" class="dialog-input" placeholder="${placeholder}" style="width:100%;margin-top:2px;" /></div>`;
    }
    const 已有模型名 = 密钥配置["模型名称"] || "";
    const 当前模型名显示 = 已有模型名 || 默认模型名;
    // 有默认模型名的只显示提示文字（不可改），无默认的显示输入框
    let 模型名HTML;
    if (默认模型名) {
        模型名HTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:6px;">模型名: <span style="color:var(--blue);">${当前模型名显示}</span></div>`;
    } else {
        模型名HTML = `<div style="margin-top:6px;"><label style="font-size:11px;color:var(--text2);">模型名称</label><input type="text" data-model="${m.名称}" data-key="_模型名称" class="dialog-input" placeholder="如 deepseek-chat" value="${已有模型名}" style="width:100%;margin-top:2px;" /></div>`;
    }
    // 购买指南
    const 指南 = _模型购买指南[m.名称];
    let 指南HTML = "";
    if (指南) {
        指南HTML = `<div style="margin-top:10px;padding:8px;background:var(--bg);border-radius:4px;font-size:11px;line-height:1.7;color:var(--text2);">
            ${指南.推荐 ? `<div style="color:var(--green);font-weight:bold;margin-bottom:4px;">${指南.推荐}</div>` : ""}
            <div>📋 <b>注册：</b><a href="${指南.url}" target="_blank" style="color:var(--blue);">${指南.url}</a></div>
            <div>📝 <b>步骤：</b>${指南.注册}</div>
            <div>💰 <b>充值：</b>${指南.充值}</div>
            <div>💲 <b>价格：</b>${指南.价格}</div>
            ${指南.免费 ? `<div style="color:var(--orange);">🎁 <b>免费：</b>${指南.免费}</div>` : ""}
        </div>`;
    }
    wrap.innerHTML = `${模型名HTML}${inputs}${指南HTML}`;
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

async function loadSystemStatus() {
    try {
        const res = await fetch("/api/status"); const s = await res.json();
        document.getElementById("statusInfo").textContent = `模式: ${s.对话?.工作模式 || "商量"} | 模型: ${s.当前模型 || "默认"}`;
        // 同步版本号到标题
        if (s.版本 && s.版本 !== "未知") {
            document.title = `朱峰社区智能体 v${s.版本}`;
            const titleEl = document.querySelector(".topbar-title");
            if (titleEl) titleEl.innerHTML = titleEl.innerHTML.replace(/朱峰社区智能体( v[\d.]+)?/, `朱峰社区智能体 v${s.版本}`);
        }
    } catch (e) {}
}

