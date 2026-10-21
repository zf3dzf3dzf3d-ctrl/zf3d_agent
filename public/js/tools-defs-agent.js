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
        "description": "对话管理：create/close/move/send/list/arrange/pipeline/wait/review/review_wait/macro_save/macro_list/macro_run/macro_delete/register_tool/approve_tool/disable_tool/unregister_tool/list_tools/call_tool。【跨对话指挥链】wait=异步等待目标对话回复完成并空闲（chat_id必填，可选 idle_for_ms/require_reply/timeout_ms≤720000，返回Promise不冻结页面，拿到 last_reply_excerpt）；review=给目标对话派 count 个客观审核窗（chat_id必填，count默认2/上限5，gather默认true=自动回收重审；必须先 wait 让目标说完；返回已建 pair 数）；review_wait=轮询等审核出结论（chat_id必填，可选 batch_start=review返回的批次下界/timeout_ms/pass_score/excerpt_chars，返回 pairs+score_history+min_score+passed_all+need_rework+last_excerpt+autoloop_active，全 passed 才 success；返工/挂起等已出结论态会提前回报；若 need_rework>0 且 autoloop_active=true，说明自动重审闭环仍在跑（改完→复审→passed），须沿用同一 batch_start 再次 review_wait 取终局，勿直接关链）；close 时 chat_id 传 \"self\" 关闭发起方自己（须 last_step:true，且先落盘/异常态拒绝）。典型链：create B→send B→wait B→review B→review_wait B→close self。pipeline=画布流水线：传入 mermaid flowchart 文本（mermaid参数），自动在无限画布创建真实对话节点、按工程图布局连线，上游节点完成后自动汇流到下游，终点节点归总产出。可选 name=流水线名、model_id=节点模型、final_prompt=归总节点提示词、prompts={节点key:提示词} 定制各节点任务。宏系统：macro_save(name,steps,desc)=保存宏（steps=[{use:'chat_manage',args:{action:'create',...}},...]，步骤args中可用${参数名}占位）；macro_list=列出宏库；macro_run(name,params)=运行宏，params替换占位符，逐步串行执行、失败即中止并返回已完成步骤；macro_delete(name)=删除宏。自举工具库：register_tool(name,desc,params,code,dry_run?)=注册自定义 JS 工具（code 为函数体，可用变量 args/ctx；建议先 dry_run:true+test_args 沙箱试运行），状态 pending 需审核；approve_tool(name,approved:true)=审核通过启用；disable_tool=禁用；unregister_tool=删除回滚；list_tools=列出全部；call_tool(name,args)=调用已启用工具。",
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
                "pipeline",
                "wait",
                "review",
                "review_wait",
                "register_tool",
                "approve_tool",
                "disable_tool",
                "unregister_tool",
                "list_tools",
                "call_tool"
              ],
              "description": "操作类型：create=新建对话，close=关闭对话（chat_id='self'+last_step:true=关发起方自己），move=移动对话位置，send=向对话发送消息，list=列出所有对话，arrange=按状态排列所有对话为一排，pipeline=部署画布流水线（mermaid→真实对话节点编排），wait=异步等待目标对话空闲/回复完成（chat_id必填），review=给目标对话派 count 个审核窗（chat_id+count，错峰600ms建窗，gather默认true自动回收；返回 data.batch_start=本批次时间下界，请透传给 review_wait 以隔离历史审核）；review_wait=轮询取审核结论（chat_id，可选 batch_start/timeout_ms/pass_score/excerpt_chars，返回 pairs+score_history+min_score+passed_all+need_rework+autoloop_active+last_excerpt；全 passed 才 success，revising/modified/failed/suspended 属已出结论会提前回报不再空等；need_rework>0 且 autoloop_active=true 时返工非终局，须沿用同一 batch_start 再次 review_wait 等自动重审出终局 passed，勿直接关链），macro_save=保存宏(name+steps数组)，macro_list=列出宏库，macro_run=运行宏(name+params参数替换)，macro_delete=删除宏(name)，register_tool=注册自定义JS工具(name+desc+params+code，可dry_run:true沙箱试运行)，approve_tool=审核启用(name+approved:true)，disable_tool=禁用(name)，unregister_tool=删除回滚(name)，list_tools=列出全部，call_tool=调用已启用工具(name+args)"
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
              "description": "目标对话ID（如 cb1）。close/move/send/wait/review/review_wait 操作时需要。create 和 list 可省略。close 时传 \"all\" 关闭所有对话；close 时传 \"self\" 关闭发起命令的当前对话自己（须配合 last_step:true）"
            },
            "count": {
              "type": "integer",
              "minimum": 1,
              "maximum": 5,
              "description": "review 操作：派几个客观审核窗，默认 2，上限 5"
            },
            "gather": {
              "type": "boolean",
              "description": "review 操作：true（默认）=给这批审核配对挂自动回收凭证（审核通过即回收+重审目标），false=仅派单不自动回收"
            },
            "idle_for_ms": {
              "type": "integer",
              "minimum": 200,
              "description": "wait 操作：连续空闲判定毫秒数，默认 1200"
            },
            "timeout_ms": {
              "type": "integer",
              "minimum": 5000,
              "maximum": 720000,
              "description": "wait/review_wait 操作：等待上限毫秒，默认 300000（wait）/600000（review_wait），硬上限 720000（须低于工具层 15min 超时）"
            },
            "require_reply": {
              "type": "boolean",
              "description": "wait 操作：true=不仅空闲，还要求本轮新增了至少一条 assistant 回复才算完成（默认 false）"
            },
            "check_queue": {
              "type": "boolean",
              "description": "wait 操作：true（默认）=空闲判定同时检查队列非空则视为忙"
            },
            "pass_score": {
              "type": "integer",
              "description": "review_wait 操作：可选通过线覆盖，缺省跟随系统 window.ZF_PASS_LINE（默认 60）"
            },
            "excerpt_chars": {
              "type": "integer",
              "description": "wait/review_wait 操作：返回的末条回复摘要字符数，默认 200（review_wait 默认 300）"
            },
            "batch_start": {
              "type": "integer",
              "description": "review_wait 操作：可选。本批次派单的时间下界（毫秒时间戳），直接取 review 返回的 data.batch_start。传入后只统计该时刻之后新建的审核配对，排除目标对话上历史遗留的旧审核；不传则自动回落最近一次指挥链派单凭证（同对话才生效）"
            },
            "last_step": {
              "type": "boolean",
              "description": "close self 操作护栏：必须显式传 true 才允许关闭发起方自己，确认这是整条指挥链的最后一步且结论已交付完毕"
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
            },
            "name": {
              "type": "string",
              "description": "宏名/自定义工具名（macro_save/macro_run/macro_delete/register_tool/approve_tool/disable_tool/unregister_tool/call_tool 操作时使用）"
            },
            "code": {
              "type": "string",
              "description": "register_tool：自定义工具的 JS 函数体源码（函数参数为 args、ctx，需 return 结果），≤128KB"
            },
            "desc": {
              "type": "string",
              "description": "register_tool/macro_save：工具/宏的功能描述"
            },
            "params": {
              "type": "object",
              "description": "macro_run：占位符参数替换表；register_tool：工具入参说明（JSON Schema 简化版）"
            },
            "steps": {
              "type": "array",
              "description": "macro_save：宏步骤数组 [{use:'chat_manage', args:{...}}]，args 中可用 ${参数名} 占位"
            },
            "args": {
              "type": "object",
              "description": "call_tool：传给自定义工具的入参对象"
            },
            "test_args": {
              "type": "object",
              "description": "register_tool + dry_run:true：沙箱试运行用的测试入参"
            },
            "dry_run": {
              "type": "boolean",
              "description": "register_tool：true 时仅本地沙箱试运行验证代码，不落盘"
            },
            "approved": {
              "type": "boolean",
              "description": "approve_tool：必须显式传 true 才会启用（审核闸门）"
            }
          },
          "required": [
            "action"
          ]
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
