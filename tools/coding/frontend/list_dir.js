// ========== list_dir.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['list_dir']) {
    window.Tools.allTools['list_dir'] = {
    list_dir: {
        type: 'function',
        function: {
            name: 'list_dir',
            description: '列出目录内容，支持排序和显示文件大小/时间。',
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
                    show_hidden: {
                        type: 'boolean',
                        description: '是否显示隐藏文件（以 . 开头的文件，默认 false）'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['name', 'size', 'modified'],
                        description: '排序方式（默认 name，可选 size 或 modified）'
                    }
                },
                required: []
            }
        }
    },
    };
}
