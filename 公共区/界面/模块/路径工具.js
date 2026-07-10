/**
 * 路径工具 — 路径拼接等工具函数
 * 从 逻辑.js 拆分，无依赖
 */

// ============ 路径工具 ============

// 规范化路径：统一分隔符为\，去末尾分隔符（盘符根除外）
function normPath(p) {
    if (!p) return null;
    p = String(p).replace(/\//g, "\\");
    // 盘符根 C:\ 保留末尾\
    if (/^[A-Za-z]:\\?$/.test(p)) return p.replace(/\\?$/, "\\");
    return p.replace(/\\+$/, "");
}

// 路径拼接：自动使用\分隔符（Windows）
function joinPath(base, name) {
    if (!base) return name;
    base = normPath(base);
    if (!base) return name;
    return base + "\\" + name;
}

// 路径比较：忽略分隔符差异和末尾差异
function samePath(a, b) {
    return normPath(a) === normPath(b);
}

// 获取父目录
function parentPath(p) {
    p = normPath(p);
    if (!p || p === ".") return null;
    // 盘符根 C:\ 无父目录
    if (/^[A-Za-z]:\\$/.test(p)) return null;
    // UNC根 \\server\share 无父目录
    if (/^\\\\[^\\]+\\[^\\]+$/.test(p)) return null;
    const idx = p.lastIndexOf("\\");
    if (idx < 0) return null; // 无父目录
    if (idx <= 2) return p.substring(0, 3); // C:\Users → C:\
    return p.substring(0, idx);
}
