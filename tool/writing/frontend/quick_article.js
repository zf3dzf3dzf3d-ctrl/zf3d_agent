// ========== quick_article.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['quick_article']) {
    window.Tools.allTools['quick_article'] = {
    quick_article: {
        sys: "你是快速写作专家。根据主题和要点快速生成一篇文章，结构完整、内容充实。直接输出文章。",
        temp: 0.6,
        build: function(a, t) { return "主题："+(a.topic||"")+"\n文章类型："+(a.article_type||"通用")+"\n字数："+(a.word_count||"800")+"\n要点："+(a.points||t||"无"); }
    },
    };
}
