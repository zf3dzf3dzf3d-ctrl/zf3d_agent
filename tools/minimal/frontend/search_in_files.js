// ========== search_in_files.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['search_in_files']) {
    window.Tools.allTools['search_in_files'] = {
    search_in_files: {
        type: 'function',
        function: {
            name: 'search_in_files',
            description: '在文件内容中搜索关键词/正则。支持多文件/目录，上下文行显示。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '搜索关键词或正则表达式'
                    },
                    path: {
                        type: 'string',
                        description: '（单个）文件或目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）文件或目录路径数组'
                    },
                    regex: {
                        type: 'boolean',
                        description: '是否将关键词作为正则表达式（默认 false）'
                    },
                    case_insensitive: {
                        type: 'boolean',
                        description: '是否不区分大小写（默认 false）'
                    },
                    max_results: {
                        type: 'integer',
                        description: '最大返回匹配数（默认 30）'
                    },
                    context_lines: {
                        type: 'integer',
                        description: '每个匹配显示几行上下文（默认 1）'
                    },
                    file_type: {
                        type: 'string',
                        description: '按扩展名过滤搜索文件，如 .py'
                    }
                },
                required: ['keyword']
            }
        }
    },
    };
}
