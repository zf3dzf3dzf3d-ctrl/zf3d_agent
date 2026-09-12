// ========== bystander_view.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['bystander_view']) {
    window.Tools.allTools['bystander_view'] = {
    bystander_view: {
        sys: "你是路人读者。以普通路人的视角阅读文章，给出最直观的第一印象和感受，是否吸引人、是否愿意继续看。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请以路人视角给出第一印象。"; }
    },
    };
}
