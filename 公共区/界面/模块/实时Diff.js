/**
 * 实时Diff系统 — 编辑器内容刷新+实时差异高亮
 * 从 逻辑.js 拆分，依赖全局状态+撤销重做
 */

// ============ 编辑器内容刷新 ============
// ============ Toast通知系统 ============
// ============ Toast通知 → 已拆分到 模块/Toast通知.js ============
// initToast, showToast, showEditorModifiedBanner, flashEditorLines 已移至独立文件

async function refreshAllOpenFiles(force) {
    // 刷新所有打开的文件内容（force=true时即使内容相同也更新编辑器+显示反馈）
    for (let i = 0; i < openFiles.length; i++) {
        const f = openFiles[i];
        if (f.type === 'document') {
            if (force) await renderDocumentContent(i);
            continue;
        }
        try {
            const res = await fetch("/api/file-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: f.path }) });
            const d = await res.json();
            if (d.成功 && (force || d.内容 !== f.content)) {
                const 旧内容 = f.content;
                const 新内容 = d.内容;
                // 找diff行范围
                const 旧行 = 旧内容.split("\n");
                const 新行 = 新内容.split("\n");
                let startLine = -1, endLine = -1;
                const maxLen = Math.max(旧行.length, 新行.length);
                for (let li = 0; li < maxLen; li++) {
                    if (li >= 旧行.length || li >= 新行.length || 旧行[li] !== 新行[li]) {
                        if (startLine === -1) startLine = li;
                        endLine = li;
                    }
                }
                // 更新内容
                f.content = 新内容;
                if (i === activeFileIdx && editorInstance) {
                    // 记录撤销
                    pushUndo(i, 旧内容, 新内容, "AI修改");
                    editorInstance.设置内容(新内容);
                    // 内容变化后清除框选状态（位置已失效）
                    if (旧内容 !== 新内容) {
                        editorSelection = null;
                        hideSelectionHint();
                        if (editorInstance) editorInstance.清除选区高亮();
                        // 高亮新增文本（字符级）— applyLiveDiff已处理时跳过，避免用全文件diff覆盖精确的块级diff
                        if (!liveDiffHandled) {
                            const added = computeAddedRange(旧内容, 新内容);
                            if (added) highlightNewText(editorInstance, added.start, added.end);
                        }
                    }
                    // 闪烁+提示（仅当前Tab）
                    if (startLine >= 0) {
                        const isDelete = 新行.length < 旧行.length;
                        const opType = isDelete ? "delete" : "modify";
                        const opLabel = isDelete ? "已删除" : "已修改";
                        flashEditorLines(startLine, endLine, opType);
                        showEditorModifiedBanner(`AI${opLabel} (第${startLine + 1}-${endLine + 1}行)`, opType);
                        showToast(opType, `${isDelete ? "🗑️" : "✏️"} 文件${opLabel}`, `${f.name} 第${startLine + 1}-${endLine + 1}行`);
                        const ta = document.getElementById("codeInput");
                        if (ta) {
                            const 行高 = parseFloat(getComputedStyle(ta).lineHeight) || 19.5;
                            ta.scrollTop = Math.max(0, startLine * 行高 - 60);
                        }
                    } else if (force) {
                        // 内容未变化但需要反馈
                        showToast("info", "🔄 已刷新", `${f.name} 内容无变化`);
                    }
                }
                f.dirty = true;
                if (typeof markAIModified === 'function') markAIModified(i);
                if (typeof updateChangeBadge === 'function') updateChangeBadge();
                renderTabs();
            }
        } catch (e) {}
    }
}

// ============ 实时Diff系统 ============

// 计算新增文本的字符范围（公共前缀/后缀法）
// 返回 {start, end} 或 null（纯删除/无变化）
function computeAddedRange(oldText, newText) {
    if (oldText === newText) return null;
    if (!newText) return null; // 纯删除
    // 找公共前缀
    let prefix = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;
    // 找公共后缀
    let suffix = 0;
    while (suffix < minLen - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
    const addedStart = prefix;
    const addedEnd = newText.length - suffix;
    if (addedStart >= addedEnd) return null;
    return { start: addedStart, end: addedEnd };
}

// 高亮新增文本并自动淡出
let highlightClearTimer = null;
let liveDiffHandled = false;  // applyLiveDiff是否已处理高亮
function highlightNewText(editor, start, end) {
    if (!editor || start < 0 || end <= start) return;
    editor.设置新增高亮(start, end);
    if (highlightClearTimer) clearTimeout(highlightClearTimer);
    highlightClearTimer = setTimeout(() => { editor.清除新增高亮(); }, 5000);
}

function applyLiveDiff(旧文本, 新文本) {
    if (activeFileIdx < 0 || !editorInstance) return;
    const ta = document.getElementById("codeInput");
    const 当前内容 = ta.value;
    const 位置 = 当前内容.indexOf(旧文本);
    if (位置 === -1) {
        // 编辑器中找不到旧文本（可能已被之前的操作修改），清除框选状态防止过期
        editorSelection = null;
        hideSelectionHint();
        if (editorInstance) editorInstance.清除选区高亮();
        return;
    }

    // 直接在textarea中替换
    const 新内容 = 当前内容.substring(0, 位置) + 新文本 + 当前内容.substring(位置 + 旧文本.length);
    const isDelete = 新文本 === "";
    // 记录撤销
    pushUndo(activeFileIdx, 当前内容, 新内容, isDelete ? "AI删除" : "AI替换");
    ta.value = 新内容;
    editorInstance.设置内容(新内容);

    // 更新openFiles
    openFiles[activeFileIdx].content = 新内容;
    openFiles[activeFileIdx].dirty = true;
    if (typeof markAIModified === 'function') markAIModified(activeFileIdx);
    if (typeof updateChangeBadge === 'function') updateChangeBadge();
    renderTabs();

    // 清除框选状态
    editorSelection = null;
    hideSelectionHint();
    if (editorInstance) editorInstance.清除选区高亮();

    // 高亮新增文本（字符级，仅对比替换块的差异）
    if (!isDelete && editorInstance) {
        const added = computeAddedRange(旧文本, 新文本);
        if (added) {
            highlightNewText(editorInstance, 位置 + added.start, 位置 + added.end);
            liveDiffHandled = true;
        }
    }

    // 计算修改行范围并闪烁
    const 替换前内容 = 当前内容.substring(0, 位置);
    const startLine = 替换前内容.split("\n").length - 1;
    const 新行数 = 新文本.split("\n").length - 1;
    const endLine = startLine + 新行数;
    const opType = isDelete ? "delete" : "modify";
    flashEditorLines(startLine, endLine, opType);

    // 修改提示（颜色区分）
    const 操作描述 = isDelete ? `删除「${旧文本.substring(0, 25)}${旧文本.length > 25 ? "..." : ""}」` : `→「${新文本.substring(0, 30)}${新文本.length > 30 ? "..." : ""}」`;
    const toastType = isDelete ? "delete" : "modify";
    const toastIcon = isDelete ? "🗑️" : "✏️";
    showEditorModifiedBanner(`第${startLine + 1}行 ${操作描述}`, opType);
    showToast(toastType, `${toastIcon} ${isDelete ? "已删除" : "已替换"}`, `${openFiles[activeFileIdx].name} 第${startLine + 1}行 ${操作描述}`);

    // 显示diff高亮
    showDiffOverlay(位置, 旧文本, 新文本, 新内容);
}

function showDiffOverlay(position, 旧文本, 新文本, 新内容) {
    const container = document.getElementById("editorContainer");
    const ta = document.getElementById("codeInput");
    if (!container || !ta) return;

    // 计算替换起始行号
    const 替换前内容 = 新内容.substring(0, position);
    const startLine = 替换前内容.split("\n").length - 1;
    const 行高 = parseFloat(getComputedStyle(ta).lineHeight) || 19.5;
    const scrollTop = ta.scrollTop || 0;
    const containerRect = container.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    const offsetY = taRect.top - containerRect.top;
    const topPx = startLine * 行高 + offsetY - scrollTop;

    // 创建diff信息浮层（贴在修改行右侧）
    const highlightLayer = document.createElement("div");
    highlightLayer.className = "diff-highlight-layer";
    highlightLayer.innerHTML = `<div class="diff-change-info">
        <span class="diff-del-badge">−${旧文本.length}字</span>
        <span class="diff-add-badge">+${新文本.length}字</span>
        <span class="diff-accept" onclick="this.parentElement.parentElement.remove()">✕</span>
    </div>`;
    highlightLayer.style.top = (topPx - 24) + "px";
    container.appendChild(highlightLayer);

    // 在编辑器背景中添加高亮条（标记被修改的行区域）
    const 新行数 = 新文本.split("\n").length;
    const 行高亮 = document.createElement("div");
    行高亮.className = "diff-line-highlight";
    行高亮.style.cssText = `position:absolute;left:48px;right:0;top:${topPx}px;height:${新行数 * 行高}px;background:rgba(233,30,126,0.06);border-left:3px solid #E91E63;z-index:1;pointer-events:none;transition:opacity 2s;`;
    container.appendChild(行高亮);

    // 5秒后自动淡出
    setTimeout(() => {
        if (highlightLayer.parentElement) {
            highlightLayer.style.opacity = "0";
            setTimeout(() => highlightLayer.remove(), 1000);
        }
        if (行高亮.parentElement) {
            行高亮.style.opacity = "0";
            setTimeout(() => 行高亮.remove(), 2000);
        }
    }, 5000);

    // 滚动到修改位置
    ta.scrollTop = Math.max(0, topPx - 60);
}

