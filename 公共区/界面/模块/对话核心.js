/**
 * 对话核心 — 思考状态+停止+发送消息
 * 从 逻辑.js 拆分，依赖全局状态+面板布局+语音播报+Toast通知
 */

function setThinkingState(thinking) {
    const input = document.getElementById("userInput");
    const btn = document.getElementById("sendBtn");
    const indicator = document.getElementById("thinkingIndicator");
    if (thinking) {
        input.disabled = true;
        input.placeholder = "AI思考中...";
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>';
        btn.title = "停止生成";
        btn.classList.add("stop");
        if (indicator) indicator.classList.add("show");
        startThinkingAnim();
    } else {
        input.disabled = false;
        input.placeholder = "输入消息... (Enter发送, Shift+Enter换行)";
        btn.disabled = false;
        btn.innerHTML = '➤';
        btn.title = "发送";
        btn.classList.remove("stop");
        if (indicator) indicator.classList.remove("show");
        stopThinkingAnim();
        // 清理生成进度条
        const genBar = document.getElementById("genProgressBar");
        if (genBar) genBar.remove();
        input.focus();
    }
}

// 思考状态：基于真实推理流事件驱动，不再使用随机动画
let _thinkTimer = null;
let _thinkStartTime = 0;

function startThinkingAnim() {
    _thinkStartTime = Date.now();
    stopThinkingAnim();
    _updateThinkingDisplay("等待", "连接AI中...", 0);
    // 轻量计时器：只显示已等待时间，不伪造进度
    _thinkTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _thinkStartTime) / 1000);
        const elNum = document.getElementById("thinkingNum");
        if (elNum) elNum.textContent = elapsed + "s";
        // 进度条做不确定效果：0→30%缓慢爬升，永不到100%
        const pct = Math.min(elapsed * 3, 30);
        const elTrack = document.getElementById("thinkingTrack");
        if (elTrack) elTrack.style.width = pct + "%";
    }, 500);
}

function _updateThinkingDisplay(cat, phrase, progress) {
    const elCat = document.getElementById("thinkingCat");
    const elPhrase = document.getElementById("thinkingPhrase");
    const elNum = document.getElementById("thinkingNum");
    const elTrack = document.getElementById("thinkingTrack");
    if (elCat) elCat.textContent = cat;
    if (elPhrase) elPhrase.textContent = phrase;
    if (elTrack) elTrack.style.width = progress + "%";
}

function stopThinkingAnim() {
    if (_thinkTimer) { clearInterval(_thinkTimer); _thinkTimer = null; }
}

function stopChat() {
    if (chatAbortController) {
        chatAbortController.abort();
        chatAbortController = null;
    }
    stopTTS();
    // 通知后端取消并立即保存对话
    fetch("/api/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    fetch("/api/conversation-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

async function sendMessage() {
    if (isChatting) return;
    const input = document.getElementById("userInput");
    const text = input.value.trim();
    if (!text) return;
    // 停止当前朗读，准备读下一个输出
    stopTTS();
    addMsg("user", text);
    input.value = "";
    isChatting = true;
    setThinkingState(true);
    // 显示推理流容器（SSE模式下推理事件直接推送）
    showReasoningPanel();
    reasoningIndex = 0;
    // 收集上下文
    const 上下文 = {};
    if (activeFileIdx >= 0 && openFiles[activeFileIdx] && openFiles[activeFileIdx].type !== 'document') {
        上下文.当前文件 = {
            路径: openFiles[activeFileIdx].path,
            名称: openFiles[activeFileIdx].name,
            内容: editorInstance ? editorInstance.获取内容() : openFiles[activeFileIdx].content
        };
    }
    if (openFiles.length > 0) {
        上下文.打开的文件列表 = openFiles.map(f => ({ 路径: f.path, 名称: f.name, 已修改: f.dirty }));
    }
    if (currentRoot) 上下文.当前文件夹 = currentRoot;
    if (currentViewFile) 上下文.当前预览文件 = currentViewFile;
    // 框选文件上下文
    if (selectedItems.size > 0) {
        上下文.选中文件 = Array.from(selectedItems.values());
    }
    // 构建工作环境摘要（注入用户消息，模型对用户消息关注度更高）
    let 环境摘要 = "";
    if (currentRoot) 环境摘要 += `📂 工作目录: ${currentRoot}\n`;
    if (currentViewFile) 环境摘要 += `👁️ 正在预览: ${currentViewFile.名称} (${currentViewFile.路径}) [${currentViewFile.类型}]\n`;
    if (openFiles.length > 0) {
        环境摘要 += `📄 打开文件: ${openFiles.map(f => f.name + (f.dirty ? "(已修改)" : "")).join(", ")}\n`;
    }
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]) {
        const f = openFiles[activeFileIdx];
        if (f.type === 'document') 环境摘要 += `📖 当前文档: ${f.name} (${f.path})\n`;
        else 环境摘要 += `✏️ 当前编辑: ${f.name} (${f.path})\n`;
    }
    if (selectedItems.size > 0) {
        环境摘要 += `📋 已选中${selectedItems.size}个文件/文件夹: ${Array.from(selectedItems.values()).map(i => i.名称).join(", ")}\n`;
    }
    // 框选文本上下文
    let 发送消息 = text;
    if (editorSelection && editorSelection.text) {
        const isDocSel = currentViewFile && document.getElementById("docViewer") && document.getElementById("docViewer").style.display !== "none";
        const selPath = isDocSel ? currentViewFile.路径 : (openFiles[activeFileIdx]?.path || "");
        const selName = isDocSel ? currentViewFile.名称 : (openFiles[activeFileIdx]?.name || "");
        上下文.框选文本 = {
            内容: editorSelection.text,
            起始位置: editorSelection.start,
            结束位置: editorSelection.end,
            所在文件: selPath,
            所在文件名: selName
        };
        发送消息 = `[用户在文件「${selName}」中选中了以下文本，要求你对此文本执行操作]\n---\n${editorSelection.text}\n---\n文件路径: ${selPath}\n\n用户指令: ${text}`;
    } else if (环境摘要) {
        // 无框选时，在用户消息前加环境摘要
        发送消息 = `${环境摘要}\n用户: ${text}`;
    }
    try {
        chatAbortController = new AbortController();
        const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 消息: 发送消息, 上下文 }), signal: chatAbortController.signal });

        // SSE流式读取
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let streamEl = null;
        let streamBody = null;
        let streamText = "";
        let hasFileChange = false;
        let docChanges = [];
        let gotComplete = false;
        liveDiffHandled = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });

            const events = sseBuffer.split("\n\n");
            sseBuffer = events.pop();

            for (const event of events) {
                if (!event.startsWith("data: ")) continue;
                let data;
                try { data = JSON.parse(event.slice(6)); } catch(e) { continue; }

                if (data.类型 === "推理流") {
                    for (const rec of data.记录) {
                        // 询问用户：弹出交互式弹窗
                        if (rec.类型 === "询问用户" && rec.内容?.问题列表) {
                            showAskUserDialog(rec.内容.id, rec.内容.问题列表);
                            continue;
                        }
                        // 流式回复token → 直接追加到消息元素，不进推理面板
                        if (rec.类型 === "流式回复" && rec.内容?.内容) {
                            // 收到首个token时更新思考状态
                            if (!streamEl) {
                                _updateThinkingDisplay("生成", "AI回复中...", 60);
                            }
                            if (!streamEl) {
                                streamEl = document.createElement("div");
                                streamEl.className = "msg assistant";
                                streamBody = document.createElement("div");
                                streamBody.className = "msg-body";
                                streamEl.appendChild(streamBody);
                                document.getElementById("msgList").appendChild(streamEl);
                            }
                            streamText += rec.内容.内容;
                            // 增量渲染：预处理+彩色callout样式（与最终渲染一致）
                            streamBody.innerHTML = _streamRender(_preprocessText(streamText)) + '<span class="stream-cursor"></span>';
                            document.getElementById("msgList").scrollTop = document.getElementById("msgList").scrollHeight;
                            continue; // 不进推理面板
                        }

                        // 根据真实事件更新思考状态显示
                        if (rec.类型 === "操作调用" && rec.内容?.操作) {
                            _updateThinkingDisplay("执行", rec.内容.操作, 40);
                        } else if (rec.类型 === "操作结果" && rec.内容?.操作) {
                            _updateThinkingDisplay("观察", "分析结果...", 50);
                        } else if (rec.类型 === "思考") {
                            _updateThinkingDisplay("思考", `第${rec.内容.步数}步推理`, 20);
                        }

                        // 其他推理记录 → 进推理面板
                        reasoningStreamContent.push(rec);
                        appendReasoningRecord(rec);

                        // 实时文件变更检测（仅标记，不立即刷新，完成时统一刷新一次）
                        if (rec.类型 === "操作结果" && rec.内容?.操作 && rec.内容?.成功) {
                            const 文件变更操作 = ["删除文件", "写入文件", "替换文本", "创建文件", "追加文件", "重命名",
                                "多线程下载", "下载网页图片", "ComfyUI一键生图", "ComfyUI获取图片", "ComfyUI图片修改", "ComfyUI视频生成",
                                "替换Word文本", "替换Excel文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档",
                                "运行命令", "压缩文件", "解压文件"];
                            if (文件变更操作.includes(rec.内容.操作)) {
                                hasFileChange = true;
                            }
                        }
                    }
                } else if (data.类型 === "完成") {
                    gotComplete = true;
                    const d = data.结果;
                    if (d.成功) {
                        // 最终Markdown渲染：平滑过渡而非突然替换
                        if (streamEl && streamText) {
                            // 先淡出纯文本
                            streamBody.style.transition = "opacity 0.15s ease";
                            streamBody.style.opacity = "0.5";
                            // 渲染完整Markdown
                            streamBody.innerHTML = renderMsg(d.回复 || streamText);
                            bindFolderLinks(streamBody);
                            addCopyButtons(streamEl);
                            // 淡入Markdown
                            requestAnimationFrame(() => {
                                streamBody.style.opacity = "1";
                            });
                            document.getElementById("msgList").scrollTop = document.getElementById("msgList").scrollHeight;
                            if (voiceEnabled) speakText(d.回复);
                        } else {
                            // 无流式token的回退：直接显示，不再用假打字机
                            addMsg("assistant", d.回复);
                            if (voiceEnabled) speakText(d.回复);
                        }

                        // 处理推理过程中的文件修改操作（从完整结果补充检测）
                        if (d.推理过程?.length > 0 && !hasFileChange) {
                            for (const s of d.推理过程) {
                                if (s.类型 === "操作" && s.成功 && ["写入文件", "替换文本", "删除文件", "追加文件", "创建文件", "替换Word文本", "替换Excel文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档", "多线程下载", "下载网页图片", "ComfyUI一键生图", "ComfyUI获取图片", "ComfyUI图片修改", "ComfyUI视频生成"].includes(s.操作)) {
                                    hasFileChange = true;
                                }
                                if (s.操作 === "替换文本" && s.成功 && s.参数 && !liveDiffHandled) {
                                    applyLiveDiff(s.参数["旧文本"] || "", s.参数["新文本"] || "");
                                }
                                if (s.成功 && s.参数) {
                                    if (s.操作 === "替换Word文本" || s.操作 === "替换Excel文本") {
                                        docChanges.push({操作: s.操作, 旧文本: s.参数["旧文本"] || "", 新文本: s.参数["新文本"] || ""});
                                    } else if (s.操作 === "追加Word段落" || s.操作 === "插入Word段落") {
                                        docChanges.push({操作: s.操作, 旧文本: "", 新文本: s.参数["内容"] || ""});
                                    } else if (s.操作 === "删除Word段落") {
                                        docChanges.push({操作: s.操作, 旧文本: s.结果 || "", 新文本: ""});
                                    }
                                }
                            }
                        }

                        if (hasFileChange) {
                            await refreshAllOpenFiles(true);
                            refreshTree();
                            if (galleryPath) showGallery(galleryPath);
                            if (docChanges.length > 0) highlightDocChanges(docChanges);
                        } else {
                            await refreshAllOpenFiles(false);
                        }
                    } else {
                        if (streamEl) { streamEl.remove(); }
                        addMsg("assistant", `❌ ${d.错误 || "对话失败"}`);
                    }
                }
            }
            if (gotComplete) {
                try { reader.cancel(); } catch(e) {}
                break;
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            addMsg("system", "⏹ 已停止生成");
        } else {
            addMsg("assistant", `❌ 连接错误: ${e.message}`);
        }
    }
    // 停止推理流轮询（SSE模式下不再需要，但保留兼容）
    if (reasoningPollTimer) { clearInterval(reasoningPollTimer); reasoningPollTimer = null; }
    // 对话结束后立即隐藏推理面板（下载进度由独立面板显示）
    hideReasoningPanel();
    isChatting = false;
    chatAbortController = null;
    setThinkingState(false);
    // 刷新对话列表（标题可能已自动更新）
    if (convListOpen) loadConvList();
}

