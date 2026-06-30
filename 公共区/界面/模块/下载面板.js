/**
 * 独立下载面板 — 唯一的下载进度展示入口
 * 固定右下角，下载期间始终可见，1秒刷新一次
 */
let _dpPollTimer = null;
let _dpCollapsed = false;
let _dpCompletedTimers = {}; // 记录已完成项的移除定时器

function initDownloadPanel() {
    if (_dpPollTimer) clearInterval(_dpPollTimer);
    _dpPollTimer = setInterval(pollDownloadPanel, 1000);
    // 延迟首次查询，等页面完全加载
    setTimeout(pollDownloadPanel, 500);
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
                return;
            }

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

    // 更新class
    item.className = "dl-item";
    if (status === "完成") item.className += " dl-complete";
    else if (status === "失败") item.className += " dl-failed";
    else if (status === "启动中") item.className += " dl-starting";
    else if (status === "校验中") item.className += " dl-verifying";

    // 图标
    let icon = "⬇️";
    if (status === "完成") icon = "✅";
    else if (status === "失败") icon = "❌";
    else if (status === "启动中") icon = "⟳";
    else if (status === "校验中") icon = "🔍";

    // 统计行
    let statsHtml;
    if (status === "完成") {
        statsHtml = `<span class="dl-item-size">${downloaded}/${total} MB</span><span class="dl-item-status">完成</span>`;
    } else if (status === "失败") {
        statsHtml = `<span class="dl-item-status">失败</span>`;
    } else if (status === "校验中") {
        statsHtml = `<span class="dl-item-status">校验SHA256中...</span>`;
    } else {
        statsHtml = `
            <span class="dl-item-size">${downloaded}/${total} MB</span>
            <span class="dl-item-speed">${speed} MB/s</span>
            ${eta ? `<span class="dl-item-eta">⏳${escapeHtml(String(eta))}</span>` : ""}
            ${chunks ? `<span class="dl-item-status">${escapeHtml(String(chunks))}</span>` : ""}
        `;
    }

    item.innerHTML = `
        <div class="dl-item-name">${icon} ${escapeHtml(name)}</div>
        <div class="dl-item-bar"><div class="dl-item-bar-fill" style="width:${pct}%"></div></div>
        <div class="dl-item-stats">
            <span class="dl-item-pct">${pct}%</span>
            ${statsHtml}
        </div>
    `;
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
