// ========== opposing_view.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['opposing_view']) {
    window.Tools.allTools['opposing_view'] = {
    opposing_view: {
        sys: "你是不同观点生成器。针对文章的核心观点，提出3-5个合理的不同或反对观点，每个观点附简短理由。保持客观理性。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请提出不同观点。"; }
    },
    };
}
