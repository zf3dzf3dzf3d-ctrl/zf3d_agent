// ========== analyze_sentiment.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['analyze_sentiment']) {
    window.Tools.allTools['analyze_sentiment'] = {
    analyze_sentiment: {
        sys: "你是情感分析专家。分析文章并输出：1)整体情感倾向（积极/消极/中性，给出百分比）；2)情绪强度（强烈/中等/温和）；3)情绪变化轨迹（按段落描述开头-中间-结尾的情绪起伏）；4)情绪把控建议。用清晰Markdown结构化输出，不要改写原文。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t; }
    },
    };
}
