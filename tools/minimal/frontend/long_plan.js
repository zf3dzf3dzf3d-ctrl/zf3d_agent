// ========== long_plan.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.4 - 超长计划管理（MD 持久化，跨对话框接力）

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['long_plan']) {
    window.Tools.allTools['long_plan'] = {
    long_plan: {
        type: 'function',
        function: {
            name: 'long_plan',
            description: '超长计划管理（面向 5 步以上的大型任务的总体计划，持久化为 MD 文件，多个对话框可接力执行）。计划的特点：①它是覆盖整个任务的大计划，不是单次任务清单；②创建时目标/步骤可以是粗略的，允许在执行过程中通过 update 逐步明确和细化；③计划必须整体上是可完成的（目标清晰、步骤有先后依赖、不依赖未确认的外部条件）。create=创建计划；update=修订计划（更新目标/追加步骤/重写未完成步骤）；list=列出所有计划及进度；read=读计划全文；progress=勾选/跳过步骤并写日志；stats=进度概览+下一批待做步骤（新对话续做的入口）。使用规则：任务约 5 步以上、跨对话才能做完时建计划，再用 plan_batch.claim 分批执行；执行中先 read/stats 查看计划，再制定本批具体任务；每次只执行认领的批次；新对话开场若发现未完成计划，先调 stats 续做。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'update', 'list', 'read', 'progress', 'stats'],
                        description: '操作类型（update=修订计划：更新目标/追加步骤/重写未完成步骤）'
                    },
                    plan_id: {
                        type: 'string',
                        description: '计划ID（lp-开头，create 时可不传自动生成；其余操作必传）'
                    },
                    title: {
                        type: 'string',
                        description: '（create）计划标题'
                    },
                    goal: {
                        type: 'string',
                        description: '（create）最终目标/验收标准'
                    },
                    steps: {
                        type: 'array',
                        description: '（create）步骤列表，每项可为字符串或 {title, detail, deliverable, accept}',
                        items: {}
                    },
                    step_nos: {
                        type: 'array',
                        description: '（progress）要标记的步骤序号数组，如 [1,2,3]',
                        items: { type: 'integer' }
                    },
                    status: {
                        type: 'string',
                        enum: ['completed', 'skipped'],
                        description: '（progress）标记状态，默认 completed'
                    },
                    note: {
                        type: 'string',
                        description: '（progress）本批完成摘要，写入执行日志'
                    },
                    append_steps: {
                        type: 'array',
                        description: '（update）追加的步骤列表，格式同 create 的 steps，自动接到现有步骤末尾',
                        items: {}
                    },
                    reset_pending: {
                        type: 'boolean',
                        description: '（update）配合 steps 使用：清空所有未完成步骤，用 steps 重写（已完成步骤保留勾选），用于计划逐步明确后重排'
                    }
                },
                required: ['action']
            }
        }
    },
    };
}
