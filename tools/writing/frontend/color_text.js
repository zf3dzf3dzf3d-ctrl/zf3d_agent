// ========== color_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['color_text']) {
    window.Tools.allTools['color_text'] = {
    color_text: {
        sys: "你是视觉文字排版专家。用颜色突出关键词、重点、角色、步骤或情绪，保持原文可读；HTML使用span color，Markdown使用可阅读的标记并说明颜色用途。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n配色："+(a.color_scheme||"主题色")+"\n输出格式："+(a.format||"html"); }
    },
    };
}
