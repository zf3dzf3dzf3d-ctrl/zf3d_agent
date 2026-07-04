/**
 * 录屏模块 — 点击🎥按钮弹出配置面板
 * 支持区域选择(拖拽/手动输入)、帧率、音频模式、音量放大
 */

let screenRecordState = false;
let screenRecordTimer = null;
let screenRecordDevices = [];

// 前端日志发送到后端SQLite
function srLog(msg) {
    console.log("[录屏] " + msg);
    try {
        fetch("/api/screenrecord-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "消息": msg })
        }).catch(() => {});
    } catch (e) {}
}

function getSRMicVol() {
    const v = parseFloat(localStorage.getItem("srMicVol"));
    return isNaN(v) ? 80.0 : v;
}

function getSRSysVol() {
    const v = parseFloat(localStorage.getItem("srSysVol"));
    return isNaN(v) ? 80.0 : v;
}

function initScreenRecordBtn() {
    const btn = document.getElementById("screenRecordBtn");
    if (!btn) return;
    btn.addEventListener("click", toggleScreenRecord);
    btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showScreenRecordPanel(e);
    });
}

async function toggleScreenRecord() {
    if (screenRecordState) {
        await stopScreenRecord();
    } else {
        // 用上次保存的面板位置，没有则用按钮位置
        const savedPX = parseInt(localStorage.getItem("srPanelX"));
        const savedPY = parseInt(localStorage.getItem("srPanelY"));
        if (!isNaN(savedPX) && !isNaN(savedPY)) {
            showScreenRecordPanel({ clientX: savedPX, clientY: savedPY });
        } else {
            const btn = document.getElementById("screenRecordBtn");
            const rect = btn ? btn.getBoundingClientRect() : { left: 100, bottom: 100 };
            showScreenRecordPanel({ clientX: rect.left, clientY: rect.bottom + 5 });
        }
    }
}

async function showScreenRecordPanel(event) {
    try {
        const res = await fetch("/api/screenrecord-devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        }).then(r => r.json());
        if (res["成功"]) {
            screenRecordDevices = res["设备列表"] || [];
        }
    } catch (e) {
        showToast("error", "获取设备失败", e.message);
        return;
    }

    const savedFps = localStorage.getItem("srFps") || "30";
    const savedAudio = localStorage.getItem("srAudio") || "mic";
    const savedDev = localStorage.getItem("srDevice") || "";
    const savedX = localStorage.getItem("srX") || "0";
    const savedY = localStorage.getItem("srY") || "0";
    const savedW = localStorage.getItem("srW") || "0";
    const savedH = localStorage.getItem("srH") || "0";

    let existing = document.getElementById("screenRecordPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "screenRecordPanel";
    panel.style.cssText = `position:fixed;z-index:99999;background:#1a1a2e;border:1px solid #444466;
        border-radius:10px;padding:0;min-width:280px;
        box-shadow:0 4px 20px rgba(0,0,0,0.5);font-size:13px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;`;

    // 标题栏（可拖拽）
    const titleBar = document.createElement("div");
    titleBar.style.cssText = `display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;cursor:move;user-select:none;border-bottom:1px solid #333;flex-shrink:0;`;
    const titleText = document.createElement("span");
    titleText.textContent = "🎬 屏幕录制设置";
    titleText.style.cssText = "color:#aaaacc;font-weight:bold;";
    titleBar.appendChild(titleText);
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "color:#666;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;";
    closeBtn.onmouseover = () => closeBtn.style.color = "#fff";
    closeBtn.onmouseout = () => closeBtn.style.color = "#666";
    closeBtn.onclick = () => panel.remove();
    titleBar.appendChild(closeBtn);
    panel.appendChild(titleBar);

    // 拖拽逻辑
    let dragStart = null;
    let panelStart = null;
    titleBar.addEventListener("mousedown", (e) => {
        if (e.target === closeBtn) return;
        dragStart = { x: e.clientX, y: e.clientY };
        panelStart = { x: parseInt(panel.style.left) || 0, y: parseInt(panel.style.top) || 0 };
    });
    document.addEventListener("mousemove", (e) => {
        if (!dragStart) return;
        panel.style.left = (panelStart.x + e.clientX - dragStart.x) + "px";
        panel.style.top = (panelStart.y + e.clientY - dragStart.y) + "px";
    });
    document.addEventListener("mouseup", () => {
        if (dragStart) {
            localStorage.setItem("srPanelX", parseInt(panel.style.left) || 0);
            localStorage.setItem("srPanelY", parseInt(panel.style.top) || 0);
        }
        dragStart = null;
    });

    // 内容容器
    const content = document.createElement("div");
    content.style.cssText = "padding:12px;overflow-y:auto;flex:1;";

    // === 录制区域 ===
    const areaSection = document.createElement("div");
    areaSection.style.cssText = "margin-bottom:10px;";
    const areaLabel = document.createElement("div");
    areaLabel.textContent = "录制区域";
    areaLabel.style.cssText = "color:#888;margin-bottom:4px;";
    areaSection.appendChild(areaLabel);

    // 按钮行：全屏 / 拖拽选择
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;margin-bottom:6px;";
    const fullBtn = document.createElement("button");
    fullBtn.textContent = "🖥️ 全屏";
    fullBtn.style.cssText = "flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1c1c28;color:#ccc;cursor:pointer;font-size:12px;";
    fullBtn.id = "srFullBtn";
    fullBtn.onclick = () => {
        document.getElementById("srInputX").value = "0";
        document.getElementById("srInputY").value = "0";
        document.getElementById("srInputW").value = "0";
        document.getElementById("srInputH").value = "0";
        updateAreaBtns("full");
    };
    const dragBtn = document.createElement("button");
    dragBtn.textContent = "📐 拖拽选择";
    dragBtn.style.cssText = "flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1c1c28;color:#ccc;cursor:pointer;font-size:12px;";
    dragBtn.onclick = async () => {
        showToast("info", "区域选择", "请在屏幕上拖拽选择录制区域...");
        try {
            const res = await fetch("/api/screenrecord-select-area", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            }).then(r => r.json());
            if (res["成功"] && res["区域"]) {
                const a = res["区域"];
                document.getElementById("srInputX").value = a.x;
                document.getElementById("srInputY").value = a.y;
                document.getElementById("srInputW").value = a.w;
                document.getElementById("srInputH").value = a.h;
                updateAreaBtns("custom");
                showToast("info", "区域已选", `${a.w}×${a.h}`);
            }
        } catch (e) {
            showToast("error", "区域选择失败", e.message);
        }
    };
    btnRow.appendChild(fullBtn);
    btnRow.appendChild(dragBtn);
    areaSection.appendChild(btnRow);

    // 手动输入行: X Y W H
    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;gap:4px;align-items:center;";
    inputRow.innerHTML = `<span style="color:#666;font-size:11px;">手动:</span>`;
    const fields = [
        { id: "srInputX", label: "X", val: savedX, w: "40px" },
        { id: "srInputY", label: "Y", val: savedY, w: "40px" },
        { id: "srInputW", label: "W", val: savedW, w: "50px" },
        { id: "srInputH", label: "H", val: savedH, w: "50px" }
    ];
    for (const f of fields) {
        const wrap = document.createElement("span");
        wrap.style.cssText = "display:flex;align-items:center;gap:2px;";
        const lab = document.createElement("span");
        lab.textContent = f.label;
        lab.style.cssText = "color:#666;font-size:11px;";
        const inp = document.createElement("input");
        inp.type = "number";
        inp.id = f.id;
        inp.value = f.val;
        inp.style.cssText = `width:${f.w};padding:3px;border-radius:4px;background:#1c1c28;border:1px solid #333;color:#ccc;font-size:11px;text-align:center;`;
        inp.oninput = () => updateAreaBtns("custom");
        wrap.appendChild(lab);
        wrap.appendChild(inp);
        inputRow.appendChild(wrap);
    }
    areaSection.appendChild(inputRow);
    content.appendChild(areaSection);

    // === 帧率 ===
    const fpsRow = document.createElement("div");
    fpsRow.style.cssText = "margin-bottom:10px;";
    const fpsLabel = document.createElement("div");
    fpsLabel.textContent = "帧率 (FPS)";
    fpsLabel.style.cssText = "color:#888;margin-bottom:4px;";
    fpsRow.appendChild(fpsLabel);
    const fpsSelect = document.createElement("select");
    fpsSelect.style.cssText = "width:100%;padding:5px;border-radius:6px;background:#1c1c28;border:1px solid #333;color:#ccc;font-size:12px;";
    for (const f of [15, 24, 30, 60]) {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f + " fps";
        if (String(f) === savedFps) opt.selected = true;
        fpsSelect.appendChild(opt);
    }
    fpsRow.appendChild(fpsSelect);
    content.appendChild(fpsRow);

    // === 音频模式 ===
    const audioRow = document.createElement("div");
    audioRow.style.cssText = "margin-bottom:10px;";
    const audioLabel = document.createElement("div");
    audioLabel.textContent = "音频来源";
    audioLabel.style.cssText = "color:#888;margin-bottom:4px;";
    audioRow.appendChild(audioLabel);
    const audioSelect = document.createElement("select");
    audioSelect.style.cssText = "width:100%;padding:5px;border-radius:6px;background:#1c1c28;border:1px solid #333;color:#ccc;font-size:12px;";
    const audioOptions = [
        { value: "mic", label: "🎤 麦克风" },
        { value: "system", label: "🔊 系统声音" },
        { value: "both", label: "🎤🔊 麦克风+系统" },
        { value: "none", label: "🔇 无音频" }
    ];
    for (const opt of audioOptions) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === savedAudio) o.selected = true;
        audioSelect.appendChild(o);
    }
    audioRow.appendChild(audioSelect);

    if (screenRecordDevices.length > 0) {
        const devSelect = document.createElement("select");
        devSelect.style.cssText = "width:100%;padding:5px;border-radius:6px;background:#1c1c28;border:1px solid #333;color:#ccc;font-size:12px;margin-top:4px;";
        for (const dev of screenRecordDevices) {
            const o = document.createElement("option");
            o.value = dev["名称"];
            o.textContent = "🎤 " + dev["名称"];
            if (dev["名称"] === savedDev) o.selected = true;
            devSelect.appendChild(o);
        }
        devSelect.id = "srDeviceSelect";
        audioRow.appendChild(devSelect);
    }
    content.appendChild(audioRow);

    // === 音量控制（双滑块+各自开关） ===
    const volRow = document.createElement("div");
    volRow.style.cssText = "padding:8px 0;border-top:1px solid #333;margin-bottom:10px;";

    // 创建单个音量滑块行
    const makeVolSlider = (title, icon, getValue, saveKey) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-bottom:8px;";

        const labelRow = document.createElement("div");
        labelRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;";

        const leftWrap = document.createElement("div");
        leftWrap.style.cssText = "display:flex;align-items:center;gap:6px;";

        // 开关
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = localStorage.getItem(saveKey + "On") !== "0";
        toggle.style.cssText = "accent-color:#4a9eff;cursor:pointer;";
        leftWrap.appendChild(toggle);

        const label = document.createElement("span");
        label.textContent = icon + " " + title;
        label.style.cssText = "color:#888;font-size:12px;";
        leftWrap.appendChild(label);

        labelRow.appendChild(leftWrap);

        const valSpan = document.createElement("span");
        valSpan.textContent = Math.round(getValue()) + "x";
        valSpan.style.cssText = "color:#4a9eff;font-size:12px;font-weight:bold;";
        labelRow.appendChild(valSpan);
        wrap.appendChild(labelRow);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "1";
        slider.value = String(getValue());
        slider.style.cssText = "width:100%;accent-color:#4a9eff;cursor:pointer;";
        slider.oninput = () => {
            const v = parseFloat(slider.value);
            valSpan.textContent = Math.round(v) + "x";
            localStorage.setItem(saveKey, String(v));
        };

        toggle.onchange = () => {
            localStorage.setItem(saveKey + "On", toggle.checked ? "1" : "0");
        };
        wrap.appendChild(slider);

        wrap._slider = slider;
        wrap._toggle = toggle;
        wrap._getValue = () => parseFloat(slider.value);
        wrap._isOn = () => toggle.checked;
        return wrap;
    };

    const micVolWrap = makeVolSlider("麦克风音量", "🎤", getSRMicVol, "srMicVol");
    volRow.appendChild(micVolWrap);

    const sysVolWrap = makeVolSlider("系统音量", "🔊", getSRSysVol, "srSysVol");
    volRow.appendChild(sysVolWrap);

    const volHint = document.createElement("div");
    volHint.textContent = "录屏结束后各自独立放大，关闭开关=静音该源";
    volHint.style.cssText = "color:#555;font-size:11px;margin-top:3px;";
    volRow.appendChild(volHint);
    content.appendChild(volRow);

    // === 点击效果 ===
    const fxRow = document.createElement("div");
    fxRow.style.cssText = "padding:8px 0;border-top:1px solid #333;margin-bottom:10px;";

    const circleLabel = document.createElement("label");
    circleLabel.style.cssText = "display:flex;align-items:center;gap:6px;color:#888;font-size:12px;cursor:pointer;margin-bottom:6px;";
    const circleCb = document.createElement("input");
    circleCb.type = "checkbox";
    circleCb.checked = localStorage.getItem("srClickCircle") === "1";
    circleCb.style.cssText = "accent-color:#4a9eff;";
    circleCb.onchange = () => localStorage.setItem("srClickCircle", circleCb.checked ? "1" : "0");
    circleLabel.appendChild(circleCb);
    circleLabel.appendChild(document.createTextNode("⭕ 鼠标点击涟漪动画"));
    fxRow.appendChild(circleLabel);

    const soundLabel = document.createElement("label");
    soundLabel.style.cssText = "display:flex;align-items:center;gap:6px;color:#888;font-size:12px;cursor:pointer;margin-bottom:6px;";
    const soundCb = document.createElement("input");
    soundCb.type = "checkbox";
    soundCb.checked = localStorage.getItem("srClickSound") === "1";
    soundCb.style.cssText = "accent-color:#4a9eff;";
    soundCb.onchange = () => {
        localStorage.setItem("srClickSound", soundCb.checked ? "1" : "0");
        sndVolRow.style.display = soundCb.checked ? "block" : "none";
    };
    soundLabel.appendChild(soundCb);
    soundLabel.appendChild(document.createTextNode("🔊 鼠标点击音效"));
    fxRow.appendChild(soundLabel);

    const sndVolRow = document.createElement("div");
    sndVolRow.style.cssText = `display:${soundCb.checked ? "block" : "none"};margin-left:22px;margin-bottom:4px;`;
    const sndVolLabel = document.createElement("div");
    sndVolLabel.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;";
    const sndVolTitle = document.createElement("span");
    sndVolTitle.textContent = "音效音量";
    sndVolTitle.style.cssText = "color:#666;font-size:11px;";
    const sndVolValue = document.createElement("span");
    const savedSndVol = parseInt(localStorage.getItem("srSndVol")) || 30;
    sndVolValue.textContent = savedSndVol + "%";
    sndVolValue.style.cssText = "color:#4a9eff;font-size:11px;font-weight:bold;";
    sndVolLabel.appendChild(sndVolTitle);
    sndVolLabel.appendChild(sndVolValue);
    sndVolRow.appendChild(sndVolLabel);
    const sndVolSlider = document.createElement("input");
    sndVolSlider.type = "range";
    sndVolSlider.min = "0";
    sndVolSlider.max = "100";
    sndVolSlider.step = "5";
    sndVolSlider.value = String(savedSndVol);
    sndVolSlider.style.cssText = "width:100%;accent-color:#4a9eff;cursor:pointer;";
    sndVolSlider.oninput = () => {
        sndVolValue.textContent = sndVolSlider.value + "%";
        localStorage.setItem("srSndVol", sndVolSlider.value);
    };
    sndVolRow.appendChild(sndVolSlider);
    fxRow.appendChild(sndVolRow);
    content.appendChild(fxRow);

    // === 开始/停止按钮 ===
    const startBtn = document.createElement("button");
    if (screenRecordState) {
        startBtn.textContent = "⏹ 停止录制";
        startBtn.style.cssText = "width:100%;padding:10px;border-radius:8px;border:none;background:#c0392b;color:#fff;cursor:pointer;font-size:14px;font-weight:bold;";
        startBtn.onmouseover = () => startBtn.style.background = "#e74c3c";
        startBtn.onmouseout = () => startBtn.style.background = "#c0392b";
        startBtn.onclick = () => {
            panel.remove();
            stopScreenRecord();
        };
    } else {
        startBtn.textContent = "🔴 开始录制";
        startBtn.style.cssText = "width:100%;padding:10px;border-radius:8px;border:none;background:#c0392b;color:#fff;cursor:pointer;font-size:14px;font-weight:bold;";
        startBtn.onmouseover = () => startBtn.style.background = "#e74c3c";
        startBtn.onmouseout = () => startBtn.style.background = "#c0392b";
    startBtn.onclick = async () => {
        const fps = parseInt(fpsSelect.value);
        const audio = audioSelect.value;
        const devSelect = document.getElementById("srDeviceSelect");
        const devName = devSelect ? devSelect.value : "";
        const micVol = micVolWrap._getValue();
        const micOn = micVolWrap._isOn();
        const sysVol = sysVolWrap._getValue();
        const sysOn = sysVolWrap._isOn();

        const x = parseInt(document.getElementById("srInputX").value) || 0;
        const y = parseInt(document.getElementById("srInputY").value) || 0;
        const w = parseInt(document.getElementById("srInputW").value) || 0;
        const h = parseInt(document.getElementById("srInputH").value) || 0;

        localStorage.setItem("srFps", String(fps));
        localStorage.setItem("srAudio", audio);
        localStorage.setItem("srDevice", devName);
        localStorage.setItem("srMicVol", String(micVol));
        localStorage.setItem("srSysVol", String(sysVol));
        localStorage.setItem("srX", String(x));
        localStorage.setItem("srY", String(y));
        localStorage.setItem("srW", String(w));
        localStorage.setItem("srH", String(h));

        const clickCircle = circleCb.checked;
        const clickSound = soundCb.checked;
        const sndVol = parseInt(sndVolSlider.value);

        panel.remove();
        await startScreenRecord(fps, audio, devName, micVol, micOn, sysVol, sysOn, x, y, w, h, clickCircle, clickSound, sndVol);
    };
    }
    content.appendChild(startBtn);
    panel.appendChild(content);

    document.body.appendChild(panel);

    const px = Math.min(event.clientX, window.innerWidth - 300);
    const py = Math.min(event.clientY, window.innerHeight - 400);
    panel.style.left = px + "px";
    panel.style.top = py + "px";
    localStorage.setItem("srPanelX", px);
    localStorage.setItem("srPanelY", py);

    setTimeout(() => {
        const closeHandler = (ev) => {
            if (!panel.contains(ev.target)) {
                panel.remove();
                document.removeEventListener("click", closeHandler);
            }
        };
        document.addEventListener("click", closeHandler);
    }, 100);
}

function updateAreaBtns(mode) {
    const fullBtn = document.getElementById("srFullBtn");
    if (!fullBtn) return;
    if (mode === "full") {
        fullBtn.style.borderColor = "#4a9eff";
        fullBtn.style.background = "#2a3a52";
    } else {
        fullBtn.style.borderColor = "#333";
        fullBtn.style.background = "#1c1c28";
    }
}

async function startScreenRecord(fps, audio, devName, micVol, micOn, sysVol, sysOn, x, y, w, h, clickCircle, clickSound, sndVol) {
    let saveDir = "";
    if (typeof currentRoot !== "undefined" && currentRoot) {
        saveDir = currentRoot;
    }

    const body = {
        "保存目录": saveDir,
        "x": x, "y": y, "w": w, "h": h,
        "帧率": fps,
        "音频模式": audio,
        "dshow设备名": (audio === "mic" || audio === "both") ? devName : "",
        "麦克风音量": micVol,
        "麦克风静音": !micOn,
        "系统音量": sysVol,
        "系统静音": !sysOn,
        "点击效果": clickCircle,
        "点击音效": clickSound,
        "音效音量": sndVol
    };

    try {
        const res = await fetch("/api/screenrecord-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).then(r => r.json());

        if (res["成功"]) {
            screenRecordState = true;
            updateScreenRecordBtn();
            showToast("info", "录屏", "🎬 录屏中... " + (res["消息"] || ""));
            const startTime = Date.now();
            screenRecordTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
                const sec = String(elapsed % 60).padStart(2, "0");
                const btn = document.getElementById("screenRecordBtn");
                if (btn) {
                    btn.title = `🎬 录屏中 ${min}:${sec} (点击停止)`;
                }
            }, 500);
        } else {
            showToast("error", "录屏失败", res["错误"] || "录屏启动失败");
        }
    } catch (e) {
        showToast("error", "录屏请求失败", e.message);
    }
}

let screenStopping = false;

async function stopScreenRecord() {
    if (screenStopping) return;
    screenStopping = true;
    srLog("stopScreenRecord 开始");

    if (screenRecordTimer) {
        clearInterval(screenRecordTimer);
        screenRecordTimer = null;
    }

    // 立即更新UI为等待状态
    const btn = document.getElementById("screenRecordBtn");
    if (btn) {
        btn.textContent = "⏳";
        btn.title = "正在生成视频，请等待...";
        btn.style.pointerEvents = "none";
    }

    try {
        // 一次请求等转码完成（后端最多等60秒）
        const res = await fetch("/api/screenrecord-stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        }).then(r => r.json());

        srLog("stop完成 成功=" + res["成功"]);

        if (res["成功"]) {
            showToast("success", "录屏完成", (res["消息"] || "") + "，已打开保存文件夹");
            if (typeof refreshTree === "function") {
                try { refreshTree(); } catch(e) {}
            }
        } else {
            showToast("error", "录屏失败", res["错误"] || "未知错误");
        }
    } catch (e) {
        srLog("stop异常: " + e.message);
        showToast("error", "停止录屏失败", e.message);
    }

    screenStopping = false;
    screenRecordState = false;
    updateScreenRecordBtn();
    srLog("按钮已恢复");
}

function updateScreenRecordBtn() {
    const btn = document.getElementById("screenRecordBtn");
    if (!btn) return;
    if (screenRecordState) {
        btn.classList.add("recording");
        btn.textContent = "⏹";
        btn.title = "录屏中... 点击停止";
        btn.style.pointerEvents = "";
    } else {
        btn.classList.remove("recording");
        btn.textContent = "🎬";
        btn.title = "录制屏幕视频（右键设置）";
        btn.style.pointerEvents = "";
    }
}

window.addEventListener("beforeunload", () => {
    if (screenRecordState) {
        navigator.sendBeacon("/api/screenrecord-stop", JSON.stringify({}));
    }
});

document.addEventListener("DOMContentLoaded", () => {
    initScreenRecordBtn();
});
