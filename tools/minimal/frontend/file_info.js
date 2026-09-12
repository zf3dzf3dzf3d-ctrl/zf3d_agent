// ========== file_info.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['file_info']) {
    window.Tools.allTools['file_info'] = {
    file_info: {
        type: 'function',
        function: {
            name: 'file_info',
            description: '获取文件/目录信息：大小、时间、行数等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单个）文件或目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）文件或目录路径数组'
                    }
                },
                required: []
            }
        }
    },
    };
}
