// ========== convert_chars.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['convert_chars']) {
    window.Tools.allTools['convert_chars'] = {
    convert_chars: {
        sys: "你是繁简转换专家。准确进行中文繁体和简体之间的转换，保持其他内容不变。直接输出转换后的文本。",
        temp: 0.3,
        build: function(a, t) { return "转换方向："+(a.direction||"简转繁")+"\n\n原文：\n"+t; }
    },
    };
}
