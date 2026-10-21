// ========== engine-tools-defs.js ==========
// 各底层引擎（server/engines/，local_loop 模式）私有工具集的分类定义。
// 分类命名规则：引擎名 + 引擎（如「Claude Code 引擎」），与 极简/编程/写作 并列，
// 切换引擎时前端会自动切到对应分类（见 chatbox-03-chat-interaction.js 引擎切换钩子）。
// 引擎元信息：window.EnginesUI.engines / DB.getEngines() 的 {id, name, icon, own_tools}
window.registerToolDefs({
  categories: {
    "Claude Code 引擎": {
      "icon": "🤖",
      "engineId": "claude_code_style",
      "desc": "Claude Code 风格引擎自有工具集：先读后写纪律 + 精确 Edit + TodoWrite 任务清单",
      "tools": [
        "task_complete", "ask_user",
        "Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite"
      ]
    },
    "Codex 引擎": {
      "icon": "🔁",
      "engineId": "codex_style",
      "desc": "Codex 风格引擎自有工具集：提议-确认两段式写入 + 审计回放",
      "tools": [
        "task_complete", "ask_user",
        "codex_read", "codex_read_lines", "codex_list_dir",
        "codex_propose_write", "codex_apply_write", "codex_replace", "codex_diffstat",
        "codex_audit", "codex_run_code", "codex_set_approval"
      ]
    },
    "DeepSeek 引擎": {
      "icon": "🐳",
      "engineId": "deepseek_direct",
      "desc": "DeepSeek 直连引擎自有工具集：极简直读直写直跑",
      "tools": [
        "task_complete", "ask_user",
        "ds_read", "ds_write", "ds_files", "ds_grep", "ds_run"
      ]
    },
    "Hermes 引擎": {
      "icon": "⚡",
      "engineId": "hermes_style",
      "desc": "Hermes 风格引擎自有工具集：读写跑 + 技能库管理",
      "tools": [
        "task_complete", "ask_user",
        "h_read", "h_write", "h_grep", "h_run",
        "skill_list", "skill_view", "skill_save"
      ]
    },
    "OpenClaw 引擎": {
      "icon": "🦀",
      "engineId": "openclaw_style",
      "desc": "OpenClaw 风格引擎自有工具集：路由/绑定/任务编排",
      "tools": [
        "task_complete", "ask_user",
        "o_routes", "o_bind", "o_task", "o_list", "o_read", "o_write", "o_run"
      ]
    },
    "Pi 引擎": {
      "icon": "🥧",
      "engineId": "pi_style",
      "desc": "Pi 风格引擎自有工具集：管道预算约束下的读写搜索运行",
      "tools": [
        "task_complete", "ask_user",
        "pi_read", "pi_read_lines", "pi_files", "pi_grep", "pi_run", "pi_write"
      ]
    }
  }
});

// ===== 引擎工具 → 分类 的反查映射（切换引擎时自动定位分类） =====
window.EngineToolCategories = {
  claude_code_style: 'Claude Code 引擎',
  codex_style: 'Codex 引擎',
  deepseek_direct: 'DeepSeek 引擎',
  hermes_style: 'Hermes 引擎',
  openclaw_style: 'OpenClaw 引擎',
  pi_style: 'Pi 引擎'
};

// ===== 引擎自有工具描述表（名称 -> 说明/参数用法），供设置面板展示与复制 =====
window.EngineToolDescs = {
  // 通用
  "task_complete": "结束任务并给用户最终答复。success 标记成败，message 写清结论、改动内容和涉及文件。",
  "ask_user": "向用户提问并暂停等待回答。可传 question 提问，或用 fields 定义表单（text/select/radio/checkbox）。",
  // Claude Code 风格
  "cc_read": "读取文件内容，支持行范围与关键词筛选。",
  "cc_edit": "编辑文件：精确替换指定文本，或整文件写入。",
  "cc_write": "写入文本文件，已存在则自动备份 .bak。",
  "cc_glob": "按 glob 模式查找文件，如 **/*.py。",
  "cc_grep": "在文件内容中搜索关键词或正则，支持上下文行。",
  "cc_bash": "运行 shell 命令并返回输出。",
  "cc_tree": "树形显示目录结构。",
  // Codex 风格
  "codex_read": "读取文件内容。",
  "codex_write": "写入文件（自动备份）。",
  "codex_edit": "替换文件中的指定文本。",
  "codex_apply_patch": "应用补丁修改多个文件。",
  "codex_shell": "执行 shell 命令。",
  "codex_grep": "内容搜索。",
  // DeepSeek 风格
  "ds_read_file": "读取文件内容，支持 max_chars 限制。",
  "ds_write_file": "写入文本文件。",
  "ds_replace_text": "精确替换文件文本，多处匹配需 all:true。",
  "ds_run_code": "运行 shell 命令，返回 stdout/stderr。",
  "ds_find_files": "按 glob 查找文件。",
  // Hermes 风格
  "hermes_read": "读取文件。",
  "hermes_write": "写入文件。",
  "hermes_edit": "编辑文件。",
  "hermes_shell": "执行命令。",
  "hermes_search": "搜索文件内容。",
  // OpenClaw 风格
  "oc_gateway": "OpenClaw 网关操作：会话/消息管理。",
  "oc_workspace": "工作区文件操作：读取、写入、列表。",
  // Pi 风格
  "pi_read": "读取文件内容（受管道预算约束）。",
  "pi_read_lines": "按行读取文件。",
  "pi_files": "列出/查找文件。",
  "pi_grep": "内容搜索。",
  "pi_run": "运行命令。",
  "pi_write": "写入文件。"
};
