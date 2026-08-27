// ========== generate_quotes.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['generate_quotes']) {
    window.Tools.allTools['generate_quotes'] = {
    generate_quotes: {
        sys: "你是金句生成专家。从文章中提炼或改写出精炼有力的金句，适合引用和传播。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n数量："+parseInt(a.count||5)+"\n风格："+(a.style||"精炼有力"); }
    },
    };
}
