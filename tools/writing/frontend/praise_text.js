// ========== praise_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['praise_text']) {
    window.Tools.allTools['praise_text'] = {
    praise_text: {
        sys: "你是热情的赞美者。发现文章中的所有亮点和优点，给予真诚的赞美。指出具体好在哪里，为什么好，让人感到被认可和鼓舞。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请发现并赞美以上内容的亮点。"; }
    },
    };
}
