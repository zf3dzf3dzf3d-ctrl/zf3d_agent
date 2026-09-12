// ========== tools-defs-dev.js ==========
// 拆分自 tools-definitions.js，注册进 window.ToolDefinitions（见 tools-defs-registry.js）
window.registerToolDefs({
  tools: {
    "timeline": {
      "type": "function",
      "function": {
        "name": "timeline",
        "description": "时间线浏览器（多维回溯）：列出账本步骤/快照/git提交三合一时间线；detail 查看某步骤详情；rollback 安全回滚（按 step 委托 undo_step 安全回退，按 commit 用 revert，绝不硬重置删历史）。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "description": "list=列出时间线（默认），detail=查看某账本步骤详情，rollback=回滚"
            },
            "step": {
              "type": "integer",
              "description": "账本步骤号（detail/rollback 用）"
            },
            "commit": {
              "type": "string",
              "description": "git 提交哈希（rollback 用，revert 该提交）"
            },
            "limit": {
              "type": "integer",
              "description": "list 返回条数，默认 50"
            },
            "path": {
              "type": "string",
              "description": "项目路径（默认项目根目录）"
            }
          },
          "required": []
        }
      }
    },
    "git_save": {
      "type": "function",
      "function": {
        "name": "git_save",
        "description": "Git 保存（git add -A + commit）。可选 push。返回结果和最近 commit。",
        "parameters": {
          "type": "object",
          "properties": {
            "message": {
              "type": "string",
              "description": "提交信息（commit message）。省略时自动生成 \"auto: git save @ 时间\""
            },
            "path": {
              "type": "string",
              "description": "Git 仓库路径，默认为项目根目录"
            },
            "push": {
              "type": "boolean",
              "description": "是否在 commit 后执行 git push，默认 false"
            }
          },
          "required": []
        }
      }
    },
    "timeline": {
      "type": "function",
      "function": {
        "name": "timeline",
        "description": "时间线浏览器（多维回溯入口）：聚合变更账本/快照/Git 提交为一条时间线；可查看某步骤详情，或按 step/commit 一键回滚（安全回退，绝不硬重置）。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["list", "detail", "rollback"],
              "description": "list=列出时间线(默认)；detail=查看某步骤详情；rollback=回滚"
            },
            "limit": {
              "type": "integer",
              "description": "list 模式返回条数，默认 50"
            },
            "step": {
              "type": "integer",
              "description": "detail/rollback：账本步骤号"
            },
            "commit": {
              "type": "string",
              "description": "rollback：Git 提交哈希（与 step 二选一）"
            },
            "path": {
              "type": "string",
              "description": "项目路径，默认项目根目录"
            }
          },
          "required": []
        }
      }
    },
    "git_log": {
      "type": "function",
      "function": {
        "name": "git_log",
        "description": "查看 Git 提交历史(git log)。支持限制数量、按作者过滤。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "Git 仓库路径（默认项目根目录）"
            },
            "count": {
              "type": "integer",
              "description": "返回最近多少条提交记录（默认 20）"
            },
            "author": {
              "type": "string",
              "description": "按作者过滤（可选，如 \"张三\"）"
            },
            "oneline": {
              "type": "boolean",
              "description": "true=简洁模式每行一条(默认)，false=完整信息含作者日期"
            },
            "file": {
              "type": "string",
              "description": "（单个）查看指定文件的提交历史（可选）"
            },
            "files": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多个）查看多个文件的提交历史（与 file 二选一）"
            }
          },
          "required": []
        }
      }
    },
    "code_outline": {
      "type": "function",
      "function": {
        "name": "code_outline",
        "description": "分析代码结构，提取函数/类/方法骨架信息。支持 .py/.js/.java 等。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "代码文件路径"
            },
            "paths": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "多个代码文件路径数组（批量分析）"
            }
          },
          "required": [
            "path"
          ]
        }
      }
    },
    "diff_preview": {
      "type": "function",
      "function": {
        "name": "diff_preview",
        "description": "查看 Git 差异(git diff)。staged/unstaged 可选，可指定文件。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "Git 仓库路径（默认项目根目录）"
            },
            "staged": {
              "type": "boolean",
              "description": "true=查看暂存区差异(git diff --cached)，false=查看工作区差异(git diff)，默认 false"
            },
            "file": {
              "type": "string",
              "description": "（单个）指定文件路径过滤差异（可选，如 src/app.js）"
            },
            "files": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "（多个）指定文件路径数组过滤差异（与 file 二选一）"
            },
            "max_lines": {
              "type": "integer",
              "description": "最大返回行数（默认 200，防止输出过长）"
            }
          },
          "required": []
        }
      }
    },
    "list_dir": {
      "type": "function",
      "function": {
        "name": "list_dir",
        "description": "列出目录内容，支持排序和显示文件大小/时间。",
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
            "show_hidden": {
              "type": "boolean",
              "description": "是否显示隐藏文件（以 . 开头的文件，默认 false）"
            },
            "sort_by": {
              "type": "string",
              "enum": [
                "name",
                "size",
                "modified"
              ],
              "description": "排序方式（默认 name，可选 size 或 modified）"
            }
          },
          "required": []
        }
      }
    },
    "regex_search": {
      "type": "function",
      "function": {
        "name": "regex_search",
        "description": "正则表达式搜索工具（始终正则模式）。支持文件/文件夹、单路径/多路径。输出匹配行、捕获组、上下文。比 search_in_files+regex=true 更强大：自动提取捕获组、高亮匹配位置。",
        "parameters": {
          "type": "object",
          "properties": {
            "pattern": {
              "type": "string",
              "description": "正则表达式（必填）。如 \\bdef\\s+(\\w+) 匹配Python函数定义"
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
            "case_insensitive": {
              "type": "boolean",
              "description": "是否不区分大小写（默认 false）"
            },
            "max_results": {
              "type": "integer",
              "description": "最大返回匹配数（默认 50）"
            },
            "context_lines": {
              "type": "integer",
              "description": "每个匹配显示几行上下文（默认 2）"
            },
            "file_type": {
              "type": "string",
              "description": "按扩展名过滤搜索文件，如 .py 或 .js"
            },
            "show_groups": {
              "type": "boolean",
              "description": "是否显示捕获组详情（默认 true）"
            }
          },
          "required": [
            "pattern"
          ]
        }
      }
    },
    "timeline": {
      "type": "function",
      "function": {
        "name": "timeline",
        "description": "时间线浏览器（多维回溯入口）：聚合账本步骤(steps.jsonl)、快照(snapshot_*.zip)、git提交为一条时间线。action=list 列出变更与回滚点；action=detail 查看某步骤详情；action=rollback 一键回滚（step→undo_step安全回退 / commit→revert，绝不硬重置）。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["list", "detail", "rollback"],
              "description": "list=时间线列表(默认)；detail=查看某步骤；rollback=回滚"
            },
            "step": {
              "type": "integer",
              "description": "账本步骤号（detail/rollback 用）"
            },
            "commit": {
              "type": "string",
              "description": "提交哈希（rollback 用，revert该提交）"
            },
            "limit": {
              "type": "integer",
              "description": "list 返回条数，默认 50"
            },
            "path": {
              "type": "string",
              "description": "项目路径，默认当前项目"
            }
          },
          "required": []
        }
      }
    },
    "switch_port": {
      "type": "function",
      "function": {
        "name": "switch_port",
        "description": "切换本地智能体服务端口。直接传入目标端口即可；工具会校验端口、更新 private/port.txt，并可选启动新服务。适用于用户要求切换访问端口。",
        "parameters": {
          "type": "object",
          "properties": {
            "port": {
              "type": "integer",
              "description": "目标端口，1024-65535。仅查询状态时可省略。"
            },
            "start": {
              "type": "boolean",
              "description": "是否在写入后启动新端口服务，默认 true。"
            },
            "open_browser": {
              "type": "boolean",
              "description": "切换成功后是否打开浏览器，默认 false。"
            },
            "status": {
              "type": "boolean",
              "description": "仅查询当前端口状态，不进行切换。"
            }
          },
          "required": []
        }
      }
    },
    "table_memory": {
      "type": "function",
      "function": {
        "name": "table_memory",
        "description": "通用表格记忆（SQLite 持久化，跨对话复用，领域无关）。表名和字段由你按需创建/填写：create_table=建表，insert=插一条记录，query=查询（可按字段过滤），get/update/delete=按 id 操作，stats=对数值字段自动统计（均值/最大/最小/趋势），list_tables=列出所有表。适合每日打卡、运营数据记录（如发帖热度/点赞/流量）、长期观察统计等需要跨对话持久化的表格数据。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["create_table", "list_tables", "drop_table", "insert", "query", "get", "update", "delete", "stats", "batch"],
              "description": "操作类型：create_table=建表，list_tables=列所有表，drop_table=删表，insert=插入记录，query=查询，get=按id取一条，update=按id修改，delete=按id删除，stats=数值字段统计，batch=一次批量执行多个操作（多条插入/更新推荐用 batch，一次调用更快）"
            },
            "table": {
              "type": "string",
              "description": "表名，如：游泳打卡、游戏战绩、发帖运营。除 list_tables 外必填"
            },
            "data": {
              "type": "string",
              "description": "insert/update 时的记录内容，JSON 对象字符串，字段名任意（中文亦可），如：{\"日期\":\"2026-09-03\",\"点赞\":120,\"阅读\":3000}"
            },
            "id": {
              "type": "integer",
              "description": "记录 id（get/update/delete 时必填）"
            },
            "where": {
              "type": "string",
              "description": "query 时的过滤条件，JSON 对象字符串（等值匹配），如：{\"日期\":\"2026-09-03\"}"
            },
            "order": {
              "type": "string",
              "description": "query 时排序字段，前加 - 表示倒序，如：-created_at"
            },
            "limit": {
              "type": "integer",
              "description": "query 返回条数上限"
            },
            "field": {
              "type": "string",
              "description": "stats 时要统计的数值字段名"
            },
            "operations": {
              "type": "string",
              "description": "batch 时的操作数组 JSON 字符串，每项是完整单次操作（含 action 及参数），如：[{\"action\":\"create_table\",\"table\":\"发帖运营\"},{\"action\":\"insert\",\"table\":\"发帖运营\",\"data\":\"{\\\"日期\\\":\\\"2026-09-03\\\",\\\"点赞\\\":120}\"},{\"action\":\"query\",\"table\":\"发帖运营\",\"limit\":10}]"
            }
          },
          "required": ["action"]
        }
      }
    },
    "table_viewer": {
      "type": "function",
      "function": {
        "name": "table_viewer",
        "description": "数据表查看器（前端可视化）：在用户屏幕上弹出表格查看器窗口，可视化浏览 table_memory 创建的 SQLite 表。open_list=打开并列出所有表，open_table=直接打开指定表查看全部数据。适合你在用 table_memory 建表/写入数据后，主动调用它把表展示给用户看。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["open_list", "open_table"],
              "description": "open_list=打开查看器显示所有表列表（默认），open_table=直接打开指定表"
            },
            "table": {
              "type": "string",
              "description": "表名（open_table 时必填），如：发帖运营"
            }
          },
          "required": []
        }
      }
    }
  },
  categories: {} // 分类统一在 tools-defs-categories.js 注册
});
