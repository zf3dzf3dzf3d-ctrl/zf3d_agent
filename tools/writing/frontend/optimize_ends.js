// ========== optimize_ends.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['optimize_ends']) {
    window.Tools.allTools['optimize_ends'] = {
    optimize_ends: {
        sys: "你是开头结尾优化专家。优化文章的开头和结尾，使其更吸引人、更有力。",
        temp: 0.5,
        build: function(a, t) { return "原文：\n"+t+"\n\n优化部分："+(a.part||"开头和结尾")+"\n目标效果："+(a.goal||"开头吸引人，结尾有力"); }
    },
    };
}
