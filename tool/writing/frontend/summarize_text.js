// ========== summarize_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['summarize_text']) {
    window.Tools.allTools['summarize_text'] = {
    summarize_text: {
        sys: "你是资深内容总结专家。输出清晰的结构化总结，包含核心结论、关键事实、待办/下一步；不要添加原文没有的信息。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"中")+"\n重点："+(a.focus||"核心结论与行动项"); }
    },
    };
}
