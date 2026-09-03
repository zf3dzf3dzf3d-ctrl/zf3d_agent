// ========== monitor.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['monitor']) {
    window.Tools.allTools['monitor'] = {
    monitor: {
        type: 'function',
        function: {
            name: 'monitor',
            description: '监控队列：send 排队消息触发AI，status 查状态，list 列出窗口，merge 合并队列。配合 schedule 实现无人值守。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['send', 'status', 'list', 'merge'],
                        description: '操作类型：send=向目标窗口队列发送消息（前端自动拾取触发AI），status=查询窗口最近消息，list=列出所有窗口概况，merge=合并指定窗口的排队消息+上下文到新窗口（自动清空队列）'
                    },
                    chat_id: {
                        type: 'string',
                        description: 'send操作时目标窗口ID（如 cb1、cb2）'
                    },
                    message: {
                        type: 'string',
                        description: 'send操作时要发送给AI的消息内容'
                    },
                    session_id: {
                        type: 'string',
                        description: 'status操作时单个窗口ID'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'status操作时多个窗口ID数组'
                    },
                    limit: {
                        type: 'integer',
                        description: 'status操作时每个窗口返回的最近消息数，默认5'
                    }
                },
                required: ['action']
            }
        }
    },
    // 后续在此添加更多工具定义，如 list_dir 等
};
}
