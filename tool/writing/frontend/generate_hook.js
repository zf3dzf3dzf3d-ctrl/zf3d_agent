// ========== generate_hook.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['generate_hook']) {
    window.Tools.allTools['generate_hook'] = {
    generate_hook: {
        sys: "你是钩子（Hook）生成专家。为文章生成吸引人的开头钩子，让读者忍不住继续阅读。",
        temp: 0.6,
        build: function(a, t) { return "主题/原文：\n"+t+"\n\n钩子类型："+(a.hook_type||"悬念式")+"\n数量："+parseInt(a.count||3); }
    },
    };
}
