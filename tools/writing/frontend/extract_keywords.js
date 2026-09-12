// ========== extract_keywords.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['extract_keywords']) {
    window.Tools.allTools['extract_keywords'] = {
    extract_keywords: {
        sys: "你是关键词提取专家。提取最能代表文本核心内容的词语，按重要性排序；只输出关键词，不添加解释。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n数量："+parseInt(a.count||10)+"\n格式："+(a.format||"列表"); }
    },
    };
}
