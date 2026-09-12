// ========== proofread_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['proofread_text']) {
    window.Tools.allTools['proofread_text'] = {
    proofread_text: {
        sys: "你是专业校对编辑。检查文本中的错别字、语法错误、标点问题和逻辑漏洞，逐条列出问题并给出修改建议。如果没有问题，说明文本已无错误。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n请逐条列出错误和修改建议。"; }
    },
    };
}
