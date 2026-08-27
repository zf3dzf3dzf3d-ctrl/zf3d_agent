// ========== regex_search.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['regex_search']) {
    window.Tools.allTools['regex_search'] = {
    regex_search: {
        type: 'function',
        function: {
            name: 'regex_search',
            description: '正则表达式搜索工具（始终正则模式）。支持文件/文件夹、单路径/多路径。输出匹配行、捕获组、上下文。比 search_in_files+regex=true 更强大：自动提取捕获组、高亮匹配位置。',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: '正则表达式（必填）。如 \\bdef\\s+(\\w+) 匹配Python函数定义'
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
                    case_insensitive: {
                        type: 'boolean',
                        description: '是否不区分大小写（默认 false）'
                    },
                    max_results: {
                        type: 'integer',
                        description: '最大返回匹配数（默认 50）'
                    },
                    context_lines: {
                        type: 'integer',
                        description: '每个匹配显示几行上下文（默认 2）'
                    },
                    file_type: {
                        type: 'string',
                        description: '按扩展名过滤搜索文件，如 .py 或 .js'
                    },
                    show_groups: {
                        type: 'boolean',
                        description: '是否显示捕获组详情（默认 true）'
                    }
                },
                required: ['pattern']
            }
        }
    },

    // ===== 工单清单工具（多轮规划，批量执行） =====
    };
}
