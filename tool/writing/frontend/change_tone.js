// ========== change_tone.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['change_tone']) {
    window.Tools.allTools['change_tone'] = {
    change_tone: {
        sys: "你是语气改写专家。将文本转换为指定语气，保持核心内容不变。直接输出改写后的文本。",
        temp: 0.6,
        build: function(a, t) { return "目标语气："+(a.tone||"正式")+"\n\n原文：\n"+t; }
    },
    };
}
