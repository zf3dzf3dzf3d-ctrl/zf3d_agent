/**
 * 推理流 — 实时推理过程展示
 * 从 逻辑.js 拆分，依赖全局状态
 */

// ============ 实时推理流 ============
let reasoningStreamContent = [];

function showReasoningPanel() {
    reasoningStreamContent = [];
    let panel = document.getElementById("reasoningPanel");
    if (!panel) {
        const chatMsg = document.getElementById("msgList");
        panel = document.createElement("div");
        panel.id = "reasoningPanel";
        panel.className = "reasoning-panel";
        panel.innerHTML = '<div class="reasoning-header" id="reasoningHeader"><span>⚡ AI推理过程</span><span class="rh-count" id="rhCount">0步</span></div><div class="reasoning-body" id="reasoningBody"></div>';
        chatMsg.parentNode.insertBefore(panel, chatMsg.nextSibling);
        // 恢复上次高度（强制最小150px，避免被拖到极小后看不见）
        const savedH = Math.max(150, parseInt(localStorage.getItem('reasoningPanelHeight')) || 240);
        panel.style.maxHeight = savedH + 'px';
        const body = document.getElementById('reasoningBody');
        if (body) body.style.maxHeight = (savedH - 30) + 'px';
        // 拖拽调整大小
        const header = document.getElementById('reasoningHeader');
        let dragging = false, startY = 0, startH = 0;
        // 使用命名函数以便后续移除
        function _onMouseMove(e) {
            if (!dragging) return;
            const delta = startY - e.clientY;
            let newH = Math.max(150, Math.min(600, startH + delta));
            panel.style.maxHeight = newH + 'px';
            const body = document.getElementById('reasoningBody');
            if (body) body.style.maxHeight = (newH - 30) + 'px';
        }
        function _onMouseUp() {
            if (dragging) {
                dragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem('reasoningPanelHeight', panel.offsetHeight);
                // 拖拽结束后移除监听器，避免泄漏
                document.removeEventListener('mousemove', _onMouseMove);
                document.removeEventListener('mouseup', _onMouseUp);
            }
        }
        header.addEventListener('mousedown', function(e) {
            if (e.target.id === 'rhCount') return;
            dragging = true;
            startY = e.clientY;
            startH = panel.offsetHeight;
            e.preventDefault();
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            // 每次拖拽开始时添加监听器，结束时移除
            document.addEventListener('mousemove', _onMouseMove);
            document.addEventListener('mouseup', _onMouseUp);
        });
    }
    panel.style.display = "block";
    document.getElementById("reasoningBody").innerHTML = "";
}

function hideReasoningPanel() {
    const panel = document.getElementById("reasoningPanel");
    if (panel) panel.style.display = "none";
}

async function pollReasoningStream() {
    if (!isChatting) return;
    try {
        const res = await fetch(`/api/reasoning-stream?index=${reasoningIndex}`);
        const d = await res.json();
        if (d.成功 && d.记录?.length > 0) {
            reasoningIndex = d.当前索引 || reasoningIndex + d.记录.length;
            for (const rec of d.记录) {
                reasoningStreamContent.push(rec);
                appendReasoningRecord(rec);
                // 检测文件变更操作，提前刷新文件夹（不用等最终响应）
                if (rec.类型 === "操作结果" && rec.内容?.操作 && rec.内容?.成功) {
                    const 文件变更操作 = ["删除文件", "写入文件", "替换文本", "创建文件", "追加文件", "重命名",
                        "多线程下载", "下载网页图片", "ComfyUI一键生图", "ComfyUI获取图片", "ComfyUI图片修改", "ComfyUI视频生成",
                        "替换Word文本", "替换Excel文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档",
                        "运行命令", "压缩文件", "解压文件"];
                    if (文件变更操作.includes(rec.内容.操作)) {
                        refreshTree();
                        if (galleryPath) showGallery(galleryPath);
                    }
                }
            }
        }
    } catch (e) { /* 静默忽略 */ }
}

function appendReasoningRecord(rec) {
    const body = document.getElementById("reasoningBody");
    if (!body) return;
    const div = document.createElement("div");
    div.className = "reasoning-card";
    let 详情数据 = null;  // 点击展开时显示的完整内容

    switch (rec.类型) {
        case "开始":
            div.className += " rc-start";
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content"><span class="rc-label">开始</span> ${escapeHtml(rec.内容.消息 || "")}</div>`;
            break;
        case "思考":
            div.className += " rc-thinking";
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content"><span class="rc-label">步骤 ${rec.内容.步数}</span> 思考中...</div>`;
            break;
        case "操作调用":
            div.className += " rc-action";
            const p = Object.entries(rec.内容.参数||{}).map(([k,v])=>`<span class="rc-param">${escapeHtml(k)}=<span class="rc-val">${escapeHtml(String(v).substring(0,40))}</span></span>`).join(" ");
            const 参数完整 = Object.entries(rec.内容.参数||{}).map(([k,v])=>`${k}: ${v}`).join("\n");
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content"><span class="rc-label rc-op-name">${escapeHtml(rec.内容.操作)}</span><div class="rc-params">${p}</div></div>`;
            详情数据 = `操作: ${rec.内容.操作}\n\n参数:\n${参数完整}`;
            // 朗读操作时更新思考状态
            if (rec.内容.操作 === "普通话") {
                _updateThinkingDisplay("朗读", "语音播报中...", 80);
            }
            break;
        case "操作结果":
            div.className += " rc-result" + (rec.内容.成功 ? " rc-success" : " rc-fail");
            // 如果之前在等待生成，清理进度条
            if (document.getElementById("genProgressBar")) {
                document.getElementById("genProgressBar").remove();
            }
            // 朗读结束后恢复思考状态
            const elCat = document.getElementById("thinkingCat");
            if (elCat && elCat.textContent === "朗读") {
                _updateThinkingDisplay("思考", "继续推理...", 50);
            }
            const resultText = escapeHtml((rec.内容.结果||"").substring(0,200));
            const resultFull = rec.内容.结果 || "";
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content">${rec.内容.成功 ? "✅" : "❌"} ${escapeHtml(rec.内容.操作 || "")} — ${resultText}</div>`;
            详情数据 = `操作: ${rec.内容.操作}\n成功: ${rec.内容.成功}\n\n结果:\n${resultFull}`;
            break;
        case "下载进度": {
            const p = rec.内容;
            // 重启下载面板轮询（页面加载后轮询已停止，收到进度事件时恢复）
            if (typeof _dpStartPolling === 'function') _dpStartPolling();
            if (typeof pollDownloadPanel === 'function') pollDownloadPanel();
            const dlId = p.下载ID || 'default';
            const barId = `dlBar_${dlId}`;
            let progBar = document.getElementById(barId);
            if (!progBar) {
                progBar = document.createElement("div");
                progBar.id = barId;
                progBar.className = "reasoning-card rc-progress download-progress";
                let etaHtml = p.ETA ? `<span class="dl-eta">⏳ ${escapeHtml(String(p.ETA))}</span>` : '';
                progBar.innerHTML = `<div class="dl-header">⬇️ <span class="dl-name">${escapeHtml(p.文件名||'下载中')}</span></div><div class="dl-bar-container"><div class="dl-bar-fill" style="width:${p.百分比||0}%"></div></div><div class="dl-info"><span class="dl-pct">${p.百分比||0}%</span><span class="dl-size">${p.已下载MB||0}/${p.总大小MB||0} MB</span><span class="dl-speed">${p.速度MB每秒||0} MB/s</span>${etaHtml}<span class="dl-chunks">${p.已完成分块||''}</span></div>`;
                body.appendChild(progBar);
            } else {
                progBar.querySelector(".dl-name").textContent = p.文件名 || '下载中';
                progBar.querySelector(".dl-bar-fill").style.width = (p.百分比||0) + "%";
                progBar.querySelector(".dl-pct").textContent = (p.百分比||0) + "%";
                progBar.querySelector(".dl-size").textContent = `${p.已下载MB||0}/${p.总大小MB||0} MB`;
                progBar.querySelector(".dl-speed").textContent = `${p.速度MB每秒||0} MB/s`;
                let etaEl = progBar.querySelector(".dl-eta");
                if (p.ETA) {
                    if (!etaEl) {
                        etaEl = document.createElement("span");
                        etaEl.className = "dl-eta";
                        progBar.querySelector(".dl-info").insertBefore(etaEl, progBar.querySelector(".dl-chunks"));
                    }
                    etaEl.textContent = `⏳ ${p.ETA}`;
                } else if (etaEl) {
                    etaEl.remove();
                }
                progBar.querySelector(".dl-chunks").textContent = p.已完成分块 || '';
            }
            body.scrollTop = body.scrollHeight;
            return;
        }
        case "下载完成": {
            const p = rec.内容;
            const dlId = p.下载ID || 'default';
            const barId = `dlBar_${dlId}`;
            let progBar = document.getElementById(barId);
            if (progBar) {
                progBar.querySelector(".dl-bar-fill").classList.add("complete");
                progBar.querySelector(".dl-bar-fill").style.width = "100%";
                progBar.querySelector(".dl-header").innerHTML = `✅ <span class="dl-name">${escapeHtml(p.文件名||'下载完成')}</span>`;
                progBar.removeAttribute("id");
            }
            showToast("success", "✅ 下载完成", `${p.文件名||'文件'} (${p.大小MB||0}MB) 已保存`);
            refreshTree();
            if (galleryPath) showGallery(galleryPath);
            return;
        }
        case "下载失败": {
            const p = rec.内容;
            const dlId = p.下载ID || 'default';
            const barId = `dlBar_${dlId}`;
            let progBar = document.getElementById(barId);
            if (progBar) {
                progBar.querySelector(".dl-bar-fill").classList.add("failed");
                progBar.removeAttribute("id");
            }
            showToast("error", "❌ 下载失败", `${p.文件名||'文件'}: ${p.错误||'未知错误'}`);
            return;
        }
        case "最终回复":
            if (document.getElementById("genProgressBar")) {
                document.getElementById("genProgressBar").remove();
            }
            div.className += " rc-reply";
            const replyText = escapeHtml((rec.内容.内容||"").substring(0,300));
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content">💬 ${replyText}</div>`;
            详情数据 = rec.内容.内容 || "";
            // 如果有下载进度条，启动轮询
            startDownloadPolling();
            break;
        case "生成进度":
        case "启动进度": {
            const p = rec.内容;
            const isGen = rec.类型 === "生成进度";
            const label = isGen ? "ComfyUI生成中" : "ComfyUI启动中";
            const elapsed = p.已耗时秒 || 0;
            _updateThinkingDisplay("等待", `${label}... ${elapsed}秒`, 70);
            let progBar = document.getElementById("genProgressBar");
            if (!progBar) {
                progBar = document.createElement("div");
                progBar.id = "genProgressBar";
                progBar.className = "reasoning-card rc-progress gen-progress";
                progBar.innerHTML = `<div class="gen-header">⏳ ${label}... <span class="gen-elapsed">${elapsed}秒</span></div><div class="gen-bar-container"><div class="gen-bar-fill" style="width:100%"></div></div>`;
                body.appendChild(progBar);
            } else {
                const header = progBar.querySelector(".gen-header");
                if (header) header.innerHTML = `⏳ ${label}... <span class="gen-elapsed">${elapsed}秒</span>`;
            }
            body.scrollTop = body.scrollHeight;
            return;
        }
        case "播放视频": {
            const p = rec.内容;
            if (p.文件路径) {
                videoPlaylist = [{ 路径: p.文件路径, 名称: p.标题 }];
                showVideo(p.文件路径, p.标题, 0);
            }
            _updateThinkingDisplay("播放", `🎬 ${p.标题||''}`, 90);
            return;
        }
        case "视频搜索": {
            const p = rec.内容;
            _updateThinkingDisplay("搜索", p.状态 === "搜索中" ? `搜索视频: ${p.关键词||''}` : `处理中...`, 60);
            return;
        }
        case "播放音乐": {
            const p = rec.内容;
            if (typeof mbPlaySong === 'function') {
                mbPlaySong(p.文件路径 || "", p.歌名, p.歌手, p.封面, p.来源, p.添加到列表, p.播放URL, p.bvid);
            }
            return;
        }
        case "音乐搜索": {
            const p = rec.内容;
            _updateThinkingDisplay("搜索", p.状态 === "下载中" ? `下载: ${p.歌名||''} ${p.歌手||''}` : `搜索: ${p.关键词||''}`, 60);
            return;
        }
        case "工作流方案": {
            const p = rec.内容;
            const 节点列表 = (p.节点 || []).map((n, i) => {
                const num = i + 1;
                return `<div class="rc-wf-node-item"><span class="rc-wf-node-num">${num}</span> ${escapeHtml(n.name || n.员工名 || n.type || '?')}</div>`;
            }).join("");
            const 连接列表 = (p.连接 || []).map(c => {
                return `${escapeHtml(c.from||'?')} → ${escapeHtml(c.to||'?')}`;
            }).join("  ");
            div.className += " rc-wf-plan";
            // 保存方案数据到全局变量供按钮使用
            window._lastWfPlan = p;
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content">
                <span class="rc-label" style="color:#4EC9B0">🔀 工作流编排建议</span>
                <div class="rc-wf-reason">${escapeHtml(p.理由 || '')}</div>
                <div class="rc-wf-nodes">${节点列表}</div>
                <div class="rc-wf-conns">${连接列表}</div>
                <div class="rc-wf-hint">💡 方案已在对话中渲染，可在下方助手回复中查看和执行</div>
            </div>`;
            详情数据 = `任务: ${p.原始任务 || ''}\n\n理由: ${p.理由 || ''}\n\n节点:\n${(p.节点||[]).map(n=>`  - ${n.name||n.员工名} (${n.type})`).join('\n')}\n\n连接:\n${(p.连接||[]).map(c=>`  ${c.from} → ${c.to}`).join('\n')}`;
            break;
        }
        default:
            div.innerHTML = `<div class="rc-icon"></div><div class="rc-content">${escapeHtml(rec.类型)}: ${escapeHtml(JSON.stringify(rec.内容).substring(0,100))}</div>`;
    }
    // 点击展开/收起详情（仅有详情数据的卡片）
    if (详情数据) {
        const detailDiv = document.createElement("div");
        detailDiv.className = "rc-detail";
        detailDiv.textContent = 详情数据;
        div.appendChild(detailDiv);
        div.addEventListener("click", (e) => {
            // 进度条卡片不响应点击
            if (div.classList.contains("rc-progress")) return;
            div.classList.toggle("rc-expanded");
        });
    }
    body.appendChild(div);
    // 更新步数计数
    const countEl = document.getElementById("rhCount");
    if (countEl) countEl.textContent = `${body.children.length}步`;
    body.scrollTop = body.scrollHeight;
}

// === 下载进度轮询 ===
// 已由 下载面板.js 接管，这里保留空函数避免报错
let _downloadPollTimer = null;

// 对话员工化：把编排方案加载到工作流画布
window._loadWfPlanToCanvas = function() {
    var plan = window._lastWfPlan;
    if (!plan) { alert('无工作流方案数据'); return; }
    
    // 构建工作流数据格式
    var nodes = [];
    var nodeMap = {};
    (plan.节点 || []).forEach(function(n, idx) {
        var id = n.id || ('n' + (idx + 1));
        nodeMap[id] = id;
        // 自动排列坐标
        var cols = Math.ceil(Math.sqrt((plan.节点 || []).length));
        var col = idx % cols, row = Math.floor(idx / cols);
        nodes.push({
            id: id,
            type: n.type || 'employee',
            name: n.name || n.员工名 || '?',
            员工名: n.员工名 || n.name || '',
            x: col * 240 + 80,
            y: row * 180 + 80,
            config: n.config || {},
            extra: {}
        });
    });
    var conns = (plan.连接 || []).map(function(c) {
        return {from: nodeMap[c.from] || c.from, to: nodeMap[c.to] || c.to};
    });
    
    // 调用员工浮窗的加载函数
    if (typeof loadWorkflowFromData === 'function') {
        loadWorkflowFromData({nodes: nodes, conns: conns, frames: []});
        // 打开工作流面板
        if (typeof openWorkflow === 'function') {
            openWorkflow();
        }
        // 自动排列和适应
        setTimeout(function() {
            if (typeof autoLayout === 'function') autoLayout();
            if (typeof fitWorkflow === 'function') fitWorkflow();
        }, 200);
        showToast('工作流方案已加载到画布，点击🚀执行', 'success');
    } else {
        // 员工浮窗未加载，打开工作流面板
        if (typeof toggleWorkflow === 'function') {
            toggleWorkflow();
            setTimeout(function() {
                if (typeof loadWorkflowFromData === 'function') {
                    loadWorkflowFromData({nodes: nodes, conns: conns, frames: []});
                    if (typeof autoLayout === 'function') autoLayout();
                    if (typeof fitWorkflow === 'function') fitWorkflow();
                }
            }, 500);
        } else {
            alert('请先打开工作流面板后再点击加载');
        }
    }
};

function startDownloadPolling() {
    // 重启下载面板轮询（最终回复后SSE关闭，靠轮询继续追踪后台下载）
    if (typeof _dpStartPolling === 'function') _dpStartPolling();
    if (typeof pollDownloadPanel === 'function') pollDownloadPanel();
}

function pollDownloadStatus() {
    // 已由 下载面板.js 接管
}

// ============ 推理流节点图（对话区域渲染） ============
function renderReasoningGraph(msgEl, reasoningSteps) {
    if (!reasoningSteps || reasoningSteps.length === 0) return;
    if (msgEl.querySelector('.rg-container')) return;

    // 提取操作序列
    const nodes = [];
    for (const step of reasoningSteps) {
        const type = step.类型 || step.type || '';
        if (type === '操作' || type === '操作调用' || type === '操作结果') {
            const opName = step.操作 || step.operation || (step.内容 ? step.内容.操作 : '') || '?';
            const success = step.成功 !== false;
            const isResult = type === '操作结果' || (step.结果 && !step.思考);
            // 合并操作调用+结果为一个节点
            if (!isResult) {
                nodes.push({
                    name: opName,
                    success: success,
                    step: step.步骤 || step.step || (nodes.length + 1),
                    params: step.参数 || step.参数 || (step.内容 ? step.内容.参数 : {}) || {},
                    result: step.结果 || (step.内容 ? step.内容.结果 : '') || '',
                });
            }
        }
    }
    if (nodes.length === 0) return;

    // 限制最多20个节点
    const maxNodes = 20;
    const displayNodes = nodes.length > maxNodes ? nodes.slice(0, maxNodes) : nodes;

    // 构建自动换行SVG节点图
    const nodeW = 100, nodeH = 36, gapX = 40, gapY = 50;
    // 用父容器宽度或默认值——container还未创建，用合理估算
    const parentEl = msgList || document.querySelector('.msg-list') || document.body;
    const containerW = parentEl.clientWidth || 600;
    const maxPerRow = Math.max(3, Math.floor((containerW - 30) / (nodeW + gapX)));
    const rows = Math.ceil(displayNodes.length / maxPerRow);
    const svgW = maxPerRow * (nodeW + gapX) + 20;
    const svgH = rows * (nodeH + gapY) + 10;

    let svgNodes = '';
    let svgConns = '';

    displayNodes.forEach((n, i) => {
        const row = Math.floor(i / maxPerRow);
        const col = i % maxPerRow;
        const x = col * (nodeW + gapX) + 10;
        const y = row * (nodeH + gapY) + 15;
        const color = n.success ? '#4CAF50' : '#f44336';
        const bgColor = n.success ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)';
        const shortName = n.name.length > 6 ? n.name.substring(0, 6) + '..' : n.name;
        const stepNum = n.step;

        svgNodes += `<g class="rg-node" data-idx="${i}">
            <rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="6" fill="${bgColor}" stroke="${color}" stroke-width="1.5"/>
            <circle cx="${x + 10}" cy="${y + 10}" r="5" fill="${color}"/>
            <text x="${x + 10}" y="${y + 12}" text-anchor="middle" fill="#fff" font-size="8" font-weight="bold">${stepNum}</text>
            <text x="${x + nodeW/2 + 5}" y="${y + 14}" text-anchor="middle" fill="${color}" font-size="10" font-weight="bold">${escapeHtml(shortName)}</text>
            <text x="${x + nodeW/2}" y="${y + 28}" text-anchor="middle" fill="#888" font-size="8">${n.success ? '✅' : '❌'}</text>
        </g>`;

        if (i < displayNodes.length - 1) {
            const ni = i + 1;
            const nRow = Math.floor(ni / maxPerRow);
            const nCol = ni % maxPerRow;
            const x2 = nCol * (nodeW + gapX) + 10;
            const y2 = nRow * (nodeH + gapY) + 15;
            if (nRow === row) {
                // 同一行——水平连线
                const mx = (x + nodeW + x2) / 2;
                svgConns += `<path d="M${x + nodeW},${y + nodeH/2} C${mx},${y + nodeH/2} ${mx},${y + nodeH/2} ${x2},${y + nodeH/2}" fill="none" stroke="#555" stroke-width="1" opacity="0.5"/>`;
                svgConns += `<polygon points="${x2},${y + nodeH/2} ${x2 - 5},${y + nodeH/2 - 3} ${x2 - 5},${y + nodeH/2 + 3}" fill="#555" opacity="0.5"/>`;
            } else {
                // 跨行——从行尾向下折回到下一行行首
                const endX = x + nodeW;
                const endY = y + nodeH/2;
                const midY = y + nodeH + gapY/2 - 5;
                const startX = x2 + nodeW/2;
                svgConns += `<path d="M${endX},${endY} L${endX + 10},${endY} L${endX + 10},${midY} L${startX},${midY} L${startX},${y2 - 5} L${startX},${y2 + nodeH/2}" fill="none" stroke="#555" stroke-width="1" opacity="0.5" stroke-dasharray="3,2"/>`;
                svgConns += `<polygon points="${startX},${y2 + nodeH/2} ${startX - 3},${y2 + nodeH/2 - 5} ${startX + 3},${y2 + nodeH/2 - 5}" fill="#555" opacity="0.5"/>`;
            }
        }
    });

    // 如果有更多节点被截断
    let truncatedMsg = '';
    if (nodes.length > maxNodes) {
        truncatedMsg = `<span style="font-size:10px;color:var(--text3);margin-left:8px">...共${nodes.length}步，显示前${maxNodes}步</span>`;
    }

    const container = document.createElement('div');
    container.className = 'rg-container';
    container.innerHTML = `
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px;display:flex;align-items:center">
            <span style="color:var(--blue)">⚡ 推理路径</span> (${nodes.length}步)
            ${truncatedMsg}
        </div>
        <div style="overflow:hidden;border:1px solid var(--border);border-radius:6px;padding:4px;background:var(--bg4)">
            <svg width="100%" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMinYMin meet" style="min-height:${svgH}px">
                ${svgConns}
                ${svgNodes}
            </svg>
        </div>
    `;

    // 点击节点展开详情，默认展开最后一个节点
    container.querySelectorAll('.rg-node').forEach(function(g) {
        g.style.cursor = 'pointer';
        const nodeIdx = parseInt(g.getAttribute('data-idx'));
        // 默认展开最后一个节点
        if (nodeIdx === displayNodes.length - 1) {
            setTimeout(function() { g.click(); }, 50);
        }
        g.addEventListener('click', function() {
            const idx = parseInt(g.getAttribute('data-idx'));
            const n = displayNodes[idx];
            const detail = container.querySelector('.rg-detail');
            if (detail && detail.getAttribute('data-idx') === String(idx)) {
                detail.remove();
                return;
            }
            if (detail) detail.remove();
            const d = document.createElement('div');
            d.className = 'rg-detail';
            d.setAttribute('data-idx', String(idx));
            const paramsStr = Object.entries(n.params || {}).map(function(k) {
                return escapeHtml(k[0]) + ': ' + escapeHtml(String(k[1]).substring(0, 60));
            }).join('\n');
            d.innerHTML = `<div style="margin-top:6px;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:Consolas,monospace;white-space:pre-wrap;max-height:200px;overflow-y:auto">
步骤${n.step}: ${escapeHtml(n.name)}
成功: ${n.success ? '✅' : '❌'}

参数:
${paramsStr || '(无)'}

结果:
${escapeHtml((n.result || '').substring(0, 500))}
</div>`;
            container.appendChild(d);
        });
    });

    msgEl.appendChild(container);
}
// ============ 工作流编排方案卡片（在对话区域渲染） ============
function renderWorkflowPlanCard(msgEl, plan) {
    if (!plan || !plan.节点 || plan.节点.length === 0) return;

    // 避免重复渲染
    if (msgEl.querySelector('.wf-plan-card')) return;

    const 节点 = plan.节点;
    const 连接 = plan.连接 || [];

    // 构建SVG可视化
    const nodeW = 120, nodeH = 44, gapX = 60, gapY = 80;
    const cols = Math.ceil(Math.sqrt(节点.length));
    const rows = Math.ceil(节点.length / cols);
    const svgW = Math.max(300, cols * (nodeW + gapX));
    const svgH = Math.max(120, rows * (nodeH + gapY));

    // 计算节点坐标
    const nodePos = {};
    节点.forEach((n, i) => {
        const id = n.id || ('n' + (i + 1));
        const col = i % cols, row = Math.floor(i / cols);
        nodePos[id] = { x: col * (nodeW + gapX) + 20, y: row * (nodeH + gapY) + 20, name: n.name || n.员工名 || '?' };
    });

    // 生成SVG
    let svgNodes = '';
    节点.forEach((n, i) => {
        const id = n.id || ('n' + (i + 1));
        const p = nodePos[id];
        const cx = p.x + nodeW / 2;
        const emoji = n.type === 'employee' ? '👤' : '🎯';
        svgNodes += `<g class="wf-svg-node">
            <rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="8" fill="#1e2a3e" stroke="#4EC9B0" stroke-width="1.5"/>
            <text x="${cx}" y="${p.y + 18}" text-anchor="middle" fill="#4EC9B0" font-size="11" font-weight="bold">${emoji} ${escapeHtml(p.name).substring(0, 8)}</text>
            <text x="${cx}" y="${p.y + 34}" text-anchor="middle" fill="#888" font-size="9">${escapeHtml(n.type || 'employee')}</text>
        </g>`;
    });

    let svgConns = '';
    连接.forEach(c => {
        const from = nodePos[c.from], to = nodePos[c.to];
        if (!from || !to) return;
        const x1 = from.x + nodeW, y1 = from.y + nodeH / 2;
        const x2 = to.x, y2 = to.y + nodeH / 2;
        const mx = (x1 + x2) / 2;
        svgConns += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#4EC9B0" stroke-width="1.5" opacity="0.6"/>`;
        // 箭头
        svgConns += `<polygon points="${x2},${y2} ${x2-6},${y2-4} ${x2-6},${y2+4}" fill="#4EC9B0" opacity="0.6"/>`;
    });

    const card = document.createElement('div');
    card.className = 'wf-plan-card';
    card.innerHTML = `
        <div class="wf-plan-header">
            <span style="color:#4EC9B0;font-weight:bold;font-size:14px">🔀 工作流编排方案</span>
            <span style="font-size:12px;color:var(--text2);margin-left:8px;flex:1">${escapeHtml(plan.理由 || '')}</span>
            <span style="font-size:11px;color:var(--text3);background:rgba(78,201,176,0.1);padding:2px 8px;border-radius:10px">${节点.length}个员工</span>
        </div>
        <div class="wf-plan-svg-wrap" style="overflow-x:auto;margin:10px 0;border-radius:6px;background:rgba(0,0,0,0.15);padding:8px">
            <svg width="${svgW}" height="${svgH}" style="min-height:80px">
                ${svgConns}
                ${svgNodes}
            </svg>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
            <button class="wf-plan-exec-btn" style="background:var(--blue);color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;transition:all 0.2s">🚀 执行工作流</button>
            <span style="font-size:11px;color:var(--text3)">点击执行，结果实时显示</span>
        </div>
        <div class="wf-plan-result" style="margin-top:10px"></div>
    `;

    // 添加到消息下方
    msgEl.appendChild(card);

    // 绑定执行按钮
    const execBtn = card.querySelector('.wf-plan-exec-btn');
    execBtn.onclick = async function() {
        execBtn.disabled = true;
        execBtn.textContent = '⏳ 执行中...';
        const execStartTime = Date.now();
        const resultEl = card.querySelector('.wf-plan-result');
        resultEl.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:4px">⏳ 工作流执行中...</div>';

        try {
            // 构建工作流数据 — 保留每个员工的原始指令，不覆盖
            const wfNodes = 节点.map((n, i) => {
                return {
                    id: n.id || ('n' + (i + 1)),
                    type: n.type || 'employee',
                    name: n.name || n.员工名 || '?',
                    员工名: n.员工名 || n.name || '',
                    config: n.config || {},
                    disabled: false
                };
            });
            const wfConns = 连接.map(c => ({from: c.from, to: c.to}));

            const resp = await fetch('/api/employee-workflow', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    节点: wfNodes,
                    连接: wfConns,
                    当前文件夹: (typeof currentRoot !== 'undefined' ? currentRoot : '') || ''
                })
            });

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let results = [];
            let allDone = false;

            while (!allDone) {
                const {done, value} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(trimmed.substring(6));
                        if (d.类型 === '节点开始') {
                            resultEl.innerHTML += `<div style="color:var(--orange);font-size:12px;padding:2px">⏳ ${d.name || ''} 执行中...</div>`;
                        } else if (d.类型 === '节点完成') {
                            const ok = d.成功 !== false;
                            const fullOut = (d.输出 || '');
                            const shortOut = fullOut.substring(0, 200);
                            const tokens = d.tokens || {};
                            const tokenStr = (tokens.提示 || tokens.生成) ? ` | 💬${tokens.提示||0}+${tokens.生成||0}tok` : '';
                            results.push({name: d.name, ok, out: fullOut, tokens});
                            resultEl.innerHTML += `<div style="color:${ok ? 'var(--green)' : 'var(--red)'};font-size:12px;padding:2px">${ok ? '✅' : '❌'} ${d.name || ''}: ${escapeHtml(shortOut)}<span style="color:var(--text3);font-size:10px">${tokenStr}</span></div>`;
                        } else if (d.类型 === '完成') {
                            allDone = true;
                        }
                    } catch(e) {}
                }
                resultEl.scrollTop = resultEl.scrollHeight;
            }

            // 汇总结果 + 展示最终输出
            const successCount = results.filter(r => r.ok).length;
            const totalPrompt = results.reduce((s, r) => s + ((r.tokens||{}).提示||0), 0);
            const totalGen = results.reduce((s, r) => s + ((r.tokens||{}).生成||0), 0);
            execBtn.textContent = `✅ 完成 (${successCount}/${results.length})`;
            execBtn.style.background = 'var(--green)';
            resultEl.innerHTML += `<div style="margin-top:6px;padding:6px;border-top:1px solid var(--border);font-size:12px;color:var(--text2)">工作流执行完成，${successCount}/${results.length}个节点成功 | 💬总Token: ${totalPrompt}+${totalGen}=${totalPrompt+totalGen}</div>`;
            // 展示最终节点的完整输出（渲染为Markdown）
            // 优先查找汇总汇报员的输出
            const summaryResult = results.find(r => r.name === '汇总汇报员');
            const lastResult = summaryResult || results[results.length - 1];
            if (lastResult && lastResult.ok && lastResult.out) {
                // 汇总汇报员的输出作为正式助手消息显示在对话区域
                if (summaryResult) {
                    addMsg('assistant', summaryResult.out);
                } else {
                    // 没有汇总节点时，在卡片内展示最后一个节点的输出
                    const reportDiv = document.createElement('div');
                    reportDiv.style.cssText = 'margin-top:8px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;max-height:500px;overflow-y:auto';
                    const reportHeader = document.createElement('div');
                    reportHeader.style.cssText = 'font-size:12px;color:var(--text3);margin-bottom:8px';
                    reportHeader.textContent = `📄 ${lastResult.name} 最终输出：`;
                    reportDiv.appendChild(reportHeader);
                    const reportBody = document.createElement('div');
                    reportBody.className = 'msg-body';
                    reportBody.innerHTML = (typeof renderMsg === 'function') ? renderMsg(lastResult.out) : escapeHtml(lastResult.out);
                    if (typeof bindFolderLinks === 'function') bindFolderLinks(reportBody);
                    reportDiv.appendChild(reportBody);
                    resultEl.appendChild(reportDiv);
                }
            }
            // 执行总结：告诉用户做了什么
            const summaryDiv = document.createElement('div');
            summaryDiv.style.cssText = 'margin-top:8px;padding:10px 12px;background:rgba(78,201,176,0.08);border:1px solid rgba(78,201,176,0.2);border-radius:6px;font-size:13px;line-height:1.6';
            let summaryHtml = '<div style="color:#4EC9B0;font-weight:bold;margin-bottom:6px">📋 执行总结</div>';
            summaryHtml += `<div style="color:var(--text2)">共安排 <b>${results.length}</b> 个员工协作完成：</div>`;
            summaryHtml += '<div style="margin-top:4px">';
            results.forEach(function(r, i) {
                const icon = r.ok ? '✅' : '❌';
                const outShort = (r.out || '').substring(0, 80).replace(/\n/g, ' ');
                summaryHtml += `<div style="margin:2px 0">${icon} <b>${escapeHtml(r.name)}</b>：${escapeHtml(outShort)}${r.out && r.out.length > 80 ? '...' : ''}</div>`;
            });
            summaryHtml += '</div>';
            summaryHtml += `<div style="margin-top:6px;color:var(--text3);font-size:12px">💬 总Token: ${totalPrompt}+${totalGen}=${totalPrompt+totalGen} | 耗时: ${Math.round((Date.now() - execStartTime) / 1000)}秒</div>`;
            summaryDiv.innerHTML = summaryHtml;
            resultEl.appendChild(summaryDiv);
        } catch(e) {
            execBtn.textContent = '❌ 失败，点击重试';
            execBtn.disabled = false;
            execBtn.style.background = 'var(--red)';
            resultEl.innerHTML = `<div style="color:var(--red);font-size:12px">执行失败: ${escapeHtml(e.message)}</div>`;
        }
    };
}
