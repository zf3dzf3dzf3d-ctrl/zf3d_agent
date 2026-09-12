// ========== task_complete.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['task_complete']) {
    window.Tools.allTools['task_complete'] = {
    task_complete: {
        type: 'function',
        function: {
            name: 'task_complete',
            description: '结束任务并给用户最终消息。调用后 Agent 循环终止。message 必须写清改了什么、改了哪些文件。',
            parameters: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        description: '任务是否成功完成。true=成功，false=失败'
                    },
                    message: {
                        type: 'string',
                        description: '最终消息。成功时写清修改内容和文件，失败时说明原因。'
                    },
                    scope: {
                        type: 'string',
                        enum: ['当前任务', '剩余计划'],
                        description: '完成范围。"当前任务"=只完成了本次任务（默认）；"剩余计划"=已实际完成后续全部交付，整个计划结束。'
                    }
                },
                required: ['success', 'message']
            }
        }
    },
    };
}
