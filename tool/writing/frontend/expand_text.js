// ========== expand_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['expand_text']) {
    window.Tools.allTools['expand_text'] = {
    expand_text: {
        sys: "你是专业内容扩写专家。在保持原文主旨和风格的基础上，丰富细节、补充论据、扩展场景，使内容更加充实饱满。只输出扩写后的完整文本。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"扩充一倍")+"\n方向："+(a.direction||"补充细节和论据")+"\n要求：保持原文主旨，丰富内容。"; }
    },
    };
}
