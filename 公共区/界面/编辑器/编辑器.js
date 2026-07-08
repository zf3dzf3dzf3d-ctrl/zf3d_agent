/**
 * 编辑器引擎 - Monaco Editor 适配层
 * 基于 VS Code 的 Monaco Editor，提供完整代码编辑体验
 * 保留原有接口，让上层模块无感知切换
 */

// ============ Monaco 加载管理 ============
let monacoReady = false;
let monacoLoading = false;
let monacoCallbacks = [];

function loadMonaco(callback) {
    if (monacoReady) { callback(); return; }
    monacoCallbacks.push(callback);
    if (monacoLoading) return;
    monacoLoading = true;

    require.config({ paths: { vs: '/monaco/vs' } });
    require(['vs/editor/editor.main'], function () {
        monacoReady = true;
        // 自定义主题，匹配系统暗色风格
        monaco.editor.defineTheme('zf-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '546e7a', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'c792ea' },
                { token: 'string', foreground: 'c3e88d' },
                { token: 'number', foreground: 'f78c6c' },
                { token: 'type', foreground: 'ff5370' },
                { token: 'function', foreground: '82aaff' },
            ],
            colors: {
                'editor.background': '#1a1a2e',
                'editor.foreground': '#cccccc',
                'editorLineNumber.foreground': '#546e7a',
                'editorLineNumber.activeForeground': '#82aaff',
                'editor.selectionBackground': '#264f78',
                'editor.lineHighlightBackground': '#2a2a3a',
                'editorCursor.foreground': '#82aaff',
                'editorIndentGuide.background': '#2a2a3a',
            }
        });
        monacoCallbacks.forEach(cb => cb());
        monacoCallbacks = [];
    });
}

// ============ 文件扩展名 → Monaco 语言映射 ============
const Monaco语言映射 = {
    json: 'json', py: 'python', js: 'javascript', ts: 'typescript',
    cs: 'csharp', css: 'css', html: 'html', md: 'markdown',
    txt: 'plaintext', bat: 'bat', sh: 'shell', yaml: 'yaml',
    yml: 'yaml', xml: 'xml', sql: 'sql', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', go: 'go',
    rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', scala: 'scala', r: 'r', lua: 'lua',
    dockerfile: 'dockerfile', ini: 'ini', toml: 'ini',
    less: 'less', scss: 'scss', pug: 'pug', vue: 'html',
    graphql: 'graphql', proto: 'proto', dart: 'dart',
    pl: 'perl', ps1: 'powershell', vbs: 'vb',
};

// ============ 编辑器引擎类 ============
class 编辑器引擎 {
    constructor(容器, 文本区, 预览区, 行号栏) {
        this.容器 = 容器;
        this.当前语言 = "json";
        this.editor = null;
        this._选区装饰 = [];
        this._新增装饰 = [];
        this._内容变更回调 = null;
        this._选区回调 = null;
        this._内容变更定时器 = null;
        this._待设内容 = undefined;
        this._待设语言 = undefined;

        // 隐藏旧的 textarea/pre/行号栏 及其父容器 code-area
        if (文本区) 文本区.style.display = 'none';
        if (预览区) 预览区.style.display = 'none';
        if (行号栏) 行号栏.style.display = 'none';
        // 隐藏 code-area 父容器（textarea 和 pre 的父节点），释放 flex 空间
        const codeArea = 容器.querySelector('.code-area');
        if (codeArea) codeArea.style.display = 'none';

        // 创建 Monaco 容器
        this.monaco容器 = document.createElement('div');
        this.monaco容器.className = 'monaco-container';
        this.monaco容器.style.cssText = 'width:100%;height:100%;flex:1;';
        容器.appendChild(this.monaco容器);

        loadMonaco(() => this._初始化Monaco());
    }

    _初始化Monaco() {
        this.editor = monaco.editor.create(this.monaco容器, {
            value: this._待设内容 || '',
            language: this._待设语言 || this.当前语言,
            theme: 'zf-dark',
            automaticLayout: true,
            fontSize: 14,
            lineHeight: 21,
            minimap: { enabled: true, maxColumn: 60, renderCharacters: false },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            tabSize: 4,
            insertSpaces: true,
            lineNumbers: 'on',
            folding: true,
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
            roundedSelection: false,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: true,
            smoothScrolling: true,
            scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
                useShadows: false,
            },
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            padding: { top: 6, bottom: 6 },
        });

        // 内容变更事件
        this.editor.onDidChangeModelContent(() => {
            if (this._内容变更回调) {
                clearTimeout(this._内容变更定时器);
                this._内容变更定时器 = setTimeout(this._内容变更回调, 50);
            }
        });

        // 选区变更事件（框选）
        this.editor.onDidChangeCursorSelection(() => {
            if (this._选区回调) this._选区回调();
        });

        // 处理待设置的内容和语言
        if (this._待设内容 !== undefined) {
            this.editor.setValue(this._待设内容);
            this._待设内容 = undefined;
        }
        if (this._待设语言 !== undefined) {
            monaco.editor.setModelLanguage(this.editor.getModel(), this._待设语言);
            this.当前语言 = this._待设语言;
            this._待设语言 = undefined;
        }
    }

    设置语言(语言) {
        this.当前语言 = 语言;
        if (this.editor) {
            monaco.editor.setModelLanguage(this.editor.getModel(), 语言);
        } else {
            this._待设语言 = 语言;
        }
    }

    设置内容(文本) {
        if (this.editor) {
            const 旧选区 = this.editor.getSelection();
            this.editor.setValue(文本);
            try { this.editor.setSelection(旧选区); } catch(e) {}
        } else {
            this._待设内容 = 文本;
        }
    }

    // 设置内容但保留 Monaco 原生撤销栈（用 executeEdits 替代 setValue）
    设置内容保留撤销(文本) {
        if (!this.editor) { this._待设内容 = 文本; return; }
        const model = this.editor.getModel();
        const 当前 = model.getValue();
        if (当前 === 文本) return; // 内容相同，跳过
        const 全范围 = model.getFullModelRange();
        this.editor.executeEdits('refresh', [{ range: 全范围, text: 文本 }]);
    }

    获取内容() {
        if (this.editor) return this.editor.getValue();
        return this._待设内容 || '';
    }

    刷新高亮() { /* Monaco 自动处理高亮，无需手动刷新 */ }

    设置选区高亮(起始, 结束) {
        if (!this.editor) return;
        this.清除选区高亮();
        const model = this.editor.getModel();
        const 起始位 = model.getPositionAt(起始);
        const 结束位 = model.getPositionAt(结束);
        this._选区装饰 = this.editor.deltaDecorations([], [{
            range: new monaco.Range(起始位.lineNumber, 起始位.column, 结束位.lineNumber, 结束位.column),
            options: { inlineClassName: 'sel-highlight-mark' }
        }]);
    }

    清除选区高亮() {
        if (this.editor && this._选区装饰.length >= 0) {
            this._选区装饰 = this.editor.deltaDecorations(this._选区装饰, []);
        }
    }

    设置新增高亮(起始, 结束) {
        if (!this.editor) return;
        this.清除新增高亮();
        const model = this.editor.getModel();
        const 起始位 = model.getPositionAt(起始);
        const 结束位 = model.getPositionAt(结束);
        this._新增装饰 = this.editor.deltaDecorations([], [{
            range: new monaco.Range(起始位.lineNumber, 起始位.column, 结束位.lineNumber, 结束位.column),
            options: { inlineClassName: 'new-text-highlight' }
        }]);
    }

    清除新增高亮() {
        if (this.editor && this._新增装饰.length >= 0) {
            this._新增装饰 = this.editor.deltaDecorations(this._新增装饰, []);
        }
    }

    获取选中文本() {
        if (!this.editor) return '';
        const sel = this.editor.getSelection();
        if (sel.isEmpty()) return '';
        return this.editor.getModel().getValueInRange(sel);
    }

    获取选中范围() {
        if (!this.editor) return null;
        const sel = this.editor.getSelection();
        if (sel.isEmpty()) return null;
        const model = this.editor.getModel();
        return {
            start: model.getOffsetAt(sel.getStartPosition()),
            end: model.getOffsetAt(sel.getEndPosition()),
            text: model.getValueInRange(sel)
        };
    }

    滚动到行(行号) {
        if (this.editor) this.editor.revealLineInCenter(行号);
    }

    获取行高() {
        if (this.editor) return this.editor.getOption(monaco.editor.EditorOption.lineHeight);
        return 21;
    }

    获取滚动位置() {
        if (this.editor) {
            return { scrollTop: this.editor.getScrollTop(), scrollLeft: this.editor.getScrollLeft() };
        }
        return { scrollTop: 0, scrollLeft: 0 };
    }

    设置滚动位置(top) {
        if (this.editor) this.editor.setScrollTop(top);
    }

    // 替换文本范围（供 applyLiveDiff 使用）
    替换范围(起始偏移, 结束偏移, 新文本) {
        if (!this.editor) return;
        const model = this.editor.getModel();
        const 起始位 = model.getPositionAt(起始偏移);
        const 结束位 = model.getPositionAt(结束偏移);
        this.editor.executeEdits('ai-edit', [{
            range: new monaco.Range(起始位.lineNumber, 起始位.column, 结束位.lineNumber, 结束位.column),
            text: 新文本
        }]);
    }

    // 查找文本位置（供 applyLiveDiff 使用）
    查找文本位置(文本) {
        if (!this.editor) return -1;
        const content = this.editor.getValue();
        return content.indexOf(文本);
    }

    聚焦() {
        if (this.editor) this.editor.focus();
    }

    设置内容变更回调(回调) { this._内容变更回调 = 回调; }
    设置选区回调(回调) { this._选区回调 = 回调; }
}
