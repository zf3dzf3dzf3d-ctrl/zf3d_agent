// ========== rewrite_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['rewrite_text']) {
    window.Tools.allTools['rewrite_text'] = {
    rewrite_text: {
        sys: "你是专业中文写作编辑。在严格保持原意的前提下改写文本，改变句式结构和用词表达，降低与原文的重复率。只输出改写后的完整文本，不添加解释或说明。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n改写风格："+(a.style||"自然")+"\n改写力度："+(a.strength||"中度")+"\n要求：保持原意，改变表达方式，降低重复率。"; }
    },
    };
}
