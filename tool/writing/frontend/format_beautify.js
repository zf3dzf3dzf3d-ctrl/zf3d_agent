// ========== format_beautify.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['format_beautify']) {
    window.Tools.allTools['format_beautify'] = {
    format_beautify: {
        sys: "你是排版美化专家。对文本进行格式美化：优化标题层级、段落间距、列表格式、引用样式等。直接输出美化后的Markdown文本。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n输出格式："+(a.format||"Markdown"); }
    },
    };
}
