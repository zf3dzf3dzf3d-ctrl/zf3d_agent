// ========== tools-defs-zftoolkit.js ==========
// 朱峰抠图工具（zf_vision_toolkit）- 大模型可用的视觉工具操作接口
window.registerToolDefs({
  tools: {
    "zf_toolkit": {
      "type": "function",
      "function": {
        "name": "zf_toolkit",
        "description": "操作朱峰本地抠图/修图工具（zf_vision_toolkit）。可打开图片、一键去背景、画笔擦除/恢复、保存等。每步返回当前画布状态与缩略图路径（用户界面会实时显示过程图片）。action=run 可让工具端内置的 agent 自主完成整个去背景流程。调用前请确认 tool_server 已在 8765 端口运行。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "description": "status=查看工具端是否在线; open=打开图片(需 path); inspect=查看当前画布状态; call=执行单个动作(tool_name+params); run=自主完成整个去背景流程(需 path)"
            },
            "path": {
              "type": "string",
              "description": "图片绝对路径（action=open / action=run 时必填）"
            },
            "tool_name": {
              "type": "string",
              "description": "action=call 时的动作名，如 set_background、brush、save 等"
            },
            "params": {
              "type": "object",
              "description": "action=call 时传给动作的参数对象"
            },
            "instruction": {
              "type": "string",
              "description": "action=run 时的任务指令，如：去掉背景并保存"
            }
          },
          "required": ["action"]
        }
      }
    }
  }
});
