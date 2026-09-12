// ========== replace_text.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['replace_text']) {
    window.Tools.allTools['replace_text'] = {
    replace_text: {
        type: 'function',
        function: {
            name: 'replace_text',
            description: '文件内查找替换文本，自动备份 .bak。支持单/多文件批量替换。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单文件）文件路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多文件）文件路径数组，批量替换多个文件中的相同文本'
                    },
                    old_text: {
                        type: 'string',
                        description: '要查找的旧文本（精确匹配）'
                    },
                    new_text: {
                        type: 'string',
                        description: '替换后的新文本'
                    },
                    all: {
                        type: 'boolean',
                        description: '是否替换所有匹配（true=全部替换，false=仅第一处，默认 true）'
                    },
                    backup: {
                        type: 'boolean',
                        description: '是否备份原文件为 .bak（默认 true）'
                    }
                },
                required: ['old_text', 'new_text']
            }
        }
    },
    };
}
