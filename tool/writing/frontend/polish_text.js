// ========== polish_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['polish_text']) {
    window.Tools.allTools['polish_text'] = {
    polish_text: {
        sys: "你是专业中文写作编辑。先给出1-3条简短的润色说明，然后输出润色后的完整文本。保持原文核心内容不变，优化表达、逻辑和文风。",
        temp: 0.5,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标文风："+(a.style||"更清晰")+"\n目标长度："+(a.target_length||"保持")+"\n润色重点："+(a.focus||"整体表达")+"\n约束："+(a.preserve_meaning!==false?"必须严格保持原意":"可以适度改写"); }
    },
    };
}
