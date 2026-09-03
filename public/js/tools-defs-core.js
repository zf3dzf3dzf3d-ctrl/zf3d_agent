// ========== tools-defs-core.js ==========
// 拆分自 tools-definitions.js，注册进 window.ToolDefinitions（见 tools-defs-registry.js）
window.registerToolDefs({
  tools: {
    "task_complete": {
      "type": "function",
      "function": {
        "name": "task_complete",
        "description": "结束任务并给用户最终消息。调用后 Agent 循环终止。message 就是给用户的最终答复（以“✅ 任务完成”消息展示）：写清结论、改动内容和涉及文件。调用本工具的那一轮不要再在正文里重复输出答案或总结。",
        "parameters": {
          "type": "object",
          "properties": {
            "success": {
              "type": "boolean",
              "description": "任务是否成功完成。true=成功，false=失败"
            },
            "message": {
              "type": "string",
              "description": "最终消息，即给用户的完整答复（以“✅ 任务完成”形式展示）。成功时写清结论、修改内容和文件，失败时说明原因。不要在调用同轮的正文里重复这些内容。"
            },
            "scope": {
              "type": "string",
              "enum": [
                "当前任务",
                "剩余计划"
              ],
              "description": "完成范围。\"当前任务\"=只完成了本次任务（默认）；\"剩余计划\"=已实际完成后续全部交付，整个计划结束。"
            }
          },
          "required": [
            "success",
            "message"
          ]
        }
      }
    },
    "switch_tool_category": {
      "type": "function",
      "function": {
        "name": "switch_tool_category",
        "description": "切换工具分类。传入空字符串可查看所有分类。",
        "parameters": {
          "type": "object",
          "properties": {
            "category": {
              "type": "string",
              "description": "要切换到的分类名称。传入空字符串或省略时返回所有可用分类列表。"
            }
          },
          "required": []
        }
      }
    },
    "tasknote": {
      "type": "function",
      "function": {
        "name": "tasknote",
        "description": "任务本/便条（最高优先级，主人最看重）。当主人说「把这个记到任务本上/加到任务簿/记个便条/记个任务」等时必须调用本工具。actions：add=新增任务（主人那句话原样放进 title 即可，无需拆标题和补充说明，一句话记完）；list=查看任务列表（可按 status 过滤）；status=推进任务状态（new_status 仅 todo/doing/review，done 归档只能由主人在任务簿界面审核触发，AI 无权归档）；note=给任务追加备注。AI 做完任务后应将状态推到 review 交主人验收。日历提醒：主人说「几月几号通知我/提醒我/到日期叫我」时，把日期解析为 YYYY-MM-DD 传入 remind 参数，到期当天任务簿会弹窗+系统通知提醒主人。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "enum": ["add", "list", "status", "note"], "description": "操作：add=新增，list=列表，status=推进状态，note=追加备注" },
            "title": { "type": "string", "description": "add：任务内容，一句话即可（必填）。主人原话直接放这里，不要拆标题" },
            "desc": { "type": "string", "description": "add：任务补充说明" },
            "remind": { "type": "string", "description": "add：日历提醒日期 YYYY-MM-DD（可选）。主人说「9月10号通知我…」时解析为 2026-09-10 传入，到期当天会通知主人" },
            "task_id": { "type": "string", "description": "status/note：任务ID（来自 list）" },
            "new_status": { "type": "string", "enum": ["todo", "doing", "review"], "description": "status：目标状态。done 归档仅主人审核可触发" },
            "note": { "type": "string", "description": "note：备注内容" },
            "status": { "type": "string", "description": "list：按状态过滤（todo/doing/review/done）" },
            "limit": { "type": "integer", "description": "list：返回条数上限，默认 30" }
          },
          "required": []
        }
      }
    },
    "ask_user": {
      "type": "function",
      "function": {
        "name": "ask_user",
        "description": "向用户提问并等待回答，暂停 Agent 循环。简单模式只传 question；表单模式传 question+fields 数组（支持 text/select/radio/checkbox）。",
        "parameters": {
          "type": "object",
          "properties": {
            "question": {
              "type": "string",
              "description": "要问用户的问题或需要用户提供的内容说明"
            },
            "fields": {
              "type": "array",
              "description": "（表单模式，可选）多字段表单定义数组。每项格式：{type, label, name, options, placeholder, default, required}。type 可选 text/select/radio/checkbox；label 为字段显示名；name 为字段标识（用作返回值 key）；options 为选项数组（select/radio/checkbox 类型用，每项可为字符串或 {value,label} 对象）；placeholder 为输入提示；default 为默认值；required 是否必填（默认 true）。未传 fields 时退化为单行文本输入。",
              "items": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "text",
                      "select",
                      "radio",
                      "checkbox"
                    ],
                    "description": "字段类型：text=单行文本，select=下拉选择，radio=单选，checkbox=多选"
                  },
                  "label": {
                    "type": "string",
                    "description": "字段显示名称"
                  },
                  "name": {
                    "type": "string",
                    "description": "字段标识（用作返回值中的 key），省略时自动为 field1, field2..."
                  },
                  "options": {
                    "type": "array",
                    "description": "选项列表（select/radio/checkbox 类型用），每项可为字符串或 {value, label} 对象",
                    "items": {}
                  },
                  "placeholder": {
                    "type": "string",
                    "description": "输入提示文字（text/select 类型用）"
                  },
                  "default": {
                    "description": "默认值（radio 传字符串，checkbox 传字符串数组）"
                  },
                  "required": {
                    "type": "boolean",
                    "description": "是否必填，默认 true"
                  }
                },
                "required": [
                  "type",
                  "label"
                ]
              }
            }
          },
          "required": [
            "question"
          ]
        }
      }
    },
    "read_file": {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "读取文本文件。path 读单个，paths 数组读多个。返回内容及元信息。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "文件路径（读单文件时用）"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "多文件路径数组（与 path 二选一）"
            },
            "max_chars": {
              "type": "integer",
              "description": "最多读取字符数，默认8000"
            }
          },
          "required": []
        }
      }
    },
    "read_lines": {
      "type": "function",
      "function": {
        "name": "read_lines",
        "description": "按行读取文件，适配中文编码。支持行范围(start/end)、统计行数(num)、关键词筛选(contains)。注意：单次至少读 50 行（end-start>=50），或用 paths 一次读多个文件；禁止连续多次小范围读同一文件。批量收集信息优先用 run_code 脚本。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "文件路径（单文件时用）"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多文件）文件路径数组，批量读取多个文件的指定行（与 path 二选一）"
            },
            "start": {
              "type": "integer",
              "description": "起始行号（从 1 开始），默认 1"
            },
            "end": {
              "type": "integer",
              "description": "结束行号，省略则读到文件末尾"
            },
            "num": {
              "type": "boolean",
              "description": "true 时仅统计总行数，不返回内容"
            },
            "contains": {
              "type": "string",
              "description": "筛选包含该关键词的行（与行范围二选一，优先于行范围）"
            }
          },
          "required": [
            "path"
          ]
        }
      }
    },
    "write_file": {
      "type": "function",
      "function": {
        "name": "write_file",
        "description": "写入文本文件，已存在则备份 .bak。path+content 单文件，files 数组批量写。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "文件路径（单文件时用）"
            },
            "content": {
              "type": "string",
              "description": "文件内容（单文件时用）"
            },
            "files": {
              "type": "array",
              "description": "批量文件数组，每项 {path, content}"
            }
          },
          "required": []
        }
      }
    },
    "run_code": {
      "type": "function",
      "function": {
        "name": "run_code",
        "description": (function(){
            // 运行时自动检测服务端执行环境，不写死
            var ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
            var isWin = /win/i.test(ua);
            var isMac = /mac/i.test(ua) && !isWin;
            var env = isWin ? 'Windows，cmd/PowerShell 环境' : (isMac ? 'macOS，zsh/bash 环境' : 'Linux，bash 环境');
            var warn = isWin
                ? '不要使用 Unix 命令（ls/grep/cat/rm 等），请用 Windows 命令（dir/findstr/type/del 等）。'
                : '请使用对应的 Unix 命令（ls/grep/cat/rm 等）。';
            return '运行 shell 命令，返回 stdout/stderr/exit_code。code 单段，codes 数组批量。【执行环境已由程序自动检测：' + env + '】' + warn;
        })(),
        "parameters": {
          "type": "object",
          "properties": {
            "code": {
              "type": "string",
              "description": "shell 命令（与 codes 二选一）"
            },
            "timeout": {
              "type": "integer",
              "description": "保留参数"
            },
            "codes": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "code": {
                    "type": "string",
                    "description": "要执行的 shell 命令"
                  },
                  "timeout": {
                    "type": "integer",
                    "description": "保留参数"
                  }
                },
                "required": [
                  "code"
                ]
              },
              "description": "批量代码数组（与 code 二选一）"
            }
          }
        }
      }
    },
    "replace_text": {
      "type": "function",
      "function": {
        "name": "replace_text",
        "description": "精确替换文件文本，自动备份 .bak。默认要求 old_text 仅匹配一处；多处替换必须显式传 all: true。支持单/多文件。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "（单文件）文件路径"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多文件）文件路径数组，批量替换多个文件中的相同文本"
            },
            "old_text": {
              "type": "string",
              "description": "要查找的旧文本（精确匹配）"
            },
            "new_text": {
              "type": "string",
              "description": "替换后的新文本"
            },
            "all": {
              "type": "boolean",
              "description": "是否替换所有匹配（默认 false）。old_text 匹配多处时必须显式传 true，否则不会修改文件。"
            },
            "backup": {
              "type": "boolean",
              "description": "是否备份原文件为 .bak（默认 true）"
            }
          },
          "required": [
            "old_text",
            "new_text"
          ]
        }
      }
    },
    "tree_dir": {
      "type": "function",
      "function": {
        "name": "tree_dir",
        "description": "树形显示目录内容，排除 node_modules/.git 等。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "（单目录）目录路径"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多目录）目录路径数组"
            },
            "max_depth": {
              "type": "integer",
              "description": "最大遍历深度（默认 3）"
            },
            "show_files": {
              "type": "boolean",
              "description": "是否显示文件（默认 true，false 则只显示目录）"
            }
          },
          "required": []
        }
      }
    },
    "find_files": {
      "type": "function",
      "function": {
        "name": "find_files",
        "description": "按 glob 模式查找文件，如 **/*.py。可按扩展名过滤。",
        "parameters": {
          "type": "object",
          "properties": {
            "pattern": {
              "type": "string",
              "description": "glob 模式，如 **/*.py、*.json、src/**/*.ts"
            },
            "path": {
              "type": "string",
              "description": "（单目录）搜索根目录（默认当前目录）"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多目录）搜索根目录数组"
            },
            "max_results": {
              "type": "integer",
              "description": "最大返回文件数（默认 50）"
            },
            "file_type": {
              "type": "string",
              "description": "按扩展名过滤，如 .py 或 .js"
            }
          },
          "required": [
            "pattern"
          ]
        }
      }
    },
    "search_in_files": {
      "type": "function",
      "function": {
        "name": "search_in_files",
        "description": "在文件内容中搜索关键词/正则。支持多文件/目录，上下文行显示。",
        "parameters": {
          "type": "object",
          "properties": {
            "keyword": {
              "type": "string",
              "description": "搜索关键词或正则表达式"
            },
            "path": {
              "type": "string",
              "description": "（单个）文件或目录路径"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多个）文件或目录路径数组"
            },
            "regex": {
              "type": "boolean",
              "description": "是否将关键词作为正则表达式（默认 false）"
            },
            "case_insensitive": {
              "type": "boolean",
              "description": "是否不区分大小写（默认 false）"
            },
            "max_results": {
              "type": "integer",
              "description": "最大返回匹配数（默认 30）"
            },
            "context_lines": {
              "type": "integer",
              "description": "每个匹配显示几行上下文（默认 1）"
            },
            "file_type": {
              "type": "string",
              "description": "按扩展名过滤搜索文件，如 .py"
            }
          },
          "required": [
            "keyword"
          ]
        }
      }
    },
    "file_info": {
      "type": "function",
      "function": {
        "name": "file_info",
        "description": "获取文件/目录信息：大小、时间、行数等。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "（单个）文件或目录路径"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多个）文件或目录路径数组"
            }
          },
          "required": []
        }
      }
    },
    "move_file": {
      "type": "function",
      "function": {
        "name": "move_file",
        "description": "移动/重命名文件目录。支持批量，自动创建父目录。",
        "parameters": {
          "type": "object",
          "properties": {
            "src": {
              "type": "string",
              "description": "（单文件）源文件路径"
            },
            "dst": {
              "type": "string",
              "description": "（单文件）目标路径"
            },
            "moves": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "src": {
                    "type": "string",
                    "description": "源路径"
                  },
                  "dst": {
                    "type": "string",
                    "description": "目标路径"
                  }
                }
              },
              "description": "（批量）移动数组，每项 {src, dst}"
            },
            "overwrite": {
              "type": "boolean",
              "description": "目标已存在时是否覆盖（默认 false）"
            }
          },
          "required": []
        }
      }
    },
    "project_record": {
      "type": "function",
      "function": {
        "name": "project_record",
        "description": "项目记录管理（存于「项目记录/」.md 文件）。list/read/write/append/search/delete，名称自动补 .md。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "list",
                "read",
                "write",
                "append",
                "search",
                "delete"
              ],
              "description": "操作类型：list=列出所有记录，read=读取记录内容，write=创建/覆盖记录，append=追加内容，search=搜索关键词，delete=删除记录"
            },
            "name": {
              "type": "string",
              "description": "记录名称（自动补 .md 后缀）。list 和 search 操作可省略。read 支持多个名称用逗号分隔（与 names 二选一）"
            },
            "names": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（read 操作）多个记录名称数组，批量读取多条记录（与 name 二选一）"
            },
            "content": {
              "type": "string",
              "description": "写入或追加的内容（write/append 操作时使用）"
            },
            "keyword": {
              "type": "string",
              "description": "搜索关键词（search 操作时使用）"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "analyze_project": {
      "type": "function",
      "function": {
        "name": "analyze_project",
        "description": "项目分析工具。扫描项目目录结构，识别入口文件、顶层目录、路由/接口，自动生成 mermaid 流程图，并把完整分析结果存入共享上下文池（全局共享，不按对话隔离），供流程图每个节点和任意对话通过 read_shared_context 共同读取。actions：analyze=执行分析（可选 root 相对目录、max_depth），status=查询是否已有分析结果。analyze 成功后前端自动把 mermaid 流程图部署到画布（FlowGlam），无需再调 deploy_flowchart。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["analyze", "status"],
              "description": "操作类型：analyze=分析当前项目并生成流程图+写入共享池，status=查询池中是否已有分析"
            },
            "root": {
              "type": "string",
              "description": "要分析的相对目录（默认项目根目录）"
            },
            "max_depth": {
              "type": "integer",
              "description": "目录遍历最大深度（默认 6，最大 10）"
            }
          },
          "required": ["action"]
        }
      }
    },
    "read_shared_context": {
      "type": "function",
      "function": {
        "name": "read_shared_context",
        "description": "读取共享上下文池。analyze_project 等工具写入的全局共享数据（不按对话隔离，流程图所有节点、所有对话都可读）。key 目前支持 project_analysis（项目分析结果）。part 可选 summary=摘要（默认）、mermaid=流程图、files=文件列表、routes=路由列表、all=全部。limit 限制列表返回条数（默认 200，最大 1000）。",
        "parameters": {
          "type": "object",
          "properties": {
            "key": {
              "type": "string",
              "enum": ["project_analysis"],
              "description": "要读取的数据键（默认 project_analysis）"
            },
            "part": {
              "type": "string",
              "enum": ["summary", "mermaid", "files", "routes", "all"],
              "description": "读取哪部分（默认 summary）"
            },
            "limit": {
              "type": "integer",
              "description": "列表类数据的最大返回条数（默认 200，最大 1000）"
            }
          },
          "required": []
        }
      }
    },
    "task_list": {
      "type": "function",
      "function": {
        "name": "task_list",
        "description": "任务清单管理。create/show/update/add/delete。状态：pending/in_progress/completed/skipped。强制规则：预计调用3个及以上工具的任务必须先用本工具创建清单，再开始执行；每项开始置in_progress、完成置completed，全部完成后才调用task_complete。右侧任务面板会实时向用户展示进度。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "create",
                "show",
                "update",
                "add",
                "delete"
              ],
              "description": "操作类型：create=创建新清单，show=展示清单（不传 id 则列出全部），update=更新任务状态，add=向已有清单添加任务，delete=删除任务或整个清单"
            },
            "title": {
              "type": "string",
              "description": "任务清单标题（create 时必填）或新任务标题（add 时必填）"
            },
            "tasks": {
              "type": "array",
              "description": "（create 时）任务列表，每项可为字符串（任务名）或对象 {title, status, detail}",
              "items": {}
            },
            "id": {
              "type": "string",
              "description": "任务清单ID（show/update/add/delete 时需传入，创建时生成的 tl_ 开头的ID）"
            },
            "task_id": {
              "type": "integer",
              "description": "（update/delete 时）任务序号，如 1、2、3"
            },
            "status": {
              "type": "string",
              "enum": [
                "pending",
                "in_progress",
                "completed",
                "skipped"
              ],
              "description": "（update 时）新状态"
            },
            "detail": {
              "type": "string",
              "description": "（update 时可选）任务备注/详情"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "get_tool_result": {
      "type": "function",
      "function": {
        "name": "get_tool_result",
        "description": "查回已被丢弃的工具结果原文。工具结果超出保留数时会被替换为[已丢弃]，但原文已存档，可通过本工具找回。支持按ID查回单条、列出所有存档、或按工具名筛选。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "get",
                "list"
              ],
              "description": "操作类型：get=按ID查回单条原文（需传id），list=列出所有存档摘要（不传id时默认list）"
            },
            "id": {
              "type": "integer",
              "description": "要查回的存档ID（action=get时必传，可通过action=list先查看有哪些ID）"
            }
          },
          "required": []
        }
      }
    }
  },
  categories: {} // 分类统一在 tools-defs-categories.js 注册
});
