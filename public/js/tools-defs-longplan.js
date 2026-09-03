// ========== tools-defs-longplan.js ==========
// 超长计划系统工具定义：long_plan（计划管理）+ plan_batch（分批执行）
// 注册进 window.ToolDefinitions（见 tools-defs-registry.js）
window.registerToolDefs({
  tools: {
    "long_plan": {
      "type": "function",
      "function": {
        "name": "long_plan",
        "description": "超长计划管理（面向 5 步以上的大型任务的总体计划，持久化为 MD 文件，多个对话框可接力执行）。计划的特点：①它是覆盖整个任务的大计划，不是单次任务清单；②创建时目标/步骤可以是粗略的，允许在执行过程中通过 update 逐步明确和细化；③计划必须整体上是可完成的（目标清晰、步骤有先后依赖、不依赖未确认的外部条件）。create=创建计划（拆成步骤，每步含说明/产出/验收）；update=修订计划（更新目标/追加步骤/重写未完成步骤，用于计划逐步明确）；list=列出所有计划及进度；read=读计划全文；progress=勾选/跳过步骤并写日志；stats=进度概览+下一批待做步骤（新对话续做的入口）。使用规则：任务约 5 步以上、跨对话才能做完时建计划，再用 plan_batch.claim 分批执行；执行中智能体应先 read/stats 查看计划，再制定本批具体任务；每次只执行认领的批次；新对话开场若发现未完成计划（系统上下文会提示），先调 stats 续做。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["create", "update", "list", "read", "progress", "stats"],
              "description": "操作类型（update=修订计划：更新目标/追加步骤/重写未完成步骤）"
            },
            "plan_id": {
              "type": "string",
              "description": "计划ID（lp-开头，create 时可不传自动生成；其余操作必传）"
            },
            "title": {
              "type": "string",
              "description": "（create）计划标题"
            },
            "goal": {
              "type": "string",
              "description": "（create）最终目标/验收标准"
            },
            "steps": {
              "type": "array",
              "description": "（create）步骤列表，每项可为字符串或 {title, detail, deliverable, accept}",
              "items": {}
            },
            "step_nos": {
              "type": "array",
              "description": "（progress）要标记的步骤序号数组，如 [1,2,3]",
              "items": { "type": "integer" }
            },
            "status": {
              "type": "string",
              "enum": ["completed", "skipped"],
              "description": "（progress）标记状态，默认 completed"
            },
            "note": {
              "type": "string",
              "description": "（progress）本批完成摘要，写入执行日志"
            },
            "append_steps": {
              "type": "array",
              "description": "（update）追加的步骤列表，格式同 create 的 steps，自动接到现有步骤末尾",
              "items": {}
            },
            "reset_pending": {
              "type": "boolean",
              "description": "（update）配合 steps 使用：清空所有未完成步骤，用 steps 重写（已完成步骤保留勾选），用于计划逐步明确后重排"
            }
          },
          "required": ["action"]
        }
      }
    },
    "plan_batch": {
      "type": "function",
      "function": {
        "name": "plan_batch",
        "description": "超长计划分批执行。claim=从计划认领下一批步骤（默认5步，只返回本批上下文，防上下文爆炸）；report=逐项汇报本批步骤完成情况（勾选MD+写日志）；handoff=生成交接摘要（本对话结束前调用，新对话可无缝续做）。强制规则：claim 后必须 report 才算闭环；每个步骤完成后立即 report（不要攒到最后一起）；对话结束（task_complete）前若有已认领未 report 的步骤必须先 report，计划未完成须先 handoff。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["claim", "report", "handoff"],
              "description": "操作类型"
            },
            "plan_id": {
              "type": "string",
              "description": "计划ID（必填）"
            },
            "batch_size": {
              "type": "integer",
              "description": "（claim）每批步数，默认 5，最大 20"
            },
            "items": {
              "type": "array",
              "description": "（report）汇报项数组，每项 {no: 步骤号, status: completed/skipped, note: 完成摘要}",
              "items": {}
            }
          },
          "required": ["action", "plan_id"]
        }
      }
    }
  }
});
