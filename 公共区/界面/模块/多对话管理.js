/**
 * 多对话管理 — 对话列表/新建/切换/删除/加载消息
 * 从 逻辑.js 拆分
 */

// ============ 多对话管理 ============
let currentConvID = null;
let convListOpen = false;

// 对话API指向神经元实验8770端口
const NEURON_API = "http://localhost:8770";

async function loadConvList() {
    try {
        const res = await fetch(NEURON_API + "/api/conversations");
        const d = await res.json();
        const list = d.对话列表 || [];
        currentConvID = d.当前ID;
        const container = document.getElementById("convListItems");
        if (!container) return;
        container.innerHTML = "";
        if (list.length === 0) {
            container.innerHTML = '<div style="padding:8px 10px;color:var(--text2);font-size:11px;text-align:center">暂无对话</div>';
            return d;
        }
        for (const c of list) {
            const el = document.createElement("div");
            el.className = `conv-item${c.id === currentConvID ? " active" : ""}`;
            const time = c.更新时间 ? c.更新时间.substring(5, 16).replace("T", " ") : "";
            el.innerHTML = `<span class="conv-title" title="${c.标题}">${c.标题}</span><span style="color:var(--text2);font-size:10px">${time}</span><span class="conv-del" onclick="event.stopPropagation();deleteConv('${c.id}')" title="删除此对话">✕</span>`;
            el.addEventListener("click", () => switchConv(c.id));
            container.appendChild(el);
        }
        return d;
    } catch (e) {}
    return null;
}

function toggleConvList() {
    convListOpen = !convListOpen;
    document.getElementById("convList").style.display = convListOpen ? "block" : "none";
    if (convListOpen) loadConvList();
}

// 点击对话列表外的空白处自动收回
document.addEventListener("click", (e) => {
    if (!convListOpen) return;
    const convList = document.getElementById("convList");
    const toggleBtn = document.querySelector('.bar-btn[onclick="toggleConvList()"]');
    if (convList && !convList.contains(e.target) && !(toggleBtn && toggleBtn.contains(e.target))) {
        convListOpen = false;
        convList.style.display = "none";
    }
});

async function newConversation() {
    // 先停止当前对话（SSE流+后端取消），防止旧线程持锁导致新对话卡死
    if (isChatting) stopChat();
    isChatting = false;
    setThinkingState(false);
    try {
        const res = await fetch(NEURON_API + "/api/conversation-new", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.成功) {
            document.getElementById("msgList").innerHTML = "";
            currentConvID = d.对话?.id;
            // 只刷新对话列表，不自动展开
            if (convListOpen) loadConvList();
            showToast("success", "✅ 新建对话", `对话 ${d.对话?.标题 || "新对话"} 已创建`);
        } else {
            showToast("error", "❌ 新建失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

async function switchConv(id) {
    if (id === currentConvID) return;
    // 先停止当前对话（SSE流+后端取消），防止旧线程持锁导致切换后卡死
    if (isChatting) stopChat();
    isChatting = false;
    setThinkingState(false);
    try {
        const res = await fetch(NEURON_API + "/api/conversation-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        const d = await res.json();
        if (d.成功) {
            currentConvID = id;
            document.getElementById("msgList").innerHTML = "";
            loadConvList();
            // 加载并渲染该对话的历史消息
            loadConvMessages();
        } else {
            showToast("error", "❌ 切换失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

async function deleteConv(id) {
    if (!confirm("确定删除此对话？")) return;
    try {
        const res = await fetch(NEURON_API + "/api/conversation-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        const d = await res.json();
        if (d.成功) {
            document.getElementById("msgList").innerHTML = "";
            currentConvID = null;
            loadConvList();
            showToast("success", "🗑️ 已删除", "对话已删除");
        } else {
            showToast("error", "❌ 删除失败", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

// 加载当前对话的历史消息到界面
async function loadConvMessages() {
    try {
        const res = await fetch(NEURON_API + "/api/conversation-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: currentConvID }) });
        const d = await res.json();
        if (d.成功 && d.历史) {
            const list = document.getElementById("msgList");
            list.innerHTML = "";
            for (const msg of d.历史) {
                addMsg(msg.角色 || "assistant", msg.内容 || "", msg.时间 || "");
            }
            // 检查是否有未完成的检查点（可续跑）
            checkCheckpoint();
        }
    } catch (e) {}
}

async function checkCheckpoint() {
    try {
        const res = await fetch(NEURON_API + "/api/checkpoint-info");
        const d = await res.json();
        if (d.有检查点) {
            const list = document.getElementById("msgList");
            const bar = document.createElement("div");
            bar.className = "resume-bar";
            bar.innerHTML = '<span>⏸️ 上次任务未完成</span><button class="dlg-btn primary" onclick="resumeCheckpoint()">▶️ 继续执行</button><button class="dlg-btn" onclick="dismissCheckpoint()">✕ 忽略</button>';
            list.appendChild(bar);
            list.scrollTop = list.scrollHeight;
        }
    } catch (e) {}
}

async function resumeCheckpoint() {
    try {
        document.querySelectorAll(".resume-bar").forEach(el => el.remove());
        showToast("success", "🔄 续跑中", "从上次中断处继续执行");
        const res = await fetch(NEURON_API + "/api/resume-checkpoint", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.成功 && d.结果) {
            addMsg("assistant", d.结果.回复 || "续跑完成");
        } else {
            showToast("error", "❌ 续跑失败", d.错误 || d.结果?.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

function dismissCheckpoint() {
    document.querySelectorAll(".resume-bar").forEach(el => el.remove());
    fetch(NEURON_API + "/api/clear-checkpoint", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

