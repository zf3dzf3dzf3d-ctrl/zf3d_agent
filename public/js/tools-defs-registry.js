// ========== tools-defs-registry.js ==========
// 工具定义注册器。加载顺序：本文件 -> 各 tools-defs-*.js -> tools-runtime。
// 未来新增工具：任一 tools-defs-*.js 文件里调用 registerToolDefs({...}) 即可，
// 不必修改大文件，也不必改 index.html（新文件加一行 script 即可）。
window.ToolDefinitions = { categories: {}, allTools: {} };
window.registerToolDefs = function (defs) {
  if (!defs) return;
  if (defs.tools) Object.assign(window.ToolDefinitions.allTools, defs.tools);
  if (defs.categories) Object.assign(window.ToolDefinitions.categories, defs.categories);
};
