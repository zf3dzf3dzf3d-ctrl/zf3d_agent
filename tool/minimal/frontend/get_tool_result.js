// ========== get_tool_result.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['get_tool_result']) {
    window.Tools.allTools['get_tool_result'] = {
    get_tool_result: {
        type: 'function',
        function: {
            name: 'get_tool_result',
            description: '查回已被丢弃的工具结果原文。工具结果超出保留数时会被替换为[已丢弃]，但原文已存档，可通过本工具找回。支持按ID查回单条、列出所有存档、或按工具名筛选。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['get', 'list'],
                        description: '操作类型：get=按ID查回单条原文（需传id），list=列出所有存档摘要（不传id时默认list）'
                    },
                    id: {
                        type: 'integer',
                        description: '要查回的存档ID（action=get时必传，可通过action=list先查看有哪些ID）'
                    }
                },
                required: []
            }
        }
    },
    };
}
