// ========== tools-definitions.js - tool metadata ==========
// Extracted from tools.js; loaded before the Tools runtime.
window.ToolDefinitions = {
categories: {
            '极简': {
                icon: '📄',
                desc: '基础工具集：文件读写、代码运行、搜索替换、任务管理',
                tools: ['task_complete', 'switch_tool_category', 'ask_user', 'read_file', 'read_lines', 'write_file', 'run_code', 'replace_text', 'tree_dir', 'find_files', 'search_in_files', 'file_info', 'move_file', 'project_record', 'task_list', 'get_tool_result']
            },
            '编程': {
                icon: '💻',
                desc: '极简 + 全套开发工具：Git、调试、搜索、定时、记忆、邮件、生图生视频等',
                tools: ['task_complete', 'switch_tool_category', 'ask_user', 'read_file', 'read_lines', 'write_file', 'run_code', 'replace_text', 'tree_dir', 'find_files', 'search_in_files', 'file_info', 'move_file', 'project_record', 'task_list', 'get_tool_result', 'chat_context', 'chat_manage', 'chat_summary', 'code_outline', 'diff_preview', 'git_log', 'git_save', 'image_gen', 'list_dir', 'locate_mouse', 'long_term_memory', 'monitor', 'net', 'pixel_display', 'query_answers', 'ram_cache', 'recent_questions', 'regex_search', 'schedule', 'search_chat', 'send_email', 'set_camera', 'switch_port', 'video_gen', 'wait', 'work_order']
            },
            '写作': {
                icon: '✍️',
                desc: '极简 + 40+ AI文本工具：改写、润色、扩写、翻译、总结、分析、SEO等',
                tools: ['task_complete', 'switch_tool_category', 'ask_user', 'read_file', 'read_lines', 'write_file', 'run_code', 'replace_text', 'tree_dir', 'find_files', 'search_in_files', 'file_info', 'move_file', 'project_record', 'task_list', 'get_tool_result', 'adapt_audience', 'analyze_sentiment', 'analyze_text_metrics', 'bystander_view', 'change_tone', 'color_text', 'compare_text', 'convert_chars', 'detect_sensitive', 'detect_style', 'expand_text', 'expert_review', 'extract_keywords', 'extract_outline', 'fact_check', 'fix_punctuation', 'format_beautify', 'generate_description', 'generate_hook', 'generate_quotes', 'generate_title', 'group_discussion', 'interpret_document', 'list_formats', 'novice_view', 'opposing_view', 'optimize_ends', 'play_devil_advocate', 'polish_text', 'praise_text', 'professional_edit', 'proofread_text', 'quick_article', 'rate_article', 'rewrite_text', 'role_brainstorm', 'seo_optimize', 'shorten_text', 'summarize_text', 'translate_text', 'write_outline']
            }
        }
,
        // ===== 所有工具定义（按名称索引，OpenAI function calling 格式） =====
                allTools: {
            task_complete: {
        type: 'function',
        function: {
            name: 'task_complete',
            description: '结束任务并给用户最终消息。调用后 Agent 循环终止。message 就是给用户的最终答复（以“✅ 任务完成”消息展示）：写清结论、改动内容和涉及文件。调用本工具的那一轮不要再在正文里重复输出答案或总结。',
            parameters: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        description: '任务是否成功完成。true=成功，false=失败'
                    },
                    message: {
                        type: 'string',
                        description: '最终消息，即给用户的完整答复（以“✅ 任务完成”形式展示）。成功时写清结论、修改内容和文件，失败时说明原因。不要在调用同轮的正文里重复这些内容。'
                    },
                    scope: {
                        type: 'string',
                        enum: ['当前任务', '剩余计划'],
                        description: '完成范围。"当前任务"=只完成了本次任务（默认）；"剩余计划"=已实际完成后续全部交付，整个计划结束。'
                    }
                },
                required: ['success', 'message']
            }
        }
    },
            switch_port: {
        type: 'function',
        function: {
            name: 'switch_port',
            description: '切换本地智能体服务端口。直接传入目标端口即可；工具会校验端口、更新 private/port.txt，并可选启动新服务。适用于用户要求切换访问端口。',
            parameters: {
                type: 'object',
                properties: {
                    port: { type: 'integer', description: '目标端口，1024-65535。仅查询状态时可省略。' },
                    start: { type: 'boolean', description: '是否在写入后启动新端口服务，默认 true。' },
                    open_browser: { type: 'boolean', description: '切换成功后是否打开浏览器，默认 false。' },
                    status: { type: 'boolean', description: '仅查询当前端口状态，不进行切换。' }
                },
                required: []
            }
        }
    },
            read_file: {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取文本文件。path 读单个，paths 数组读多个。返回内容及元信息。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（读单文件时用）'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多文件路径数组（与 path 二选一）'
                    },
                    max_chars: {
                        type: 'integer',
                        description: '最多读取字符数，默认8000'
                    }
                },
                required: []
            }
        }
    },
            write_file: {
        type: 'function',
        function: {
            name: 'write_file',
            description: '写入文本文件，已存在则备份 .bak。path+content 单文件，files 数组批量写。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（单文件时用）'
                    },
                    content: {
                        type: 'string',
                        description: '文件内容（单文件时用）'
                    },
                    files: {
                        type: 'array',
                        description: '批量文件数组，每项 {path, content}'
                    }
                },
                required: []
            }
        }
    },
            run_code: {
        type: 'function',
        function: {
            name: 'run_code',
            description: '运行 shell 命令，返回 stdout/stderr/exit_code。code 单段，codes 数组批量。',
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'shell 命令（与 codes 二选一）'
                    },
                    timeout: {
                        type: 'integer',
                        description: '保留参数'
                    },
                    codes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                code: {
                                    type: 'string',
                                    description: '要执行的 shell 命令'
                                },
                                timeout: {
                                    type: 'integer',
                                    description: '保留参数'
                                }
                            },
                            required: ['code']
                        },
                        description: '批量代码数组（与 code 二选一）'
                    }
                }
            }
        }
    },
            net: {
        type: 'function',
        function: {
            name: 'net',
            description: '抓取网页返回文本。url 单个，urls 数组多个。自动去 HTML 标签。',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: '网页 URL（与 urls 二选一）'
                    },
                    urls: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多 URL 数组（与 url 二选一）'
                    },
                    raw_html: {
                        type: 'boolean',
                        description: 'true 返回原始 HTML，默认 false 返回纯文本'
                    },
                    max_chars: {
                        type: 'integer',
                        description: '内容字符上限，默认 6000'
                    }
                },
                required: []
            }
        }
    },
            read_lines: {
        type: 'function',
        function: {
            name: 'read_lines',
            description: '按行读取文件，适配中文编码。支持行范围(start/end)、统计行数(num)、关键词筛选(contains)。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（单文件时用）'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多文件）文件路径数组，批量读取多个文件的指定行（与 path 二选一）'
                    },
                    start: {
                        type: 'integer',
                        description: '起始行号（从 1 开始），默认 1'
                    },
                    end: {
                        type: 'integer',
                        description: '结束行号，省略则读到文件末尾'
                    },
                    num: {
                        type: 'boolean',
                        description: 'true 时仅统计总行数，不返回内容'
                    },
                    contains: {
                        type: 'string',
                        description: '筛选包含该关键词的行（与行范围二选一，优先于行范围）'
                    }
                },
                required: ['path']
            }
        }
    },
            ask_user: {
        type: 'function',
        function: {
            name: 'ask_user',
            description: '向用户提问并等待回答，暂停 Agent 循环。简单模式只传 question；表单模式传 question+fields 数组（支持 text/select/radio/checkbox）。',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: '要问用户的问题或需要用户提供的内容说明'
                    },
                    fields: {
                        type: 'array',
                        description: '（表单模式，可选）多字段表单定义数组。每项格式：{type, label, name, options, placeholder, default, required}。type 可选 text/select/radio/checkbox；label 为字段显示名；name 为字段标识（用作返回值 key）；options 为选项数组（select/radio/checkbox 类型用，每项可为字符串或 {value,label} 对象）；placeholder 为输入提示；default 为默认值；required 是否必填（默认 true）。未传 fields 时退化为单行文本输入。',
                        items: {
                            type: 'object',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['text', 'select', 'radio', 'checkbox'],
                                    description: '字段类型：text=单行文本，select=下拉选择，radio=单选，checkbox=多选'
                                },
                                label: {
                                    type: 'string',
                                    description: '字段显示名称'
                                },
                                name: {
                                    type: 'string',
                                    description: '字段标识（用作返回值中的 key），省略时自动为 field1, field2...'
                                },
                                options: {
                                    type: 'array',
                                    description: '选项列表（select/radio/checkbox 类型用），每项可为字符串或 {value, label} 对象',
                                    items: {}
                                },
                                placeholder: {
                                    type: 'string',
                                    description: '输入提示文字（text/select 类型用）'
                                },
                                default: {
                                    description: '默认值（radio 传字符串，checkbox 传字符串数组）'
                                },
                                required: {
                                    type: 'boolean',
                                    description: '是否必填，默认 true'
                                }
                            },
                            required: ['type', 'label']
                        }
                    }
                },
                required: ['question']
            }
        }
    },
            git_save: {
        type: 'function',
        function: {
            name: 'git_save',
            description: 'Git 保存（git add -A + commit）。可选 push。返回结果和最近 commit。',
            parameters: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: '提交信息（commit message）。省略时自动生成 "auto: git save @ 时间"'
                    },
                    path: {
                        type: 'string',
                        description: 'Git 仓库路径，默认为项目根目录'
                    },
                    push: {
                        type: 'boolean',
                        description: '是否在 commit 后执行 git push，默认 false'
                    }
                },
                required: []
            }
        }
    },
            project_record: {
        type: 'function',
        function: {
            name: 'project_record',
            description: '项目记录管理（存于「项目记录/」.md 文件）。list/read/write/append/search/delete，名称自动补 .md。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'read', 'write', 'append', 'search', 'delete'],
                        description: '操作类型：list=列出所有记录，read=读取记录内容，write=创建/覆盖记录，append=追加内容，search=搜索关键词，delete=删除记录'
                    },
                    name: {
                        type: 'string',
                        description: '记录名称（自动补 .md 后缀）。list 和 search 操作可省略。read 支持多个名称用逗号分隔（与 names 二选一）'
                    },
                    names: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（read 操作）多个记录名称数组，批量读取多条记录（与 name 二选一）'
                    },
                    content: {
                        type: 'string',
                        description: '写入或追加的内容（write/append 操作时使用）'
                    },
                    keyword: {
                        type: 'string',
                        description: '搜索关键词（search 操作时使用）'
                    }
                },
                required: ['action']
            }
        }
    },
            chat_manage: {
        type: 'function',
        function: {
            name: 'chat_manage',
            description: '对话管理：create/close/move/send/list/arrange。新建对话、发送消息、排列对话框等。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'close', 'move', 'send', 'list', 'arrange'],
                        description: '操作类型：create=新建对话，close=关闭对话，move=移动对话位置，send=向对话发送消息，list=列出所有对话，arrange=按状态排列所有对话为一排'
                    },
                    chat_id: {
                        type: 'string',
                        description: '目标对话ID（如 cb1）。close/move/send 操作时需要。create 和 list 可省略。close 时传 "all" 关闭所有对话'
                    },
                    message: {
                        type: 'string',
                        description: '要发送的消息内容（send 操作时使用，create 操作时可附带初始消息自动发送）'
                    },
                    model_id: {
                        type: 'string',
                        description: '指定模型ID（create 操作可选，不传则用当前活跃对话的模型）'
                    },
                    x: {
                        type: 'integer',
                        description: '对话框左上角X坐标（move 操作时使用，create 操作可选指定位置）'
                    },
                    y: {
                        type: 'integer',
                        description: '对话框左上角Y坐标（move 操作时使用，create 操作可选指定位置）'
                    },
                    auto_send: {
                        type: 'boolean',
                        description: 'create 操作时是否自动发送 message（默认 false）。为 true 时会创建对话并立即发送 message'
                    }
                },
                required: ['action']
            }
        }
    },
            image_gen: {
        type: 'function',
        function: {
            name: 'image_gen',
            description: 'AI 文生图工具：多渠道免费额度自动切换。用户说"画个XX/生成图片"时调用，返回图片 URL（用 markdown ![](url) 直接展示）。渠道：pollinations(免费无key，默认主力) / siliconflow / zhipu，自动失败切换+冷却恢复。',
            parameters: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: '画面描述（必填）。英文提示词效果更佳，可把中文需求翻译成英文细节描述。'
                    },
                    size: {
                        type: 'string',
                        description: '图片尺寸，可选：512x512、768x768、1024x1024(默认)、768x1024、1024x768、832x1216、1216x832'
                    },
                    action: {
                        type: 'string',
                        description: 'generate=生成图片(默认)；status=查看各渠道可用状态'
                    }
                },
                required: ['prompt']
            }
        }
    },
            video_gen: {
        type: 'function',
        function: {
            name: 'video_gen',
            description: 'AI 文生视频工具：用户说"生成视频/做个XX视频/动起来"时调用，返回视频 URL（用 HTML <video> 标签直接展示）。渠道：pollinations(免费无key，默认主力，Veo-3 模型异步轮询) / siliconflow(Wan2.1 需 key)。自动失败切换+冷却恢复。生成完成后会自动在 Kite 画布上添加一个可拖拽的视频节点，并自动连接最近对话的曲线。',
            parameters: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: '视频内容描述（必填）。英文提示词效果更佳，可把中文需求翻译成英文细节描述（运镜、风格、动作、光影等）。'
                    },
                    duration: {
                        type: 'integer',
                        description: '视频时长（秒），可选 4/5/8/10，默认 5。'
                    },
                    size: {
                        type: 'string',
                        description: '视频尺寸，可选：832x480(默认 横屏) / 480x832(竖屏) / 1024x576(高清横屏) / 576x1024(高清竖屏)'
                    },
                    model: {
                        type: 'string',
                        description: '视频模型：veo3(Pollinations Veo-3, 默认免费) / wan2.1(硅基流动, 需 key)'
                    },
                    action: {
                        type: 'string',
                        description: 'generate=生成视频(默认)；status=查看各渠道可用状态'
                    }
                },
                required: ['prompt']
            }
        }
    },
            wait: {
        type: 'function',
        function: {
            name: 'wait',
            description: '等待指定秒数后继续。用于延迟、轮询等。',
            parameters: {
                type: 'object',
                properties: {
                    seconds: {
                        type: 'number',
                        description: '要等待的秒数（支持小数，如 0.5 表示半秒）。默认 1 秒，最大 300 秒（5分钟）。'
                    }
                },
                required: ['seconds']
            }
        }
    },
            schedule: {
        type: 'function',
        function: {
            name: 'schedule',
            description: '定时循环执行 shell 命令。支持条件停止(stop_on_success/stop_on_output)。后台运行不阻塞。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['start', 'stop', 'list', 'status'],
                        description: '操作类型：start=启动定时任务，stop=停止任务，list=列出所有运行中的任务，status=查看单个任务状态'
                    },
                    name: {
                        type: 'string',
                        description: '任务名称（唯一标识），start/stop/status 时必填'
                    },
                    code: {
                        type: 'string',
                        description: '要执行的 shell 命令（start 时必填）。例如 "echo hello" 或 "python backup.py"'
                    },
                    interval: {
                        type: 'number',
                        description: '执行间隔（秒）。默认 60 秒，最小 0.5 秒，最大 86400 秒（24小时）'
                    },
                    max_times: {
                        type: 'integer',
                        description: '最大执行次数。0=无限循环（默认），>0 则执行指定次数后自动停止'
                    },
                    stop_on_success: {
                        type: 'boolean',
                        description: '条件停止：当命令退出码为 0（成功）时自动停止任务。适用于轮询等待、重试到成功等场景。默认 false'
                    },
                    stop_on_output: {
                        type: 'string',
                        description: '条件停止：当命令输出中包含此字符串时自动停止任务。例如设为 "ok" 则输出含 ok 时停止。默认空（不检查）'
                    }
                },
                required: ['action']
            }
        }
    },
            search_chat: {
        type: 'function',
        function: {
            name: 'search_chat',
            description: '全局搜索对话内容。keyword/keywords 搜索，session_id 限定窗口。match_mode: any(OR)/all(AND)。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '单个搜索关键词（与 keywords 二选一）'
                    },
                    keywords: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个搜索关键词数组，支持同时搜索多个词（与 keyword 二选一）'
                    },
                    session_id: {
                        type: 'string',
                        description: '指定单个窗口ID搜索（如 cb12）。不指定则搜索全部窗口（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定多个窗口ID数组搜索（与 session_id 二选一）'
                    },
                    match_mode: {
                        type: 'string',
                        enum: ['any', 'all'],
                        description: '多关键词匹配模式：any=任一匹配即返回(OR,默认)，all=全部匹配才返回(AND)'
                    },
                    limit: {
                        type: 'integer',
                        description: '每个窗口最多返回的匹配数，默认50'
                    },
                    role: {
                        type: 'string',
                        description: '按角色过滤：user/assistant/tool/system。不传则不过滤'
                    }
                },
                required: []
            }
        }
    },
            recent_questions: {
        type: 'function',
        function: {
            name: 'recent_questions',
            description: '查询近期用户问题。当对话中混入大量"刷新""继续"等噪音消息导致遗忘原始问题时，用此工具快速定位用户真实意图。支持按关键字筛选（keyword）或正则表达式匹配（regex=true），指定单个窗口(session_id)或多个窗口(session_ids)。支持分页查询：limit控制每页条数（默认100），offset控制起始位置，可无限翻页查询全部历史记录。返回结果中含has_more和next_offset提示是否还有更多。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '关键字筛选。传入后只返回包含该关键字的问题，更快定位。regex=true时作为正则表达式'
                    },
                    regex: {
                        type: 'boolean',
                        description: '是否将keyword作为正则表达式匹配。默认false（普通文本包含匹配），true时启用正则'
                    },
                    session_id: {
                        type: 'string',
                        description: '指定单个窗口ID查询（如 cb1）。不指定则查询全部窗口（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定多个窗口ID数组查询（与 session_id 二选一）'
                    },
                    limit: {
                        type: 'integer',
                        description: '每页返回条数，默认100。与offset配合使用实现分页，如limit=100&offset=0查第1-100条，limit=100&offset=100查第101-200条'
                    },
                    offset: {
                        type: 'integer',
                        description: '起始位置（跳过多少条），默认0。与limit配合实现无限分页查询'
                    },
                    filter_noise: {
                        type: 'boolean',
                        description: '是否过滤噪音消息（如"刷新""继续""好的"等），默认true'
                    }
                },
                required: []
            }
        }
    },
            query_answers: {
        type: 'function',
        function: {
            name: 'query_answers',
            description: '根据用户问题关键字精准查询AI回复答案。与recent_questions对应：recent_questions查用户问题，本工具查对应的AI答案。通过关键字匹配用户问题后，自动找到紧随其后的assistant回复作为答案。支持正则表达式、分页、指定窗口。适用于精准回溯历史问答。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '必填。用户问题关键字，用于匹配历史问题。regex=true时作为正则表达式'
                    },
                    regex: {
                        type: 'boolean',
                        description: '是否将keyword作为正则表达式匹配。默认false（普通文本包含匹配），true时启用正则'
                    },
                    session_id: {
                        type: 'string',
                        description: '指定单个窗口ID查询（如 cb1）。不指定则查询全部窗口'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定多个窗口ID数组查询'
                    },
                    limit: {
                        type: 'integer',
                        description: '每页返回条数，默认10，最大200。与offset配合使用实现分页'
                    },
                    offset: {
                        type: 'integer',
                        description: '起始位置（跳过多少条），默认0。与limit配合实现无限分页查询'
                    },
                    answer_max_length: {
                        type: 'integer',
                        description: '答案最大截取长度，默认2000字符'
                    },
                    include_question: {
                        type: 'boolean',
                        description: '是否在结果中包含原始问题内容，默认true'
                    }
                },
                required: ['keyword']
            }
        }
    },
            chat_context: {
        type: 'function',
        function: {
            name: 'chat_context',
            description: '直接读写数据库聊天记录（不触发AI回复）。read/insert/append/update/delete。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['read', 'insert', 'append', 'update', 'delete'],
                        description: '操作类型：read=读取消息，insert/append=插入消息，update=修改消息，delete=删除消息'
                    },
                    session_id: {
                        type: 'string',
                        description: '单个窗口ID（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个窗口ID数组（与 session_id 二选一）'
                    },
                    limit: {
                        type: 'integer',
                        description: 'read操作时每个窗口读取的最近消息数，默认10'
                    },
                    messages: {
                        type: 'array',
                        description: 'insert/append操作时插入的消息数组，每项为{role, content, model_id}（可选）'
                    },
                    role: {
                        type: 'string',
                        description: 'insert/append单条消息时的角色（user/assistant/system）'
                    },
                    content: {
                        type: 'string',
                        description: 'insert/append单条消息时的内容，或update操作时的新内容'
                    },
                    message_id: {
                        type: 'integer',
                        description: 'update/delete操作时指定的消息ID'
                    },
                    message_ids: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'delete操作时批量删除的消息ID数组'
                    },
                    model_id: {
                        type: 'string',
                        description: 'insert/append时指定模型ID（可选）'
                    }
                },
                required: ['action']
            }
        }
    },
            chat_summary: {
        type: 'function',
        function: {
            name: 'chat_summary',
            description: '对话摘要管理。generate/save/read/list/delete。存储于 app_data 表。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['generate', 'save', 'read', 'list', 'delete'],
                        description: '操作类型：generate=获取对话内容准备生成摘要，save=保存摘要，read=读取已保存摘要，list=列出所有摘要，delete=删除摘要'
                    },
                    session_id: {
                        type: 'string',
                        description: '单个窗口ID（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个窗口ID数组（与 session_id 二选一）'
                    },
                    summary: {
                        type: 'string',
                        description: 'save操作时单个摘要内容'
                    },
                    summaries: {
                        type: 'array',
                        description: 'save操作时批量保存的摘要数组，每项为{session_id, summary, title}'
                    },
                    title: {
                        type: 'string',
                        description: 'save操作时的对话标题'
                    },
                    limit: {
                        type: 'integer',
                        description: 'generate操作时读取的消息上限，默认100'
                    }
                },
                required: ['action']
            }
        }
    },
            monitor: {
                type: 'function',
                function: {
                    name: 'monitor',
                    description: '监控队列：send 排队消息触发AI，status 查状态，list 列出窗口，merge 合并队列。配合 schedule 实现无人值守。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                enum: ['send', 'status', 'list', 'merge'],
                                description: '操作类型：send=向目标窗口队列发送消息（前端自动拾取触发AI），status=查询窗口最近消息，list=列出所有窗口概况，merge=合并指定窗口的排队消息+上下文到新窗口（自动清空队列）'
                            },
                            chat_id: {
                                type: 'string',
                                description: 'send操作时目标窗口ID（如 cb1、cb2）'
                            },
                            message: {
                                type: 'string',
                                description: 'send操作时要发送给AI的消息内容'
                            },
                            session_id: {
                                type: 'string',
                                description: 'status操作时单个窗口ID'
                            },
                            session_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'status操作时多个窗口ID数组'
                            },
                            limit: {
                                type: 'integer',
                                description: 'status操作时每个窗口返回的最近消息数，默认5'
                            }
                        },
                        required: ['action']
                    }
                }
            },
            file_info: {
        type: 'function',
        function: {
            name: 'file_info',
            description: '获取文件/目录信息：大小、时间、行数等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单个）文件或目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）文件或目录路径数组'
                    }
                },
                required: []
            }
        }
    },
            find_files: {
        type: 'function',
        function: {
            name: 'find_files',
            description: '按 glob 模式查找文件，如 **/*.py。可按扩展名过滤。',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'glob 模式，如 **/*.py、*.json、src/**/*.ts'
                    },
                    path: {
                        type: 'string',
                        description: '（单目录）搜索根目录（默认当前目录）'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多目录）搜索根目录数组'
                    },
                    max_results: {
                        type: 'integer',
                        description: '最大返回文件数（默认 50）'
                    },
                    file_type: {
                        type: 'string',
                        description: '按扩展名过滤，如 .py 或 .js'
                    }
                },
                required: ['pattern']
            }
        }
    },
            get_tool_result: {
        type: 'function',
        function: {
            name: 'get_tool_result',
            description: '查回已被丢弃的工具结果原文。工具结果超出保留数时会被替换为[已丢弃]，但原文已存档，可通过本工具找回。支持按ID查回单条、列出所有存档、或按工具名筛选。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['get', 'list'],
                        description: '操作类型：get=按ID查回单条原文（需传id），list=列出所有存档摘要（不传id时默认list）'
                    },
                    id: {
                        type: 'integer',
                        description: '要查回的存档ID（action=get时必传，可通过action=list先查看有哪些ID）'
                    }
                },
                required: []
            }
        }
    },
            move_file: {
        type: 'function',
        function: {
            name: 'move_file',
            description: '移动/重命名文件目录。支持批量，自动创建父目录。',
            parameters: {
                type: 'object',
                properties: {
                    src: {
                        type: 'string',
                        description: '（单文件）源文件路径'
                    },
                    dst: {
                        type: 'string',
                        description: '（单文件）目标路径'
                    },
                    moves: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                src: { type: 'string', description: '源路径' },
                                dst: { type: 'string', description: '目标路径' }
                            }
                        },
                        description: '（批量）移动数组，每项 {src, dst}'
                    },
                    overwrite: {
                        type: 'boolean',
                        description: '目标已存在时是否覆盖（默认 false）'
                    }
                },
                required: []
            }
        }
    },
            replace_text: {
        type: 'function',
        function: {
            name: 'replace_text',
            description: '文件内查找替换文本，自动备份 .bak。支持单/多文件批量替换。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单文件）文件路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多文件）文件路径数组，批量替换多个文件中的相同文本'
                    },
                    old_text: {
                        type: 'string',
                        description: '要查找的旧文本（精确匹配）'
                    },
                    new_text: {
                        type: 'string',
                        description: '替换后的新文本'
                    },
                    all: {
                        type: 'boolean',
                        description: '是否替换所有匹配（true=全部替换，false=仅第一处，默认 true）'
                    },
                    backup: {
                        type: 'boolean',
                        description: '是否备份原文件为 .bak（默认 true）'
                    }
                },
                required: ['old_text', 'new_text']
            }
        }
    },
            search_in_files: {
        type: 'function',
        function: {
            name: 'search_in_files',
            description: '在文件内容中搜索关键词/正则。支持多文件/目录，上下文行显示。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '搜索关键词或正则表达式'
                    },
                    path: {
                        type: 'string',
                        description: '（单个）文件或目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）文件或目录路径数组'
                    },
                    regex: {
                        type: 'boolean',
                        description: '是否将关键词作为正则表达式（默认 false）'
                    },
                    case_insensitive: {
                        type: 'boolean',
                        description: '是否不区分大小写（默认 false）'
                    },
                    max_results: {
                        type: 'integer',
                        description: '最大返回匹配数（默认 30）'
                    },
                    context_lines: {
                        type: 'integer',
                        description: '每个匹配显示几行上下文（默认 1）'
                    },
                    file_type: {
                        type: 'string',
                        description: '按扩展名过滤搜索文件，如 .py'
                    }
                },
                required: ['keyword']
            }
        }
    },
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
            tree_dir: {
        type: 'function',
        function: {
            name: 'tree_dir',
            description: '树形显示目录内容，排除 node_modules/.git 等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单目录）目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多目录）目录路径数组'
                    },
                    max_depth: {
                        type: 'integer',
                        description: '最大遍历深度（默认 3）'
                    },
                    show_files: {
                        type: 'boolean',
                        description: '是否显示文件（默认 true，false 则只显示目录）'
                    }
                },
                required: []
            }
        }
    },
            code_outline: {
        type: 'function',
        function: {
            name: 'code_outline',
            description: '分析代码结构，提取函数/类/方法骨架信息。支持 .py/.js/.java 等。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '代码文件路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个代码文件路径数组（批量分析）'
                    }
                },
                required: ['path']
            }
        }
    },
            diff_preview: {
        type: 'function',
        function: {
            name: 'diff_preview',
            description: '查看 Git 差异(git diff)。staged/unstaged 可选，可指定文件。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Git 仓库路径（默认项目根目录）'
                    },
                    staged: {
                        type: 'boolean',
                        description: 'true=查看暂存区差异(git diff --cached)，false=查看工作区差异(git diff)，默认 false'
                    },
                    file: {
                        type: 'string',
                        description: '（单个）指定文件路径过滤差异（可选，如 src/app.js）'
                    },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）指定文件路径数组过滤差异（与 file 二选一）'
                    },
                    max_lines: {
                        type: 'integer',
                        description: '最大返回行数（默认 200，防止输出过长）'
                    }
                },
                required: []
            }
        }
    },
            git_log: {
        type: 'function',
        function: {
            name: 'git_log',
            description: '查看 Git 提交历史(git log)。支持限制数量、按作者过滤。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Git 仓库路径（默认项目根目录）'
                    },
                    count: {
                        type: 'integer',
                        description: '返回最近多少条提交记录（默认 20）'
                    },
                    author: {
                        type: 'string',
                        description: '按作者过滤（可选，如 "张三"）'
                    },
                    oneline: {
                        type: 'boolean',
                        description: 'true=简洁模式每行一条(默认)，false=完整信息含作者日期'
                    },
                    file: {
                        type: 'string',
                        description: '（单个）查看指定文件的提交历史（可选）'
                    },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多个）查看多个文件的提交历史（与 file 二选一）'
                    }
                },
                required: []
            }
        }
    },
            list_dir: {
        type: 'function',
        function: {
            name: 'list_dir',
            description: '列出目录内容，支持排序和显示文件大小/时间。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '（单目录）目录路径'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（多目录）目录路径数组'
                    },
                    show_hidden: {
                        type: 'boolean',
                        description: '是否显示隐藏文件（以 . 开头的文件，默认 false）'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['name', 'size', 'modified'],
                        description: '排序方式（默认 name，可选 size 或 modified）'
                    }
                },
                required: []
            }
        }
    },
            send_email: {
        type: 'function',
        function: {
            name: 'send_email',
            description: '发送邮件，需预设 SMTP。支持纯文本和 HTML。',
            parameters: {
                type: 'object',
                properties: {
                    subject: { type: 'string', description: '邮件主题（标题）' },
                    body: { type: 'string', description: '邮件正文内容' },
                    to: { type: 'string', description: '收件人邮箱地址。不传则使用设置中配置的默认收件人。' },
                    is_html: { type: 'boolean', description: '正文是否为 HTML 格式，默认 false（纯文本）' }
                },
                required: ['subject', 'body']
            }
        }
    },
            set_camera: {
        type: 'function',
        function: {
            name: 'set_camera',
            description: '定位画布视口位置。target="center"或"chat:ID"快速定位。',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: '画布平移的 X 坐标（像素）。正值向右，负值向左。不传则保持当前 X 不变。' },
                    y: { type: 'number', description: '画布平移的 Y 坐标（像素）。正值向下，负值向上。不传则保持当前 Y 不变。' },
                    zoom: { type: 'number', description: '缩放比例（1=100%）。注意：当前画布缩放已被禁用，此参数仅做记录不会实际生效。不建议调整。' },
                    animate: { type: 'boolean', description: '是否使用动画过渡（默认 true，平滑移动到目标位置）' },
                    target: { type: 'string', description: '快速定位目标。可选值："center"=回到画布原点中心，"chat:对话ID"=定位到指定对话框。设置此值时 x/y 参数将被忽略。' }
                },
                required: []
            }
        }
    },
            switch_tool_category: {
        type: 'function',
        function: {
            name: 'switch_tool_category',
            description: '切换工具分类。传入空字符串可查看所有分类。',
            parameters: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: '要切换到的分类名称。传入空字符串或省略时返回所有可用分类列表。'
                    }
                },
                required: []
            }
        }
    },
            adapt_audience: {
        sys: "你是内容适配专家。把文章改写成适合指定目标读者阅读的版本：调整词汇难度、句式复杂度、举例方式，保留原文核心信息不改变主旨。直接输出改写后的完整文章。",
        temp: 0.6,
        build: function(a, t) { return "目标读者："+(a.audience||"大众读者")+"\n\n原文：\n"+t; }
    },
            analyze_sentiment: {
        sys: "你是情感分析专家。分析文章并输出：1)整体情感倾向（积极/消极/中性，给出百分比）；2)情绪强度（强烈/中等/温和）；3)情绪变化轨迹（按段落描述开头-中间-结尾的情绪起伏）；4)情绪把控建议。用清晰Markdown结构化输出，不要改写原文。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t; }
    },
            analyze_text_metrics: {
        type: 'function',
        function: {
            name: 'analyze_text_metrics',
            description: '统计文本的基本指标：字符数、中英文、标点、段落、句子、长句、阅读时间（本地工具，不调用模型）。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '需要统计的文本' },
                    path: { type: 'string', description: '可选：文本文件路径' }
                },
                required: []
            }
        }
    },
            bystander_view: {
        sys: "你是路人读者。以普通路人的视角阅读文章，给出最直观的第一印象和感受，是否吸引人、是否愿意继续看。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请以路人视角给出第一印象。"; }
    },
            change_tone: {
        sys: "你是语气改写专家。将文本转换为指定语气，保持核心内容不变。直接输出改写后的文本。",
        temp: 0.6,
        build: function(a, t) { return "目标语气："+(a.tone||"正式")+"\n\n原文：\n"+t; }
    },
            color_text: {
        sys: "你是视觉文字排版专家。用颜色突出关键词、重点、角色、步骤或情绪，保持原文可读；HTML使用span color，Markdown使用可阅读的标记并说明颜色用途。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n配色："+(a.color_scheme||"主题色")+"\n输出格式："+(a.format||"html"); }
    },
            compare_text: {
        sys: "你是文本对比分析专家。对比两段文本的差异，从内容、结构、风格、长度等维度进行分析，用Markdown结构化输出。",
        temp: 0.4,
        build: function(a, t) { return "文本A：\n"+(a.text_a||"")+"\n\n文本B：\n"+(a.text_b||"")+"\n\n对比重点："+(a.focus||"全面对比"); }
    },
            convert_chars: {
        sys: "你是繁简转换专家。准确进行中文繁体和简体之间的转换，保持其他内容不变。直接输出转换后的文本。",
        temp: 0.3,
        build: function(a, t) { return "转换方向："+(a.direction||"简转繁")+"\n\n原文：\n"+t; }
    },
            detect_sensitive: {
        type: 'function',
        function: {
            name: 'detect_sensitive',
            description: '检测文本中的敏感词、违规词和广告法极限词（本地工具，不调用模型）。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '需要检测的文本' },
                    path: { type: 'string', description: '可选：文本文件路径' },
                    categories: { type: 'string', description: '检测类别，逗号分隔：广告法,平台,政治；默认全部' }
                },
                required: []
            }
        }
    },
            detect_style: {
        sys: "你是文风分析专家。分析文章的文风特征并输出：1)整体文风判断（正式/口语/学术/文学/新闻等）；2)用词特征（偏书面/偏口语/专业术语密度）；3)句式特征（长句为主/短句为主/句式多样）；4)改进建议。用Markdown结构化输出。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t; }
    },
            expand_text: {
        sys: "你是专业内容扩写专家。在保持原文主旨和风格的基础上，丰富细节、补充论据、扩展场景，使内容更加充实饱满。只输出扩写后的完整文本。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"扩充一倍")+"\n方向："+(a.direction||"补充细节和论据")+"\n要求：保持原文主旨，丰富内容。"; }
    },
            expert_review: {
        sys: "你是资深领域专家。以专家的视角对内容进行深度评析，指出专业性问题和改进方向。",
        temp: 0.5,
        build: function(a, t) { return "领域："+(a.field||"通用")+"\n\n原文：\n"+t+"\n\n请以专家视角评析。"; }
    },
            extract_keywords: {
        sys: "你是关键词提取专家。提取最能代表文本核心内容的词语，按重要性排序；只输出关键词，不添加解释。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n数量："+parseInt(a.count||10)+"\n格式："+(a.format||"列表"); }
    },
            extract_outline: {
        sys: "你是文章结构分析专家。从已有文章中反向提取结构化大纲，识别标题层级、段落主题和逻辑关系；只输出大纲，不添加评论。",
        temp: 0.3,
        build: function(a, t) { return "文章：\n"+t+"\n\n格式："+(a.format||"Markdown")+"\n详细程度："+(a.detail_level||"标准"); }
    },
            fact_check: {
        sys: "你是事实核查专家。检查文本中可能存在的事实错误、数据错误和逻辑漏洞，逐条列出问题并给出核查建议。如果内容准确无误，请明确说明。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n请逐条核查事实。"; }
    },
            fix_punctuation: {
        sys: "你是标点符号修正专家。检查并修正文本中的标点符号错误，包括中英文标点混用、缺失、多余等问题。直接输出修正后的文本。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n请修正标点符号。"; }
    },
            format_beautify: {
        sys: "你是排版美化专家。对文本进行格式美化：优化标题层级、段落间距、列表格式、引用样式等。直接输出美化后的Markdown文本。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n输出格式："+(a.format||"Markdown"); }
    },
            generate_hook: {
        sys: "你是钩子（Hook）生成专家。为文章生成吸引人的开头钩子，让读者忍不住继续阅读。",
        temp: 0.6,
        build: function(a, t) { return "主题/原文：\n"+t+"\n\n钩子类型："+(a.hook_type||"悬念式")+"\n数量："+parseInt(a.count||3); }
    },
            generate_quotes: {
        sys: "你是金句生成专家。从文章中提炼或改写出精炼有力的金句，适合引用和传播。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n数量："+parseInt(a.count||5)+"\n风格："+(a.style||"精炼有力"); }
    },
            generate_title: {
        sys: "你是标题生成专家。根据文章内容生成多个吸引人的标题供选择。",
        temp: 0.6,
        build: function(a, t) { return "文章内容：\n"+t+"\n\n数量："+parseInt(a.count||5)+"\n风格："+(a.style||"吸引人"); }
    },
            group_discussion: {
        sys: "你是群聊模拟器。模拟一个群聊场景，多个角色围绕主题展开讨论，各抒己见、互相回应，生成生动的群聊记录。",
        temp: 0.7,
        build: function(a, t) { return "主题："+t+"\n参与角色："+(a.roles||"3-5个不同观点的角色")+"\n轮数："+(a.rounds||"3-5轮"); }
    },
            interpret_document: {
        sys: "你是文档解读专家。对文档进行深度解读：提炼核心观点、梳理逻辑脉络、提取关键数据、回答针对性问题。",
        temp: 0.4,
        build: function(a, t) { return "文档内容：\n"+t+"\n\n解读重点："+(a.focus||"核心观点和逻辑脉络"); }
    },
            list_formats: {
        sys: "你是列表整理专家。将文本内容整理成清晰的列表格式。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n列表类型："+(a.list_type||"要点列表")+"\n排序："+(a.sort_by||"按原文顺序"); }
    },
            novice_view: {
        sys: "你是新手读者。以初学者/新手的视角阅读文章，指出看不懂的地方、觉得困难的概念，提出疑问。语气真实自然。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请以新手视角给出阅读感受和疑问。"; }
    },
            opposing_view: {
        sys: "你是不同观点生成器。针对文章的核心观点，提出3-5个合理的不同或反对观点，每个观点附简短理由。保持客观理性。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请提出不同观点。"; }
    },
            optimize_ends: {
        sys: "你是开头结尾优化专家。优化文章的开头和结尾，使其更吸引人、更有力。",
        temp: 0.5,
        build: function(a, t) { return "原文：\n"+t+"\n\n优化部分："+(a.part||"开头和结尾")+"\n目标效果："+(a.goal||"开头吸引人，结尾有力"); }
    },
            play_devil_advocate: {
        sys: "你是专业抬杠选手。对文章的每个论点都挑毛病、找漏洞、钻牛角尖。语气可以带点挑衅，但抬杠要有理有据，不能无理取闹。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请对以上内容进行抬杠，找出所有可以反驳的点。"; }
    },
            polish_text: {
        sys: "你是专业中文写作编辑。先给出1-3条简短的润色说明，然后输出润色后的完整文本。保持原文核心内容不变，优化表达、逻辑和文风。",
        temp: 0.5,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标文风："+(a.style||"更清晰")+"\n目标长度："+(a.target_length||"保持")+"\n润色重点："+(a.focus||"整体表达")+"\n约束："+(a.preserve_meaning!==false?"必须严格保持原意":"可以适度改写"); }
    },
            praise_text: {
        sys: "你是热情的赞美者。发现文章中的所有亮点和优点，给予真诚的赞美。指出具体好在哪里，为什么好，让人感到被认可和鼓舞。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n请发现并赞美以上内容的亮点。"; }
    },
            professional_edit: {
        sys: "你是学术编辑专家。对文本进行专业级修饰，提升用词精准度、逻辑严密性和表达规范性，使其达到专业出版水平。",
        temp: 0.4,
        build: function(a, t) { return "专业领域："+(a.field||"通用")+"\n\n原文：\n"+t+"\n\n请进行专业级修饰。"; }
    },
            proofread_text: {
        sys: "你是专业校对编辑。检查文本中的错别字、语法错误、标点问题和逻辑漏洞，逐条列出问题并给出修改建议。如果没有问题，说明文本已无错误。",
        temp: 0.3,
        build: function(a, t) { return "原文：\n"+t+"\n\n请逐条列出错误和修改建议。"; }
    },
            quick_article: {
        sys: "你是快速写作专家。根据主题和要点快速生成一篇文章，结构完整、内容充实。直接输出文章。",
        temp: 0.6,
        build: function(a, t) { return "主题："+(a.topic||"")+"\n文章类型："+(a.article_type||"通用")+"\n字数："+(a.word_count||"800")+"\n要点："+(a.points||t||"无"); }
    },
            rate_article: {
        sys: "你是内容质量评审专家。对文章进行多维度评分（满分10分）：1)内容质量；2)逻辑结构；3)语言表达；4)创新性；5)可读性。给出每项分数和评语，最后给出总分和总评。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n评审维度："+(a.dimensions||"内容、逻辑、表达、创新、可读性"); }
    },
            rewrite_text: {
        sys: "你是专业中文写作编辑。在严格保持原意的前提下改写文本，改变句式结构和用词表达，降低与原文的重复率。只输出改写后的完整文本，不添加解释或说明。",
        temp: 0.6,
        build: function(a, t) { return "原文：\n"+t+"\n\n改写风格："+(a.style||"自然")+"\n改写力度："+(a.strength||"中度")+"\n要求：保持原意，改变表达方式，降低重复率。"; }
    },
            role_brainstorm: {
        sys: "你是多角色发散思维专家。从不同角色/视角对主题进行发散性思考，每个角色给出独特见解。",
        temp: 0.7,
        build: function(a, t) { return "主题："+t+"\n角色设定："+(a.roles||"产品经理、用户、开发者、投资人、批评家"); }
    },
            seo_optimize: {
        sys: "你是SEO内容优化专家。输出：1)关键词分析（3-5个目标关键词、频率、密度建议）；2)标题优化建议（2-3个SEO友好标题）；3)meta描述（80-120字含关键词）；4)结构优化建议。用Markdown结构化输出，不改写原文。",
        temp: 0.4,
        build: function(a, t) { return "目标关键词："+(a.keywords||"（未指定，请自动识别）")+"\n\n原文：\n"+t; }
    },
            shorten_text: {
        sys: "你是专业内容精简专家。在保持原文核心信息和逻辑完整的前提下，删减冗余、压缩表达，使内容更加简洁有力。只输出精简后的完整文本。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"缩短一半")+"\n要求：保留核心信息，删减冗余。"; }
    },
            summarize_text: {
        sys: "你是资深内容总结专家。输出清晰的结构化总结，包含核心结论、关键事实、待办/下一步；不要添加原文没有的信息。",
        temp: 0.4,
        build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"中")+"\n重点："+(a.focus||"核心结论与行动项"); }
    },
            translate_text: {
        sys: "你是专业翻译。准确翻译文本，保持原文的语气和风格。只输出译文，不添加解释。",
        temp: 0.3,
        build: function(a, t) { return "目标语言："+(a.target_lang||"英语")+"\n\n原文：\n"+t; }
    },
            write_outline: {
        sys: "你是大纲撰写专家。根据主题或要求生成结构化大纲，层次清晰、逻辑合理。直接输出大纲。",
        temp: 0.5,
        build: function(a, t) { return "主题："+(a.topic||t)+"\n格式："+(a.format||"Markdown")+"\n详细程度："+(a.detail_level||"标准"); }
    },

        // ===== 获取当前分类的工具定义数组（发给 AI 的 tools 字段） =====
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
            replace_text: {
                type: 'function',
                function: {
                    name: 'replace_text',
                    description: '精确替换文件文本，自动备份 .bak。默认要求 old_text 仅匹配一处；多处替换必须显式传 all: true。支持单/多文件。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: '（单文件）文件路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多文件）文件路径数组，批量替换多个文件中的相同文本'
                            },
                            old_text: {
                                type: 'string',
                                description: '要查找的旧文本（精确匹配）'
                            },
                            new_text: {
                                type: 'string',
                                description: '替换后的新文本'
                            },
                            all: {
                                type: 'boolean',
                                description: '是否替换所有匹配（默认 false）。old_text 匹配多处时必须显式传 true，否则不会修改文件。'
                            },
                            backup: {
                                type: 'boolean',
                                description: '是否备份原文件为 .bak（默认 true）'
                            }
                        },
                        required: ['old_text', 'new_text']
                    }
                }
            },
            tree_dir: {
                type: 'function',
                function: {
                    name: 'tree_dir',
                    description: '树形显示目录内容，排除 node_modules/.git 等。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: '（单目录）目录路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多目录）目录路径数组'
                            },
                            max_depth: {
                                type: 'integer',
                                description: '最大遍历深度（默认 3）'
                            },
                            show_files: {
                                type: 'boolean',
                                description: '是否显示文件（默认 true，false 则只显示目录）'
                            }
                        },
                        required: []
                    }
                }
            },
            list_dir: {
                type: 'function',
                function: {
                    name: 'list_dir',
                    description: '列出目录内容，支持排序和显示文件大小/时间。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: '（单目录）目录路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多目录）目录路径数组'
                            },
                            show_hidden: {
                                type: 'boolean',
                                description: '是否显示隐藏文件（以 . 开头的文件，默认 false）'
                            },
                            sort_by: {
                                type: 'string',
                                enum: ['name', 'size', 'modified'],
                                description: '排序方式（默认 name，可选 size 或 modified）'
                            }
                        },
                        required: []
                    }
                }
            },
            find_files: {
                type: 'function',
                function: {
                    name: 'find_files',
                    description: '按 glob 模式查找文件，如 **/*.py。可按扩展名过滤。',
                    parameters: {
                        type: 'object',
                        properties: {
                            pattern: {
                                type: 'string',
                                description: 'glob 模式，如 **/*.py、*.json、src/**/*.ts'
                            },
                            path: {
                                type: 'string',
                                description: '（单目录）搜索根目录（默认当前目录）'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多目录）搜索根目录数组'
                            },
                            max_results: {
                                type: 'integer',
                                description: '最大返回文件数（默认 50）'
                            },
                            file_type: {
                                type: 'string',
                                description: '按扩展名过滤，如 .py 或 .js'
                            }
                        },
                        required: ['pattern']
                    }
                }
            },
            search_in_files: {
                type: 'function',
                function: {
                    name: 'search_in_files',
                    description: '在文件内容中搜索关键词/正则。支持多文件/目录，上下文行显示。',
                    parameters: {
                        type: 'object',
                        properties: {
                            keyword: {
                                type: 'string',
                                description: '搜索关键词或正则表达式'
                            },
                            path: {
                                type: 'string',
                                description: '（单个）文件或目录路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多个）文件或目录路径数组'
                            },
                            regex: {
                                type: 'boolean',
                                description: '是否将关键词作为正则表达式（默认 false）'
                            },
                            case_insensitive: {
                                type: 'boolean',
                                description: '是否不区分大小写（默认 false）'
                            },
                            max_results: {
                                type: 'integer',
                                description: '最大返回匹配数（默认 30）'
                            },
                            context_lines: {
                                type: 'integer',
                                description: '每个匹配显示几行上下文（默认 1）'
                            },
                            file_type: {
                                type: 'string',
                                description: '按扩展名过滤搜索文件，如 .py'
                            }
                        },
                        required: ['keyword']
                    }
                }
            },
            file_info: {
                type: 'function',
                function: {
                    name: 'file_info',
                    description: '获取文件/目录信息：大小、时间、行数等。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: '（单个）文件或目录路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多个）文件或目录路径数组'
                            }
                        },
                        required: []
                    }
                }
            },
            diff_preview: {
                type: 'function',
                function: {
                    name: 'diff_preview',
                    description: '查看 Git 差异(git diff)。staged/unstaged 可选，可指定文件。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Git 仓库路径（默认项目根目录）'
                            },
                            staged: {
                                type: 'boolean',
                                description: 'true=查看暂存区差异(git diff --cached)，false=查看工作区差异(git diff)，默认 false'
                            },
                            file: {
                                type: 'string',
                                description: '（单个）指定文件路径过滤差异（可选，如 src/app.js）'
                            },
                            files: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多个）指定文件路径数组过滤差异（与 file 二选一）'
                            },
                            max_lines: {
                                type: 'integer',
                                description: '最大返回行数（默认 200，防止输出过长）'
                            }
                        },
                        required: []
                    }
                }
            },
            git_log: {
                type: 'function',
                function: {
                    name: 'git_log',
                    description: '查看 Git 提交历史(git log)。支持限制数量、按作者过滤。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Git 仓库路径（默认项目根目录）'
                            },
                            count: {
                                type: 'integer',
                                description: '返回最近多少条提交记录（默认 20）'
                            },
                            author: {
                                type: 'string',
                                description: '按作者过滤（可选，如 "张三"）'
                            },
                            oneline: {
                                type: 'boolean',
                                description: 'true=简洁模式每行一条(默认)，false=完整信息含作者日期'
                            },
                            file: {
                                type: 'string',
                                description: '（单个）查看指定文件的提交历史（可选）'
                            },
                            files: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多个）查看多个文件的提交历史（与 file 二选一）'
                            }
                        },
                        required: []
                    }
                }
            },
            code_outline: {
                type: 'function',
                function: {
                    name: 'code_outline',
                    description: '分析代码结构，提取函数/类/方法骨架信息。支持 .py/.js/.java 等。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: '代码文件路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '多个代码文件路径数组（批量分析）'
                            }
                        },
                        required: ['path']
                    }
                }
            },
            move_file: {
                type: 'function',
                function: {
                    name: 'move_file',
                    description: '移动/重命名文件目录。支持批量，自动创建父目录。',
                    parameters: {
                        type: 'object',
                        properties: {
                            src: {
                                type: 'string',
                                description: '（单文件）源文件路径'
                            },
                            dst: {
                                type: 'string',
                                description: '（单文件）目标路径'
                            },
                            moves: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        src: { type: 'string', description: '源路径' },
                                        dst: { type: 'string', description: '目标路径' }
                                    }
                                },
                                description: '（批量）移动数组，每项 {src, dst}'
                            },
                            overwrite: {
                                type: 'boolean',
                                description: '目标已存在时是否覆盖（默认 false）'
                            }
                        },
                        required: []
                    }
                }
            },
            switch_tool_category: {
                type: 'function',
                function: {
                    name: 'switch_tool_category',
                    description: '切换工具分类。传入空字符串可查看所有分类。',
                    parameters: {
                        type: 'object',
                        properties: {
                            category: {
                                type: 'string',
                                description: '要切换到的分类名称。传入空字符串或省略时返回所有可用分类列表。'
                            }
                        },
                        required: []
                    }
                }
            },
            get_tool_result: {
                type: 'function',
                function: {
                    name: 'get_tool_result',
                    description: '查回已被丢弃的工具结果原文。工具结果超出保留数时会被替换为[已丢弃]，但原文已存档，可通过本工具找回。支持按ID查回单条、列出所有存档、或按工具名筛选。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                enum: ['get', 'list'],
                                description: '操作类型：get=按ID查回单条原文（需传id），list=列出所有存档摘要（不传id时默认list）'
                            },
                            id: {
                                type: 'integer',
                                description: '要查回的存档ID（action=get时必传，可通过action=list先查看有哪些ID）'
                            }
                        },
                        required: []
                    }
                }
            },
            send_email: {
                type: 'function',
                function: {
                    name: 'send_email',
                    description: '发送邮件，需预设 SMTP。支持纯文本和 HTML。',
                    parameters: {
                        type: 'object',
                        properties: {
                            subject: { type: 'string', description: '邮件主题（标题）' },
                            body: { type: 'string', description: '邮件正文内容' },
                            to: { type: 'string', description: '收件人邮箱地址。不传则使用设置中配置的默认收件人。' },
                            is_html: { type: 'boolean', description: '正文是否为 HTML 格式，默认 false（纯文本）' }
                        },
                        required: ['subject', 'body']
                    }
                }
            },

            set_camera: {
                type: 'function',
                function: {
                    name: 'set_camera',
                    description: '定位画布视口位置。target="center"或"chat:ID"快速定位。',
                    parameters: {
                        type: 'object',
                        properties: {
                            x: { type: 'number', description: '画布平移的 X 坐标（像素）。正值向右，负值向左。不传则保持当前 X 不变。' },
                            y: { type: 'number', description: '画布平移的 Y 坐标（像素）。正值向下，负值向上。不传则保持当前 Y 不变。' },
                            zoom: { type: 'number', description: '缩放比例（1=100%）。注意：当前画布缩放已被禁用，此参数仅做记录不会实际生效。不建议调整。' },
                            animate: { type: 'boolean', description: '是否使用动画过渡（默认 true，平滑移动到目标位置）' },
                            target: { type: 'string', description: '快速定位目标。可选值："center"=回到画布原点中心，"chat:对话ID"=定位到指定对话框。设置此值时 x/y 参数将被忽略。' }
                        },
                        required: []
                    }
                }
            },
            locate_mouse: {
                type: 'function',
                function: {
                    name: 'locate_mouse',
                    description: '获取/移动鼠标位置。可高亮闪烁引导用户注意，target 指定元素。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['get', 'move', 'click'], description: '操作类型：get=获取当前鼠标位置（默认）；move=在画布上移动/闪烁定位到指定坐标引导用户注意；click=模拟点击指定坐标处的元素' },
                            x: { type: 'number', description: '目标 X 坐标（屏幕坐标，像素）。move/click 操作时使用。' },
                            y: { type: 'number', description: '目标 Y 坐标（屏幕坐标，像素）。move/click 操作时使用。' },
                            target: { type: 'string', description: '目标元素选择器（如 "#btn-settings" 或 ".chatbox.active"）。设置此值时会定位到该元素的位置，优先于 x/y。click 操作时会直接点击该元素。' },
                            duration: { type: 'number', description: '闪烁高亮持续时间（毫秒），默认 2000ms。仅 move 操作时有效。' }
                        },
                        required: []
                    }
                }
            },

            // ===== 长期记忆工具（数据库持久化，跨对话复用） =====
            long_term_memory: {
                type: 'function',
                function: {
                    name: 'long_term_memory',
                    description: '长期记忆管理（数据库持久化，跨对话复用）。save=保存记忆，get=读取单条或多条，search=搜索记忆，list=列出全部，delete=删除单条或多条。每条记忆含 title/content/keywords/tags。适合存储用户偏好、项目经验、工具用法等需要跨对话保留的稳定信息。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['save', 'get', 'search', 'list', 'delete'], description: '操作类型：save=保存记忆，get=读取单条(需memory_id)或多条(需memory_ids)，search=关键词搜索，list=列出全部，delete=删除单条(需memory_id)或多条(需memory_ids)' },
                            title: { type: 'string', description: '记忆标题（save 时必填）' },
                            content: { type: 'string', description: '记忆内容（save 时必填）' },
                            keywords: { type: 'array', items: { type: 'string' }, description: '检索关键词（save 时可选；search 时与 keyword 二选一，支持多关键词搜索）' },
                            tags: { type: 'array', items: { type: 'string' }, description: '分类标签（save 时可选）' },
                            memory_id: { type: 'string', description: '记忆ID（get/delete 单条时用，与 memory_ids 二选一）' },
                            memory_ids: { type: 'array', items: { type: 'string' }, description: '记忆ID数组（get/delete 批量操作时用，与 memory_id 二选一）' },
                            keyword: { type: 'string', description: '搜索关键词（search 时必填，与 keywords 二选一）' },
                            match_mode: { type: 'string', enum: ['any', 'all'], description: '多关键词匹配模式：any=任一匹配(OR,默认)，all=全部匹配(AND)。需配合 keywords 使用' },
                            limit: { type: 'integer', description: '返回数量上限（search/list 时可选，默认20）' }
                        },
                        required: ['action']
                    }
                }
            },

            // ===== 内存记忆工具（纯内存高速读写，不落盘，适合编程工具调用） =====
            ram_cache: {
                type: 'function',
                function: {
                    name: 'ram_cache',
                    description: '内存缓存管理（纯内存，不落盘，读写极快）。set=写入键值对，get=读取值，delete=删除键，clear=清空全部，list=列出所有键，has=检查键是否存在。适合编程时临时缓存中间结果、传递数据、记录状态。重启后清空。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['set', 'get', 'delete', 'clear', 'list', 'has'], description: '操作类型：set=写入，get=读取单个或多个，delete=删除单个或多个键，clear=清空全部，list=列出所有键，has=检查单个或多个键是否存在' },
                            key: { type: 'string', description: '缓存键名（set/get/delete/has 单个操作时用，与 keys 二选一）' },
                            keys: { type: 'array', items: { type: 'string' }, description: '缓存键名数组（get/delete/has 批量操作时用，与 key 二选一）' },
                            value: { type: 'string', description: '缓存值（set 时必填）' },
                            ttl: { type: 'integer', description: '存活秒数，超时自动失效（set 时可选，0=永久）' }
                        },
                        required: ['action']
                    }
                }
            },

            // ===== AI 像素显示器工具（向左下角固定面板发送像素图/动画） =====
            // PXL 格式 v2：
            //   静态图: WxHB:RLE        例: 16x16B:36,2,3,2,...
            //   动画:   WxHB F帧数:RLE1|RLE2|...   例: 16x16B F2:36,2,...|16,16,...
            //   带fps:  WxHB F帧数@fps:RLE1|RLE2|... 例: 16x16B F4@8:...|...|...|...
            //   fps默认4，动画自动循环播放
            pixel_display: {
                type: 'function',
                function: {
                    name: 'pixel_display',
                    description: '像素显示器。向左下角面板发送PXL像素图/动画。静态:WxHB:RLE 动画:WxHB F帧数:R1|R2 动画带帧率:WxHB F帧数@fps:R1|R2。RLE从0(黑)开始交替计数。fps默认4,动画循环播放。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['show', 'clear', 'status'], description: 'show=显示,clear=清除,status=查状态' },
                            title: { type: 'string', description: '标题(可选)' },
                            data: { type: 'string', description: 'PXL数据。静态:16x16B:36,2,3,2,8,4,1,4,... 动画:16x16B F2:36,2,...|16,16,...  带fps:16x16B F4@8:R1|R2|R3|R4' },
                            fps: { type: 'integer', description: '帧率(可选,默认4。也可在data中用@fps指定)' }
                        },
                        required: ['action']
                    }
                }
            },

            // ===== 正则搜索工具（始终正则模式，支持捕获组提取） =====
            regex_search: {
                type: 'function',
                function: {
                    name: 'regex_search',
                    description: '正则表达式搜索工具（始终正则模式）。支持文件/文件夹、单路径/多路径。输出匹配行、捕获组、上下文。比 search_in_files+regex=true 更强大：自动提取捕获组、高亮匹配位置。',
                    parameters: {
                        type: 'object',
                        properties: {
                            pattern: {
                                type: 'string',
                                description: '正则表达式（必填）。如 \\bdef\\s+(\\w+) 匹配Python函数定义'
                            },
                            path: {
                                type: 'string',
                                description: '（单个）文件或目录路径'
                            },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '（多个）文件或目录路径数组'
                            },
                            case_insensitive: {
                                type: 'boolean',
                                description: '是否不区分大小写（默认 false）'
                            },
                            max_results: {
                                type: 'integer',
                                description: '最大返回匹配数（默认 50）'
                            },
                            context_lines: {
                                type: 'integer',
                                description: '每个匹配显示几行上下文（默认 2）'
                            },
                            file_type: {
                                type: 'string',
                                description: '按扩展名过滤搜索文件，如 .py 或 .js'
                            },
                            show_groups: {
                                type: 'boolean',
                                description: '是否显示捕获组详情（默认 true）'
                            }
                        },
                        required: ['pattern']
                    }
                }
            },

            // ===== 工单清单工具（多轮规划，批量执行） =====
            work_order: {
                type: 'function',
                function: {
                    name: 'work_order',
                    description: '工单清单工具。多轮规划：先创建工单、逐步添加任务项（读文件/写文件/运行命令/搜索等），可多轮修改，准备好后一次性查看全部任务并批量执行。支持按会话隔离，不同对话各自独立。',
                    parameters: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                enum: ['create', 'add', 'update', 'remove', 'show', 'clear'],
                                description: '操作类型：create=创建工单（需title），add=添加任务项，update=修改任务项（需item_id），remove=删除任务项（需item_id），show=查看当前工单，clear=清空工单'
                            },
                            title: {
                                type: 'string',
                                description: '工单标题（create 时必填）'
                            },
                            item_type: {
                                type: 'string',
                                enum: ['read', 'write', 'run', 'search', 'custom'],
                                description: '任务项类型：read=读文件，write=写文件，run=运行命令，search=搜索，custom=自定义'
                            },
                            target: {
                                type: 'string',
                                description: '任务目标（文件路径/命令/搜索词等）'
                            },
                            action_desc: {
                                type: 'string',
                                description: '对该任务项的具体操作描述'
                            },
                            params: {
                                type: 'string',
                                description: '额外参数（如写入内容、搜索路径等）'
                            },
                            note: {
                                type: 'string',
                                description: '备注说明'
                            },
                            item_id: {
                                type: 'integer',
                                description: '任务项ID（update/remove 时必填）'
                            },
                            new_note: {
                                type: 'string',
                                description: '更新后的备注（update 时可选）'
                            },
                            new_status: {
                                type: 'string',
                                enum: ['pending', 'done', 'skipped'],
                                description: '更新任务状态（update 时可选）'
                            }
                        },
                        required: ['action']
                    }
                }
            }
        }
}
;