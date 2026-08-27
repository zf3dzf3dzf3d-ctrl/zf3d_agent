// ========== tree_dir.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['tree_dir']) {
    window.Tools.allTools['tree_dir'] = {
    tree_dir: {
        type: 'function',
        function: {
            name: 'tree_dir',
            description: '树形显示目录内容，排除 node_modules/.git 等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单目录）目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多目录）目录路径数组'
                    },
                    max_depth: {
                        type: 'integer',
                        description: '最大遍历深度（默认 3）'
                    },
                    show_files: {
                        type: 'boolean',
                        description: '是否显示文件（默认 true，false 则只显示目录）'
                    }
                },
                required: []
            }
        }
    },
    };
}
