// ========== chat_context.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['chat_context']) {
    window.Tools.allTools['chat_context'] = {
    chat_context: {
        type: 'function',
        function: {
            name: 'chat_context',
            description: '直接读写数据库聊天记录（不触发AI回复）。read/insert/append/update/delete。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['read', 'insert', 'append', 'update', 'delete'],
                        description: '操作类型：read=读取消息，insert/append=插入消息，update=修改消息，delete=删除消息'
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
                    limit: {
                        type: 'integer',
                        description: 'read操作时每个窗口读取的最近消息数，默认10'
                    },
                    messages: {
                        type: 'array',
                        description: 'insert/append操作时插入的消息数组，每项为{role, content, model_id}（可选）'
                    },
                    role: {
                        type: 'string',
                        description: 'insert/append单条消息时的角色（user/assistant/system）'
                    },
                    content: {
                        type: 'string',
                        description: 'insert/append单条消息时的内容，或update操作时的新内容'
                    },
                    message_id: {
                        type: 'integer',
                        description: 'update/delete操作时指定的消息ID'
                    },
                    message_ids: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'delete操作时批量删除的消息ID数组'
                    },
                    model_id: {
                        type: 'string',
                        description: 'insert/append时指定模型ID（可选）'
                    }
                },
                required: ['action']
            }
        }
    },
    };
}
