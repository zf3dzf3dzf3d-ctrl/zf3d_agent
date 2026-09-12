// ========== role_brainstorm.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['role_brainstorm']) {
    window.Tools.allTools['role_brainstorm'] = {
    role_brainstorm: {
        sys: "你是多角色发散思维专家。从不同角色/视角对主题进行发散性思考，每个角色给出独特见解。",
        temp: 0.7,
        build: function(a, t) { return "主题："+t+"\n角色设定："+(a.roles||"产品经理、用户、开发者、投资人、批评家"); }
    },
    };
}
