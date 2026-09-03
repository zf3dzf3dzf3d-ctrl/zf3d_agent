// ========== rate_article.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['rate_article']) {
    window.Tools.allTools['rate_article'] = {
    rate_article: {
        sys: "你是内容质量评审专家。对文章进行多维度评分（满分10分）：1)内容质量；2)逻辑结构；3)语言表达；4)创新性；5)可读性。给出每项分数和评语，最后给出总分和总评。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n评审维度："+(a.dimensions||"内容、逻辑、表达、创新、可读性"); }
    },
    };
}
