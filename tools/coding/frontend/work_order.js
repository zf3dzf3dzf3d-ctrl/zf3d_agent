// ========== work_order.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['work_order']) {
    window.Tools.allTools['work_order'] = {
        type: 'function',
        function: {
            name: 'work_order',
            description: '工单清单工具。多轮规划：先创建工单、逐步添加任务项（读文件/写文件/运行命令/搜索等），可多轮修改，准备好后一次性查看全部任务并批量执行。支持按会话隔离，不同对话各自独立。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'add', 'update', 'remove', 'show', 'clear'],
                        description: '操作类型：create=创建工单（需title），add=添加任务项，update=修改任务项（需item_id），remove=删除任务项（需item_id），show=查看当前工单，clear=清空工单'
                    },
                    title: {
                        type: 'string',
                        description: '工单标题（create 时必填）'
                    },
                    item_type: {
                        type: 'string',
                        enum: ['read', 'write', 'run', 'search', 'custom'],
                        description: '任务项类型：read=读文件，write=写文件，run=运行命令，search=搜索，custom=自定义'
                    },
                    target: {
                        type: 'string',
                        description: '任务目标（文件路径/命令/搜索词等）'
                    },
                    action_desc: {
                        type: 'string',
                        description: '对该任务项的具体操作描述'
                    },
                    params: {
                        type: 'string',
                        description: '额外参数（如写入内容、搜索路径等）'
                    },
                    note: {
                        type: 'string',
                        description: '备注说明'
                    },
                    item_id: {
                        type: 'integer',
                        description: '任务项ID（update/remove 时必填）'
                    },
                    new_note: {
                        type: 'string',
                        description: '更新后的备注（update 时可选）'
                    },
                    new_status: {
                        type: 'string',
                        enum: ['pending', 'done', 'skipped'],
                        description: '更新任务状态（update 时可选）'
                    }
                },
                required: ['action']
        }
    }
};
}
