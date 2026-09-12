// ========== interpret_document.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['interpret_document']) {
    window.Tools.allTools['interpret_document'] = {
    interpret_document: {
        sys: "你是文档解读专家。对文档进行深度解读：提炼核心观点、梳理逻辑脉络、提取关键数据、回答针对性问题。",
        temp: 0.4,
        build: function(a, t) { return "文档内容：\n"+t+"\n\n解读重点："+(a.focus||"核心观点和逻辑脉络"); }
    },
    };
}
