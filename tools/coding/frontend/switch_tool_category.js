// ========== switch_tool_category.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['switch_tool_category']) {
    window.Tools.allTools['switch_tool_category'] = {
    switch_tool_category: {
        type: 'function',
        function: {
            name: 'switch_tool_category',
            description: '切换工具分类。传入空字符串可查看所有分类。',
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: '要切换到的分类名称。传入空字符串或省略时返回所有可用分类列表。'
                    }
                },
                required: []
            }
        }
    },
    };
}
