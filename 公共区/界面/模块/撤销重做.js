/**
 * 撤销/重做栈 — 自定义编辑器撤销重做（Monaco适配版）
 * 依赖全局状态的 editorInstance/openFiles/activeFileIdx
 * Monaco 自带原生撤销栈，此处作为 AI 操作的补充撤销层
 */

// ============ 自定义撤销/重做栈（AI操作专用） ============
let undoStack = [];   // [{fileIdx, oldContent, newContent, label}]
let redoStack = [];
const UNDO_MAX = 50;

function pushUndo(fileIdx, oldContent, newContent, label) {
    undoStack.push({ fileIdx, oldContent, newContent, label: label || "编辑" });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
}

function editorUndo() {
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') return;
    // 优先用自定义栈（AI操作撤销）
    if (undoStack.length > 0) {
        const entry = undoStack.pop();
        if (entry.fileIdx === activeFileIdx && editorInstance) {
            const current = editorInstance.获取内容();
            redoStack.push({ fileIdx: entry.fileIdx, oldContent: current, newContent: entry.oldContent, label: entry.label });
            // 用 executeEdits 替代 setValue，保留 Monaco 原生撤销栈
            editorInstance.设置内容保留撤销(entry.oldContent);
            if (openFiles[entry.fileIdx]) openFiles[entry.fileIdx].content = entry.oldContent;
            renderTabs();
            return;
        }
    }
    // 回退到 Monaco 原生撤销
    if (editorInstance && editorInstance.editor) {
        editorInstance.聚焦();
        editorInstance.editor.trigger('keyboard', 'undo', null);
    }
}

function editorRedo() {
    if (activeFileIdx >= 0 && openFiles[activeFileIdx]?.type === 'document') return;
    if (redoStack.length > 0) {
        const entry = redoStack.pop();
        if (entry.fileIdx === activeFileIdx && editorInstance) {
            const current = editorInstance.获取内容();
            undoStack.push({ fileIdx: entry.fileIdx, oldContent: current, newContent: entry.newContent, label: entry.label });
            // 用 executeEdits 替代 setValue，保留 Monaco 原生撤销栈
            editorInstance.设置内容保留撤销(entry.newContent);
            if (openFiles[entry.fileIdx]) openFiles[entry.fileIdx].content = entry.newContent;
            renderTabs();
            return;
        }
    }
    // 回退到 Monaco 原生重做
    if (editorInstance && editorInstance.editor) {
        editorInstance.聚焦();
        editorInstance.editor.trigger('keyboard', 'redo', null);
    }
}
