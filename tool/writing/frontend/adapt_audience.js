// ========== adapt_audience.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['adapt_audience']) {
    window.Tools.allTools['adapt_audience'] = {
    adapt_audience: {
        sys: "你是内容适配专家。把文章改写成适合指定目标读者阅读的版本：调整词汇难度、句式复杂度、举例方式，保留原文核心信息不改变主旨。直接输出改写后的完整文章。",
        temp: 0.6,
        build: function(a, t) { return "目标读者："+(a.audience||"大众读者")+"\n\n原文：\n"+t; }
    },
    };
}
