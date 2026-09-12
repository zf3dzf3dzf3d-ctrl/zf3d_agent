// ========== detect_sensitive.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['detect_sensitive']) {
    window.Tools.allTools['detect_sensitive'] = {
    detect_sensitive: {
        type: 'function',
        function: {
            name: 'detect_sensitive',
            description: '检测文本中的敏感词、违规词和广告法极限词（本地工具，不调用模型）。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '需要检测的文本' },
                    path: { type: 'string', description: '可选：文本文件路径' },
                    categories: { type: 'string', description: '检测类别，逗号分隔：广告法,平台,政治；默认全部' }
                },
                required: []
            }
        }
    },
    };
}
