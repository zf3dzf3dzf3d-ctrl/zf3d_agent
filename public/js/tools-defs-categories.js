// ========== tools-defs-categories.js ==========
// 工具分类（极简/视觉工具/编程/流程图/写作/黑客）定义，注册进 window.ToolDefinitions
// 说明：视觉工具 / 编程 / 流程图 / 写作 不再重复罗列极简工具，
//       而是声明 includes: ["极简"]，运行时动态继承「极简」分类中实际启用的工具。
window.registerToolDefs({
  categories: {
    "极简": {
      "icon": "📄",
      "desc": "基础工具集：文件读写、运行命令、搜索替换、任务管理、浏览器操作",
      "tools": [
        "task_complete",
        "switch_tool_category",
        "ask_user",
        "read_file",
        "read_lines",
        "write_file",
        "run_code",
        "replace_text",
        "tree_dir",
        "find_files",
        "search_in_files",
        "file_info",
        "move_file",
        "project_record",
        "capability_tree",
        "long_plan",
        "plan_batch",
        "task_list",
        "get_tool_result",
        "collab",
        "browser_control"
      ]
    },
    "视觉工具": {
      "icon": "🎨",
      "desc": "含极简全部工具，另加 AI 视觉生成：生图、生视频、截图、像素显示等",
      "includes": ["极简"],
      "tools": [
        "image_gen",
        "video_gen",
        "video_edit",
        "video_status",
        "set_camera",
        "monitor"
      ]
    },
    "编程": {
      "icon": "💻",
      "desc": "含极简全部工具，另加开发套件：Git、代码结构、差异对比、定时任务、记忆缓存、聊天检索、邮件、网络请求等",
      "includes": ["极简"],
      "tools": [
        "chat_context",
        "chat_manage",
        "chat_summary",
        "code_outline",
        "diff_preview",
        "git_log",
        "git_save",
        "timeline",
        "image_gen",
        "list_dir",
        "locate_mouse",
        "control_keyboard",
        "mobile_control",
        "long_term_memory",
        "monitor",
        "net",
        "query_answers",
        "ram_cache",
        "recent_questions",
        "regex_search",
        "schedule",
        "search_chat",
        "send_email",
        "set_camera",
        "switch_port",
        "video_gen",
        "video_edit",
        "wait",
        "work_order",
        "table_memory",
        "memory_map",
        "table_viewer",
        "undo_changes",
        "undo_step",
        "self_check"
      ]
    },
    "写作": {
      "icon": "✍️",
      "desc": "含极简全部工具，另加 40+ AI 文本工具：改写润色、扩写缩写、翻译、摘要、分析检测、标题生成、SEO 等",
      "includes": ["极简"],
      "tools": [
        "adapt_audience",
        "analyze_sentiment",
        "analyze_text_metrics",
        "bystander_view",
        "change_tone",
        "color_text",
        "compare_text",
        "convert_chars",
        "detect_sensitive",
        "detect_style",
        "expand_text",
        "expert_review",
        "extract_keywords",
        "extract_outline",
        "fact_check",
        "fix_punctuation",
        "format_beautify",
        "generate_description",
        "generate_hook",
        "generate_quotes",
        "generate_title",
        "group_discussion",
        "interpret_document",
        "list_formats",
        "novice_view",
        "opposing_view",
        "optimize_ends",
        "play_devil_advocate",
        "polish_text",
        "praise_text",
        "professional_edit",
        "proofread_text",
        "quick_article",
        "rate_article",
        "rewrite_text",
        "role_brainstorm",
        "seo_optimize",
        "shorten_text",
        "summarize_text",
        "translate_text",
        "write_outline"
      ]
    },
    "智能体广场": {
      "hidden": true, // 专用分类：不在常规对话右上角分类子菜单显示
      "icon": "💬",
      "desc": "含极简全部工具，另加论坛三件套：读帖、发帖、回帖（对接 zf3d.com 智能体广场版块）",
      "includes": ["极简"],
      "tools": [
        "forum_read",
        "forum_write",
        "forum_reply"
      ]
    },
    "只读沙盘": {
      "hidden": true, // 专用分类：仅 i进化沙盘场景使用，不在常规对话分类子菜单显示
      "icon": "🔍",
      "desc": "i进化沙盘专用只读工具集：仅检索/读取/评测，无写文件、改文件、执行命令类工具（红线：只出策划案，不实际干活）",
      "tools": [
        "task_complete",
        "switch_tool_category",
        "read_file",
        "read_lines",
        "tree_dir",
        "find_files",
        "search_in_files",
        "file_info",
        "get_tool_result",
        "project_record",
        "net",
        "task_list"
      ]
    },
    "黑客": {
      "icon": "🛡️",
      "desc": "含极简全部工具，另加网络诊断/安全自检：Ping、端口扫描、DNS、HTTP 探活、SSL、WHOIS、路由追踪、IP 归属、CDN 检测、密码强度自检（仅限自有或已授权资产运维使用）",
      "includes": ["极简"],
      "tools": [
        "net_ping",
        "port_scan",
        "dns_query",
        "http_probe",
        "ssl_check",
        "whois_query",
        "traceroute",
        "ip_geo",
        "http_headers",
        "cdn_check",
        "password_audit",
        "subdomain_enum",
        "sensitive_file_probe"
      ]
    }
  }
});
