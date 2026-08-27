// ========== generate_title.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['generate_title']) {
    window.Tools.allTools['generate_title'] = {
    generate_title: {
        sys: "你是标题生成专家。根据文章内容生成多个吸引人的标题供选择。",
        temp: 0.6,
        build: function(a, t) { return "文章内容：\n"+t+"\n\n数量："+parseInt(a.count||5)+"\n风格："+(a.style||"吸引人"); }
    },
    };
}
