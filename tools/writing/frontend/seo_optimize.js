// ========== seo_optimize.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['seo_optimize']) {
    window.Tools.allTools['seo_optimize'] = {
    seo_optimize: {
        sys: "你是SEO内容优化专家。输出：1)关键词分析（3-5个目标关键词、频率、密度建议）；2)标题优化建议（2-3个SEO友好标题）；3)meta描述（80-120字含关键词）；4)结构优化建议。用Markdown结构化输出，不改写原文。",
        temp: 0.4,
        build: function(a, t) { return "目标关键词："+(a.keywords||"（未指定，请自动识别）")+"\n\n原文：\n"+t; }
    },
    };
}
