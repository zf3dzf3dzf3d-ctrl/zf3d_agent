// ========== git_log.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['git_log']) {
    window.Tools.allTools['git_log'] = {
    git_log: {
        type: 'function',
        function: {
            name: 'git_log',
            description: '查看 Git 提交历史(git log)。支持限制数量、按作者过滤。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Git 仓库路径（默认项目根目录）'
                    },
                    count: {
                        type: 'integer',
                        description: '返回最近多少条提交记录（默认 20）'
                    },
                    author: {
                        type: 'string',
                        description: '按作者过滤（可选，如 "张三"）'
                    },
                    oneline: {
                        type: 'boolean',
                        description: 'true=简洁模式每行一条(默认)，false=完整信息含作者日期'
                    },
                    file: {
                        type: 'string',
                        description: '（单个）查看指定文件的提交历史（可选）'
                    },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）查看多个文件的提交历史（与 file 二选一）'
                    }
                },
                required: []
            }
        }
    },
    };
}
