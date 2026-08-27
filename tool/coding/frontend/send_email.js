// ========== send_email.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['send_email']) {
    window.Tools.allTools['send_email'] = {
    send_email: {
        type: 'function',
        function: {
            name: 'send_email',
            description: '发送邮件，需预设 SMTP。支持纯文本和 HTML。',
            parameters: {
                type: 'object',
                properties: {
                    subject: { type: 'string', description: '邮件主题（标题）' },
                    body: { type: 'string', description: '邮件正文内容' },
                    to: { type: 'string', description: '收件人邮箱地址。不传则使用设置中配置的默认收件人。' },
                    is_html: { type: 'boolean', description: '正文是否为 HTML 格式，默认 false（纯文本）' }
                },
                required: ['subject', 'body']
            }
        }
    },

    };
}
