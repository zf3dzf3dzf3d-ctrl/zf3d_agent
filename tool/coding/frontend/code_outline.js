// ========== code_outline.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['code_outline']) {
    window.Tools.allTools['code_outline'] = {
    code_outline: {
        type: 'function',
        function: {
            name: 'code_outline',
            description: '分析代码结构，提取函数/类/方法骨架信息。支持 .py/.js/.java 等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '代码文件路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个代码文件路径数组（批量分析）'
                    }
                },
                required: ['path']
            }
        }
    },
    };
}
