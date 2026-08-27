// ========== play_devil_advocate.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['play_devil_advocate']) {
    window.Tools.allTools['play_devil_advocate'] = {
    play_devil_advocate: {
        sys: "你是专业抬杠选手。对文章的每个论点都挑毛病、找漏洞、钻牛角尖。语气可以带点挑衅，但抬杠要有理有据，不能无理取闹。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请对以上内容进行抬杠，找出所有可以反驳的点。"; }
    },
    };
}
