// ========== net.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['net']) {
    window.Tools.allTools['net'] = {
    net: {
        type: 'function',
        function: {
            name: 'net',
            description: '抓取网页返回文本。url 单个，urls 数组多个。自动去 HTML 标签。',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: '网页 URL（与 urls 二选一）'
                    },
                    urls: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多 URL 数组（与 url 二选一）'
                    },
                    raw_html: {
                        type: 'boolean',
                        description: 'true 返回原始 HTML，默认 false 返回纯文本'
                    },
                    max_chars: {
                        type: 'integer',
                        description: '内容字符上限，默认 6000'
                    }
                },
                required: []
            }
        }
    },

    };
}
