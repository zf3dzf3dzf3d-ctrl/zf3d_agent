// ========== extract_outline.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['extract_outline']) {
    window.Tools.allTools['extract_outline'] = {
    extract_outline: {
        sys: "你是文章结构分析专家。从已有文章中反向提取结构化大纲，识别标题层级、段落主题和逻辑关系；只输出大纲，不添加评论。",
        temp: 0.3,
        build: function(a, t) { return "文章：\n"+t+"\n\n格式："+(a.format||"Markdown")+"\n详细程度："+(a.detail_level||"标准"); }
    },
    };
}
