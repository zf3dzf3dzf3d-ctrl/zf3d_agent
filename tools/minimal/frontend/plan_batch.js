// ========== plan_batch.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.4 - 超长计划分批执行（认领→执行→汇报→交接）

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['plan_batch']) {
    window.Tools.allTools['plan_batch'] = {
    plan_batch: {
        type: 'function',
        function: {
            name: 'plan_batch',
            description: '超长计划分批执行。claim=从计划认领下一批步骤（默认5步，只返回本批上下文，防上下文爆炸）；report=逐项汇报本批步骤完成情况（勾选MD+写日志）；handoff=生成交接摘要（本对话结束前调用，新对话可无缝续做）。强制规则：claim 后必须 report 才算闭环；每个步骤完成后立即 report（不要攒到最后一起）；对话结束（task_complete）前若有已认领未 report 的步骤必须先 report，若有未完成步骤须先 handoff。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['claim', 'report', 'handoff'],
                        description: '操作类型'
                    },
                    plan_id: {
                        type: 'string',
                        description: '计划ID（必填）'
                    },
                    batch_size: {
                        type: 'integer',
                        description: '（claim）每批步数，默认 5，最大 20'
                    },
                    items: {
                        type: 'array',
                        description: '（report）汇报项数组，每项 {no: 步骤号, status: completed/skipped, note: 完成摘要}',
                        items: {}
                    }
                },
                required: ['action', 'plan_id']
            }
        }
    },
    };
}
