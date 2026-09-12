// ========== wait.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['wait']) {
    window.Tools.allTools['wait'] = {
    wait: {
        type: 'function',
        function: {
            name: 'wait',
            description: '等待指定秒数后继续。用于延迟、轮询等。',
            parameters: {
                type: 'object',
                properties: {
                    seconds: {
                        type: 'number',
                        description: '要等待的秒数（支持小数，如 0.5 表示半秒）。默认 1 秒，最大 300 秒（5分钟）。'
                    }
                },
                required: ['seconds']
            }
        }
    },
    };
}
