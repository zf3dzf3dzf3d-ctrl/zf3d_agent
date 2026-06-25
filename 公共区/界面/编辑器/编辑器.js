/**
 * 编辑器引擎 - 语法高亮+代码提示
 * 自研轻量引擎，零外部依赖
 */
class 编辑器引擎 {
    constructor(容器, 文本区, 预览区, 行号栏) {
        this.容器 = 容器;
        this.文本区 = 文本区;
        this.预览区 = 预览区;
        this.行号栏 = 行号栏;
        this.当前语言 = "json";
        this.关键词表 = {
            json: { 关键词: ["true", "false", "null"], 内置函数: [], 字符串: true, 数字: true, 注释: false },
            python: { 关键词: ["def", "class", "if", "else", "elif", "for", "while", "import", "from", "return", "try", "except", "with", "as", "in", "not", "and", "or", "True", "False", "None", "pass", "break", "continue", "yield", "lambda", "raise", "global", "async", "await"], 内置函数: ["print", "len", "range", "str", "int", "float", "list", "dict", "set", "tuple", "open", "type", "isinstance", "enumerate", "zip", "map", "filter", "sorted", "reversed", "super", "property"], 字符串: true, 数字: true, 注释: true },
            javascript: { 关键词: ["function", "const", "let", "var", "if", "else", "for", "while", "return", "class", "new", "this", "true", "false", "null", "undefined", "async", "await", "import", "export", "from", "switch", "case", "break", "default", "try", "catch", "finally", "throw", "typeof", "instanceof"], 内置函数: ["console", "document", "window", "fetch", "JSON", "Object", "Array", "String", "Number", "Math", "Date", "Promise", "setTimeout", "setInterval"], 字符串: true, 数字: true, 注释: true }
        };
        this.补全列表 = null;
        this.补全索引 = -1;
        this._选区高亮起始 = -1;
        this._选区高亮结束 = -1;
        this._新增高亮起始 = -1;
        this._新增高亮结束 = -1;
        this._绑定事件();
    }
    设置语言(语言) { this.当前语言 = 语言; this.刷新高亮(); }
    设置内容(文本) { this.文本区.value = 文本; this.刷新高亮(); }
    获取内容() { return this.文本区.value; }
    设置选区高亮(起始, 结束) { this._选区高亮起始 = 起始; this._选区高亮结束 = 结束; this.刷新高亮(); }
    清除选区高亮() { this._选区高亮起始 = -1; this._选区高亮结束 = -1; this.刷新高亮(); }
    设置新增高亮(起始, 结束) { this._新增高亮起始 = 起始; this._新增高亮结束 = 结束; this.刷新高亮(); }
    清除新增高亮() { this._新增高亮起始 = -1; this._新增高亮结束 = -1; this.刷新高亮(); }
    刷新高亮() {
        const 代码 = this.文本区.value;
        const 高亮代码 = this._高亮代码(代码);
        // 注入选区高亮 + 新增高亮
        let 最终代码 = 高亮代码;
        if (this._选区高亮起始 >= 0 && this._选区高亮结束 > this._选区高亮起始) {
            最终代码 = this._注入范围标记(最终代码, this._选区高亮起始, this._选区高亮结束, "sel-highlight-mark");
        }
        if (this._新增高亮起始 >= 0 && this._新增高亮结束 > this._新增高亮起始) {
            最终代码 = this._注入范围标记(最终代码, this._新增高亮起始, this._新增高亮结束, "new-text-highlight");
        }
        this.预览区.innerHTML = 最终代码 + "\n";
        this._更新行号(代码);
    }
    _绑定事件() {
        this.文本区.addEventListener("input", () => { this._新增高亮起始 = -1; this._新增高亮结束 = -1; this.刷新高亮(); });
        this.文本区.addEventListener("scroll", () => { this.预览区.scrollTop = this.文本区.scrollTop; this.预览区.scrollLeft = this.文本区.scrollLeft; this.行号栏.scrollTop = this.文本区.scrollTop; });
        this.文本区.addEventListener("keydown", (e) => this._处理按键(e));
        this.文本区.addEventListener("input", () => this._显示补全());
        this.文本区.addEventListener("blur", () => { if (this.补全列表) { this.补全列表.remove(); this.补全列表 = null; } });
    }
    _处理按键(e) {
        if (e.key === "Tab") { e.preventDefault(); const 开始 = this.文本区.selectionStart; this.文本区.value = this.文本区.value.substring(0, 开始) + "    " + this.文本区.value.substring(this.文本区.selectionEnd); this.文本区.selectionStart = this.文本区.selectionEnd = 开始 + 4; this.刷新高亮(); }
        if (e.key === "Enter" && e.key === "{") { /* 自动配对 */ }
    }
    _显示补全() {
        const 光标位置 = this.文本区.selectionStart;
        const 文本 = this.文本区.value;
        const 当前行 = 文本.substring(0, 光标位置).split("\n").pop();
        const 匹配 = 当前行.match(/[\u4e00-\u9fa5a-zA-Z_]+$/);
        if (!匹配 || 匹配[0].length < 1) { if (this.补全列表) { this.补全列表.remove(); this.补全列表 = null; } return; }
        const 前缀 = 匹配[0].toLowerCase();
        const 语言配置 = this.关键词表[this.当前语言] || this.关键词表.json;
        const 候选 = [...语言配置.关键词, ...语言配置.内置函数].filter(w => w.toLowerCase().startsWith(前缀) && w.toLowerCase() !== 前缀).slice(0, 8);
        if (候选.length === 0) { if (this.补全列表) { this.补全列表.remove(); this.补全列表 = null; } return; }
        if (!this.补全列表) { this.补全列表 = document.createElement("div"); this.补全列表.className = "补全列表"; this.容器.appendChild(this.补全列表); }
        this.补全列表.innerHTML = 候选.map((c, i) => `<div class="补全项${i === 0 ? " 选中" : ""}" data-补全="${c}">${c}</div>`).join("");
        this.补全列表.style.bottom = "40px"; this.补全列表.style.left = "60px";
        this.补全列表.querySelectorAll(".补全项").forEach(项 => { 项.addEventListener("mousedown", (e) => { this._插入补全(e.target.dataset.补全, 前缀.length); }); });
    }
    _插入补全(文本, 删除长度) { const 开始 = this.文本区.selectionStart; this.文本区.value = this.文本区.value.substring(0, 开始 - 删除长度) + 文本 + this.文本区.value.substring(this.文本区.selectionEnd); this.文本区.selectionStart = this.文本区.selectionEnd = 开始 - 删除长度 + 文本.length; this.刷新高亮(); if (this.补全列表) { this.补全列表.remove(); this.补全列表 = null; } }
    _高亮代码(代码) {
        const 语言 = this.当前语言;
        const 配置 = this.关键词表[语言] || this.关键词表.json;
        let 结果 = "";
        let i = 0;
        while (i < 代码.length) {
            // 字符串
            if (配置.字符串 && (代码[i] === '"' || 代码[i] === "'" || 代码[i] === "`")) {
                const 引号 = 代码[i]; let 结束 = i + 1;
                while (结束 < 代码.length && 代码[结束] !== 引号) { if (代码[结束] === "\\") 结束++; 结束++; }
                结束++; 结果 += `<span class="编辑器字符串">${this._转义(代码.substring(i, 结束))}</span>`; i = 结束; continue;
            }
            // 注释
            if (配置.注释 && 代码[i] === "#") { let 结束 = 代码.indexOf("\n", i); if (结束 === -1) 结束 = 代码.length; 结果 += `<span class="编辑器注释">${this._转义(代码.substring(i, 结束))}</span>`; i = 结束; continue; }
            if (配置.注释 && 代码.substring(i, i + 2) === "//") { let 结束 = 代码.indexOf("\n", i); if (结束 === -1) 结束 = 代码.length; 结果 += `<span class="编辑器注释">${this._转义(代码.substring(i, 结束))}</span>`; i = 结束; continue; }
            // 数字
            if (配置.数字 && /[0-9]/.test(代码[i]) && (i === 0 || /[^a-zA-Z_]/.test(代码[i - 1]))) { let 结束 = i; while (结束 < 代码.length && /[0-9.]/.test(代码[结束])) 结束++; 结果 += `<span class="编辑器数字">${代码.substring(i, 结束)}</span>`; i = 结束; continue; }
            // 关键词和标识符
            if (/[a-zA-Z_\u4e00-\u9fa5]/.test(代码[i])) {
                let 结束 = i; while (结束 < 代码.length && /[a-zA-Z0-9_\u4e00-\u9fa5]/.test(代码[结束])) 结束++;
                const 词 = 代码.substring(i, 结束);
                if (配置.关键词.includes(词)) 结果 += `<span class="编辑器关键词">${this._转义(词)}</span>`;
                else if (配置.内置函数 && 配置.内置函数.includes(词)) 结果 += `<span class="编辑器布尔">${this._转义(词)}</span>`;
                else 结果 += this._转义(词);
                i = 结束; continue;
            }
            // JSON键名
            if (语言 === "json" && 代码[i] === '"' && i > 0) { /* 已在字符串处理 */ }
            // 符号
            结果 += this._转义(代码[i]); i++;
        }
        return 结果;
    }
    _更新行号(代码) { const 行数 = 代码.split("\n").length; this.行号栏.innerHTML = Array.from({ length: 行数 }, (_, i) => i + 1).join("<br>"); }
    _转义(文本) { return 文本.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

    _注入范围标记(html, 起始, 结束, className) {
        // 在已高亮的HTML中，按字符偏移量注入<mark>标签
        // 关键：遇到HTML标签时，若在选区内则先关mark再跳过标签后重开mark，保证嵌套合法
        let 结果 = "";
        let 原始偏移 = 0;
        let 已注入起始 = false;
        let 已注入结束 = false;
        let i = 0;
        while (i < html.length) {
            // 检查HTML标签
            if (html[i] === '<') {
                let 标签结束 = html.indexOf('>', i);
                if (标签结束 >= 0) {
                    const 在选区内 = 已注入起始 && !已注入结束;
                    if (在选区内) 结果 += '</mark>';
                    结果 += html.substring(i, 标签结束 + 1);
                    if (在选区内) 结果 += `<mark class="${className}">`;
                    i = 标签结束 + 1;
                    continue;
                }
            }
            // HTML实体 &...;
            if (html[i] === '&') {
                let 实体结束 = html.indexOf(';', i);
                if (实体结束 >= 0) {
                    const 实体 = html.substring(i, 实体结束 + 1);
                    if (!已注入起始 && 原始偏移 >= 起始) {
                        结果 += `<mark class="${className}">`;
                        已注入起始 = true;
                    }
                    if (!已注入结束 && 已注入起始 && 原始偏移 >= 结束) {
                        结果 += '</mark>';
                        已注入结束 = true;
                    }
                    结果 += 实体;
                    原始偏移++;
                    i = 实体结束 + 1;
                    continue;
                }
            }
            // 普通字符
            if (!已注入起始 && 原始偏移 >= 起始) {
                结果 += `<mark class="${className}">`;
                已注入起始 = true;
            }
            if (!已注入结束 && 已注入起始 && 原始偏移 >= 结束) {
                结果 += '</mark>';
                已注入结束 = true;
            }
            结果 += html[i];
            原始偏移++;
            i++;
        }
        // 如果范围到末尾
        if (已注入起始 && !已注入结束) {
            结果 += '</mark>';
        }
        return 结果;
    }
}
