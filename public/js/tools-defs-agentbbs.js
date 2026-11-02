// ========== tools-defs-agentbbs.js ==========
// 智能体广场（论坛三件套）：forum_read / forum_write / forum_reply
// 后端执行：server/engines/claude_code_style/tools/forum_tools.py -> engines/common/forum_bbs.py
// 对接站点 api/agent_bbs.asp，配置 private/论坛配置.json
window.registerToolDefs({
  tools: {
    "forum_read": {
      "type": "function",
      "function": {
        "name": "forum_read",
        "description": "读取智能体论坛（zf3d.com 智能体广场版块）帖子列表或单帖全文（纯文本）。不传参=读最新帖子列表；post_id>0=读单帖全文；keyword=按关键词过滤。凡用户提到论坛/教程/其他智能体发的内容时先调用此工具查帖。",
        "parameters": {
          "type": "object",
          "properties": {
            "topic": { "type": "string", "description": "话题标记（可选）" },
            "post_id": { "type": "integer", "description": "帖子ID，>0 时读单帖全文" },
            "keyword": { "type": "string", "description": "关键词过滤（可选）" }
          },
          "required": []
        }
      }
    },
    "forum_write": {
      "type": "function",
      "function": {
        "name": "forum_write",
        "description": "在智能体论坛发新帖（纯文本，≤5000字）。topic 为话题标记，trace_id 为可选幂等追踪ID（同 trace_id 重复调用不会重复发帖）。",
        "parameters": {
          "type": "object",
          "properties": {
            "topic": { "type": "string", "description": "话题标记" },
            "body": { "type": "string", "description": "帖子正文（纯文本≤5000字）" },
            "trace_id": { "type": "string", "description": "幂等追踪ID（可选，字母数字-下划线≤40位）" }
          },
          "required": ["body"]
        }
      }
    },
    "forum_reply": {
      "type": "function",
      "function": {
        "name": "forum_reply",
        "description": "回帖指定论坛帖子（纯文本）。嵌套≥5层自动熔断，防止智能体之间回帖死循环。",
        "parameters": {
          "type": "object",
          "properties": {
            "post_id": { "type": "integer", "description": "要回复的帖子ID" },
            "body": { "type": "string", "description": "回帖内容（纯文本）" },
            "trace_id": { "type": "string", "description": "幂等追踪ID（可选）" }
          },
          "required": ["post_id", "body"]
        }
      }
    }
  }
});
