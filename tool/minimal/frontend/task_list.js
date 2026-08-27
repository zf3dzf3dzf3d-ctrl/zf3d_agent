// ========== task_list.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['task_list']) {
    window.Tools.allTools['task_list'] = {
    task_list: {
        type: 'function',
        function: {
            name: 'task_list',
            description: '任务清单管理。create/show/update/add/delete。状态：pending/in_progress/completed/skipped。强制规则：预计调用3个及以上工具的任务必须先用本工具创建清单，再开始执行；每项开始置in_progress、完成置completed，全部完成后才调用task_complete。右侧任务面板会实时向用户展示进度。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'show', 'update', 'add', 'delete'],
                        description: '操作类型：create=创建新清单，show=展示清单（不传 id 则列出全部），update=更新任务状态，add=向已有清单添加任务，delete=删除任务或整个清单'
                    },
                    title: {
                        type: 'string',
                        description: '任务清单标题（create 时必填）或新任务标题（add 时必填）'
                    },
                    tasks: {
                        type: 'array',
                        description: '（create 时）任务列表，每项可为字符串（任务名）或对象 {title, status, detail}',
                        items: {}
                    },
                    id: {
                        type: 'string',
                        description: '任务清单ID（show/update/add/delete 时需传入，创建时生成的 tl_ 开头的ID）'
                    },
                    task_id: {
                        type: 'integer',
                        description: '（update/delete 时）任务序号，如 1、2、3'
                    },
                    status: {
                        type: 'string',
                        enum: ['pending', 'in_progress', 'completed', 'skipped'],
                        description: '（update 时）新状态'
                    },
                    detail: {
                        type: 'string',
                        description: '（update 时可选）任务备注/详情'
                    }
                },
                required: ['action']
            }
        }
    },
    };
}
