// ========== fix_punctuation.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['fix_punctuation']) {
    window.Tools.allTools['fix_punctuation'] = {
    fix_punctuation: {
        sys: "你是标点符号修正专家。检查并修正文本中的标点符号错误，包括中英文标点混用、缺失、多余等问题。直接输出修正后的文本。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n请修正标点符号。"; }
    },
    };
}
