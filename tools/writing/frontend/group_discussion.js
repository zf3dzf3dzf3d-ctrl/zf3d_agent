// ========== group_discussion.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['group_discussion']) {
    window.Tools.allTools['group_discussion'] = {
    group_discussion: {
        sys: "你是群聊模拟器。模拟一个群聊场景，多个角色围绕主题展开讨论，各抒己见、互相回应，生成生动的群聊记录。",
        temp: 0.7,
        build: function(a, t) { return "主题："+t+"\n参与角色："+(a.roles||"3-5个不同观点的角色")+"\n轮数："+(a.rounds||"3-5轮"); }
    },
    };
}
