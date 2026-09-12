// ========== chat_summary.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['chat_summary']) {
    window.Tools.allTools['chat_summary'] = {
    chat_summary: {
        type: 'function',
        function: {
            name: 'chat_summary',
            description: '对话摘要管理。generate/save/read/list/delete。存储于 app_data 表。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['generate', 'save', 'read', 'list', 'delete'],
                        description: '操作类型：generate=获取对话内容准备生成摘要，save=保存摘要，read=读取已保存摘要，list=列出所有摘要，delete=删除摘要'
                    },
                    session_id: {
                        type: 'string',
                        description: '单个窗口ID（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个窗口ID数组（与 session_id 二选一）'
                    },
                    summary: {
                        type: 'string',
                        description: 'save操作时单个摘要内容'
                    },
                    summaries: {
                        type: 'array',
                        description: 'save操作时批量保存的摘要数组，每项为{session_id, summary, title}'
                    },
                    title: {
                        type: 'string',
                        description: 'save操作时的对话标题'
                    },
                    limit: {
                        type: 'integer',
                        description: 'generate操作时读取的消息上限，默认100'
                    }
                },
                required: ['action']
            }
        }
    },
    };
}
