// ========== write_outline.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['write_outline']) {
    window.Tools.allTools['write_outline'] = {
    write_outline: {
        sys: "你是大纲撰写专家。根据主题或要求生成结构化大纲，层次清晰、逻辑合理。直接输出大纲。",
        temp: 0.5,
        build: function(a, t) { return "主题："+(a.topic||t)+"\n格式："+(a.format||"Markdown")+"\n详细程度："+(a.detail_level||"标准"); }
    },
    };
}
