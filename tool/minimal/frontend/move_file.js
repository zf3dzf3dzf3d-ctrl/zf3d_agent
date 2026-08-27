// ========== move_file.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['move_file']) {
    window.Tools.allTools['move_file'] = {
    move_file: {
        type: 'function',
        function: {
            name: 'move_file',
            description: '移动/重命名文件目录。支持批量，自动创建父目录。',
            parameters: {
                type: 'object',
                properties: {
                    src: {
                        type: 'string',
                        description: '（单文件）源文件路径'
                    },
                    dst: {
                        type: 'string',
                        description: '（单文件）目标路径'
                    },
                    moves: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                src: { type: 'string', description: '源路径' },
                                dst: { type: 'string', description: '目标路径' }
                            }
                        },
                        description: '（批量）移动数组，每项 {src, dst}'
                    },
                    overwrite: {
                        type: 'boolean',
                        description: '目标已存在时是否覆盖（默认 false）'
                    }
                },
                required: []
            }
        }
    },
    };
}
