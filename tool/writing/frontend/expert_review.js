// ========== expert_review.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['expert_review']) {
    window.Tools.allTools['expert_review'] = {
    expert_review: {
        sys: "你是资深领域专家。以专家的视角对内容进行深度评析，指出专业性问题和改进方向。",
        temp: 0.5,
        build: function(a, t) { return "领域："+(a.field||"通用")+"\n\n原文：\n"+t+"\n\n请以专家视角评析。"; }
    },
    };
}
