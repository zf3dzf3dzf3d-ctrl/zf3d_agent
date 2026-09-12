// ========== list_formats.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['list_formats']) {
    window.Tools.allTools['list_formats'] = {
    list_formats: {
        sys: "你是列表整理专家。将文本内容整理成清晰的列表格式。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n列表类型："+(a.list_type||"要点列表")+"\n排序："+(a.sort_by||"按原文顺序"); }
    },
    };
}
