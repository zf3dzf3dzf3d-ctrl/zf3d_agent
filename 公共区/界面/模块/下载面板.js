/**
 * 独立下载面板 — 唯一的下载进度展示入口
 * 固定左上角，下载期间始终可见，1秒刷新一次
 */
let _dpPollTimer = null;
let _dpCollapsed = false;
let _dpCompletedTimers = {}; // 记录已完成项的移除定时器
let _dpCancelling = new Set(); // 记录正在取消的下载ID

function initDownloadPanel() {
    if (_dpPollTimer) clearInterval(_dpPollTimer);
    _dpPollTimer = setInterval(pollDownloadPanel, 3000);
    // 延迟首次查询，等页面完全加载
    setTimeout(pollDownloadPanel, 500);
}
let _dpIdleMode = false;
function _dpSwitchInterval(空闲) {
    if (空闲 === _dpIdleMode) return;
    _dpIdleMode = 空闲;
    if (_dpPollTimer) clearInterval(_dpPollTimer);
    _dpPollTimer = setInterval(pollDownloadPanel, 空闲 ? 10000 : 3000);
}

function toggleDownloadPanel() {
    _dpCollapsed = !_dpCollapsed;
    const panel = document.getElementById("downloadPanel");
    if (panel) panel.classList.toggle("collapsed", _dpCollapsed);
}

function pollDownloadPanel() {
    fetch("/api/download-status")
        .then(r => r.json())
        .then(d => {
            if (!d.成功 || !d.下载列表) return;
            const list = d.下载列表;
            const entries = Object.entries(list);

            if (entries.length === 0) {
                hideDownloadPanel();
                _dpSwitchInterval(true);
                return;
            }
            _dpSwitchInterval(false);

            const body = document.getElementById("downloadPanelBody");
            if (!body) return;

            let hasActive = false;
            const seenIds = new Set();

            for (const [dlId, info] of entries) {
                seenIds.add(dlId);
                const status = info.状态 || "";

                if (status !== "完成" && status !== "失败") {
                    hasActive = true;
                }

                // 获取或创建条目
                let item = document.getElementById(`dpItem_${dlId}`);
                if (!item) {
                    item = document.createElement("div");
                    item.id = `dpItem_${dlId}`;
                    item.className = "dl-item";
                    body.appendChild(item);
                }

                // 原地更新条目内容（不重建DOM，防止闪烁）
                updateDownloadItem(item, dlId, info);

                // 完成项：5秒后淡出移除
                if (status === "完成" || status === "失败") {
                    if (!_dpCompletedTimers[dlId]) {
                        _dpCompletedTimers[dlId] = setTimeout(() => {
                            const el = document.getElementById(`dpItem_${dlId}`);
                            if (el) {
                                el.style.transition = "opacity 0.5s";
                                el.style.opacity = "0";
                                setTimeout(() => el.remove(), 500);
                            }
                            delete _dpCompletedTimers[dlId];
                            _dpCancelling.delete(dlId);
                            // 检查是否还有其他条目
                            const remaining = document.getElementById("downloadPanelBody");
                            if (remaining && remaining.children.length === 0) {
                                hideDownloadPanel();
                            }
                        }, 5000);
                    }
                }
            }

            // 移除已不在列表中的条目（后端清理后）
            for (const child of Array.from(body.children)) {
                const childId = child.id.replace("dpItem_", "");
                if (!seenIds.has(childId) && !_dpCompletedTimers[childId]) {
                    child.remove();
                }
            }

            // 显示面板和计数
            if (body.children.length > 0) {
                showDownloadPanel();
                const countEl = document.getElementById("dpCount");
                if (countEl) countEl.textContent = hasActive ? Array.from(body.children).length : 0;
                countEl.style.display = hasActive ? "" : "none";
            } else {
                hideDownloadPanel();
            }
        })
        .catch(() => {});
}

function updateDownloadItem(item, dlId, info) {
    const pct = info.百分比 || 0;
    const status = info.状态 || "";
    const name = info.文件名 || "下载中";
    const downloaded = info.已下载MB || 0;
    const total = info.总大小MB || 0;
    const speed = info.速度MB每秒 || 0;
    const eta = info.ETA || "";
    const chunks = info.已完成分块 || "";
    const isCancelling = _dpCancelling.has(dlId);

    // 计算当前结构状态签名，判断是否需要重建DOM
    let phase;
    if (status === "完成") phase = "complete";
    else if (status === "失败") phase = "failed";
    else if (isCancelling) phase = "cancelling";
    else if (status === "校验中") phase = "verifying";
    else phase = "active";

    const needCancelBtn = (phase === "active");
    const stateKey = `${phase}:${needCancelBtn}`;

    // 只在结构状态变化时重建DOM，避免每秒重建导致按钮闪烁/鼠标无法对位
    if (item.dataset.stateKey !== stateKey) {
        item.dataset.stateKey = stateKey;

        // 更新class
        item.className = "dl-item";
        if (status === "完成") item.className += " dl-complete";
        else if (status === "失败") item.className += " dl-failed";
        else if (status === "启动中") item.className += " dl-starting";
        else if (status === "校验中") item.className += " dl-verifying";
        if (isCancelling) item.className += " dl-cancelling";

        // 图标
        let icon = "⬇️";
        if (status === "完成") icon = "✅";
        else if (status === "失败") icon = "❌";
        else if (status === "启动中") icon = "⟳";
        else if (status === "校验中") icon = "🔍";
        else if (isCancelling) icon = "⏹️";

        // 取消按钮
        let cancelBtnHtml = "";
        if (needCancelBtn) {
            cancelBtnHtml = `<button class="dl-cancel-btn" onclick="cancelDownload(${dlId}); event.stopPropagation();" title="取消下载">×</button>`;
        }

        // 统计行
        let statsHtml;
        if (phase === "complete") {
            statsHtml = `<span class="dl-item-size"></span><span class="dl-item-status">完成</span>`;
        } else if (phase === "failed") {
            statsHtml = `<span class="dl-item-status">失败</span>`;
        } else if (phase === "cancelling") {
            statsHtml = `<span class="dl-item-status">取消中...</span>`;
        } else if (phase === "verifying") {
            statsHtml = `<span class="dl-item-status">校验SHA256中...</span>`;
        } else {
            statsHtml = `
                <span class="dl-item-size"></span>
                <span class="dl-item-speed"></span>
                <span class="dl-item-eta"></span>
                <span class="dl-item-status"></span>
            `;
        }

        item.innerHTML = `
            <div class="dl-item-name">${icon} <span class="dl-name-text"></span>${cancelBtnHtml}</div>
            <div class="dl-item-bar"><div class="dl-item-bar-fill" style="width:${pct}%"></div></div>
            <div class="dl-item-stats">
                <span class="dl-item-pct">${pct}%</span>
                ${statsHtml}
            </div>
        `;
    } else {
        // 结构没变，只更新class（status可能从启动中→下载中，都是active phase）
        item.className = "dl-item";
        if (status === "完成") item.className += " dl-complete";
        else if (status === "失败") item.className += " dl-failed";
        else if (status === "启动中") item.className += " dl-starting";
        else if (status === "校验中") item.className += " dl-verifying";
        if (isCancelling) item.className += " dl-cancelling";
    }

    // 更新动态文本（不重建DOM）
    const nameEl = item.querySelector(".dl-name-text");
    if (nameEl) nameEl.textContent = name;

    const barFill = item.querySelector(".dl-item-bar-fill");
    if (barFill) barFill.style.width = pct + "%";

    const pctEl = item.querySelector(".dl-item-pct");
    if (pctEl) pctEl.textContent = pct + "%";

    const sizeEl = item.querySelector(".dl-item-size");
    if (sizeEl) sizeEl.textContent = (downloaded && total) ? `${downloaded}/${total} MB` : "";

    const speedEl = item.querySelector(".dl-item-speed");
    if (speedEl) speedEl.textContent = speed ? `${speed} MB/s` : "";

    const etaEl = item.querySelector(".dl-item-eta");
    if (etaEl) etaEl.textContent = eta ? `⏳${eta}` : "";

    const statusEl2 = item.querySelector(".dl-item-status");
    // 校验中/取消中/完成/失败 的文本在重建时已写死，只在active phase更新chunks
    if (statusEl2 && phase === "active") {
        statusEl2.textContent = chunks || "";
    }
}

function cancelDownload(dlId) {
    if (_dpCancelling.has(dlId)) return;
    _dpCancelling.add(dlId);
    fetch("/api/download-cancel", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({下载ID: dlId})
    }).then(r => r.json()).then(d => {
        if (!d.成功) {
            _dpCancelling.delete(dlId);
        }
    }).catch(() => {
        _dpCancelling.delete(dlId);
    });
    // 立即刷新UI显示取消中状态
    const item = document.getElementById(`dpItem_${dlId}`);
    if (item) {
        item.className += " dl-cancelling";
        const statusEl = item.querySelector(".dl-item-status");
        if (statusEl) statusEl.textContent = "取消中...";
        const btn = item.querySelector(".dl-cancel-btn");
        if (btn) btn.remove();
    }
}

function showDownloadPanel() {
    const panel = document.getElementById("downloadPanel");
    if (panel) panel.style.display = "block";
}

function hideDownloadPanel() {
    const panel = document.getElementById("downloadPanel");
    if (panel) panel.style.display = "none";
}

// 兼容旧代码调用（推理流.js和对话核心.js中可能调用）
function startDownloadPolling() {
    // 已由initDownloadPanel接管，此函数保留为空避免报错
}

document.addEventListener("DOMContentLoaded", initDownloadPanel);
