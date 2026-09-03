// ========== shorten_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['shorten_text']) {
    window.Tools.allTools['shorten_text'] = {
    shorten_text: {
        sys: "你是专业内容精简专家。在保持原文核心信息和逻辑完整的前提下，删减冗余、压缩表达，使内容更加简洁有力。只输出精简后的完整文本。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"缩短一半")+"\n要求：保留核心信息，删减冗余。"; }
    },
    };
}
