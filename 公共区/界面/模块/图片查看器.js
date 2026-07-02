/**
 * 图片查看器 — 视频缩放/平移+图片查看器交互
 * 从 逻辑.js 拆分
 */

// ============ 视频缩放/平移交互 ============
(function() {
    const stage = document.getElementById("videoStage");
    const video = document.getElementById("videoElement");

    function updateVideoTransform() {
        const x = parseFloat(video.dataset.x || 0);
        const y = parseFloat(video.dataset.y || 0);
        const s = parseFloat(video.dataset.scale || 1);
        video.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    }

    stage.addEventListener("wheel", (e) => {
        if (document.getElementById("videoPlayer").style.display === "none") return;
        e.preventDefault();
        const rect = video.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const oldScale = parseFloat(video.dataset.scale || 1);
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newScale = Math.max(0.1, Math.min(20, oldScale * delta));
        const ratio = newScale / oldScale;
        const oldX = parseFloat(video.dataset.x || 0);
        const oldY = parseFloat(video.dataset.y || 0);
        video.dataset.x = oldX - (cx * ratio - cx);
        video.dataset.y = oldY - (cy * ratio - cy);
        video.dataset.scale = newScale;
        updateVideoTransform();
    }, { passive: false });

    let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    let lastMidClick = 0;
    stage.addEventListener("mousedown", (e) => {
        if (document.getElementById("videoPlayer").style.display === "none") return;
        if (e.button === 1) {
            e.preventDefault();
            const now = Date.now();
            if (now - lastMidClick < 300) {
                lastMidClick = 0;
                panning = false;
                video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
                updateVideoTransform();
                return;
            }
            lastMidClick = now;
            panning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            panOrigX = parseFloat(video.dataset.x || 0);
            panOrigY = parseFloat(video.dataset.y || 0);
        }
    });
    document.addEventListener("mousemove", (e) => {
        if (!panning) return;
        video.dataset.x = panOrigX + (e.clientX - panStartX);
        video.dataset.y = panOrigY + (e.clientY - panStartY);
        updateVideoTransform();
    });
    document.addEventListener("mouseup", (e) => {
        if (e.button === 1) panning = false;
    });
    stage.addEventListener("dblclick", (e) => {
        if (document.getElementById("videoPlayer").style.display === "none") return;
        video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
        updateVideoTransform();
    });
})();

// ============ 图片查看器交互 ============
(function() {
    const viewer = document.getElementById("imageViewer");
    const stage = document.getElementById("imageViewerStage");
    const img = document.getElementById("imageViewerImg");

    function updateTransform() {
        const x = parseFloat(img.dataset.x || 0);
        const y = parseFloat(img.dataset.y || 0);
        const s = parseFloat(img.dataset.scale || 1);
        img.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    }
    window._updateImgTransform = updateTransform;

    stage.addEventListener("wheel", (e) => {
        if (viewer.style.display === "none") return;
        e.preventDefault();
        const rect = img.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const oldScale = parseFloat(img.dataset.scale || 1);
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newScale = Math.max(0.1, Math.min(20, oldScale * delta));
        const ratio = newScale / oldScale;
        const oldX = parseFloat(img.dataset.x || 0);
        const oldY = parseFloat(img.dataset.y || 0);
        img.dataset.x = oldX - (cx * ratio - cx);
        img.dataset.y = oldY - (cy * ratio - cy);
        img.dataset.scale = newScale;
        updateTransform();
        saveCurrentTransform();
    }, { passive: false });

    let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    let lastRClick = 0;
    viewer.addEventListener("mousedown", (e) => {
        if (viewer.style.display === "none") return;
        if (e.target.tagName === "BUTTON") return;
        if (e.button === 1) {
            e.preventDefault();
            panning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            panOrigX = parseFloat(img.dataset.x || 0);
            panOrigY = parseFloat(img.dataset.y || 0);
        } else if (e.button === 0) {
            prevImage();
        } else if (e.button === 2) {
            const now = Date.now();
            if (now - lastRClick < 300) { lastRClick = 0; backToGallery(); }
            else { lastRClick = now; nextImage(); }
        }
    });
    viewer.addEventListener("contextmenu", (e) => {
        if (viewer.style.display !== "none") e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
        if (!panning) return;
        img.dataset.x = panOrigX + (e.clientX - panStartX);
        img.dataset.y = panOrigY + (e.clientY - panStartY);
        updateTransform();
        saveCurrentTransform();
    });
    document.addEventListener("mouseup", (e) => {
        if (e.button === 1) panning = false;
    });
    stage.addEventListener("dblclick", (e) => {
        if (viewer.style.display === "none") return;
        img.dataset.x = 0; img.dataset.y = 0; img.dataset.scale = 1;
        updateTransform();
        saveCurrentTransform();
    });
    // 键盘左右切换
    document.addEventListener("keydown", (e) => {
        if (viewer.style.display === "none") return;
        if (e.key === "ArrowLeft") prevImage();
        else if (e.key === "ArrowRight") nextImage();
        else if (e.key === "Escape") { stopSlideshow(); backToGallery(); }
    });
})();

// 双击右键返回画廊（音频/视频播放器）
(function() {
    let lastRClick = 0;
    ["audioPlayer", "videoPlayer"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("contextmenu", (e) => { e.preventDefault(); });
        el.addEventListener("mousedown", (e) => {
            if (e.button !== 2) return;
            if (el.style.display === "none") return;
            const now = Date.now();
            if (now - lastRClick < 300) { lastRClick = 0; backToGallery(); }
            else { lastRClick = now; }
        });
    });
})();

// 禁用 mediaView 内所有区域的浏览器右键菜单（统一拦截，防止遗漏子元素）
document.getElementById("mediaView").addEventListener("contextmenu", (e) => e.preventDefault());
// 文件树也禁用
document.getElementById("fileTree").addEventListener("contextmenu", (e) => e.preventDefault());

function goUpFolder() {
    if (!currentRoot) return;
    // 如果已经是盘符根目录（如 C:\ D:\ E:\），往上进入"此电脑"视图
    const 盘符匹配 = currentRoot.match(/^([A-Za-z]):[\/\\]?$/);
    if (盘符匹配) {
        // 切换到"此电脑"驱动器列表
        loadDriveList();
        return;
    }
    const parent = currentRoot.replace(/[\/\\]+$/, "").replace(/[\/\\][^\/\\]+$/, "");
    if (parent && parent !== currentRoot) {
        // 如果上级变成了盘符根目录（如 C:\），也允许进入
        openFolder(parent);
        showGallery(parent);
    }
}

function goUpGallery() {
    if (!galleryPath) return;
    // 如果已经是盘符根目录，往上进入"此电脑"视图
    const 盘符匹配 = galleryPath.match(/^([A-Za-z]):[\/\\]?$/);
    if (盘符匹配) {
        loadDriveList();
        return;
    }
    const parent = galleryPath.replace(/[\/\\]+$/, "").replace(/[\/\\][^\/\\]+$/, "");
    if (parent && parent !== galleryPath) {
        openFolder(parent);
        showGallery(parent);
    }
}

// 加载驱动器列表（"此电脑"视图）
async function loadDriveList() {
    const tree = document.getElementById("fileTree");
    tree.innerHTML = '<div class="tree-loading">加载驱动器...</div>';
    try {
        const res = await fetch("/api/drives");
        const d = await res.json();
        if (d.成功 && d.驱动器列表) {
            currentRoot = null;
            tree.innerHTML = "";
            const header = document.createElement("div");
            header.className = "ti active";
            header.innerHTML = '<span class="arr">▼</span><span class="ico">💻</span><span class="nm">此电脑</span>';
            tree.appendChild(header);
            const kidsWrap = document.createElement("div");
            kidsWrap.className = "tc open";
            tree.appendChild(kidsWrap);
            // 优先使用统一格式(含完整路径)，回退到驱动器列表
            const drives = (d.驱动器 && d.驱动器.length > 0) ? d.驱动器 : d.驱动器列表.map(drv => ({盘符: drv.盘符, 路径: drv.盘符 + ":\\", 类型: drv.类型, 可用空间: drv.可用空间}));
            for (const drv of drives) {
                const item = document.createElement("div");
                item.className = "ti";
                const 盘符名 = drv.盘符 || drv.标签 || '';
                item.innerHTML = `<span class="arr"> </span><span class="ico">💽</span><span class="nm">${escapeHtml(盘符名)}: ${escapeHtml(drv.类型 || '')} ${drv.可用空间 ? '(' + drv.可用空间 + ')' : ''}</span>`;
                item.addEventListener("click", (e) => { e.stopPropagation(); openFolder(drv.路径 || (盘符名 + ":\\")); });
                kidsWrap.appendChild(item);
            }
        } else {
            tree.innerHTML = '<div class="tree-empty">无法获取驱动器列表</div>';
        }
    } catch (e) {
        tree.innerHTML = '<div class="tree-empty">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
}

function refreshTree() {
    if (currentRoot) openFolder(currentRoot);
    if (galleryPath) showGallery(galleryPath);
}

async function openInExplorer(path) {
    try {
        const res = await fetch("/api/open-in-explorer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path }) });
        const d = await res.json();
        if (!d.成功) showToast("error", "❌ 无法打开", d.错误 || "未知错误");
    } catch (e) { showToast("error", "❌ 无法打开", e.message); }
}

async function newItem(type) {
    if (!currentRoot) { alert("请先打开一个文件夹"); return; }
    if (type === "folder") {
        const name = prompt("文件夹名:");
        if (!name) return;
        const res = await fetch("/api/file-mkdir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: joinPath(currentRoot, name) }) });
        const d = await res.json();
        if (d.成功) refreshTree(); else alert(d.错误 || "创建失败");
        return;
    }
    document.getElementById("newFileOverlay").style.display = "flex";
    document.getElementById("newFileName").value = "";
    document.getElementById("newFileName").focus();
}
function closeNewFile() { document.getElementById("newFileOverlay").style.display = "none"; }
async function doNewFile() {
    const name = document.getElementById("newFileName").value.trim();
    const ext = document.getElementById("newFileType").value;
    if (!name) return;
    const fullName = name.includes(".") ? name : name + ext;
    const fullPath = joinPath(currentRoot, fullName);
    document.getElementById("newFileOverlay").style.display = "none";
    const res = await fetch("/api/file-create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: fullPath }) });
    const d = await res.json();
    if (d.成功) { refreshTree(); openFileInEditor(currentRoot, fullName); }
    else alert(d.错误 || "创建失败");
}

async function openFileInEditor(path, name) {
    const ep = document.getElementById("editorPanel");
    const eb = document.getElementById("toggleEditor");
    if (ep.classList.contains("hidden")) { ep.classList.remove("hidden"); eb.classList.add("active"); updateDividers(); }
    const fullPath = joinPath(path, name);
    const existIdx = openFiles.findIndex(f => f.path === fullPath && f.type !== 'document');
    if (existIdx >= 0) { if (existIdx !== activeFileIdx) switchTab(existIdx); return; }
    try {
        const res = await fetch("/api/file-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: fullPath }) });
        const d = await res.json();
        if (d.成功) {
            openFiles.push({ path: fullPath, name, content: d.内容, dirty: false, type: 'code', selection: null, 原始内容: d.内容 });
            switchTab(openFiles.length - 1);
            renderTabs();
        } else {
            showToast("error", "❌ 无法打开文件", d.错误 || "未知错误");
        }
    } catch (e) {
        showToast("error", "❌ 连接错误", e.message);
    }
}

