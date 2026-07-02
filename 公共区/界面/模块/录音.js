/**
 * 录音模块 — 点击录音按钮录制系统音频，停止后自动保存并打开文件夹
 */

let recordState = false;  // 是否正在录音
let recordTimer = null;   // 计时器

function initRecordBtn() {
    const btn = document.getElementById("recordBtn");
    if (!btn) return;
    btn.addEventListener("click", toggleRecord);
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
            body: JSON.stringify({ "保存目录": saveDir })
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
            body: JSON.stringify({})
        }).then(r => r.json());

        recordState = false;
        updateRecordBtn();

        if (res["成功"]) {
            showToast("success", "录音完成", res["消息"] + "，已打开保存文件夹");
            if (typeof loadFileTree === "function" && typeof currentRoot !== "undefined" && currentRoot) {
                loadFileTree(currentRoot);
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
        btn.textContent = "🔴";
        btn.title = "录制系统音频";
    }
}

window.addEventListener("beforeunload", () => {
    if (recordState) {
        navigator.sendBeacon("/api/record-stop", JSON.stringify({}));
    }
});

document.addEventListener("DOMContentLoaded", () => {
    initRecordBtn();
});
