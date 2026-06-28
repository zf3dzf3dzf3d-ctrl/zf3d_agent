/**
 * 路径工具 — 路径拼接等工具函数
 * 从 逻辑.js 拆分，无依赖
 */

// ============ 路径工具 ============
function joinPath(base, name) {
    if (!base) return name;
    return base.replace(/[\/\\]+$/, "") + "/" + name;
}
