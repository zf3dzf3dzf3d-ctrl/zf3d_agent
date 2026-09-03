// ========== write_file.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['write_file']) {
    window.Tools.allTools['write_file'] = {
    write_file: {
        type: 'function',
        function: {
            name: 'write_file',
            description: '写入文本文件，已存在则备份 .bak。path+content 单文件，files 数组批量写。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（单文件时用）'
                    },
                    content: {
                        type: 'string',
                        description: '文件内容（单文件时用）'
                    },
                    files: {
                        type: 'array',
                        description: '批量文件数组，每项 {path, content}'
                    }
                },
                required: []
            }
        }
    },
    };
}
