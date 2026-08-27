// ========== fact_check.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['fact_check']) {
    window.Tools.allTools['fact_check'] = {
    fact_check: {
        sys: "你是事实核查专家。检查文本中可能存在的事实错误、数据错误和逻辑漏洞，逐条列出问题并给出核查建议。如果内容准确无误，请明确说明。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n请逐条核查事实。"; }
    },
    };
}
