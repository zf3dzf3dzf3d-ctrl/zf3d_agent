/**
 * 权限轮询 — 智能轮询+AI询问用户弹窗
 * 仅在AI执行任务期间轮询，空闲时停止
 */

// ============ 权限轮询 ============
let _shownPermPaths = new Set();
let _permPollTimer = null;
let _permActive = false;  // 是否在任务执行中

function startPermPoll() {
    if (_permPollTimer) return;
    _permActive = true;
    pollPending();
}

function stopPermPoll() {
    _permActive = false;
    if (_permPollTimer) { clearTimeout(_permPollTimer); _permPollTimer = null; }
}

async function pollPending() {
    _permPollTimer = null;
    if (!_permActive) return;
    try {
        const res = await fetch("/api/pending");
        const d = await res.json();
        if (d.待确认 && d.待确认.length > 0) {
            for (const req of d.待确认) {
                if (!_shownPermPaths.has(req.路径)) {
                    _shownPermPaths.add(req.路径);
                    showPermissionDialog(req);
                }
            }
        }
    } catch (e) {}
    // 仅在活跃状态下继续轮询，5秒间隔
    if (_permActive) {
        _permPollTimer = setTimeout(pollPending, 5000);
    }
}

function showPermissionDialog(req) {
    const overlay = document.getElementById("permissionOverlay");
    document.getElementById("permPath").textContent = req.路径 || "";
    const actionMap = {"读":"读取","写":"写入","创建":"创建","删除":"删除"};
    document.getElementById("permAction").textContent = actionMap[req.操作] || req.操作 || "操作";
    overlay.style.display = "flex";
}

async function respondPermission(choice) {
    const overlay = document.getElementById("permissionOverlay");
    const path = document.getElementById("permPath").textContent;
    const actionRaw = document.getElementById("permAction").textContent;
    const actionMap = {"读取":"读","写入":"写","创建":"创建","删除":"删除"};
    const action = actionMap[actionRaw] || actionRaw;
    overlay.style.display = "none";
    _shownPermPaths.delete(path);
    try {
        await fetch("/api/permission", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({路径: path, 操作: action, 选择: choice})
        });
        const labels = {"允许一次":"单次授权","永久允许":"永久授权此文件","永久授权文件夹":"已授权整个文件夹","拒绝":"已拒绝"};
        showToast("success", "🔐 " + (labels[choice]||choice), path);
    } catch (e) {
        showToast("error", "❌ 授权响应失败", e.message);
    }
}

// ============ AI询问用户弹窗 ============
let _askUserId = null;

function showAskUserDialog(id, 问题列表) {
    _askUserId = id;
    const body = document.getElementById("askUserBody");
    body.innerHTML = "";

    问题列表.forEach((q, i) => {
        const item = document.createElement("div");
        item.className = "ask-item";

        const label = document.createElement("div");
        label.className = "ask-label";
        label.textContent = `${i + 1}. ${q.问题}`;
        item.appendChild(label);

        const 类型 = q.类型 || "text";

        if (类型 === "choice") {
            const opts = document.createElement("div");
            opts.className = "ask-options";
            const 多选 = q.多选;
            (q.选项 || []).forEach((opt, j) => {
                const row = document.createElement("label");
                row.className = "ask-option";
                const input = document.createElement("input");
                input.type = 多选 ? "checkbox" : "radio";
                input.name = `ask_${i}`;
                input.value = opt.label;
                if (多选) input.dataset.askMulti = "1";
                row.appendChild(input);
                const txt = document.createElement("span");
                txt.textContent = opt.label;
                row.appendChild(txt);
                if (opt.description) {
                    const desc = document.createElement("div");
                    desc.className = "ask-option-desc";
                    desc.textContent = opt.description;
                    row.appendChild(desc);
                }
                opts.appendChild(row);
            });
            item.appendChild(opts);
        } else if (类型 === "yesno") {
            const opts = document.createElement("div");
            opts.className = "ask-options";
            ["是", "否"].forEach(v => {
                const row = document.createElement("label");
                row.className = "ask-option";
                const input = document.createElement("input");
                input.type = "radio";
                input.name = `ask_${i}`;
                input.value = v === "是" ? "yes" : "no";
                row.appendChild(input);
                const txt = document.createElement("span");
                txt.textContent = v;
                row.appendChild(txt);
                opts.appendChild(row);
            });
            item.appendChild(opts);
        } else {
            const input = document.createElement("input");
            input.type = "text";
            input.className = "ask-input";
            input.name = `ask_${i}`;
            input.placeholder = q.占位符 || "请输入...";
            if (q.默认值) input.value = q.默认值;
            item.appendChild(input);
        }

        body.appendChild(item);
    });

    document.getElementById("askUserOverlay").style.display = "flex";
}

async function submitAskUser() {
    const overlay = document.getElementById("askUserOverlay");
    const body = document.getElementById("askUserBody");
    const items = body.querySelectorAll(".ask-item");
    const 回答 = {};

    items.forEach((item, i) => {
        const idx = i + 1;
        const radios = item.querySelectorAll(`input[name="ask_${i}"]`);
        const checked = Array.from(radios).filter(r => r.checked);

        if (checked.length > 0) {
            if (checked[0].dataset.askMulti) {
                回答[`问题${idx}`] = checked.map(c => c.value).join(", ");
            } else {
                回答[`问题${idx}`] = checked[0].value;
            }
        } else {
            // text类型
            const textInput = item.querySelector("input[type='text']");
            回答[`问题${idx}`] = textInput ? textInput.value : "";
        }
    });

    overlay.style.display = "none";
    const id = _askUserId;
    _askUserId = null;

    try {
        await fetch("/api/ask-user-response", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, 回答 })
        });
    } catch (e) {
        showToast("error", "❌ 提交回答失败", e.message);
    }
}

async function cancelAskUser() {
    const overlay = document.getElementById("askUserOverlay");
    overlay.style.display = "none";
    const id = _askUserId;
    _askUserId = null;

    try {
        await fetch("/api/ask-user-response", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, 回答: {} })
        });
    } catch (e) {}
}

