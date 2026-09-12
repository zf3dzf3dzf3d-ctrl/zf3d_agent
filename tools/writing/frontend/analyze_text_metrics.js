// ========== analyze_text_metrics.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['analyze_text_metrics']) {
    window.Tools.allTools['analyze_text_metrics'] = {
    analyze_text_metrics: {
        type: 'function',
        function: {
            name: 'analyze_text_metrics',
            description: '统计文本的基本指标：字符数、中英文、标点、段落、句子、长句、阅读时间（本地工具，不调用模型）。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '需要统计的文本' },
                    path: { type: 'string', description: '可选：文本文件路径' }
                },
                required: []
            }
        }
    },
    };
}
