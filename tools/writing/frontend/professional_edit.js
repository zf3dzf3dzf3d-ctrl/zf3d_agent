// ========== professional_edit.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['professional_edit']) {
    window.Tools.allTools['professional_edit'] = {
    professional_edit: {
        sys: "你是学术编辑专家。对文本进行专业级修饰，提升用词精准度、逻辑严密性和表达规范性，使其达到专业出版水平。",
        temp: 0.4,
        build: function(a, t) { return "专业领域："+(a.field||"通用")+"\n\n原文：\n"+t+"\n\n请进行专业级修饰。"; }
    },
    };
}
