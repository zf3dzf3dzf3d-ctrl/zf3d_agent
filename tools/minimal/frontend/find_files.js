// ========== find_files.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['find_files']) {
    window.Tools.allTools['find_files'] = {
    find_files: {
        type: 'function',
        function: {
            name: 'find_files',
            description: '按 glob 模式查找文件，如 **/*.py。可按扩展名过滤。',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'glob 模式，如 **/*.py、*.json、src/**/*.ts'
                    },
                    path: {
                        type: 'string',
                        description: '（单目录）搜索根目录（默认当前目录）'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多目录）搜索根目录数组'
                    },
                    max_results: {
                        type: 'integer',
                        description: '最大返回文件数（默认 50）'
                    },
                    file_type: {
                        type: 'string',
                        description: '按扩展名过滤，如 .py 或 .js'
                    }
                },
                required: ['pattern']
            }
        }
    },
    };
}
