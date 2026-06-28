/**
 * 文件框选 — 文件框选模式+拖拽框选+框选追踪
 * 从 逻辑.js 拆分
 */

// ============ 文件框选模式 ============

function toggleSelectAll() {
    if (selectedItems.size > 0) {
        clearFileSelection();
    } else {
        selectAllGalleryItems();
    }
}

function toggleItemSelection(path, name, type) {
    if (selectedItems.has(path)) {
        selectedItems.delete(path);
    } else {
        selectedItems.set(path, { 名称: name, 类型: type, 路径: path });
    }
    updateGallerySelectionVisual();
    showFileSelectionHint();
}

function selectAllGalleryItems() {
    const items = getSortedItems();
    for (const node of items) {
        const fullPath = joinPath(galleryPath, node.名称);
        selectedItems.set(fullPath, { 名称: node.名称, 类型: node.类型, 路径: fullPath });
    }
    updateGallerySelectionVisual();
    showFileSelectionHint();
}

function clearFileSelection() {
    selectedItems.clear();
    updateGallerySelectionVisual();
    showFileSelectionHint();
}

function updateGallerySelectionVisual() {
    const grid = document.getElementById("galleryGrid");
    if (grid) {
        grid.querySelectorAll(".gallery-item").forEach(item => {
            const path = item.dataset.path;
            if (path && selectedItems.has(path)) {
                item.classList.add("selected");
            } else {
                item.classList.remove("selected");
            }
        });
    }
    const list = document.getElementById("galleryList");
    if (list) {
        list.querySelectorAll(".gallery-list-row").forEach(row => {
            const path = row.dataset.path;
            if (path && selectedItems.has(path)) {
                row.classList.add("selected");
                const check = row.querySelector(".glr-check");
                if (check) check.textContent = "☑";
            } else {
                row.classList.remove("selected");
                const check = row.querySelector(".glr-check");
                if (check) check.textContent = "☐";
            }
        });
    }
}

function showFileSelectionHint() {
    // 更新全选/取消按钮
    const toggleBtn = document.getElementById("toggleSelectAllBtn");
    if (toggleBtn) {
        if (selectedItems.size > 0) {
            toggleBtn.textContent = "☐ 不选";
            toggleBtn.title = "取消所有选择 (Ctrl+D)";
        } else {
            toggleBtn.textContent = "☑ 全选";
            toggleBtn.title = "全选当前文件夹 (Ctrl+A)";
        }
    }
    let hint = document.getElementById("fileSelectionHint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "fileSelectionHint";
        hint.className = "file-selection-hint";
        const inputArea = document.querySelector(".chat-input-area");
        if (inputArea) inputArea.insertBefore(hint, inputArea.firstChild);
    }
    if (selectedItems.size === 0) {
        hint.style.display = "none";
        return;
    }
    let 文件数 = 0, 文件夹数 = 0;
    const paths = [];
    for (const [path, item] of selectedItems) {
        if (item.类型 === "目录") 文件夹数++; else 文件数++;
        paths.push(item.名称);
    }
    const 预览 = paths.length > 10 ? paths.slice(0, 10).join(", ") + ` ...等${paths.length}项` : paths.join(", ");
    hint.innerHTML = `📋 已选中 <span class="fs-count">${selectedItems.size}</span> 项（${文件数}文件, ${文件夹数}文件夹）<span class="fs-clear" onclick="clearFileSelection()">✕</span><div class="fs-list">${escapeHtml(预览)}</div>`;
    hint.style.display = "block";
}

// ============ 拖拽框选 ============
let dragState = null;
let justDragged = false;

function initGallerySelection() {
    const mv = document.getElementById("mediaView");
    if (mv) {
        mv.addEventListener("mousedown", onDragStart);
        mv.addEventListener("click", onSelectionClick, true);
        mv.addEventListener("dblclick", onSelectionDblClick);
    }
    document.addEventListener("keydown", onSelectionKeyDown);
}

function isGalleryMode() {
    const gh = document.getElementById("galleryHeader");
    return gh && gh.style.display !== "none";
}

function onSelectionDblClick(e) {
    if (!isGalleryMode()) return;
    const item = e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row");
    if (item) return;
    if (selectedItems.size > 0) {
        clearFileSelection();
    }
}

function onSelectionClick(e) {
    // 拖拽刚结束，吞掉click防止打开文件
    if (justDragged) {
        justDragged = false;
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (!e.ctrlKey && !e.metaKey) return;
    const item = e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row");
    if (!item) return;
    const path = item.dataset.path;
    if (!path) return;
    e.preventDefault();
    e.stopPropagation();
    toggleItemSelection(path, item.dataset.name || "", item.dataset.type || "文件");
}

function onSelectionKeyDown(e) {
    // 焦点在输入框/文本域中时，不拦截，让浏览器默认选择文本
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    // 确认画廊（媒体视图）实际可见才拦截
    const mediaView = document.getElementById("mediaView");
    if (!mediaView || mediaView.style.display === "none") return;
    const galleryHeader = document.getElementById("galleryHeader");
    if (!galleryHeader || galleryHeader.style.display === "none") return;
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "a" || e.key === "A") {
            e.preventDefault();
            selectAllGalleryItems();
        } else if (e.key === "d" || e.key === "D") {
            e.preventDefault();
            clearFileSelection();
        }
    }
}

function onDragStart(e) {
    if (!isGalleryMode()) return;
    if (e.button !== 0) return;
    // 如果鼠标落在 gallery-item / gallery-list-row 上，让浏览器原生拖拽接管（用于拖拽移动/复制）
    const galleryItem = e.target.closest(".gallery-item") || e.target.closest(".gallery-list-row");
    if (galleryItem && galleryItem.dataset.path) return;
    e.preventDefault(); // 屏蔽浏览器原生拖拽行为（空白区域才框选）
    // Ctrl=加选模式, Alt=减选模式, 无修饰=普通框选(替换)
    const mode = e.altKey ? "remove" : "add";

    const container = e.currentTarget;
    container.style.position = "relative";
    const rect = container.getBoundingClientRect();
    dragState = {
        startX: e.clientX - rect.left + container.scrollLeft,
        startY: e.clientY - rect.top + container.scrollTop,
        container: container,
        mode: mode,
        dragging: false,
        clearFirst: !e.ctrlKey && !e.metaKey && !e.altKey  // 普通拖拽先清空
    };

    const box = document.createElement("div");
    box.className = "drag-selection-box";
    box.style.display = "none";
    if (mode === "remove") {
        box.style.borderColor = "var(--red)";
        box.style.background = "rgba(244,67,54,0.1)";
    }
    container.appendChild(box);
    dragState.box = box;

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
}

function onDragMove(e) {
    if (!dragState) return;
    const container = dragState.container;
    const rect = container.getBoundingClientRect();
    const curX = e.clientX - rect.left + container.scrollLeft;
    const curY = e.clientY - rect.top + container.scrollTop;

    const x = Math.min(dragState.startX, curX);
    const y = Math.min(dragState.startY, curY);
    const w = Math.abs(curX - dragState.startX);
    const h = Math.abs(curY - dragState.startY);

    if (w > 3 || h > 3) {
        if (!dragState.dragging) {
            dragState.dragging = true;
            // 普通拖拽：开始时清空已有选择
            if (dragState.clearFirst) {
                selectedItems.clear();
            }
        }
        dragState.box.style.display = "block";
    }
    if (!dragState.dragging) return;

    dragState.box.style.left = x + "px";
    dragState.box.style.top = y + "px";
    dragState.box.style.width = w + "px";
    dragState.box.style.height = h + "px";

    const boxRect = { left: x, top: y, right: x + w, bottom: y + h };
    container.querySelectorAll(".gallery-item, .gallery-list-row").forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const itemX = itemRect.left - rect.left + container.scrollLeft;
        const itemY = itemRect.top - rect.top + container.scrollTop;
        const itemW = itemRect.width;
        const itemH = itemRect.height;
        const intersects = boxRect.left < itemX + itemW && boxRect.right > itemX &&
            boxRect.top < itemY + itemH && boxRect.bottom > itemY;
        item.classList.remove("drag-hover-add", "drag-hover-remove");
        if (intersects) {
            item.classList.add(dragState.mode === "remove" ? "drag-hover-remove" : "drag-hover-add");
        }
    });
}

function onDragEnd(e) {
    if (!dragState) return;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);

    const container = dragState.container;

    if (dragState.dragging) {
        // 真正发生了拖拽框选
        const hoverClass = dragState.mode === "remove" ? "drag-hover-remove" : "drag-hover-add";
        container.querySelectorAll("." + hoverClass).forEach(item => {
            item.classList.remove(hoverClass);
            const path = item.dataset.path;
            if (path) {
                if (dragState.mode === "remove") {
                    selectedItems.delete(path);
                } else {
                    const name = item.dataset.name || "";
                    const type = item.dataset.type || "文件";
                    selectedItems.set(path, { 名称: name, 类型: type, 路径: path });
                }
            }
        });
        justDragged = true;
    }

    if (dragState.box && dragState.box.parentNode) {
        dragState.box.parentNode.removeChild(dragState.box);
    }
    dragState = null;

    updateGallerySelectionVisual();
    showFileSelectionHint();
}

// ============ 框选追踪 ============
function captureSelection() {
    // 文档预览器中的选区
    const docContent = document.getElementById("docContent");
    if (docContent && document.getElementById("docViewer").style.display !== "none") {
        const sel = window.getSelection().toString();
        if (sel && sel.length > 0) {
            editorSelection = { text: sel, start: 0, end: sel.length };
            if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = editorSelection;
            showSelectionHint(sel);
            return;
        }
        editorSelection = null;
        if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = null;
        hideSelectionHint();
        return;
    }
    // 代码编辑器中的选区
    const ta = document.getElementById("codeInput");
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    if (sel.length > 0) {
        editorSelection = { text: sel, start: ta.selectionStart, end: ta.selectionEnd };
        if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = editorSelection;
        showSelectionHint(sel);
        if (editorInstance) editorInstance.设置选区高亮(ta.selectionStart, ta.selectionEnd);
    } else {
        editorSelection = null;
        if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = null;
        hideSelectionHint();
        if (editorInstance) editorInstance.清除选区高亮();
    }
}

function showSelectionHint(text) {
    let hint = document.getElementById("selectionHint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "selectionHint";
        hint.className = "selection-hint";
        const inputArea = document.querySelector(".chat-input-area");
        inputArea.insertBefore(hint, inputArea.firstChild);
    }
    const preview = text.length > 200 ? text.substring(0, 200) + `... (${text.length}字)` : text;
    const fname = (currentViewFile && currentViewFile.名称) || openFiles[activeFileIdx]?.name || "";
    const 行数 = text.split("\n").length;
    hint.innerHTML = `📌 <code>${fname}</code> 选中${text.length}字 · ${行数}行 <span class="sel-clear" onclick="clearSelection()">✕</span><pre class="sel-preview">${escapeHtml(preview)}</pre>`;
    hint.style.display = "block";
}

function hideSelectionHint() { const h = document.getElementById("selectionHint"); if (h) h.style.display = "none"; }
function clearSelection() {
    editorSelection = null;
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]) openFiles[activeFileIdx].selection = null;
    hideSelectionHint();
    if (editorInstance) editorInstance.清除选区高亮();
    if (window.getSelection) window.getSelection().removeAllRanges();
}
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

