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
