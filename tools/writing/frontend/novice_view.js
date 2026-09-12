// ========== novice_view.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['novice_view']) {
    window.Tools.allTools['novice_view'] = {
    novice_view: {
        sys: "你是新手读者。以初学者/新手的视角阅读文章，指出看不懂的地方、觉得困难的概念，提出疑问。语气真实自然。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请以新手视角给出阅读感受和疑问。"; }
    },
    };
}
