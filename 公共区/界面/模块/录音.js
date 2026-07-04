/**
 * 录音模块 — 点击录音按钮录制音频，停止后自动保存并打开文件夹
 * 右键选择：系统音频 / 麦克风 / 音量调节
 */

let recordState = false;
let recordTimer = null;
let recordDeviceIdx = null;

function getRecordVolume() {
    const v = parseFloat(localStorage.getItem("recordVolume"));
    return isNaN(v) ? 5.0 : v;
}

function initRecordBtn() {
    const btn = document.getElementById("recordBtn");
    if (!btn) return;
    btn.addEventListener("click", toggleRecord);
    btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showRecordDeviceMenu(e);
    });
}

async function toggleRecord() {
    if (recordState) {
        await stopRecord();
    } else {
        await startRecord();
    }
}

async function startRecord() {
    let saveDir = "";
    if (typeof currentRoot !== "undefined" && currentRoot) {
        saveDir = currentRoot;
    }

    try {
        const res = await fetch("/api/record-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "保存目录": saveDir, "设备索引": recordDeviceIdx })
        }).then(r => r.json());

        if (res["成功"]) {
            recordState = true;
            updateRecordBtn();
            showToast("info", "录音", "🔴 录音中... " + (res["设备"] || ""));
            const startTime = Date.now();
            recordTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
                const sec = String(elapsed % 60).padStart(2, "0");
                const btn = document.getElementById("recordBtn");
                if (btn) {
                    btn.title = `🔴 录音中 ${min}:${sec} (点击停止)`;
                }
            }, 500);
        } else {
            showToast("error", "录音失败", res["错误"] || "录音启动失败");
        }
    } catch (e) {
        showToast("error", "录音请求失败", e.message);
    }
}

async function stopRecord() {
    if (recordTimer) {
        clearInterval(recordTimer);
        recordTimer = null;
    }

    try {
        const res = await fetch("/api/record-stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "音量倍数": getRecordVolume() })
        }).then(r => r.json());

        recordState = false;
        updateRecordBtn();

        if (res["成功"]) {
            if (res["静音"]) {
                showToast("warning", "录音完成（静音）", res["消息"]);
            } else {
                showToast("success", "录音完成", res["消息"] + "，已打开保存文件夹");
            }
            if (typeof refreshTree === "function") {
                refreshTree();
            }
        } else {
            showToast("error", "录音停止失败", res["错误"] || "未知错误");
        }
    } catch (e) {
        recordState = false;
        updateRecordBtn();
        showToast("error", "停止录音失败", e.message);
    }
}

function updateRecordBtn() {
    const btn = document.getElementById("recordBtn");
    if (!btn) return;
    if (recordState) {
        btn.classList.add("recording");
        btn.textContent = "⏹";
        btn.title = "录音中... 点击停止";
    } else {
        btn.classList.remove("recording");
        const mode = localStorage.getItem("recordMode") || "system";
        btn.textContent = mode === "mic" ? "🎤" : "🔴";
        btn.title = mode === "mic" ? "录制麦克风（右键切换/音量）" : "录制系统音频（右键切换/音量）";
    }
}

async function showRecordDeviceMenu(event) {
    let devices = [];
    let engine = "soundcard";
    try {
        const res = await fetch("/api/record-devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        }).then(r => r.json());
        if (res["成功"]) {
            devices = res["设备列表"] || [];
            engine = res["引擎"] || engine;
        } else {
            showToast("error", "获取设备失败", res["错误"] || "未知错误");
            return;
        }
    } catch (e) {
        showToast("error", "获取设备失败", e.message);
        return;
    }

    if (devices.length === 0) {
        showToast("warning", "无录音设备", "未检测到任何音频输入设备");
        return;
    }

    const loopbackDevs = devices.filter(d => d["引擎"] === "loopback");
    const micDevs = devices.filter(d => d["引擎"] === "mic" || d["引擎"] === "sounddevice");
    const sdLoopback = [];
    const sdMic = [];
    for (const d of devices) {
        if (d["引擎"] === "sounddevice") {
            const name = (d["名称"] || "").toLowerCase();
            if (name.includes("stereo") || name.includes("mix") || name.includes("混音") || name.includes("立体声")) {
                sdLoopback.push(d);
            } else {
                sdMic.push(d);
            }
        }
    }

    const allLoopback = [...loopbackDevs, ...sdLoopback];
    const allMic = [...micDevs, ...sdMic];
    const currentMode = localStorage.getItem("recordMode") || "system";

    let existing = document.getElementById("recordDeviceMenu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "recordDeviceMenu";
    menu.style.cssText = `position:fixed;z-index:99999;background:#1a1a2e;border:1px solid #444466;
        border-radius:10px;padding:0;min-width:200px;
        box-shadow:0 4px 20px rgba(0,0,0,0.5);font-size:14px;display:flex;flex-direction:column;overflow:hidden;`;

    // 标题栏（可拖拽）
    const titleBar = document.createElement("div");
    titleBar.style.cssText = `display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;cursor:move;user-select:none;border-bottom:1px solid #333;flex-shrink:0;`;
    const titleText = document.createElement("span");
    titleText.textContent = "🎙️ 录音设置";
    titleText.style.cssText = "color:#aaaacc;font-weight:bold;font-size:13px;";
    titleBar.appendChild(titleText);
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "color:#666;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;";
    closeBtn.onmouseover = () => closeBtn.style.color = "#fff";
    closeBtn.onmouseout = () => closeBtn.style.color = "#666";
    closeBtn.onclick = () => menu.remove();
    titleBar.appendChild(closeBtn);
    menu.appendChild(titleBar);

    // 拖拽逻辑
    let dragStart = null, menuStart = null;
    titleBar.addEventListener("mousedown", (e) => {
        if (e.target === closeBtn) return;
        dragStart = { x: e.clientX, y: e.clientY };
        menuStart = { x: parseInt(menu.style.left) || 0, y: parseInt(menu.style.top) || 0 };
    });
    document.addEventListener("mousemove", (e) => {
        if (!dragStart) return;
        menu.style.left = (menuStart.x + e.clientX - dragStart.x) + "px";
        menu.style.top = (menuStart.y + e.clientY - dragStart.y) + "px";
    });
    document.addEventListener("mouseup", () => { dragStart = null; });

    // 内容容器
    const menuContent = document.createElement("div");
    menuContent.style.cssText = "padding:6px;overflow-y:auto;flex:1;";

    // 系统音频
    if (allLoopback.length > 0) {
        const item = document.createElement("div");
        const isCurrent = currentMode === "system";
        item.innerHTML = (isCurrent ? "✅ " : "") + "🔊 系统音频";
        if (allLoopback.length > 1) {
            item.innerHTML += ` <span style="color:#666;font-size:11px;">(${allLoopback.length}个设备)</span>`;
        }
        item.style.cssText = `padding:10px 14px;cursor:pointer;border-radius:6px;color:#ccc;margin-bottom:2px;`;
        item.onmouseover = () => item.style.background = "#3a3a52";
        item.onmouseout = () => item.style.background = "";
        item.onclick = () => {
            recordDeviceIdx = allLoopback[0]["索引"];
            localStorage.setItem("recordMode", "system");
            localStorage.setItem("recordDeviceIdx", String(recordDeviceIdx));
            showToast("info", "录音设备", "已切换为系统音频");
            updateRecordBtn();
            menu.remove();
        };
        menuContent.appendChild(item);
    }

    // 麦克风
    if (allMic.length > 0) {
        const item = document.createElement("div");
        const isCurrent = currentMode === "mic";
        item.innerHTML = (isCurrent ? "✅ " : "") + "🎤 麦克风";
        if (allMic.length > 1) {
            item.innerHTML += ` <span style="color:#666;font-size:11px;">(${allMic.length}个设备)</span>`;
        }
        item.style.cssText = `padding:10px 14px;cursor:pointer;border-radius:6px;color:#ccc;margin-bottom:2px;`;
        item.onmouseover = () => item.style.background = "#3a3a52";
        item.onmouseout = () => item.style.background = "";
        item.onclick = () => {
            recordDeviceIdx = allMic[0]["索引"];
            localStorage.setItem("recordMode", "mic");
            localStorage.setItem("recordDeviceIdx", String(recordDeviceIdx));
            showToast("info", "录音设备", "已切换为麦克风");
            updateRecordBtn();
            menu.remove();
        };
        menuContent.appendChild(item);
    }

    // 分隔线
    const sep1 = document.createElement("div");
    sep1.style.cssText = "border-top:1px solid #333;margin:4px 0;";
    menuContent.appendChild(sep1);

    // 音量调节
    const volRow = document.createElement("div");
    volRow.style.cssText = "padding:8px 14px;border-radius:6px;color:#ccc;";

    const volLabel = document.createElement("div");
    volLabel.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;";
    const volTitle = document.createElement("span");
    volTitle.textContent = "🔊 音量放大";
    volTitle.style.cssText = "font-size:13px;";
    const volValue = document.createElement("span");
    volValue.textContent = Math.round(getRecordVolume()) + "x";
    volValue.style.cssText = "color:#4a9eff;font-size:13px;font-weight:bold;";
    volLabel.appendChild(volTitle);
    volLabel.appendChild(volValue);
    volRow.appendChild(volLabel);

    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.min = "1";
    volSlider.max = "100";
    volSlider.step = "1";
    volSlider.value = String(getRecordVolume());
    volSlider.style.cssText = "width:100%;accent-color:#4a9eff;cursor:pointer;";
    volSlider.oninput = () => {
        const v = parseFloat(volSlider.value);
        volValue.textContent = Math.round(v) + "x";
        localStorage.setItem("recordVolume", String(v));
    };
    volRow.appendChild(volSlider);

    const volHint = document.createElement("div");
    volHint.textContent = "录音结束后自动放大+正规化音量";
    volHint.style.cssText = "color:#666;font-size:11px;margin-top:4px;";
    volRow.appendChild(volHint);

    menuContent.appendChild(volRow);

    // 多设备展开
    const multiDevs = allLoopback.length + allMic.length;
    if (multiDevs > 2) {
        const sep2 = document.createElement("div");
        sep2.style.cssText = "border-top:1px solid #333;margin:4px 0;";
        menuContent.appendChild(sep2);

        const more = document.createElement("div");
        more.textContent = "📋 查看所有设备";
        more.style.cssText = "padding:6px 14px;cursor:pointer;border-radius:6px;color:#666;font-size:12px;";
        more.onmouseover = () => more.style.background = "#3a3a52";
        more.onmouseout = () => more.style.background = "";
        more.onclick = () => {
            menu.querySelectorAll("div").forEach(d => d.style.display = "none");
            const backBtn = document.createElement("div");
            backBtn.textContent = "◀ 返回";
            backBtn.style.cssText = "padding:6px 14px;cursor:pointer;border-radius:6px;color:#666;font-size:12px;";
            backBtn.onclick = () => { menu.remove(); showRecordDeviceMenu(event); };
            menuContent.appendChild(backBtn);
            for (const dev of devices) {
                const di = document.createElement("div");
                const isSelected = recordDeviceIdx === dev["索引"];
                di.textContent = (isSelected ? "✅ " : "") + dev["名称"];
                di.style.cssText = "padding:6px 14px;cursor:pointer;border-radius:6px;color:#ccc;font-size:12px;";
                di.onmouseover = () => di.style.background = "#3a3a52";
                di.onmouseout = () => di.style.background = "";
                di.onclick = () => {
                    recordDeviceIdx = dev["索引"];
                    localStorage.setItem("recordDeviceIdx", String(dev["索引"]));
                    localStorage.setItem("recordMode", dev["引擎"] === "loopback" ? "system" : "mic");
                    showToast("info", "录音设备", "已选择: " + dev["名称"]);
                    updateRecordBtn();
                    menu.remove();
                };
                menuContent.appendChild(di);
            }
        };
        menuContent.appendChild(more);
    }

    menu.appendChild(menuContent);
    document.body.appendChild(menu);

    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 220);
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    setTimeout(() => {
        const closeHandler = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener("click", closeHandler);
            }
        };
        document.addEventListener("click", closeHandler);
    }, 100);
}

window.addEventListener("beforeunload", () => {
    if (recordState) {
        navigator.sendBeacon("/api/record-stop", JSON.stringify({}));
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("recordDeviceIdx");
    if (saved && saved !== "") {
        recordDeviceIdx = parseInt(saved);
        if (isNaN(recordDeviceIdx)) recordDeviceIdx = null;
    }
    initRecordBtn();
});
