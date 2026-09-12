// ========== tools-defs-longplan.js ==========
// 超长计划系统工具定义：long_plan（计划管理）+ plan_batch（分批执行）
// 注册进 window.ToolDefinitions（见 tools-defs-registry.js）
window.registerToolDefs({
  tools: {
    "long_plan": {
      "type": "function",
      "function": {
        "name": "long_plan",
        "description": "超长计划管理（5 步以上大型任务的持久化 MD 计划，跨对话接力执行）。create=创建（拆步骤，含说明/产出/验收）；update=修订（改目标/追加/重写未完成步骤）；list=列出全部及进度；read=读全文；progress=勾选/跳过步骤并写日志；stats=进度概览+下批待做。规则：目标/步骤可先粗后细（update 逐步明确）；计划必须整体可完成。5 步以上且跨对话的任务建计划，plan_batch.claim 分批执行，每批先 read/stats 再做，只做认领批次；新对话见未完成计划先调 stats 续做。",
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
