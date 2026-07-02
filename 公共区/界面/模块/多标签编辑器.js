/**
 * 多标签编辑器 — 多Tab编辑器+编辑器初始化
 * 从 逻辑.js 拆分
 */

// ============ 多Tab编辑器 ============
function renderTabs() {
    const bar = document.getElementById("tabBar");
    bar.innerHTML = "";
    openFiles.forEach((f, i) => {
        const tab = document.createElement("div");
        tab.className = `tab${i === activeFileIdx ? " active" : ""}`;
        const icon = f.type === 'document' ? '📄 ' : '';
        const dirtyDot = f.dirty ? "● " : "";
        // AI修改回滚按钮：有AI修改且当前内容与AI修改前不同时显示
        const rollbackBtn = (f.aiModified && f.原始内容 && editorInstance && f.content !== f.原始内容)
            ? `<span class="tab-rollback" data-idx="${i}" title="撤销AI的修改，恢复到修改前">↶</span>` : "";
        tab.innerHTML = `<span class="tab-name">${dirtyDot}${icon}${f.name}</span>${rollbackBtn}<span class="close" data-idx="${i}" title="关闭此文件标签">✕</span>`;
        tab.addEventListener("click", (e) => {
            if (e.target.classList.contains("close")) { closeTab(parseInt(e.target.dataset.idx)); return; }
            if (e.target.classList.contains("tab-rollback")) { rollbackAIChange(parseInt(e.target.dataset.idx)); return; }
            switchTab(i);
        });
        bar.appendChild(tab);
    });
    if (openFiles.length === 0) bar.innerHTML = '';
    // 滚动到当前激活的tab
    if (activeFileIdx >= 0) {
        const activeTab = bar.children[activeFileIdx];
        if (activeTab) activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
}

function updateToolbarForTab() {
    const isDoc = activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document';
    const btns = document.querySelectorAll('#editorToolbar .toolbar-btn');
    btns.forEach(btn => {
        const isRefresh = btn.getAttribute('onclick')?.includes('reloadCurrentFile');
        btn.disabled = isDoc && !isRefresh;
    });
}

function switchTab(idx, skipSave) {
    // 保存当前标签页状态
    if (!skipSave && activeFileIdx >= 0 && openFiles[activeFileIdx]) {
        const cur = openFiles[activeFileIdx];
        if (cur.type !== 'document' && editorInstance) cur.content = editorInstance.获取内容();
        if (cur.type === 'document') {
            const el = document.getElementById("docContent");
            cur.docNodes = Array.from(el.childNodes);
            while (el.firstChild) el.removeChild(el.firstChild);
        }
        cur.selection = editorSelection || null;
    }
    activeFileIdx = idx;
    if (idx >= 0 && idx < openFiles.length) {
        const f = openFiles[idx];
        if (f.type === 'document') {
            // 文档标签页：显示docViewer+工具栏，保留tabBar
            document.getElementById("editorContainer").style.display = "none";
            document.getElementById("editorToolbar").style.display = "";
            document.getElementById("tabBar").style.display = "";
            const mv = document.getElementById("mediaView");
            mv.style.display = "flex";
            mv.style.overflowY = "hidden";
            mv.style.padding = "0";
            document.getElementById("galleryGrid").style.display = "none";
            document.getElementById("galleryList").style.display = "none";
            document.getElementById("galleryHeader").style.display = "none";
            document.getElementById("imageViewer").style.display = "none";
            document.getElementById("audioPlayer").style.display = "none";
            document.getElementById("videoPlayer").style.display = "none";
            document.getElementById("docViewer").style.display = "flex";
            document.getElementById("docFileName").textContent = f.name;
            const contentEl = document.getElementById("docContent");
            while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
            if (f.docNodes) f.docNodes.forEach(n => contentEl.appendChild(n));
            currentViewFile = { 路径: f.path, 名称: f.name, 类型: "文档" };
            const pathEl = document.getElementById("editorFilePath");
            if (pathEl) pathEl.textContent = f.path;
            updateToolbarForTab();
        } else {
            // 代码标签页：显示编辑器
            hideMediaView();
            if (editorInstance) {
                editorInstance.设置内容(f.content);
                const ext = (f.name.split(".").pop() || "").toLowerCase();
                const langMap = { json: "json", py: "python", js: "javascript", ts: "javascript", cs: "javascript", css: "json", html: "json", md: "json", txt: "json", bat: "json" };
                editorInstance.设置语言(langMap[ext] || "json");
            }
            const pathEl = document.getElementById("editorFilePath");
            if (pathEl) pathEl.textContent = f.path;
            updateToolbarForTab();
        }
        // 恢复该标签页的框选
        if (f.selection) {
            editorSelection = f.selection;
            showSelectionHint(f.selection.text);
            if (f.type !== 'document' && editorInstance) editorInstance.设置选区高亮(f.selection.start, f.selection.end);
        } else {
            editorSelection = null;
            hideSelectionHint();
            if (f.type !== 'document' && editorInstance) editorInstance.清除选区高亮();
        }
    }
    renderTabs();
}

function closeTab(idx) {
    const wasActive = (idx === activeFileIdx);
    openFiles.splice(idx, 1);
    if (wasActive) {
        if (activeFileIdx >= openFiles.length) activeFileIdx = openFiles.length - 1;
        if (activeFileIdx >= 0) switchTab(activeFileIdx, true);
        else { if (editorInstance) editorInstance.设置内容(""); activeFileIdx = -1; showGallery(galleryPath || currentRoot || "./"); }
    } else if (idx < activeFileIdx) {
        activeFileIdx--;
    }
    renderTabs();
}

async function saveEditorContent() {
    if (activeFileIdx < 0) return;
    const f = openFiles[activeFileIdx];
    if (f.type === 'document') return;
    f.content = editorInstance.获取内容();
    await fetch("/api/file-write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: f.path, 内容: f.content }) });
    f.dirty = false;
    f.原始内容 = f.content;  // 保存后重置变更基线
    updateChangeBadge();
    renderTabs();
}

function editorUndo2() {} // 已移至上方自定义实现
function editorRedo2() {} // 已移至上方自定义实现

// ============ AI修改回滚 ============
function rollbackAIChange(idx) {
    const f = openFiles[idx];
    if (!f || !f.原始内容) return;
    if (editorInstance && idx === activeFileIdx) {
        editorInstance.设置内容(f.原始内容);
    }
    f.content = f.原始内容;
    f.dirty = false;
    f.aiModified = false;
    if (typeof updateChangeBadge === 'function') updateChangeBadge();
    renderTabs();
    showToast("success", "↶ 已回滚", `${f.name} 已恢复到AI修改前的内容`);
}

// 标记文件被AI修改（供实时Diff调用）
function markAIModified(idx) {
    if (idx >= 0 && idx < openFiles.length) {
        openFiles[idx].aiModified = true;
        renderTabs();
    }
}

// ============ 变更统计徽章 ============
function updateChangeBadge() {
    const badge = document.getElementById("editorChangeBadge");
    if (!badge) return;
    if (activeFileIdx < 0 || !openFiles[activeFileIdx]) {
        badge.style.display = "none";
        return;
    }
    const f = openFiles[activeFileIdx];
    if (f.type === 'document' || !f.原始内容) {
        badge.style.display = "none";
        return;
    }
    const 当前内容 = editorInstance ? editorInstance.获取内容() : f.content;
    if (当前内容 === f.原始内容) {
        badge.style.display = "none";
        f.dirty = false;
        return;
    }
    // 计算行级增删
    const 旧行 = f.原始内容.split("\n");
    const 新行 = 当前内容.split("\n");
    const 旧集 = new Set(旧行);
    const 新集 = new Set(新行);
    let add数 = 0, del数 = 0;
    for (const line of 新行) { if (!旧集.has(line)) add数++; }
    for (const line of 旧行) { if (!新集.has(line)) del数++; }
    if (add数 === 0 && del数 === 0) {
        badge.style.display = "none";
        return;
    }
    let html = "";
    if (add数 > 0) html += `<span class="cb-add">+${add数}</span>`;
    if (del数 > 0) html += `<span class="cb-del">-${del数}</span>`;
    badge.innerHTML = html;
    badge.style.display = "";
}

async function reloadCurrentFile() {
    if (activeFileIdx < 0) return;
    const f = openFiles[activeFileIdx];
    if (f.type === 'document') {
        await renderDocumentContent(activeFileIdx);
        showToast("info", "🔄 已刷新", `${f.name} 已重新读取`);
        return;
    }
    await refreshAllOpenFiles();
    // 刷新后重置变更基线
    if (openFiles[activeFileIdx]) {
        openFiles[activeFileIdx].原始内容 = openFiles[activeFileIdx].content;
        updateChangeBadge();
    }
    showToast("info", "🔄 已刷新", `${openFiles[activeFileIdx]?.name || ""} 已重新读取`);
}

// ============ 编辑器初始化 ============
function initEditor() {
    const container = document.getElementById("editorContainer");
    const textarea = document.getElementById("codeInput");
    const preview = document.getElementById("codePreview");
    const lineNums = document.getElementById("lineNumbers");
    if (container && textarea && preview && lineNums) {
        editorInstance = new 编辑器引擎(container, textarea, preview, lineNums);
        textarea.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveEditorContent(); }
            setTimeout(() => {
                if (activeFileIdx >= 0 && openFiles[activeFileIdx]) {
                    openFiles[activeFileIdx].dirty = true;
                    updateChangeBadge();
                    renderTabs();
                }
            }, 50);
        });
        textarea.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
        textarea.addEventListener("keyup", () => setTimeout(captureSelection, 0));
    }
    // 文档预览器框选追踪
    const docContent = document.getElementById("docContent");
    if (docContent) {
        docContent.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
        docContent.addEventListener("keyup", () => setTimeout(captureSelection, 0));
    }
    // Tab栏鼠标滚轮横向滚动
    const tabBar = document.getElementById("tabBar");
    if (tabBar) {
        tabBar.addEventListener("wheel", (e) => {
            if (tabBar.scrollWidth > tabBar.clientWidth) {
                e.preventDefault();
                tabBar.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }
}

