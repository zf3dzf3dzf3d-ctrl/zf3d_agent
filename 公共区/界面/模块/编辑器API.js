/**
 * 编辑器API — 封装主系统编辑器/文件树/缩略图的操作，供神经元对话系统调用
 * 必须在全局状态.js之后、神经对话.js之前加载
 * 所有方法都做安全检查，独立运行模式(无全局变量)时降级返回空值
 */
(function() {
    'use strict';

    const TAG = '[editorAPI]';
    function _has(name) { return typeof window[name] !== 'undefined'; }
    function _v(name) { return _has(name) ? window[name] : undefined; }

    window.editorAPI = {

    // ============ 1. 上下文读取 ============

    /**
     * 获取完整对话上下文（工作目录+当前文件+打开文件列表+选中文件+选中文本）
     * @returns {object} 上下文对象
     */
    getContext() {
        const ctx = {};
        const root = this.getCurrentRoot();
        if (root) ctx.当前文件夹 = root;
        const f = this.getActiveFile();
        if (f) ctx.当前文件 = { 路径: f.path, 名称: f.name };
        const files = this.getOpenFiles();
        if (files.length > 0) ctx.打开的文件列表 = files;
        const selected = this.getSelectedFiles();
        if (selected.length > 0) ctx.选中文件 = selected;
        const sel = this.getSelection();
        if (sel) ctx.框选文本 = sel;
        return ctx;
    },

    getCurrentRoot() {
        if (typeof currentRoot !== 'undefined' && currentRoot) return currentRoot;
        return null;
    },

    getActiveFile() {
        if (typeof openFiles !== 'undefined' && typeof activeFileIdx !== 'undefined' && activeFileIdx >= 0 && openFiles[activeFileIdx]) {
            return openFiles[activeFileIdx];
        }
        return null;
    },

    getOpenFiles() {
        if (typeof openFiles !== 'undefined' && openFiles.length > 0) {
            return openFiles.map(f => ({ 路径: f.path, 名称: f.name, 已修改: f.dirty }));
        }
        return [];
    },

    getSelectedFiles() {
        if (typeof selectedItems !== 'undefined' && selectedItems.size > 0) {
            return Array.from(selectedItems.values());
        }
        return [];
    },

    /**
     * 获取编辑器选中文本（含所在文件信息）
     * @returns {object|null} {内容, 起始位置, 结束位置, 所在文件, 所在文件名}
     */
    getSelection() {
        if (typeof editorSelection === 'undefined' || !editorSelection || !editorSelection.text) return null;
        const isDocSel = typeof currentViewFile !== 'undefined' && currentViewFile
            && document.getElementById("docViewer")
            && document.getElementById("docViewer").style.display !== "none";
        const f = this.getActiveFile();
        const selPath = isDocSel ? currentViewFile.路径 : (f ? f.path : "");
        const selName = isDocSel ? currentViewFile.名称 : (f ? f.name : "");
        return {
            内容: editorSelection.text,
            起始位置: editorSelection.start,
            结束位置: editorSelection.end,
            所在文件: selPath,
            所在文件名: selName
        };
    },

    // ============ 2. 文件/标签操作 ============

    /**
     * 打开文件到编辑器
     * @param {string} path 完整路径
     * @returns {Promise<boolean>}
     */
    async openFile(path) {
        if (typeof openFileInEditor === 'function') {
            const name = path.split(/[/\\]/).pop();
            const dir = path.substring(0, path.length - name.length - 1);
            await openFileInEditor(dir, name);
            return true;
        }
        return false;
    },

    /**
     * 按路径切换到已打开的Tab
     * @param {string} path
     * @returns {boolean}
     */
    switchToPath(path) {
        if (typeof openFiles === 'undefined' || typeof switchTab !== 'function') return false;
        const idx = openFiles.findIndex(f => f.path === path && f.type !== 'document');
        if (idx >= 0) {
            if (idx !== activeFileIdx) switchTab(idx);
            return true;
        }
        return false;
    },

    /**
     * 按路径关闭Tab
     * @param {string} path
     * @returns {boolean}
     */
    closeTabByPath(path) {
        if (typeof openFiles === 'undefined' || typeof closeTab !== 'function') return false;
        const idx = openFiles.findIndex(f => f.path === path && f.type !== 'document');
        if (idx >= 0) { closeTab(idx); return true; }
        return false;
    },

    /**
     * 保存当前文件
     * @returns {Promise<boolean>}
     */
    async saveCurrentFile() {
        if (typeof saveEditorContent === 'function') {
            await saveEditorContent();
            return true;
        }
        return false;
    },

    // ============ 3. 编辑器内容读写 ============

    getContent() {
        if (typeof editorInstance !== 'undefined' && editorInstance) return editorInstance.获取内容();
        return '';
    },

    setContent(text, keepUndo) {
        if (typeof editorInstance === 'undefined' || !editorInstance) return false;
        if (keepUndo !== false) editorInstance.设置内容保留撤销(text);
        else editorInstance.设置内容(text);
        return true;
    },

    replaceRange(start, end, newText) {
        if (typeof editorInstance === 'undefined' || !editorInstance) return false;
        editorInstance.替换范围(start, end, newText);
        return true;
    },

    findText(text) {
        if (typeof editorInstance === 'undefined' || !editorInstance) return -1;
        return editorInstance.查找文本位置(text);
    },

    scrollToLine(line) {
        if (typeof editorInstance !== 'undefined' && editorInstance) editorInstance.滚动到行(line);
    },

    // ============ 4. 选区操作 ============

    getEditorSelection() {
        if (typeof editorInstance !== 'undefined' && editorInstance) return editorInstance.获取选中范围();
        return null;
    },

    setSelectionHighlight(start, end) {
        if (typeof editorInstance !== 'undefined' && editorInstance) editorInstance.设置选区高亮(start, end);
    },

    clearSelection() {
        if (typeof editorSelection !== 'undefined') editorSelection = null;
        if (typeof editorInstance !== 'undefined' && editorInstance) editorInstance.清除选区高亮();
        if (typeof hideSelectionHint === 'function') hideSelectionHint();
    },

    clearFileSelection() {
        if (typeof selectedItems !== 'undefined') selectedItems.clear();
        if (typeof clearFileSelection === 'function') clearFileSelection();
    },

    // ============ 5. AI改文件联动（从对话核心.js移植） ============

    /**
     * AI替换文本：自动找/开文件→switchTab→applyLiveDiff
     * @param {string} path 文件路径
     * @param {string} oldText 旧文本
     * @param {string} newText 新文本
     * @returns {Promise<boolean>}
     */
    async applyReplacement(path, oldText, newText) {
        if (typeof openFiles === 'undefined' || typeof switchTab !== 'function') return false;
        const fileIdx = openFiles.findIndex(f => f.path === path && f.type !== 'document');
        if (fileIdx >= 0) {
            if (fileIdx !== activeFileIdx) switchTab(fileIdx);
        } else {
            // 未打开：先读取并打开
            try {
                const res = await fetch("/api/file-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path }) });
                const fd = await res.json();
                if (fd.成功) {
                    const name = path.split(/[/\\]/).pop();
                    openFiles.push({ path, name, content: fd.内容, dirty: false, type: 'code', selection: null, 原始内容: fd.内容 });
                    switchTab(openFiles.length - 1);
                    if (typeof renderTabs === 'function') renderTabs();
                }
            } catch(e) { return false; }
        }
        // 调用实时Diff
        if (typeof applyLiveDiff === 'function') {
            applyLiveDiff(oldText, newText);
            return true;
        }
        return false;
    },

    /**
     * AI写入/创建文件：自动打开文件→switchTab→Toast
     * @param {string} path 文件路径
     * @param {string} action 操作类型（写入文件/创建文件/追加文件）
     * @returns {Promise<boolean>}
     */
    async applyFileWrite(path, action) {
        if (typeof openFiles === 'undefined' || typeof switchTab !== 'function') return false;
        if (window.playSound) playSound(action === 'create_file' ? 'file-create' : 'file-write');
        const fileIdx = openFiles.findIndex(f => f.path === path && f.type !== 'document');
        const wasOpen = fileIdx >= 0;
        // 记录旧内容用于对比
        let 旧内容 = '';
        if (wasOpen) {
            if (fileIdx !== activeFileIdx) switchTab(fileIdx);
            旧内容 = editorInstance ? editorInstance.获取内容() : (openFiles[fileIdx].content || '');
        }
        // 读取文件最新内容
        try {
            const res = await fetch("/api/file-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ 路径: path }) });
            const fd = await res.json();
            if (fd.成功) {
                const 新内容 = fd.内容;
                const name = path.split(/[/\\]/).pop();
                if (!wasOpen) {
                    // 文件未打开：push新标签
                    openFiles.push({ path, name, content: 新内容, dirty: true, type: 'code', selection: null, 原始内容: 新内容 });
                    switchTab(openFiles.length - 1);
                    if (typeof renderTabs === 'function') renderTabs();
                    if (typeof showToast === 'function') showToast("info", "📝 已打开", `${name} 被 AI ${action === "创建文件" ? "创建" : "修改"}`);
                } else {
                    // 文件已打开：更新内容
                    if (editorInstance && 旧内容 !== 新内容) {
                        // 用 executeEdits 全量替换，保留撤销栈
                        editorInstance.设置内容保留撤销(新内容);
                    }
                    // 更新 openFiles 状态
                    const idx = openFiles.findIndex(f => f.path === path && f.type !== 'document');
                    if (idx >= 0) {
                        openFiles[idx].content = 新内容;
                        openFiles[idx].dirty = true;
                    }
                    if (typeof renderTabs === 'function') renderTabs();
                    if (typeof updateChangeBadge === 'function') updateChangeBadge();
                }
                // 标记AI修改
                const idx2 = openFiles.findIndex(f => f.path === path && f.type !== 'document');
                if (idx2 >= 0 && typeof markAIModified === 'function') markAIModified(idx2);
                if (typeof renderTabs === 'function') renderTabs();

                // 动画化显示变化（复用实时Diff的动画组件）
                if (editorInstance && 旧内容 && 旧内容 !== 新内容) {
                    const 旧行 = 旧内容.split('\n');
                    const 新行 = 新内容.split('\n');
                    const 旧集 = new Set(旧行);
                    let 第一新增行 = -1, 最后新增行 = -1;
                    for (let i = 0; i < 新行.length; i++) {
                        if (!旧集.has(新行[i])) {
                            if (第一新增行 < 0) 第一新增行 = i;
                            最后新增行 = i;
                        }
                    }
                    console.log(TAG, `applyFileWrite 动画: 旧${旧行.length}行→新${新行.length}行, 变化行${第一新增行 + 1}-${最后新增行 + 1}`);
                    if (第一新增行 >= 0) {
                        // 滚动到变化行
                        editorInstance.滚动到行(第一新增行 + 1);
                        // 行闪烁动画
                        if (typeof flashEditorLines === 'function') {
                            flashEditorLines(第一新增行, 最后新增行, action === 'create_file' ? 'create' : 'modify');
                            console.log(TAG, 'applyFileWrite: flashEditorLines ✓');
                        } else { console.warn(TAG, 'applyFileWrite: flashEditorLines 函数不存在'); }
                        // 新增文本高亮（字符级）
                        if (typeof highlightNewText === 'function') {
                            let startOff = 0;
                            for (let i = 0; i < 第一新增行; i++) startOff += 新行[i].length + 1;
                            let endOff = startOff;
                            for (let i = 第一新增行; i <= 最后新增行; i++) endOff += 新行[i].length + 1;
                            highlightNewText(editorInstance, startOff, endOff);
                            console.log(TAG, `applyFileWrite: highlightNewText ✓ offset=${startOff}-${endOff}`);
                        } else { console.warn(TAG, 'applyFileWrite: highlightNewText 函数不存在'); }
                        // 横幅提示
                        if (typeof showEditorModifiedBanner === 'function') {
                            const 变化行数 = 最后新增行 - 第一新增行 + 1;
                            showEditorModifiedBanner(`第${第一新增行 + 1}行 AI${action === 'create_file' ? '创建' : '写入'} ${变化行数}行变化`, action === 'create_file' ? 'create' : 'modify');
                            console.log(TAG, 'applyFileWrite: showEditorModifiedBanner ✓');
                        } else { console.warn(TAG, 'applyFileWrite: showEditorModifiedBanner 函数不存在'); }
                    }
                } else if (!旧内容 && editorInstance && 新内容) {
                    // 新建文件：高亮全部+闪烁前20行
                    console.log(TAG, `applyFileWrite 新建文件动画: ${新内容.split('\n').length}行`);
                    if (typeof highlightNewText === 'function') {
                        highlightNewText(editorInstance, 0, Math.min(新内容.length, 5000));
                        console.log(TAG, 'applyFileWrite: highlightNewText(全量) ✓');
                    } else { console.warn(TAG, 'applyFileWrite: highlightNewText 函数不存在'); }
                    if (typeof flashEditorLines === 'function') {
                        flashEditorLines(0, Math.min(19, 新内容.split('\n').length - 1), 'create');
                        console.log(TAG, 'applyFileWrite: flashEditorLines(前20行) ✓');
                    } else { console.warn(TAG, 'applyFileWrite: flashEditorLines 函数不存在'); }
                    if (typeof showEditorModifiedBanner === 'function') {
                        showEditorModifiedBanner(`AI创建文件 ${新内容.split('\n').length}行`, 'create');
                        console.log(TAG, 'applyFileWrite: showEditorModifiedBanner(创建) ✓');
                    } else { console.warn(TAG, 'applyFileWrite: showEditorModifiedBanner 函数不存在'); }
                } else {
                    console.log(TAG, 'applyFileWrite: 无需动画 (内容未变或无旧内容)');
                }

                // Toast通知
                if (typeof showToast === 'function') {
                    const 变化字数 = Math.abs(新内容.length - 旧内容.length);
                    const icon = action === 'create_file' ? '📄' : '✏️';
                    showToast(action === 'create_file' ? 'modify' : 'modify',
                        `${icon} ${action === 'create_file' ? '已创建' : '已写入'}`,
                        `${name} ${旧内容 ? `${旧内容.length}→${新内容.length}字` : `${新内容.length}字新建`}`);
                    console.log(TAG, 'applyFileWrite: showToast ✓');
                } else { console.warn(TAG, 'applyFileWrite: showToast 函数不存在'); }

                console.log(TAG, `applyFileWrite ✓ ${name} 已更新, 旧${旧内容.length}字→新${新内容.length}字`);
                return true;
            } else {
                console.error(TAG, 'applyFileWrite: 读取文件失败', fd.错误);
                return false;
            }
        } catch(e) {
            console.error(TAG, 'applyFileWrite: 读取文件异常', e);
            return false;
        }
    },

    /**
     * 刷新所有打开的文件+文件树
     * @returns {Promise<void>}
     */
    async refreshAll() {
        if (typeof refreshAllOpenFiles === 'function') await refreshAllOpenFiles(true);
        if (typeof refreshTree === 'function') refreshTree();
    },

    /**
     * 标记AI修改过的文件（文件树高亮）
     * @param {string} path
     */
    markModified(path) {
        if (typeof aiModifiedFiles !== 'undefined') aiModifiedFiles.add(path);
    },

    /**
     * 获取AI修改过的文件列表
     * @returns {string[]}
     */
    getModifiedFiles() {
        if (typeof aiModifiedFiles !== 'undefined') return Array.from(aiModifiedFiles);
        return [];
    }

    };
})();
