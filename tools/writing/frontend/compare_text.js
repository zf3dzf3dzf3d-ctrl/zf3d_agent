// ========== compare_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['compare_text']) {
    window.Tools.allTools['compare_text'] = {
    compare_text: {
        sys: "你是文本对比分析专家。对比两段文本的差异，从内容、结构、风格、长度等维度进行分析，用Markdown结构化输出。",
        temp: 0.4,
        build: function(a, t) { return "文本A：\n"+(a.text_a||"")+"\n\n文本B：\n"+(a.text_b||"")+"\n\n对比重点："+(a.focus||"全面对比"); }
    },
    };
}
