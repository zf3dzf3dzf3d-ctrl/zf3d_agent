// ========== translate_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['translate_text']) {
    window.Tools.allTools['translate_text'] = {
    translate_text: {
        sys: "你是专业翻译。准确翻译文本，保持原文的语气和风格。只输出译文，不添加解释。",
        temp: 0.3,
        build: function(a, t) { return "目标语言："+(a.target_lang||"英语")+"\n\n原文：\n"+t; }
    },
    };
}
