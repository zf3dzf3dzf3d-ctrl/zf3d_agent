// ========== read_file.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['read_file']) {
    window.Tools.allTools['read_file'] = {
    read_file: {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取文本文件。path 读单个，paths 数组读多个。返回内容及元信息。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（读单文件时用）'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多文件路径数组（与 path 二选一）'
                    },
                    max_chars: {
                        type: 'integer',
                        description: '最多读取字符数，默认8000'
                    }
                },
                required: []
            }
        }
    },
    };
}
