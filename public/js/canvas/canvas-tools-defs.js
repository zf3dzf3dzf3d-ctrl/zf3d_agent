// ========== public/js/canvas/canvas-tools-defs.js ==========
// 流程图（节点图）分类：独立工具分类，与「极简/编程/写作」并列。
// 只含工具定义 + 分类注册（前端声明层）；
// 执行逻辑仍在 app-canvas-agent.js（后端/内核执行层，Tools.execute 前置拦截）。
// 加载顺序要求：tools-defs-registry.js 之后、app-canvas-agent.js 之前/之后均可。
window.registerToolDefs({
  categories: {
    "流程图": {
      "icon": "🧬",
      "desc": "无限画布多智能体节点图：动态建节点、读状态、跑节点、固化/删除，含全局上下文池与工具仓库",
      "tools": [
        "task_complete",
        "switch_tool_category",
        "ask_user",
        "create_node",
        "read_node",
        "read_global_context",
        "read_tool_store",
        "run_node",
        "delete_node",
        "delete_chain",
        "undo_chain",
        "set_node_fixed",
        "reassign_node",
        "get_canvas_status",
        "get_credits",
        "ask_help",
        "set_charter",
        "get_charter",
        "final_report",
        "analyze_project",
        "read_shared_context"
      ]
    }
  },
  tools: {
    "create_node": {
      "type": "function",
      "function": {
        "name": "create_node",
        "description": "动态新建流程图节点（正向拆解 / 反向倒推），自动连线并创建会话锚点。支持派小弟协议 v1.1 标准任务包：goal/accept/deliverable/timeout/assigned_to/extra_deps。建依赖边前自动 DFS 环路检测，成环拒绝。",
        "parameters": {
          "type": "object",
          "properties": {
            "label": { "type": "string", "description": "节点名称" },
            "prompt": { "type": "string", "description": "节点任务提示词" },
            "parent_id": { "type": "string", "description": "父节点 id（缺省用当前会话锚点）" },
            "direction": { "type": "string", "enum": ["before", "after"], "description": "反向倒推(before)/正向拆解(after)，默认 after" },
            "node_type": { "type": "string", "enum": ["task", "start", "end", "review"], "description": "节点类型，默认 task" },
            "goal": { "type": "string", "description": "任务包：做什么（一句话目标）" },
            "accept": { "type": "string", "description": "任务包：验收标准（可检查的，无验收标准不发任务）" },
            "deliverable": { "type": "string", "description": "任务包：产出物（文件路径/产物说明）" },
            "timeout": { "type": "integer", "description": "任务包：超时秒数，默认 300" },
            "assigned_to": { "type": "string", "description": "任务包：派给哪个小弟（节点/智能体名称），缺省由执行节点自己干" },
            "extra_deps": { "type": "array", "items": { "type": "string" }, "description": "额外依赖节点 id 列表（在 parent 之外追加逻辑依赖，成环会被拒绝）" },
            "layer_id": { "type": "string", "description": "目标流程图图层 id（缺省用当前会话绑定图层）" }
          },
          "required": ["label"]
        }
      }
    },
    "read_node": {
      "type": "function",
      "function": {
        "name": "read_node",
        "description": "读取任意节点的状态、属性与最近对话记录",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "节点 id" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" },
            "limit": { "type": "integer", "description": "返回最近对话条数，默认 6" }
          },
          "required": ["node_id"]
        }
      }
    },
    "read_global_context": {
      "type": "function",
      "function": {
        "name": "read_global_context",
        "description": "读取全局上下文 + 状态信箱：所有节点最近结论（上下文池）+ 最近事件流（waiting/blocked/timeout/reassigned 等状态事件），主脑用它监控小弟动态",
        "parameters": {
          "type": "object",
          "properties": {
            "layer_id": { "type": "string", "description": "图层 id（可选）" },
            "limit": { "type": "integer", "description": "每个节点返回结论条数" },
            "event_limit": { "type": "integer", "description": "返回最近事件条数，默认 30" },
            "event_type": { "type": "string", "description": "按事件类型过滤：created/running/success/failed/waiting/blocked/reassigned/timeout/heartbeat/note" }
          },
          "required": []
        }
      }
    },
    "read_tool_store": {
      "type": "function",
      "function": {
        "name": "read_tool_store",
        "description": "读取全局工具结果仓库，复用历史工具调用结果，避免重复调用",
        "parameters": {
          "type": "object",
          "properties": {
            "tool": { "type": "string", "description": "按工具名过滤" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" },
            "limit": { "type": "integer", "description": "数量限制" }
          },
          "required": []
        }
      }
    },
    "run_node": {
      "type": "function",
      "function": {
        "name": "run_node",
        "description": "执行指定节点（前置依赖未满足会被拒绝；固化节点不可重跑），完成后自动向下游接力",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "节点 id" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": ["node_id"]
        }
      }
    },
    "delete_node": {
      "type": "function",
      "function": {
        "name": "delete_node",
        "description": "软删除无效节点（不污染全局，其他节点与工具结果保留）",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "节点 id" },
            "reason": { "type": "string", "description": "删除原因（软删除备注）" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": ["node_id"]
        }
      }
    },
    "delete_chain": {
      "type": "function",
      "function": {
        "name": "delete_chain",
        "description": "链路批量软删除：从指定节点出发，沿逻辑依赖向下游（默认）或上游遍历，整条链一次软删除。固化节点默认保护，遇固化节点自动中止。可用 undo_chain 一键恢复。",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "起始节点 id（缺省用当前会话锚点）" },
            "direction": { "type": "string", "enum": ["downstream", "upstream"], "description": "遍历方向：downstream=向下游（默认），upstream=向上游" },
            "reason": { "type": "string", "description": "删除原因（软删除备注）" },
            "force": { "type": "boolean", "description": "true 时允许删除链路上的固化节点（慎用）" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": []
        }
      }
    },
    "undo_chain": {
      "type": "function",
      "function": {
        "name": "undo_chain",
        "description": "链路删除的整体撤销：恢复最近一次 delete_chain 批量删除的全部节点（状态原样还原）。",
        "parameters": {
          "type": "object",
          "properties": {
            "layer_id": { "type": "string", "description": "图层 id（可选，缺省恢复最近一次记录）" }
          },
          "required": []
        }
      }
    },
    "set_node_fixed": {
      "type": "function",
      "function": {
        "name": "set_node_fixed",
        "description": "半固化：设置节点固定（定稿不可重跑）或解锁（可继续迭代）",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "节点 id" },
            "is_fixed": { "type": "boolean", "description": "true 固化 / false 解锁" },
            "note": { "type": "string", "description": "备注" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": ["node_id", "is_fixed"]
        }
      }
    },
    "reassign_node": {
      "type": "function",
      "function": {
        "name": "reassign_node",
        "description": "小弟热替换：任务完成不顺利时换新执行者。attempt+1、状态重置、信誉自动扣分。attempt>=3 自动升级回主脑。",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "要换人的节点 id" },
            "new_worker": { "type": "string", "description": "新执行者标识（如 worker-2 / deepseek / glm），缺省自动命名" },
            "reason": { "type": "string", "description": "换人原因（将写入事件流与旧执行者信誉档案）" },
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": ["node_id"]
        }
      }
    },
    "get_credits": {
      "type": "function",
      "function": {
        "name": "get_credits",
        "description": "主脑查信誉档案：所有小弟的信誉分（credit）、通过/失败次数（done/fail）。派活前先查，优先派 credit 高的，低分者设更长 timeout。",
        "parameters": {
          "type": "object",
          "properties": {
            "limit": { "type": "integer", "description": "返回条数（默认 20，按 credit 降序）" }
          },
          "required": []
        }
      }
    },
    "ask_help": {
      "type": "function",
      "function": {
        "name": "ask_help",
        "description": "小弟反向求助（blocked/waiting）：发现前置条件不满足、缺信息、干不下去时用。标准求助帧自动入主脑信箱（事件流），不硬编造结果。",
        "parameters": {
          "type": "object",
          "properties": {
            "node_id": { "type": "string", "description": "求助节点 id（缺省用当前会话锚点）" },
            "block_type": { "type": "string", "enum": ["blocked", "waiting"], "description": "blocked=受阻干不下去（默认），waiting=缺信息可等" },
            "need": { "type": "string", "description": "需要主脑提供什么（信息/权限/上游产出）" },
            "tried": { "type": "string", "description": "已经尝试过什么" },
            "suggest": { "type": "string", "description": "建议的处理方案（可选）" }
          },
          "required": ["need"]
        }
      }
    },
    "get_canvas_status": {
      "type": "function",
      "function": {
        "name": "get_canvas_status",
        "description": "获取整张流程图运行进度与全部节点状态",
        "parameters": {
          "type": "object",
          "properties": {
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": []
        }
      }
    },
    "set_charter": {
      "type": "function",
      "function": {
        "name": "set_charter",
        "description": "【目标链统一协议 v1.0·监工专用】登记人类总目标 charter（人类原话一字不改存档）。设立后全图节点元数据自动携带该总目标，回执单必须含「推进charter」字段，固化前第0关验收。人类更新需求时重设即重开目标链。",
        "parameters": {
          "type": "object",
          "properties": {
            "text": { "type": "string", "description": "人类总目标原话（一字不改）" },
            "layer_id": { "type": "string", "description": "图层 id（可选，默认当前）" }
          },
          "required": ["text"]
        }
      }
    },
    "get_charter": {
      "type": "function",
      "function": {
        "name": "get_charter",
        "description": "查询当前图层的人类总目标 charter（含设立时间与设立人），未设立会提示。",
        "parameters": {
          "type": "object",
          "properties": {
            "layer_id": { "type": "string", "description": "图层 id（可选）" }
          },
          "required": []
        }
      }
    },
    "final_report": {
      "type": "function",
      "function": {
        "name": "final_report",
        "description": "【目标链统一协议 v1.0·监工专用】生成终审报告：charter、节点完成度、信誉榜、未完成清单。ready=true 表示全图固化完毕，可交人类终审；不满意则重设 charter 重开目标链。",
        "parameters": {
          "type": "object",
          "properties": {
            "layer_id": { "type": "string", "description": "图层 id（可选，默认当前）" }
          },
          "required": []
        }
      }
    },
    "analyze_project": {
      "type": "function",
      "function": {
        "name": "analyze_project",
        "description": "一键扫描整个项目目录：自动生成项目结构分析 + mermaid 流程图，并自动部署到无限画布成为可交互节点图（每个节点自动绑定会话锚点，可双击接力运行）。分析结果同时存入共享上下文池（read_shared_context 可读）。action=status 只查询是否已有分析结果。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "enum": ["analyze", "status"], "description": "analyze=扫描并生成节点图（默认），status=只查询已有分析结果" },
            "root": { "type": "string", "description": "项目内相对路径（默认整个项目根）" },
            "max_depth": { "type": "integer", "description": "扫描深度上限（默认 6，最大 10）" }
          },
          "required": []
        }
      }
    },
    "read_shared_context": {
      "type": "function",
      "function": {
        "name": "read_shared_context",
        "description": "读取共享上下文池：analyze_project 写入的项目分析结果（summary/mermaid/files/routes），所有节点、所有对话都可读。",
        "parameters": {
          "type": "object",
          "properties": {
            "key": { "type": "string", "description": "上下文键（默认 project_analysis）" },
            "part": { "type": "string", "enum": ["summary", "mermaid", "files", "routes", "all"], "description": "读取哪部分（默认 summary）" },
            "limit": { "type": "integer", "description": "列表返回条数上限（默认 200）" }
          },
          "required": []
        }
      }
    }
  }
});
