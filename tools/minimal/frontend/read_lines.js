// ========== read_lines.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['read_lines']) {
    window.Tools.allTools['read_lines'] = {
    read_lines: {
        type: 'function',
        function: {
            name: 'read_lines',
            description: '按行读取文件，适配中文编码。支持行范围(start/end)、统计行数(num)、关键词筛选(contains)。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（单文件时用）'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多文件）文件路径数组，批量读取多个文件的指定行（与 path 二选一）'
                    },
                    start: {
                        type: 'integer',
                        description: '起始行号（从 1 开始），默认 1'
                    },
                    end: {
                        type: 'integer',
                        description: '结束行号，省略则读到文件末尾'
                    },
                    num: {
                        type: 'boolean',
                        description: 'true 时仅统计总行数，不返回内容'
                    },
                    contains: {
                        type: 'string',
                        description: '筛选包含该关键词的行（与行范围二选一，优先于行范围）'
                    }
                },
                required: ['path']
            }
        }
    },
    };
}
