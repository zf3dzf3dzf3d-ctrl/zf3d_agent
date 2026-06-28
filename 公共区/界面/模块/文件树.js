/**
 * 文件树 — 文件树+目录浏览+新建/删除/重命名
 * 从 逻辑.js 拆分
 */

// ============ 文件树 ============
async function openFolderDialog() {
    document.getElementById("openFolderOverlay").style.display = "flex";
    document.getElementById("openFolderPath").value = "";
    document.getElementById("openFolderPath").focus();
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        const list = document.getElementById("driveList");
        list.innerHTML = "";
        // 智能体根目录快捷按钮
        const agentBtn = document.createElement("button");
        agentBtn.className = "drive-btn";
        agentBtn.style.background = "var(--accent-soft)";
        agentBtn.textContent = "🏠 智能体根目录";
        agentBtn.title = "打开智能体根目录";
        agentBtn.addEventListener("click", () => { document.getElementById("openFolderPath").value = "."; doOpenFolder(); });
        list.appendChild(agentBtn);
        for (const drv of (d.驱动器 || [])) {
            const btn = document.createElement("button");
            btn.className = "drive-btn";
            const icon = drv.图标 || "💾";
            const label = drv.标签 || drv.盘符;
            // 磁盘显示空间信息
            let text = `${icon} ${label}`;
            if (drv.类型 === "磁盘" && drv.总大小GB) {
                text += ` (${drv.可用GB}GB可用/${drv.总大小GB}GB)`;
            }
            btn.textContent = text;
            btn.title = `打开 ${drv.路径}`;
            btn.addEventListener("click", () => { document.getElementById("openFolderPath").value = drv.路径; doOpenFolder(); });
            list.appendChild(btn);
        }
    } catch (e) {}
}
function doOpenFolder() {
    const path = document.getElementById("openFolderPath").value.trim();
    if (!path) return;
    document.getElementById("openFolderOverlay").style.display = "none";
    openFolder(path);
}
async function browseFolder() {
    try {
        showToast("info", "📂 打开文件夹选择器", "请在弹出的对话框中选择文件夹...");
        const res = await fetch("/api/folder-dialog", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.路径) {
            document.getElementById("openFolderPath").value = d.路径;
            doOpenFolder();
        } else {
            showToast("info", "ℹ️ 已取消", "未选择文件夹");
        }
    } catch (e) { showToast("error", "❌ 无法打开对话框", e.message); }
}
function openFolderByPath() { const p = document.getElementById("folderPathInput").value.trim(); if (p) openFolder(p); }

async function openFolder(path) {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    currentRoot = path.replace(/[\/\\]+$/, "");
    // Windows盘符(C:)需要补回反斜杠(C:\)，否则Python解析为"当前目录的C盘"
    if (/^[A-Za-z]:$/.test(currentRoot)) {
        currentRoot = currentRoot + "\\";
    }
    currentRootDisplay = currentRoot === "." ? "项目根目录" : currentRoot;
    if (currentRoot !== ".") localStorage.setItem("lastFolder", currentRoot);
    try {
        const res = await fetch(`/api/file-tree?path=${encodeURIComponent(currentRoot)}&depth=3`);
        const d = await res.json();
        if (d.成功) {
            const tree = document.getElementById("fileTree");
            tree.innerHTML = "";
            // 我的电脑快捷入口（始终置顶）
            const mcItem = document.createElement("div");
            mcItem.className = "ti";
            mcItem.style.borderBottom = "1px solid var(--border)";
            mcItem.innerHTML = `<span class="arr"> </span><span class="ico">💻</span><span class="nm">我的电脑</span>`;
            mcItem.addEventListener("click", e => { e.stopPropagation(); openMyComputer(); });
            tree.appendChild(mcItem);
            const root = d.树;
            root.名称 = root.名称 || currentRootDisplay;
            const rootEl = document.createElement("div");
            const rootItem = document.createElement("div");
            rootItem.className = "ti active";
            rootItem.innerHTML = `<span class="arr">▼</span><span class="ico">📁</span><span class="nm">${root.名称}</span><button class="ren-btn" title="重命名此文件夹">✏️</button><button class="exp-btn" title="在Windows资源管理器中打开此文件夹">🗂️</button><button class="del-btn" title="删除此文件夹及其所有内容">🗑️</button>`;
            rootEl.appendChild(rootItem);
            setupDropTarget(rootItem, currentRoot);
            rootItem.addEventListener("click", e => {
                if (e.target.classList.contains("exp-btn")) { e.stopPropagation(); openInExplorer(currentRoot); return; }
                if (e.target.classList.contains("del-btn")) { e.stopPropagation(); deleteItem(currentRoot, root.名称, true); return; }
                if (e.target.classList.contains("ren-btn")) { e.stopPropagation(); renameItem(currentRoot, root.名称); return; }
                e.stopPropagation();
                showGallery(currentRoot);
            });
            const rootKids = document.createElement("div");
            rootKids.className = "tc open";
            if (root.子项) for (const c of root.子项) rootKids.appendChild(buildTreeNode(c, currentRoot));
            rootEl.appendChild(rootKids);
            tree.appendChild(rootEl);
        } else {
            document.getElementById("fileTree").innerHTML = `<div class="tree-hint">❌ ${d.错误 || "无法打开"}</div>`;
        }
    } catch (e) {
        document.getElementById("fileTree").innerHTML = `<div class="tree-hint">❌ 连接错误</div>`;
    }
}

async function openMyComputer() {
    currentRoot = null;
    galleryPath = null;
    const tree = document.getElementById("fileTree");
    tree.innerHTML = "";
    const mcEl = document.createElement("div");
    const mcItem = document.createElement("div");
    mcItem.className = "ti active";
    mcItem.innerHTML = `<span class="arr">▼</span><span class="ico">💻</span><span class="nm">我的电脑</span>`;
    mcEl.appendChild(mcItem);
    mcItem.addEventListener("click", e => { e.stopPropagation(); openMyComputer(); });
    const mcKids = document.createElement("div");
    mcKids.className = "tc open";
    mcEl.appendChild(mcKids);
    tree.appendChild(mcEl);
    // 画廊显示磁盘列表
    showMediaView();
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "none";
    document.getElementById("galleryHeader").style.display = "flex";
    document.getElementById("galleryCurrentPath").textContent = "我的电脑";
    updateViewToggleButtons();
    const grid = document.getElementById("galleryGrid");
    grid.innerHTML = '<div class="gallery-empty">加载中...</div>';
    document.getElementById("galleryList").style.display = "none";
    grid.style.display = "";
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        const drives = d.驱动器 || [];
        galleryItemsCache = drives.map(drv => ({ 名称: drv.标签 || drv.盘符, 类型: "目录", 后缀: "", 大小: 0, 创建时间: "" }));
        galleryImages = [];
        audioPlaylist = [];
        videoPlaylist = [];
        grid.innerHTML = "";
        mcKids.innerHTML = "";
        // 分组：快捷访问文件夹 vs 磁盘
        const quickAccess = drives.filter(drv => drv.类型 === "文件夹");
        const diskList = drives.filter(drv => drv.类型 === "磁盘");
        // --- 左侧树 ---
        if (quickAccess.length > 0) {
            const gh = document.createElement("div");
            gh.className = "tree-group-header";
            gh.textContent = "快捷访问";
            mcKids.appendChild(gh);
            for (const drv of quickAccess) {
                const label = drv.标签 || drv.盘符;
                const icon = drv.图标 || "📁";
                const ti = document.createElement("div");
                ti.className = "ti";
                ti.innerHTML = `<span class="arr"> </span><span class="ico">${icon}</span><span class="nm">${label}</span>`;
                ti.addEventListener("click", e => { e.stopPropagation(); openFolder(drv.路径); showGallery(drv.路径); });
                mcKids.appendChild(ti);
            }
        }
        if (diskList.length > 0) {
            const gh = document.createElement("div");
            gh.className = "tree-group-header";
            gh.textContent = "磁盘";
            mcKids.appendChild(gh);
            for (const drv of diskList) {
                const label = drv.标签 || drv.盘符;
                const icon = drv.图标 || "💾";
                let spaceInfo = "";
                if (drv.总大小GB) spaceInfo = `${drv.已用GB}GB / ${drv.总大小GB}GB`;
                const ti = document.createElement("div");
                ti.className = "ti";
                const spaceHtml = spaceInfo ? `<span class="ti-space">${spaceInfo}</span>` : "";
                ti.innerHTML = `<span class="arr"> </span><span class="ico">${icon}</span><span class="nm">${label}</span>${spaceHtml}`;
                ti.addEventListener("click", e => { e.stopPropagation(); openFolder(drv.路径); showGallery(drv.路径); });
                mcKids.appendChild(ti);
            }
        }
        // --- 中间画廊 ---
        if (quickAccess.length > 0) {
            const gh = document.createElement("div");
            gh.className = "gallery-group-header";
            gh.textContent = "快捷访问";
            grid.appendChild(gh);
            for (const drv of quickAccess) {
                const label = drv.标签 || drv.盘符;
                const icon = drv.图标 || "📁";
                const item = document.createElement("div");
                item.className = "gallery-item";
                item.title = `打开 ${drv.路径}`;
                item.innerHTML = `<div class="gallery-thumb">${icon}</div><div class="gallery-name">${label}</div>`;
                item.addEventListener("click", () => { openFolder(drv.路径); showGallery(drv.路径); });
                grid.appendChild(item);
            }
        }
        if (diskList.length > 0) {
            const gh = document.createElement("div");
            gh.className = "gallery-group-header";
            gh.textContent = "磁盘";
            grid.appendChild(gh);
            for (const drv of diskList) {
                const label = drv.标签 || drv.盘符;
                const icon = drv.图标 || "💾";
                let spaceInfo = "";
                if (drv.总大小GB) spaceInfo = `${drv.已用GB}GB / ${drv.总大小GB}GB`;
                const item = document.createElement("div");
                item.className = "gallery-item";
                item.title = `打开 ${drv.路径}`;
                const spaceLine = spaceInfo ? `<div class="gallery-name" style="font-size:10px;color:var(--text3);">${spaceInfo}</div>` : "";
                item.innerHTML = `<div class="gallery-thumb">${icon}</div><div class="gallery-name">${label}</div>${spaceLine}`;
                item.addEventListener("click", () => { openFolder(drv.路径); showGallery(drv.路径); });
                grid.appendChild(item);
            }
        }
        if (drives.length === 0) grid.innerHTML = '<div class="gallery-empty">未找到磁盘</div>';
    } catch (e) {
        grid.innerHTML = '<div class="gallery-empty">❌ 无法获取磁盘列表</div>';
    }
}

function buildTreeNode(node, path) {
    const el = document.createElement("div");
    const isDir = node.类型 === "目录";
    if (isDir) {
        const item = document.createElement("div");
        item.className = "ti";
        const hasKids = (node.子项?.length > 0) || node.截断;
        const fullPath = joinPath(path, node.名称);
        const truncated = !!node.截断;
        item.dataset.path = fullPath;
        item.dataset.name = node.名称;
        item.dataset.type = "目录";
        item.innerHTML = `<span class="arr">${hasKids ? "▶" : " "}</span><span class="ico">📁</span><span class="nm">${node.名称}</span><button class="ren-btn" title="重命名此文件夹">✏️</button><button class="exp-btn" title="在Windows资源管理器中打开此文件夹">🗂️</button><button class="del-btn" title="删除此文件夹及其所有内容">🗑️</button>`;
        el.appendChild(item);
        setupDropTarget(item, fullPath);
        setupItemDraggable(item);
        const kids = document.createElement("div");
        kids.className = "tc";
        if (node.子项) for (const c of node.子项) kids.appendChild(buildTreeNode(c, fullPath));
        el.appendChild(kids);
        item.addEventListener("click", e => {
            if (e.target.classList.contains("exp-btn")) { e.stopPropagation(); openInExplorer(fullPath); return; }
            if (e.target.classList.contains("del-btn")) { e.stopPropagation(); deleteItem(fullPath, node.名称, true); return; }
            if (e.target.classList.contains("ren-btn")) { e.stopPropagation(); renameItem(fullPath, node.名称); return; }
            e.stopPropagation();
            showGallery(fullPath);
            // 同步更新currentRoot，确保AI上下文正确
            currentRoot = fullPath;
            // 截断的文件夹需要懒加载子项
            if (truncated && !kids.dataset.loaded) {
                const arr = item.querySelector(".arr");
                if (arr) arr.textContent = "⏳";
                fetch(`/api/file-tree?path=${encodeURIComponent(fullPath)}&depth=1`).then(r => r.json()).then(d => {
                    if (d.成功 && d.树) {
                        kids.innerHTML = "";
                        const 子节点列表 = d.树.子项 || [];
                        for (const c of 子节点列表) kids.appendChild(buildTreeNode(c, fullPath));
                        kids.dataset.loaded = "1";
                    }
                    const open = kids.classList.toggle("open");
                    if (arr) arr.textContent = open ? "▼" : "▶";
                    item.classList.toggle("active", open);
                }).catch(() => {
                    if (arr) arr.textContent = "▶";
                });
                return;
            }
            const open = kids.classList.toggle("open");
            const arr = item.querySelector(".arr");
            if (arr) arr.textContent = open ? "▼" : (hasKids ? "▶" : " ");
            item.classList.toggle("active", open);
        });
        item.addEventListener("dblclick", e => { e.stopPropagation(); openFolder(fullPath); showGallery(fullPath); });
    } else {
        const item = document.createElement("div");
        const fullPath = joinPath(path, node.名称);
        item.className = "ti";
        item.dataset.path = fullPath;
        item.dataset.name = node.名称;
        item.dataset.type = "文件";
        item.innerHTML = `<span class="arr"> </span><span class="ico">${fileIcon(node.后缀 || "")}</span><span class="nm">${node.名称}</span><button class="del-btn" title="删除此文件">🗑️</button>`;
        item.addEventListener("click", e => {
            if (e.target.classList.contains("del-btn")) { e.stopPropagation(); deleteItem(fullPath, node.名称, false); return; }
            e.stopPropagation();
            if (isImage(node.后缀 || "")) { showImage(fullPath, node.名称); return; }
            if (isAudio(node.后缀 || "")) { showAudio(fullPath, node.名称); return; }
            if (isVideo(node.后缀 || "")) { const idx = videoPlaylist.findIndex(v => v.路径 === fullPath); showVideo(fullPath, node.名称, idx); return; }
            if (isDocument(node.后缀 || "")) { showDocument(fullPath, node.名称); return; }
            const ext = (node.后缀 || "").toLowerCase();
            const 可编辑 = [".py",".js",".css",".html",".json",".md",".bat",".sh",".txt",".cs",".java",".ts",".tsx",".jsx",".vue",".go",".rs",".cpp",".h",".yml",".yaml",".toml",".ini",".env",".gitignore"].includes(ext);
            if (!可编辑) { showToast("info", "🔒 不支持的格式", `「${node.名称}」无法在此应用中打开`); return; }
            hideMediaView();
            openFileInEditor(path, node.名称);
        });
        setupItemDraggable(item);
        el.appendChild(item);
    }
    return el;
}

async function deleteItem(path, name, isDir) {
    const typeHint = isDir ? "文件夹（含所有内容）" : "文件";
    if (!confirm(`确定要删除${typeHint}「${name}」吗？\n此操作不可撤销！`)) return;
    try {
        const res = await fetch("/api/file-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path }) });
        const d = await res.json();
        if (d.成功) {
            // 如果删除的文件正在编辑器中打开，关闭对应Tab
            const idx = openFiles.findIndex(f => f.path === path);
            if (idx >= 0) closeTab(idx);
            refreshTree();
            if (galleryPath) showGallery(galleryPath);
        } else {
            alert("删除失败: " + (d.错误 || "未知错误"));
        }
    } catch (e) {
        alert("删除失败: " + e.message);
    }
}

async function renameItem(path, name) {
    const 新名称 = prompt("请输入新名称：", name);
    if (!新名称 || 新名称 === name) return;
    try {
        const res = await fetch("/api/file-rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path, 新名称 }) });
        const d = await res.json();
        if (d.成功) {
            // 更新打开的文件标签路径
            const idx = openFiles.findIndex(f => f.path === path);
            if (idx >= 0) { openFiles[idx].path = joinPath(path.replace(/[\\/][^\\/]+$/, ""), 新名称); openFiles[idx].name = 新名称; renderTabs(); }
            refreshTree();
        } else {
            alert("重命名失败: " + (d.错误 || "未知错误"));
        }
    } catch (e) {
        alert("重命名失败: " + e.message);
    }
}

function fileIcon(ext) {
    const m = {".py":"🐍",".js":"📜",".css":"🎨",".html":"🌐",".json":"📋",".md":"📝",".bat":"⚙️",".sh":"⚙️",".txt":"📄",".cs":"🔵",".java":"☕",".ts":"🔷",".tsx":"⚛️",".jsx":"⚛️",".vue":"💚",".go":"🔹",".rs":"🦀",".cpp":"⚙️",".h":"📄",".yml":"📋",".yaml":"📋",".toml":"📋",".ini":"📋",".env":"🔒",".gitignore":"🚫",".png":"🖼️",".jpg":"🖼️",".jpeg":"🖼️",".gif":"🖼️",".webp":"🖼️",".bmp":"🖼️",".svg":"🖼️",".mp3":"🎵",".wav":"🎵",".ogg":"🎵",".m4a":"🎵",".flac":"🎵",".aac":"🎵",".opus":"🎵",".wma":"🎵",".mp4":"🎬",".webm":"🎬",".mkv":"🎬",".avi":"🎬",".wmv":"🎬",".mov":"🎬",".flv":"🎬",".ts":"🎬",".docx":"📄",".doc":"📄",".xlsx":"📊",".xls":"📊",".csv":"📊",".pdf":"📕"};
    return m[ext] || "📄";
}

const 图片后缀 = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
function isImage(ext) { return 图片后缀.includes(ext.toLowerCase()); }

const 音频后缀 = [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus", ".wma"];
function isAudio(ext) { return 音频后缀.includes(ext.toLowerCase()); }

const 视频后缀 = [".mp4", ".webm", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".ts"];
function isVideo(ext) { return 视频后缀.includes(ext.toLowerCase()); }

const 文档后缀 = [".docx", ".doc", ".xlsx", ".xls", ".csv", ".pdf"];
function isDocument(ext) { return 文档后缀.includes(ext.toLowerCase()); }

function showMediaView() {
    document.getElementById("editorContainer").style.display = "none";
    document.getElementById("editorToolbar").style.display = "none";
    document.getElementById("tabBar").style.display = "none";
    const mv = document.getElementById("mediaView");
    mv.style.display = "flex";
    mv.style.overflowY = "auto";
    mv.style.padding = "0 12px 12px 12px";
}
function hideMediaView() {
    document.getElementById("mediaView").style.display = "none";
    document.getElementById("editorContainer").style.display = "";
    document.getElementById("editorToolbar").style.display = "";
    document.getElementById("tabBar").style.display = "";
    hideAudioPlayer();
    hideVideoPlayer();
    hideDocViewer();
    currentViewFile = null;
}

async function showGallery(folderPath) {
    if (selectedItems.size > 0) clearFileSelection();
    galleryPath = folderPath;
    setupGalleryBackgroundDrop(folderPath);
    galleryPageNum = 0;
    const ep = document.getElementById("editorPanel");
    const eb = document.getElementById("toggleEditor");
    if (ep.classList.contains("hidden")) { ep.classList.remove("hidden"); eb.classList.add("active"); updateDividers(); }
    showMediaView();
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "none";
    document.getElementById("docViewer").style.display = "none";
    document.getElementById("galleryHeader").style.display = "";
    document.getElementById("galleryCurrentPath").textContent = folderPath;
    updateViewToggleButtons();
    const grid = document.getElementById("galleryGrid");
    const list = document.getElementById("galleryList");
    grid.innerHTML = '<div class="gallery-empty">加载中...</div>';
    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(folderPath)}`);
        const d = await res.json();
        if (!d.成功) { grid.innerHTML = `<div class="gallery-empty">❌ ${d.错误 || "无法读取"}</div>`; return; }
        const items = d.内容 || [];
        galleryItemsCache = items;
        galleryImages = items.filter(i => i.类型 === "文件" && isImage(i.后缀 || "")).map(i => ({ 名称: i.名称, 路径: joinPath(folderPath, i.名称) }));
        audioPlaylist = items.filter(i => i.类型 === "文件" && isAudio(i.后缀 || "")).map(i => ({ 名称: i.名称, 路径: joinPath(folderPath, i.名称) }));
        videoPlaylist = items.filter(i => i.类型 === "文件" && isVideo(i.后缀 || "")).map(i => ({ 名称: i.名称, 路径: joinPath(folderPath, i.名称) }));
        if (items.length === 0) {
            grid.innerHTML = '<div class="gallery-empty">📂 此文件夹为空</div>';
            list.innerHTML = '<div class="gallery-empty">📂 此文件夹为空</div>';
            return;
        }
        renderGallery();
    } catch (e) {
        grid.innerHTML = `<div class="gallery-empty">❌ 连接错误</div>`;
    }
}

function renderGallery() {
    if (galleryViewMode === "list") {
        document.getElementById("galleryGrid").style.display = "none";
        document.getElementById("galleryList").style.display = "";
        renderGalleryList();
    } else {
        document.getElementById("galleryGrid").style.display = "";
        document.getElementById("galleryList").style.display = "none";
        renderGalleryGrid();
    }
}

function updateViewToggleButtons() {
    document.getElementById("viewBtnGrid").style.display = galleryViewMode === "list" ? "" : "none";
    document.getElementById("viewBtnList").style.display = galleryViewMode === "grid" ? "" : "none";
    updateSortButtons();
}

function updateSortButtons() {
    document.getElementById("sortBtn").textContent = gallerySortKey;
    document.getElementById("sortOrderBtn").textContent = gallerySortAsc ? "▲" : "▼";
}

function cycleSortKey() {
    const keys = ["名称", "大小", "类型", "创建时间"];
    const i = keys.indexOf(gallerySortKey);
    gallerySortKey = keys[(i + 1) % keys.length];
    gallerySortAsc = true;
    galleryPageNum = 0;
    localStorage.setItem("gallerySortKey", gallerySortKey);
    localStorage.setItem("gallerySortAsc", "true");
    updateSortButtons();
    renderGallery();
}

function toggleSortOrder() {
    gallerySortAsc = !gallerySortAsc;
    galleryPageNum = 0;
    localStorage.setItem("gallerySortAsc", gallerySortAsc ? "true" : "false");
    updateSortButtons();
    renderGallery();
}

function toggleGalleryView(mode) {
    galleryViewMode = mode;
    localStorage.setItem("galleryView", mode);
    updateViewToggleButtons();
    renderGallery();
}

function getSortedItems() {
    const items = [...galleryItemsCache];
    items.sort((a, b) => {
        if (a.类型 !== b.类型) return a.类型 === "目录" ? -1 : 1;
        let va = a[gallerySortKey], vb = b[gallerySortKey];
        if (gallerySortKey === "大小") { va = a.大小; vb = b.大小; }
        if (gallerySortKey === "类型") { va = a.后缀 || ""; vb = b.后缀 || ""; }
        if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase(); }
        if (va < vb) return gallerySortAsc ? -1 : 1;
        if (va > vb) return gallerySortAsc ? 1 : -1;
        return 0;
    });
    return items;
}

function formatSize(bytes) {
    if (!bytes) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(1) + " GB";
}

// === 批量操作选中文件 ===
function getSelectedPaths(itemPath) {
    if (itemPath && selectedItems.has(itemPath)) {
        return [...selectedItems.values()].map(s => s.路径);
    }
    return itemPath ? [itemPath] : [...selectedItems.values()].map(s => s.路径);
}

async function batchDeleteItems(paths) {
    if (!confirm(`确定要删除选中的 ${paths.length} 项吗？\n此操作不可撤销！`)) return;
    let ok = 0, fail = 0;
    for (const p of paths) {
        try {
            const res = await fetch("/api/file-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: p }) });
            const d = await res.json();
            if (d.成功) {
                ok++;
                const idx = openFiles.findIndex(f => f.path === p);
                if (idx >= 0) closeTab(idx);
            } else fail++;
        } catch (e) { fail++; }
    }
    if (fail === 0) showToast("success", "✅ 删除完成", `已删除 ${ok} 项`);
    else showToast("error", "⚠️ 删除完成(部分失败)", `成功${ok} 失败${fail}`);
    clearFileSelection();
    refreshTree();
    if (galleryPath) showGallery(galleryPath);
}

function batchDeleteSelected() {
    if (selectedItems.size === 0) return;
    const paths = [...selectedItems.values()].map(s => s.路径);
    batchDeleteItems(paths);
}

function batchMoveSelected() {
    if (selectedItems.size === 0) return;
    const paths = [...selectedItems.values()].map(s => s.路径);
    showFolderPicker(`移动 ${paths.length} 项到目标文件夹`, t => performMoveOrCopy(paths, t, false));
}

function batchCopySelected() {
    if (selectedItems.size === 0) return;
    const paths = [...selectedItems.values()].map(s => s.路径);
    showFolderPicker(`复制 ${paths.length} 项到目标文件夹`, t => performMoveOrCopy(paths, t, true));
}

// === 文件夹选择弹窗（复制/移动目标）===
let folderPickerCallback = null;

async function showFolderPicker(title, callback) {
    folderPickerCallback = callback;
    document.getElementById("folderPickerTitle").textContent = title;
    document.getElementById("folderPickerOverlay").style.display = "flex";
    const pathInput = document.getElementById("folderPickerPath");
    pathInput.value = galleryPath || "";
    pathInput.focus();
    const list = document.getElementById("folderPickerQuickList");
    list.innerHTML = "";
    // 智能体根目录快捷按钮
    const agentBtn = document.createElement("button");
    agentBtn.className = "drive-btn";
    agentBtn.style.background = "var(--accent-soft)";
    agentBtn.textContent = "🏠 智能体根目录";
    agentBtn.title = "智能体项目根目录";
    agentBtn.addEventListener("click", () => { pathInput.value = "."; });
    list.appendChild(agentBtn);
    // 当前文件夹快捷按钮
    if (galleryPath) {
        const curBtn = document.createElement("button");
        curBtn.className = "drive-btn";
        curBtn.style.background = "var(--accent-soft)";
        curBtn.textContent = "📂 当前文件夹";
        curBtn.title = galleryPath;
        curBtn.addEventListener("click", () => { pathInput.value = galleryPath; });
        list.appendChild(curBtn);
    }
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        for (const drv of (d.驱动器 || [])) {
            const btn = document.createElement("button");
            btn.className = "drive-btn";
            const icon = drv.图标 || "💾";
            const label = drv.标签 || drv.盘符;
            let text = `${icon} ${label}`;
            if (drv.类型 === "磁盘" && drv.总大小GB) {
                text += ` (${drv.可用GB}GB可用/${drv.总大小GB}GB)`;
            }
            btn.textContent = text;
            btn.title = `选择 ${drv.路径}`;
            btn.addEventListener("click", () => { pathInput.value = drv.路径; });
            list.appendChild(btn);
        }
    } catch (e) {}
}

async function browseFolderPicker() {
    try {
        showToast("info", "📂 打开文件夹选择器", "请在弹出的对话框中选择文件夹...");
        const res = await fetch("/api/folder-dialog", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await res.json();
        if (d.路径) document.getElementById("folderPickerPath").value = d.路径;
        else showToast("info", "ℹ️ 已取消", "未选择文件夹");
    } catch (e) { showToast("error", "❌ 无法打开对话框", e.message); }
}

function confirmFolderPicker() {
    const path = document.getElementById("folderPickerPath").value.trim();
    if (!path) return;
    document.getElementById("folderPickerOverlay").style.display = "none";
    if (folderPickerCallback) folderPickerCallback(path);
    folderPickerCallback = null;
}

// === HTML5 拖拽移动/复制 ===
let dragHintEl = null;

function showDragHint(text) {
    if (!dragHintEl) {
        dragHintEl = document.createElement("div");
        dragHintEl.className = "gallery-drag-hint";
        document.body.appendChild(dragHintEl);
    }
    dragHintEl.textContent = text;
    dragHintEl.style.display = "block";
}

function hideDragHint() {
    if (dragHintEl) dragHintEl.style.display = "none";
}

function getDragPaths(item) {
    const path = item.dataset.path;
    if (!path) return [];
    if (selectedItems.has(path)) {
        return [...selectedItems.values()].map(s => s.路径);
    }
    return [path];
}

function setupItemDraggable(item) {
    item.draggable = true;
    // 内部img/video元素会拦截drag，必须禁用
    item.querySelectorAll("img, video").forEach(el => { el.draggable = false; });
    item.addEventListener("dragstart", e => {
        const paths = getDragPaths(item);
        e.dataTransfer.setData("text/plain", JSON.stringify({ paths, shift: e.shiftKey }));
        e.dataTransfer.effectAllowed = "copyMove";
        justDragged = true;
        showDragHint(e.shiftKey ? "📋 Shift拖拽=复制" : "📦 拖拽=移动");
    });
    item.addEventListener("dragend", () => { hideDragHint(); setTimeout(() => { justDragged = false; }, 50); });
}

function setupDropTarget(el, targetPath) {
    el.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.shiftKey ? "copy" : "move";
        el.classList.add("drag-over");
        showDragHint(e.shiftKey ? `📋 复制到 ${el.dataset.name || ""}` : `📦 移动到 ${el.dataset.name || ""}`);
    });
    el.addEventListener("dragleave", () => { el.classList.remove("drag-over"); });
    el.addEventListener("drop", e => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove("drag-over");
        hideDragHint();
        try {
            const data = JSON.parse(e.dataTransfer.getData("text/plain"));
            const isCopy = data.shift || e.shiftKey;
            const paths = data.paths || [];
            performMoveOrCopy(paths, targetPath, isCopy);
        } catch (err) { /* ignore */ }
    });
}

async function performMoveOrCopy(paths, targetDir, isCopy) {
    const op = isCopy ? "复制" : "移动";
    const api = isCopy ? "/api/file-copy" : "/api/file-move";
    let ok = 0, fail = 0;
    for (const p of paths) {
        try {
            const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 源路径: p, 目标目录: targetDir }) });
            const d = await res.json();
            if (d.成功) ok++; else fail++;
        } catch (e) { fail++; }
    }
    if (fail === 0) showToast("success", `✅ ${op}完成`, `${ok}项 → ${targetDir}`);
    else showToast("error", `⚠️ ${op}完成(部分失败)`, `成功${ok} 失败${fail}`);
    refreshTree();
    if (galleryPath) showGallery(galleryPath);
}

// === 画廊背景拖拽（拖到当前文件夹=复制/移动到本文件夹）===
function setupGalleryBackgroundDrop(folderPath) {
    const mv = document.getElementById("mediaView");
    if (!mv) return;
    mv._galleryDropPath = folderPath;
    if (mv._galleryDropWired) return;
    mv._galleryDropWired = true;
    mv.addEventListener("dragover", e => {
        if (e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.shiftKey ? "copy" : "move";
        showDragHint(e.shiftKey ? "📋 Shift拖拽=复制到当前文件夹" : "📦 拖拽=移动到当前文件夹");
    });
    mv.addEventListener("drop", e => {
        if (e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row")) return;
        e.preventDefault();
        hideDragHint();
        try {
            const data = JSON.parse(e.dataTransfer.getData("text/plain"));
            const isCopy = data.shift || e.shiftKey;
            const paths = data.paths || [];
            performMoveOrCopy(paths, mv._galleryDropPath, isCopy);
        } catch (err) { /* ignore */ }
    });
}

function renderGalleryGrid() {
    const grid = document.getElementById("galleryGrid");
    const items = getSortedItems();
    grid.innerHTML = "";
    const visibleCount = (galleryPageNum + 1) * galleryPageSize;
    const pageItems = items.slice(0, visibleCount);
    for (const node of pageItems) {
        if (node.类型 === "目录") {
            const fullPath = joinPath(galleryPath, node.名称);
            const item = document.createElement("div");
            item.className = "gallery-item";
            if (selectedItems.has(fullPath)) item.classList.add("selected");
            item.dataset.path = fullPath;
            item.dataset.name = node.名称;
            item.dataset.type = "目录";
            item.title = `进入文件夹: ${node.名称}`;
            item.innerHTML = `<div class="gallery-thumb">📁</div><div class="gallery-name">${node.名称}</div>`;
            item.addEventListener("click", () => { const p = joinPath(galleryPath, node.名称); openFolder(p); showGallery(p); });
            setupDropTarget(item, fullPath);
            setupItemDraggable(item);
            grid.appendChild(item);
        } else {
            const fullPath = joinPath(galleryPath, node.名称);
            const ext = node.后缀 || "";
            const item = document.createElement("div");
            item.className = "gallery-item";
            if (selectedItems.has(fullPath)) item.classList.add("selected");
            item.dataset.path = fullPath;
            item.dataset.name = node.名称;
            item.dataset.type = "文件";
            if (isImage(ext)) {
                item.title = `查看图片: ${node.名称}`;
                item.innerHTML = `<div class="gallery-thumb"><img src="/api/image?path=${encodeURIComponent(fullPath)}" loading="lazy" /></div><div class="gallery-name">${node.名称}</div>`;
                item.addEventListener("click", () => {
                    const idx = galleryImages.findIndex(g => g.路径 === fullPath);
                    showImage(fullPath, node.名称, idx);
                });
            } else if (isAudio(ext)) {
                item.title = `播放音频: ${node.名称}`;
                item.innerHTML = `<div class="gallery-thumb gallery-thumb-text">🎵</div><div class="gallery-name">${node.名称}</div>`;
                item.addEventListener("click", () => {
                    const idx = audioPlaylist.findIndex(a => a.路径 === fullPath);
                    showAudio(fullPath, node.名称, idx);
                });
            } else if (isVideo(ext)) {
                item.title = `播放视频: ${node.名称}`;
                item.innerHTML = `<div class="gallery-thumb"><video src="/api/video?path=${encodeURIComponent(fullPath)}" preload="metadata" muted playsinline></video><div class="gallery-play-overlay">▶</div></div><div class="gallery-name">${node.名称}</div>`;
                const vEl = item.querySelector('video');
                if (vEl) {
                    vEl.addEventListener('loadedmetadata', () => {
                        vEl.currentTime = Math.min(1, (vEl.duration || 1) * 0.1);
                    });
                    vEl.addEventListener('error', () => {
                        vEl.style.display = 'none';
                        const overlay = item.querySelector('.gallery-play-overlay');
                        if (overlay) overlay.textContent = '🎬';
                    });
                }
                item.addEventListener("click", () => { showVideo(fullPath, node.名称); });
            } else if (isDocument(ext)) {
                item.title = `预览文档: ${node.名称}`;
                const docIcon = ext === ".pdf" ? "📕" : (ext === ".xlsx" || ext === ".xls" || ext === ".csv" ? "📊" : "📄");
                item.innerHTML = `<div class="gallery-thumb gallery-thumb-text">${docIcon}</div><div class="gallery-name">${node.名称}</div>`;
                item.addEventListener("click", () => { showDocument(fullPath, node.名称); });
            } else {
                const icon = fileIcon(ext);
                const 可编辑 = [".py",".js",".css",".html",".json",".md",".bat",".sh",".txt",".cs",".java",".ts",".tsx",".jsx",".vue",".go",".rs",".cpp",".h",".yml",".yaml",".toml",".ini",".env",".gitignore"].includes(ext.toLowerCase());
                if (可编辑) {
                    item.title = `在编辑器中打开: ${node.名称}`;
                    item.innerHTML = `<div class="gallery-thumb gallery-thumb-text">${icon}</div><div class="gallery-name">${node.名称}</div>`;
                    item.addEventListener("click", () => { hideMediaView(); openFileInEditor(galleryPath, node.名称); });
                } else {
                    item.innerHTML = `<div class="gallery-thumb gallery-thumb-locked">🔒</div><div class="gallery-name">${node.名称}</div>`;
                    item.className = "gallery-item gallery-item-locked";
                    if (selectedItems.has(fullPath)) item.classList.add("selected");
                    item.title = "此文件格式不支持打开";
                }
            }
            setupItemDraggable(item);
            grid.appendChild(item);
        }
    }
    if (items.length > visibleCount) {
        const more = document.createElement("div");
        more.className = "gallery-load-more";
        more.innerHTML = `📂 还有 ${items.length - visibleCount} 项，点击加载更多`;
        more.addEventListener("click", () => { galleryPageNum++; renderGalleryGrid(); });
        grid.appendChild(more);
    }
}

function renderGalleryList() {
    const list = document.getElementById("galleryList");
    list.innerHTML = "";
    // 表头
    const header = document.createElement("div");
    header.className = "gallery-list-header";
    const cols = [
        { key: "名称", label: "名称", flex: true },
        { key: "大小", label: "大小", width: "80px" },
        { key: "类型", label: "类型", width: "70px" },
        { key: "创建时间", label: "修改日期", width: "120px" }
    ];
    for (const col of cols) {
        const cell = document.createElement("div");
        if (!col.flex) cell.style.width = col.width;
        else cell.style.flex = "1";
        cell.innerHTML = `${col.label}<span class="glh-sort">${gallerySortKey === col.key ? (gallerySortAsc ? "▲" : "▼") : ""}</span>`;
        cell.addEventListener("click", () => {
            if (gallerySortKey === col.key) gallerySortAsc = !gallerySortAsc;
            else { gallerySortKey = col.key; gallerySortAsc = true; }
            localStorage.setItem("gallerySortKey", gallerySortKey);
            localStorage.setItem("gallerySortAsc", gallerySortAsc ? "true" : "false");
            updateSortButtons();
            renderGalleryList();
        });
        header.appendChild(cell);
    }
    list.appendChild(header);
    // 数据行
    const items = getSortedItems();
    const visibleCount = (galleryPageNum + 1) * galleryPageSize;
    const pageItems = items.slice(0, visibleCount);
    for (const node of pageItems) {
        const row = document.createElement("div");
        row.className = "gallery-list-row";
        const isDir = node.类型 === "目录";
        const fullPath = joinPath(galleryPath, node.名称);
        const icon = isDir ? "📁" : fileIcon(node.后缀 || "");
        const isSelected = selectedItems.has(fullPath);
        if (isSelected) row.classList.add("selected");
        row.dataset.path = fullPath;
        row.dataset.name = node.名称;
        row.dataset.type = node.类型;
        const checkIcon = isSelected ? "☑" : "☐";
        row.innerHTML = `<span class="glr-check">${checkIcon}</span><span class="glr-icon">${icon}</span><span class="glr-name">${node.名称}</span><span class="glr-size">${isDir ? "-" : formatSize(node.大小)}</span><span class="glr-type">${isDir ? "文件夹" : (node.后缀 || "")}</span><span class="glr-date">${node.创建时间 || "-"}</span>`;
        row.addEventListener("click", () => {
            if (isDir) { const p = joinPath(galleryPath, node.名称); openFolder(p); showGallery(p); return; }
            const ext = node.后缀 || "";
            if (isImage(ext)) { const idx = galleryImages.findIndex(g => g.路径 === fullPath); showImage(fullPath, node.名称, idx); return; }
            if (isAudio(ext)) { const idx = audioPlaylist.findIndex(a => a.路径 === fullPath); showAudio(fullPath, node.名称, idx); return; }
            if (isVideo(ext)) { const idx = videoPlaylist.findIndex(v => v.路径 === fullPath); showVideo(fullPath, node.名称, idx); return; }
            if (isDocument(ext)) { showDocument(fullPath, node.名称); return; }
            const 可编辑 = [".py",".js",".css",".html",".json",".md",".bat",".sh",".txt",".cs",".java",".ts",".tsx",".jsx",".vue",".go",".rs",".cpp",".h",".yml",".yaml",".toml",".ini",".env",".gitignore"].includes(ext.toLowerCase());
            if (可编辑) { hideMediaView(); openFileInEditor(galleryPath, node.名称); }
            else { showToast("info", "🔒 不支持的格式", `「${node.名称}」无法在此应用中打开`); }
        });
        setupItemDraggable(row);
        if (isDir) setupDropTarget(row, fullPath);
        list.appendChild(row);
    }
    if (items.length > visibleCount) {
        const more = document.createElement("div");
        more.className = "gallery-load-more";
        more.innerHTML = `📂 还有 ${items.length - visibleCount} 项，点击加载更多`;
        more.addEventListener("click", () => { galleryPageNum++; renderGalleryList(); });
        list.appendChild(more);
    }
}

function showImage(fullPath, name, idx) {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    currentViewFile = { 路径: fullPath, 名称: name, 类型: "图片" };
    showMediaView();
    const mv = document.getElementById("mediaView");
    mv.style.overflowY = "hidden";
    mv.style.padding = "0";
    document.getElementById("galleryGrid").style.display = "none";
    document.getElementById("galleryList").style.display = "none";
    document.getElementById("galleryHeader").style.display = "none";
    const viewer = document.getElementById("imageViewer");
    viewer.style.display = "flex";
    imageTransforms = {};
    currentImageIdx = idx >= 0 ? idx : galleryImages.findIndex(g => g.路径 === fullPath);
    const img = document.getElementById("imageViewerImg");
    const back = document.getElementById("imageViewerImgBack");
    img.onload = null;
    img.style.transition = "none";
    img.style.opacity = "1";
    back.style.opacity = "0";
    back.src = "";
    img.src = `/api/image?path=${encodeURIComponent(fullPath)}`;
    img.alt = name;
    restoreTransform(currentImageIdx);
    updateImageCounter();
}

function updateImageCounter() {
    const counter = document.getElementById("imageCounter");
    const prevBtn = document.getElementById("imgNavPrev");
    const nextBtn = document.getElementById("imgNavNext");
    if (galleryImages.length > 0 && currentImageIdx >= 0) {
        counter.textContent = `${currentImageIdx + 1} / ${galleryImages.length}`;
        prevBtn.style.display = galleryImages.length > 1 ? "" : "none";
        nextBtn.style.display = galleryImages.length > 1 ? "" : "none";
    } else {
        counter.textContent = "";
        prevBtn.style.display = "none";
        nextBtn.style.display = "none";
    }
}

function resetImageTransform() {
    const img = document.getElementById("imageViewerImg");
    img.dataset.x = "0"; img.dataset.y = "0"; img.dataset.scale = "1";
    if (window._updateImgTransform) window._updateImgTransform();
    else img.style.transform = "translate(0px,0px) scale(1)";
}

let imageTransforms = {};

function saveCurrentTransform() {
    if (currentImageIdx >= 0) {
        const img = document.getElementById("imageViewerImg");
        imageTransforms[currentImageIdx] = {
            x: img.dataset.x || "0",
            y: img.dataset.y || "0",
            scale: img.dataset.scale || "1"
        };
    }
}

function restoreTransform(idx) {
    const img = document.getElementById("imageViewerImg");
    const t = imageTransforms[idx] || { x: "0", y: "0", scale: "1" };
    img.dataset.x = t.x; img.dataset.y = t.y; img.dataset.scale = t.scale;
    if (window._updateImgTransform) window._updateImgTransform();
    else img.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.scale})`;
}

function fadeToImage(newIdx) {
    const img = document.getElementById("imageViewerImg");
    const fading = !!slideshowTimer;
    const fadeTime = fading ? 500 : 100;
    img.style.transition = `opacity ${fading ? 0.5 : 0.1}s ease`;
    img.style.opacity = "0";
    setTimeout(() => {
        currentImageIdx = newIdx;
        const g = galleryImages[currentImageIdx];
        img.onload = () => {
            restoreTransform(currentImageIdx);
            updateImageCounter();
            requestAnimationFrame(() => { img.style.opacity = "1"; });
        };
        img.src = `/api/image?path=${encodeURIComponent(g.路径)}`;
        img.alt = g.名称;
    }, fadeTime);
}

function prevImage() {
    if (galleryImages.length === 0) return;
    saveCurrentTransform();
    fadeToImage((currentImageIdx - 1 + galleryImages.length) % galleryImages.length);
    resetSlideshowTimer();
}

function nextImage() {
    if (galleryImages.length === 0) return;
    saveCurrentTransform();
    fadeToImage((currentImageIdx + 1) % galleryImages.length);
    resetSlideshowTimer();
}

function toggleSlideshow() {
    const btn = document.getElementById("slideshowBtn");
    if (slideshowTimer) {
        stopSlideshow();
    } else {
        if (galleryImages.length < 2) return;
        btn.classList.add("active");
        btn.textContent = "⏸️ 停止";
        const slider = document.getElementById("slideshowSpeedSlider");
        slideshowInterval = parseFloat(slider.value) * 1000;
        slideshowTimer = setInterval(() => { nextImage(); }, slideshowInterval);
    }
}

function initSlideshowSpeed() {
    const slider = document.getElementById("slideshowSpeedSlider");
    const display = document.getElementById("slideshowSpeedValue");
    slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        display.textContent = val.toFixed(1) + "s";
        slideshowInterval = val * 1000;
        if (slideshowTimer) {
            clearInterval(slideshowTimer);
            slideshowTimer = setInterval(() => { nextImage(); }, slideshowInterval);
        }
    });
}

function stopSlideshow() {
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
        const btn = document.getElementById("slideshowBtn");
        if (btn) { btn.classList.remove("active"); btn.textContent = "▶️ 幻灯片"; }
    }
}

function resetSlideshowTimer() {
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = setInterval(() => { nextImage(); }, slideshowInterval);
    }
}

function backToGallery() {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    // 文档标签页：关闭当前标签
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') {
        closeTab(activeFileIdx);
        return;
    }
    hideDocViewer();
    currentViewFile = null;
    if (galleryPath) showGallery(galleryPath);
}

