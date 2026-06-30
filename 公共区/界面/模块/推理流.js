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
        panel.innerHTML = '<div class="reasoning-header">⚡ AI推理过程</div><div class="reasoning-body" id="reasoningBody"></div>';
        chatMsg.parentNode.insertBefore(panel, chatMsg.nextSibling);
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
    switch (rec.类型) {
        case "开始":
            div.className += " rc-start";
            div.innerHTML = `<div class="rc-icon">💬</div><div class="rc-content"><span class="rc-label">开始</span> ${escapeHtml(rec.内容.消息 || "")}</div>`; break;
        case "思考":
            div.className += " rc-thinking";
            div.innerHTML = `<div class="rc-icon">🤔</div><div class="rc-content"><span class="rc-label">步骤 ${rec.内容.步数}</span> 思考中...</div>`; break;
        case "操作调用":
            div.className += " rc-action";
            const p = Object.entries(rec.内容.参数||{}).map(([k,v])=>`<span class="rc-param">${escapeHtml(k)}=<span class="rc-val">${escapeHtml(String(v).substring(0,40))}</span></span>`).join(" ");
            div.innerHTML = `<div class="rc-icon">🔧</div><div class="rc-content"><span class="rc-label rc-op-name">${escapeHtml(rec.内容.操作)}</span><div class="rc-params">${p}</div></div>`;
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
            div.innerHTML = `<div class="rc-icon">${rec.内容.成功 ? "✅" : "❌"}</div><div class="rc-content">${resultText}</div>`;
            break;
        case "下载进度": {
            const p = rec.内容;
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
            div.innerHTML = `<div class="rc-icon">💬</div><div class="rc-content">${escapeHtml((rec.内容.内容||"").substring(0,300))}</div>`; break;
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
        default:
            div.innerHTML = `<div class="rc-icon">•</div><div class="rc-content">${escapeHtml(rec.类型)}: ${escapeHtml(JSON.stringify(rec.内容).substring(0,100))}</div>`;
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

