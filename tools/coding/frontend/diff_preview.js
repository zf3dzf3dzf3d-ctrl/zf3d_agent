// ========== diff_preview.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['diff_preview']) {
    window.Tools.allTools['diff_preview'] = {
    diff_preview: {
        type: 'function',
        function: {
            name: 'diff_preview',
            description: '查看 Git 差异(git diff)。staged/unstaged 可选，可指定文件。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Git 仓库路径（默认项目根目录）'
                    },
                    staged: {
                        type: 'boolean',
                        description: 'true=查看暂存区差异(git diff --cached)，false=查看工作区差异(git diff)，默认 false'
                    },
                    file: {
                        type: 'string',
                        description: '（单个）指定文件路径过滤差异（可选，如 src/app.js）'
                    },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）指定文件路径数组过滤差异（与 file 二选一）'
                    },
                    max_lines: {
                        type: 'integer',
                        description: '最大返回行数（默认 200，防止输出过长）'
                    }
                },
                required: []
            }
        }
    },
    };
}
