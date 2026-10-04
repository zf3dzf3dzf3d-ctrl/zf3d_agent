// agent-02c-strip-fake-tool-tags.js — 清洗伪工具调用标签（从 agent-02-loop-core.js 拆分）
// 功能单一：剥离 AI 正文残留的伪工具调用标签 / 思考标签（代码级兜底）。
Object.assign(App, {
        // ===== 清洗 AI 正文残留的"伪工具调用标签"（代码级兜底） =====
        // 模型偶尔会把 task_complete 等工具调用以 XML 文本形式误写进正文/答案，
        // 显示成 "schenck_task_complete"
        // 之类不可读内容。此函数统一剥离。
        _stripFakeToolTags: function(text) {
            if (!text || typeof text !== 'string') return text || '';
            var cleaned = text;
            // 1) 完整块：<任意前缀 tool 调用 ...>
            cleaned = cleaned.replace(/<[\w\-]*\s*tool[_\-]?call[^>]*>[\s\S]*?<[\s/]*[\w\-]*\s*tool[_\-]?call[^>]*>/gi, '');
            // 2) 单个开/闭标签行：<...task_complete... />、</...task_complete...> 等
            cleaned = cleaned.replace(/<[\s/]*[A-Za-z0-9_\u4e00-\u9fa5\-]*\s*task[_\-]?(?:complete|list|record)[^>\n]*\/?>/g, '');
            // 2) 思考标签块 / <thinking>...</thinking> / <thought>...</thought>
            //    开闭标签成对出现时整体剥离；只有开标签时，剥离开标签及其后所有内容（防止后半截裸思考泄漏）
            cleaned = cleaned.replace(/<\s*\/?\s*(?:think|thinking|thought|reasoning|reflection)\s*\/?>/gi, '\u0000');
            cleaned = cleaned.replace(/\u0000([\s\S]*?)\u0000/g, '');   // 成对的部分清空
            cleaned = cleaned.split('\u0000')[0];                        // 剩下的孤立开标签：之后全是思考，直接截断
            // 2.5) 带前缀的思考标签，如 <schenck_think>...</schenck_think>
            cleaned = cleaned.replace(/<[\w\-]*\s*(?:think|thinking|thought|reasoning|reflection)[^>\n]*>[\s\S]*?<[\s/]*[\w\-]*\s*(?:think|thinking|thought|reasoning|reflection)[^>\n]*>/gi, '');
            // 3) 兜底：裸的 schenck_task_complete 字样（不管是否独立成行，前后无字母数字即剥离）
            cleaned = cleaned.replace(/(?:^|[^A-Za-z0-9_])schenck[_\s]*task[_\s]*complete(?:\s*\{[^}]*\})?/gim, '');
            // 3.5) 兜底：独立的工具调用标签对（如 "schenck_工具名 param=值" 形式的多行块，含 task_complete 参数块）
            cleaned = cleaned.replace(/schenck_(?:task_complete|task_list|ask_user|project_record|write_file|read_file|run_code)[^\n]*\n?/gi, '');
            // 3.6) 兜底：无 < 前缀的裸参数行，如 "task_complete message=... success=true ..."（含典型参数特征才剥离，避免误伤正常文字）
            cleaned = cleaned.replace(/^[ \t]*[\w\-]*task[_\s]?complete[ \t]+[^\n]*?(message|success|scope)[^\n]*$/gim, '');
            // 4) 清理因此产生的连续空行（3 个以上压成 2 个）以及只残留空白符号的行
            cleaned = cleaned.replace(/\n[ \t]+\n/g, '\n\n');
            cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
            return cleaned.trim() === '' ? text : cleaned;
        },
});
