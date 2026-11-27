// ========== tools-defs-dcc.js ==========
// DCC 软件连接器（3ds Max / Blender / Houdini）—— 移植自老版本连接器
// 3ds Max: TCP 8765 (maxscript/python) | Blender: TCP 9876 (bpy) | Houdini: TCP 45172 (bridge)
window.registerToolDefs({
  tools: {
    "d3max": {
      "type": "function",
      "function": {
        "name": "d3max",
        "description": "3ds Max 连接器：与 3ds Max 桥插件通信（TCP 127.0.0.1:8765）。check 检查连接；maxscript 执行 MaxScript 脚本；python 执行 Python 脚本。用于自动化建模、场景查询、材质/灯光/相机操作等。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "description": "check=检查连接（默认），maxscript=执行 MaxScript，python=执行 Python" },
            "code": { "type": "string", "description": "要执行的 MaxScript 或 Python 代码（action 为 maxscript/python 时必填）" },
            "port": { "type": "integer", "description": "桥端口，默认 8765" },
            "timeout": { "type": "number", "description": "超时秒数，默认 60" }
          },
          "required": []
        }
      }
    },
    "blender_dcc": {
      "type": "function",
      "function": {
        "name": "blender_dcc",
        "description": "Blender 连接器：与 BlenderMCP 服务通信（TCP 127.0.0.1:9876）。check 检查连接；execute 直接执行 bpy Python 代码（建模/材质/渲染/导出等一切 bpy 能做的事）；scene_info 列出场景对象。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "description": "check=检查连接（默认），execute=执行 bpy 代码，scene_info=场景对象列表，get_object_info=查询单个对象变换" },
            "code": { "type": "string", "description": "bpy Python 代码（action=execute 时必填）" },
            "object": { "type": "string", "description": "对象名（action=get_object_info 时用）" },
            "port": { "type": "integer", "description": "端口，默认 9876" },
            "timeout": { "type": "number", "description": "超时秒数，默认 60" }
          },
          "required": []
        }
      }
    },
    "houdini_dcc": {
      "type": "function",
      "function": {
        "name": "houdini_dcc",
        "description": "Houdini 连接器：与 Houdini Agent 桥通信（JSON-lines TCP，默认 45172，自动读 %LOCALAPPDATA%\\HoudiniAgent\\bridge.port 端口发现文件）。check 检查连接；call 调用桥上注册的工具；scene 获取场景上下文。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "description": "check=检查连接（默认），call=调用桥工具（execute_tool），scene=场景上下文" },
            "tool": { "type": "string", "description": "桥工具名（action=call 时必填）" },
            "args": { "type": "object", "description": "桥工具参数（action=call 时用，JSON 对象）" },
            "port": { "type": "integer", "description": "端口，默认自动发现" },
            "timeout": { "type": "number", "description": "超时秒数，默认 180" }
          },
          "required": []
        }
      }
    }
  },
  categories: {
    "DCC": {
      "icon": "🧊",
      "desc": "三维软件连接器（含极简）：3ds Max（MaxScript/Python）、Blender（bpy）、Houdini（Agent桥）的本地 TCP 桥接，可自动化建模、场景查询与渲染操作。需先在对应软件里启动桥插件。",
      "includes": ["极简"],
      "tools": ["d3max", "blender_dcc", "houdini_dcc", "model_3d_gen"]
    }
  }
});
