/**
 * 撤销/重做栈 — 自定义编辑器撤销重做
 * 从 逻辑.js 拆分，依赖全局状态的 editorInstance/openFiles/activeFileIdx
 */

// ============ 自定义撤销/重做栈 ============
let undoStack = [];   // [{fileIdx, oldContent, newContent, label}]
let redoStack = [];
const UNDO_MAX = 50;

function pushUndo(fileIdx, oldContent, newContent, label) {
    undoStack.push({ fileIdx, oldContent, newContent, label: label || "编辑" });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = []; // 新操作清空redo
}

function editorUndo() {
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') return;
    const ta = document.getElementById("codeInput");
    if (!ta) return;
    // 优先用自定义栈
    if (undoStack.length > 0) {
        const entry = undoStack.pop();
        // 恢复旧内容
        if (entry.fileIdx === activeFileIdx && editorInstance) {
            const current = ta.value;
            redoStack.push({ fileIdx: entry.fileIdx, oldContent: current, newContent: entry.oldContent, label: entry.label });
            editorInstance.设置内容(entry.oldContent);
            if (openFiles[entry.fileIdx]) openFiles[entry.fileIdx].content = entry.oldContent;
            renderTabs();
            return;
        }
    }
    // 回退到浏览器原生undo
    ta.focus();
    document.execCommand("undo");
}

function editorRedo() {
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') return;
    const ta = document.getElementById("codeInput");
    if (!ta) return;
    if (redoStack.length > 0) {
        const entry = redoStack.pop();
        if (entry.fileIdx === activeFileIdx && editorInstance) {
            const current = ta.value;
            undoStack.push({ fileIdx: entry.fileIdx, oldContent: current, newContent: entry.newContent, label: entry.label });
            editorInstance.设置内容(entry.newContent);
            if (openFiles[entry.fileIdx]) openFiles[entry.fileIdx].content = entry.newContent;
            renderTabs();
            return;
        }
    }
    ta.focus();
    document.execCommand("redo");
}
