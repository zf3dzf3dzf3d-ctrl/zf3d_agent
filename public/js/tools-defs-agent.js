// ========== tools-defs-agent.js ==========
// 拆分自 tools-definitions.js，注册进 window.ToolDefinitions（见 tools-defs-registry.js）
window.registerToolDefs({
  tools: {
    "chat_context": {
      "type": "function",
      "function": {
        "name": "chat_context",
        "description": "直接读写数据库聊天记录（不触发AI回复）。read/insert/append/update/delete。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "read",
                "insert",
                "append",
                "update",
                "delete"
              ],
              "description": "操作类型：read=读取消息，insert/append=插入消息，update=修改消息，delete=删除消息"
            },
            "session_id": {
              "type": "string",
              "description": "单个窗口ID（与 session_ids 二选一）"
            },
            "session_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "多个窗口ID数组（与 session_id 二选一）"
            },
            "limit": {
              "type": "integer",
              "description": "read操作时每个窗口读取的最近消息数，默认10"
            },
            "messages": {
              "type": "array",
              "description": "insert/append操作时插入的消息数组，每项为{role, content, model_id}（可选）"
            },
            "role": {
              "type": "string",
              "description": "insert/append单条消息时的角色（user/assistant/system）"
            },
            "content": {
              "type": "string",
              "description": "insert/append单条消息时的内容，或update操作时的新内容"
            },
            "message_id": {
              "type": "integer",
              "description": "update/delete操作时指定的消息ID"
            },
            "message_ids": {
              "type": "array",
              "items": {
                "type": "integer"
              },
              "description": "delete操作时批量删除的消息ID数组"
            },
            "model_id": {
              "type": "string",
              "description": "insert/append时指定模型ID（可选）"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "chat_manage": {
      "type": "function",
      "function": {
        "name": "chat_manage",
        "description": "对话管理：create/close/move/send/list/arrange/pipeline。pipeline=画布流水线：传入 mermaid flowchart 文本（mermaid参数），自动在无限画布创建真实对话节点、按工程图布局连线，上游节点完成后自动汇流到下游，终点节点归总产出。可选 name=流水线名、model_id=节点模型、final_prompt=归总节点提示词、prompts={节点key:提示词} 定制各节点任务。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "create",
                "close",
                "move",
                "send",
                "list",
                "arrange",
                "pipeline"
              ],
              "description": "操作类型：create=新建对话，close=关闭对话，move=移动对话位置，send=向对话发送消息，list=列出所有对话，arrange=按状态排列所有对话为一排，pipeline=部署画布流水线（mermaid→真实对话节点编排）"
            },
            "mermaid": {
              "type": "string",
              "description": "pipeline 操作：mermaid flowchart 文本，如 flowchart LR; A[需求]-->B[开发]; B-->C[归总]"
            },
            "final_prompt": {
              "type": "string",
              "description": "pipeline 操作：归总（终点）节点的提示词模板"
            },
            "prompts": {
              "type": "object",
              "description": "pipeline 操作可选：各节点定制提示词 {节点key: 提示词}"
            },
            "chat_id": {
              "type": "string",
              "description": "目标对话ID（如 cb1）。close/move/send 操作时需要。create 和 list 可省略。close 时传 \"all\" 关闭所有对话"
            },
            "message": {
              "type": "string",
              "description": "要发送的消息内容（send 操作时使用，create 操作时可附带初始消息自动发送）"
            },
            "model_id": {
              "type": "string",
              "description": "指定模型ID（create 操作可选，不传则用当前活跃对话的模型）"
            },
            "x": {
              "type": "integer",
              "description": "对话框左上角X坐标（move 操作时使用，create 操作可选指定位置）"
            },
            "y": {
              "type": "integer",
              "description": "对话框左上角Y坐标（move 操作时使用，create 操作可选指定位置）"
            },
            "auto_send": {
              "type": "boolean",
              "description": "create 操作时是否自动发送 message（默认 false）。为 true 时会创建对话并立即发送 message"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "deploy_flowchart": {
      "type": "function",
      "function": {
        "name": "deploy_flowchart",
        "description": "炫酷流程图部署：把 mermaid flowchart 文本渲染成无限画布上的霓虹发光工程图（纯视觉展示层）。特点：玻璃拟态霓虹节点带呼吸光晕、渐变描边旋转、沿线奔跑的粒子发光连线、节点错落弹出入场动画。用户要求'画流程图/画到画布上/炫酷的图'时用这个（而不是 chat_manage pipeline，那个会创建真实对话节点）。",
        "parameters": {
          "type": "object",
          "properties": {
            "mermaid": {
              "type": "string",
              "description": "mermaid flowchart 文本，如 flowchart LR\n  A[选题] --> B[写开头]\n  B --> C[写正文]\n  C --> D[润色]"
            },
            "x": {
              "type": "integer",
              "description": "可选：流程图区域起始X坐标（不传则画在当前视口中央）"
            },
            "y": {
              "type": "integer",
              "description": "可选：流程图区域起始Y坐标"
            }
          },
          "required": [
            "mermaid"
          ]
        }
      }
    },
    "clear_flowcharts": {
      "type": "function",
      "function": {
        "name": "clear_flowcharts",
        "description": "清除画布上所有 FlowGlam 炫酷流程图图层。",
        "parameters": {
          "type": "object",
          "properties": {}
        }
      }
    },
    "chat_summary": {
      "type": "function",
      "function": {
        "name": "chat_summary",
        "description": "对话摘要管理。generate/save/read/list/delete。存储于 app_data 表。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "generate",
                "save",
                "read",
                "list",
                "delete"
              ],
              "description": "操作类型：generate=获取对话内容准备生成摘要，save=保存摘要，read=读取已保存摘要，list=列出所有摘要，delete=删除摘要"
            },
            "session_id": {
              "type": "string",
              "description": "单个窗口ID（与 session_ids 二选一）"
            },
            "session_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "多个窗口ID数组（与 session_id 二选一）"
            },
            "summary": {
              "type": "string",
              "description": "save操作时单个摘要内容"
            },
            "summaries": {
              "type": "array",
              "description": "save操作时批量保存的摘要数组，每项为{session_id, summary, title}"
            },
            "title": {
              "type": "string",
              "description": "save操作时的对话标题"
            },
            "limit": {
              "type": "integer",
              "description": "generate操作时读取的消息上限，默认100"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "search_chat": {
      "type": "function",
      "function": {
        "name": "search_chat",
        "description": "全局搜索对话内容。keyword/keywords 搜索，session_id 限定窗口。match_mode: any(OR)/all(AND)。",
        "parameters": {
          "type": "object",
          "properties": {
            "keyword": {
              "type": "string",
              "description": "单个搜索关键词（与 keywords 二选一）"
            },
            "keywords": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "多个搜索关键词数组，支持同时搜索多个词（与 keyword 二选一）"
            },
            "session_id": {
              "type": "string",
              "description": "指定单个窗口ID搜索（如 cb12）。不指定则搜索全部窗口（与 session_ids 二选一）"
            },
            "session_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "指定多个窗口ID数组搜索（与 session_id 二选一）"
            },
            "match_mode": {
              "type": "string",
              "enum": [
                "any",
                "all"
              ],
              "description": "多关键词匹配模式：any=任一匹配即返回(OR,默认)，all=全部匹配才返回(AND)"
            },
            "limit": {
              "type": "integer",
              "description": "每个窗口最多返回的匹配数，默认50"
            },
            "role": {
              "type": "string",
              "description": "按角色过滤：user/assistant/tool/system。不传则不过滤"
            }
          },
          "required": []
        }
      }
    },
    "recent_questions": {
      "type": "function",
      "function": {
        "name": "recent_questions",
        "description": "查询近期用户问题。当对话中混入大量\"刷新\"\"继续\"等噪音消息导致遗忘原始问题时，用此工具快速定位用户真实意图。支持按关键字筛选（keyword）或正则表达式匹配（regex=true），指定单个窗口(session_id)或多个窗口(session_ids)。支持分页查询：limit控制每页条数（默认100），offset控制起始位置，可无限翻页查询全部历史记录。返回结果中含has_more和next_offset提示是否还有更多。",
        "parameters": {
          "type": "object",
          "properties": {
            "keyword": {
              "type": "string",
              "description": "关键字筛选。传入后只返回包含该关键字的问题，更快定位。regex=true时作为正则表达式"
            },
            "regex": {
              "type": "boolean",
              "description": "是否将keyword作为正则表达式匹配。默认false（普通文本包含匹配），true时启用正则"
            },
            "session_id": {
              "type": "string",
              "description": "指定单个窗口ID查询（如 cb1）。不指定则查询全部窗口（与 session_ids 二选一）"
            },
            "session_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "指定多个窗口ID数组查询（与 session_id 二选一）"
            },
            "limit": {
              "type": "integer",
              "description": "每页返回条数，默认100。与offset配合使用实现分页，如limit=100&offset=0查第1-100条，limit=100&offset=100查第101-200条"
            },
            "offset": {
              "type": "integer",
              "description": "起始位置（跳过多少条），默认0。与limit配合实现无限分页查询"
            },
            "filter_noise": {
              "type": "boolean",
              "description": "是否过滤噪音消息（如\"刷新\"\"继续\"\"好的\"等），默认true"
            }
          },
          "required": []
        }
      }
    },
    "query_answers": {
      "type": "function",
      "function": {
        "name": "query_answers",
        "description": "根据用户问题关键字精准查询AI回复答案。与recent_questions对应：recent_questions查用户问题，本工具查对应的AI答案。通过关键字匹配用户问题后，自动找到紧随其后的assistant回复作为答案。支持正则表达式、分页、指定窗口。适用于精准回溯历史问答。",
        "parameters": {
          "type": "object",
          "properties": {
            "keyword": {
              "type": "string",
              "description": "必填。用户问题关键字，用于匹配历史问题。regex=true时作为正则表达式"
            },
            "regex": {
              "type": "boolean",
              "description": "是否将keyword作为正则表达式匹配。默认false（普通文本包含匹配），true时启用正则"
            },
            "session_id": {
              "type": "string",
              "description": "指定单个窗口ID查询（如 cb1）。不指定则查询全部窗口"
            },
            "session_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "指定多个窗口ID数组查询"
            },
            "limit": {
              "type": "integer",
              "description": "每页返回条数，默认10，最大200。与offset配合使用实现分页"
            },
            "offset": {
              "type": "integer",
              "description": "起始位置（跳过多少条），默认0。与limit配合实现无限分页查询"
            },
            "answer_max_length": {
              "type": "integer",
              "description": "答案最大截取长度，默认2000字符"
            },
            "include_question": {
              "type": "boolean",
              "description": "是否在结果中包含原始问题内容，默认true"
            }
          },
          "required": [
            "keyword"
          ]
        }
      }
    },
    "long_term_memory": {
      "type": "function",
      "function": {
        "name": "long_term_memory",
        "description": "长期记忆管理（数据库持久化，跨对话复用）。save=保存记忆，get=读取单条或多条，search=搜索记忆，list=列出全部，delete=删除单条或多条。每条记忆含 title/content/keywords/tags。适合存储用户偏好、项目经验、工具用法等需要跨对话保留的稳定信息。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "save",
                "get",
                "search",
                "list",
                "delete"
              ],
              "description": "操作类型：save=保存记忆，get=读取单条(需memory_id)或多条(需memory_ids)，search=关键词搜索，list=列出全部，delete=删除单条(需memory_id)或多条(需memory_ids)"
            },
            "title": {
              "type": "string",
              "description": "记忆标题（save 时必填）"
            },
            "content": {
              "type": "string",
              "description": "记忆内容（save 时必填）"
            },
            "keywords": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "检索关键词（save 时可选；search 时与 keyword 二选一，支持多关键词搜索）"
            },
            "tags": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "分类标签（save 时可选）"
            },
            "memory_id": {
              "type": "string",
              "description": "记忆ID（get/delete 单条时用，与 memory_ids 二选一）"
            },
            "memory_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "记忆ID数组（get/delete 批量操作时用，与 memory_id 二选一）"
            },
            "keyword": {
              "type": "string",
              "description": "搜索关键词（search 时必填，与 keywords 二选一）"
            },
            "match_mode": {
              "type": "string",
              "enum": [
                "any",
                "all"
              ],
              "description": "多关键词匹配模式：any=任一匹配(OR,默认)，all=全部匹配(AND)。需配合 keywords 使用"
            },
            "limit": {
              "type": "integer",
              "description": "返回数量上限（search/list 时可选，默认20）"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "ram_cache": {
      "type": "function",
      "function": {
        "name": "ram_cache",
        "description": "内存缓存管理（纯内存，不落盘，读写极快）。set=写入键值对，get=读取值，delete=删除键，clear=清空全部，list=列出所有键，has=检查键是否存在。适合编程时临时缓存中间结果、传递数据、记录状态。重启后清空。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "set",
                "get",
                "delete",
                "clear",
                "list",
                "has"
              ],
              "description": "操作类型：set=写入，get=读取单个或多个，delete=删除单个或多个键，clear=清空全部，list=列出所有键，has=检查单个或多个键是否存在"
            },
            "key": {
              "type": "string",
              "description": "缓存键名（set/get/delete/has 单个操作时用，与 keys 二选一）"
            },
            "keys": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "缓存键名数组（get/delete/has 批量操作时用，与 key 二选一）"
            },
            "value": {
              "type": "string",
              "description": "缓存值（set 时必填）"
            },
            "ttl": {
              "type": "integer",
              "description": "存活秒数，超时自动失效（set 时可选，0=永久）"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "schedule": {
      "type": "function",
      "function": {
        "name": "schedule",
        "description": "定时循环执行 shell 命令。支持条件停止(stop_on_success/stop_on_output)。后台运行不阻塞。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "start",
                "stop",
                "list",
                "status"
              ],
              "description": "操作类型：start=启动定时任务，stop=停止任务，list=列出所有运行中的任务，status=查看单个任务状态"
            },
            "name": {
              "type": "string",
              "description": "任务名称（唯一标识），start/stop/status 时必填"
            },
            "code": {
              "type": "string",
              "description": "要执行的 shell 命令（start 时必填）。例如 \"echo hello\" 或 \"python backup.py\""
            },
            "interval": {
              "type": "number",
              "description": "执行间隔（秒）。默认 60 秒，最小 0.5 秒，最大 86400 秒（24小时）"
            },
            "max_times": {
              "type": "integer",
              "description": "最大执行次数。0=无限循环（默认），>0 则执行指定次数后自动停止"
            },
            "stop_on_success": {
              "type": "boolean",
              "description": "条件停止：当命令退出码为 0（成功）时自动停止任务。适用于轮询等待、重试到成功等场景。默认 false"
            },
            "stop_on_output": {
              "type": "string",
              "description": "条件停止：当命令输出中包含此字符串时自动停止任务。例如设为 \"ok\" 则输出含 ok 时停止。默认空（不检查）"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "wait": {
      "type": "function",
      "function": {
        "name": "wait",
        "description": "等待指定秒数后继续。用于延迟、轮询等。",
        "parameters": {
          "type": "object",
          "properties": {
            "seconds": {
              "type": "number",
              "description": "要等待的秒数（支持小数，如 0.5 表示半秒）。默认 1 秒，最大 300 秒（5分钟）。"
            }
          },
          "required": [
            "seconds"
          ]
        }
      }
    },
    "monitor": {
      "type": "function",
      "function": {
        "name": "monitor",
        "description": "监控队列：send 排队消息触发AI，status 查状态，list 列出窗口，merge 合并队列。配合 schedule 实现无人值守。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "send",
                "status",
                "list",
                "merge"
              ],
              "description": "操作类型：send=向目标窗口队列发送消息（前端自动拾取触发AI），status=查询窗口最近消息，list=列出所有窗口概况，merge=合并指定窗口的排队消息+上下文到新窗口（自动清空队列）"
            },
            "chat_id": {
              "type": "string",
              "description": "send操作时目标窗口ID（如 cb1、cb2）"
            },
            "message": {
              "type": "string",
              "description": "send操作时要发送给AI的消息内容"
            },
            "session_id": {
              "type": "string",
              "description": "status操作时单个窗口ID"
            },
            "session_ids": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "status操作时多个窗口ID数组"
            },
            "limit": {
              "type": "integer",
              "description": "status操作时每个窗口返回的最近消息数，默认5"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "net": {
      "type": "function",
      "function": {
        "name": "net",
        "description": "抓取网页返回文本。url 单个，urls 数组多个。自动去 HTML 标签。",
        "parameters": {
          "type": "object",
          "properties": {
            "url": {
              "type": "string",
              "description": "网页 URL（与 urls 二选一）"
            },
            "urls": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "多 URL 数组（与 url 二选一）"
            },
            "raw_html": {
              "type": "boolean",
              "description": "true 返回原始 HTML，默认 false 返回纯文本"
            },
            "max_chars": {
              "type": "integer",
              "description": "内容字符上限，默认 6000"
            }
          },
          "required": []
        }
      }
    },
    "work_order": {
      "type": "function",
      "function": {
        "name": "work_order",
        "description": "工单清单工具。多轮规划：先创建工单、逐步添加任务项（读文件/写文件/运行命令/搜索等），可多轮修改，准备好后一次性查看全部任务并批量执行。支持按会话隔离，不同对话各自独立。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "create",
                "add",
                "update",
                "remove",
                "show",
                "clear"
              ],
              "description": "操作类型：create=创建工单（需title），add=添加任务项，update=修改任务项（需item_id），remove=删除任务项（需item_id），show=查看当前工单，clear=清空工单"
            },
            "title": {
              "type": "string",
              "description": "工单标题（create 时必填）"
            },
            "item_type": {
              "type": "string",
              "enum": [
                "read",
                "write",
                "run",
                "search",
                "custom"
              ],
              "description": "任务项类型：read=读文件，write=写文件，run=运行命令，search=搜索，custom=自定义"
            },
            "target": {
              "type": "string",
              "description": "任务目标（文件路径/命令/搜索词等）"
            },
            "action_desc": {
              "type": "string",
              "description": "对该任务项的具体操作描述"
            },
            "params": {
              "type": "string",
              "description": "额外参数（如写入内容、搜索路径等）"
            },
            "note": {
              "type": "string",
              "description": "备注说明"
            },
            "item_id": {
              "type": "integer",
              "description": "任务项ID（update/remove 时必填）"
            },
            "new_note": {
              "type": "string",
              "description": "更新后的备注（update 时可选）"
            },
            "new_status": {
              "type": "string",
              "enum": [
                "pending",
                "done",
                "skipped"
              ],
              "description": "更新任务状态（update 时可选）"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    }
  },
  categories: {} // 分类统一在 tools-defs-categories.js 注册
});
