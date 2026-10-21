// ==== 拆分自 tools.js：对象闭合后的启动逻辑（结构归位修复 + 出口限额加载） ====
// ===== 结构归位修复 ___STRUCT_FIX_APPLIED___ =====
// 历史编辑事故导致 L783 的 '},' 提前关闭 allTools（只含 20 个工具），
// 63 个工具定义错位挂到 Tools 对象直接属性上（L786-1449、L2094-2127）。
// 原 getDefinitions 里的 self.allTools[name] || self[name] 回退让功能可用，
// 但任何直接遍历 allTools 的代码会漏掉 63 个工具。
// 此处启动时统一归位：把 self 上形如工具定义（type:'function' 且 function.name === key）
// 的直接属性合并进 allTools。
(function normalizeMisplacedTools() {
    var self = window.Tools;
    if (!self || !self.allTools) return;
    var keys = Object.keys(self);
    var moved = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === 'allTools' || k === 'categories' || k === 'activeCategory' ||
            k === 'chatCategories' || k === 'currentChatId' || k === 'toolResultConfig' ||
            k === 'toolResultArchive' || k === '_archiveCounter') continue;
        var def = self[k];
        if (def && typeof def === 'object' && !Array.isArray(def) &&
            def.type === 'function' && def.function && def.function.name === k) {
            if (!self.allTools[k]) {
                self.allTools[k] = def;
                moved.push(k);
            }
        }
    }
})();

// ===== 启动时加载工具结果出口限额配置（private/tool_result_limits.json -> /api/tool-result-limits） =====
(function exitLimitsBootstrap() {
    try {
        if (window.Tools && typeof window.Tools.loadExitLimits === 'function') {
            window.Tools.loadExitLimits();
        }
    } catch (e) { /* ignore */ }
})();
