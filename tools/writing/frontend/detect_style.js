// ========== detect_style.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['detect_style']) {
    window.Tools.allTools['detect_style'] = {
    detect_style: {
        sys: "你是文风分析专家。分析文章的文风特征并输出：1)整体文风判断（正式/口语/学术/文学/新闻等）；2)用词特征（偏书面/偏口语/专业术语密度）；3)句式特征（长句为主/短句为主/句式多样）；4)改进建议。用Markdown结构化输出。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t; }
    },
    };
}
