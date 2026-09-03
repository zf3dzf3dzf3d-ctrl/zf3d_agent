// ========== tools-defs-media.js ==========
// 拆分自 tools-definitions.js，注册进 window.ToolDefinitions（见 tools-defs-registry.js）
window.registerToolDefs({
  tools: {
    "image_gen": {
      "type": "function",
      "function": {
        "name": "image_gen",
        "description": "AI 文生图工具：多渠道免费额度自动切换。用户说\"画个XX/生成图片\"时调用，返回图片 URL（用 markdown ![](url) 直接展示）。渠道：pollinations(免费无key，默认主力) / siliconflow / zhipu，自动失败切换+冷却恢复。",
        "parameters": {
          "type": "object",
          "properties": {
            "prompt": {
              "type": "string",
              "description": "画面描述（必填）。英文提示词效果更佳，可把中文需求翻译成英文细节描述。"
            },
            "size": {
              "type": "string",
              "description": "图片尺寸，可选：512x512、768x768、1024x1024(默认)、768x1024、1024x768、832x1216、1216x832"
            },
            "action": {
              "type": "string",
              "description": "generate=生成图片(默认)；status=查看各渠道可用状态"
            }
          },
          "required": [
            "prompt"
          ]
        }
      }
    },
    "video_gen": {
      "type": "function",
      "function": {
        "name": "video_gen",
        "description": "AI 文生视频工具：用户说\"生成视频/做个XX视频/动起来\"时调用，返回视频 URL（用 HTML <video> 标签直接展示）。渠道：pollinations(免费无key，默认主力，Veo-3 模型异步轮询) / siliconflow(Wan2.1 需 key)。自动失败切换+冷却恢复。生成完成后会自动在 Kite 画布上添加一个可拖拽的视频节点，并自动连接最近对话的曲线。",
        "parameters": {
          "type": "object",
          "properties": {
            "prompt": {
              "type": "string",
              "description": "视频内容描述（必填）。英文提示词效果更佳，可把中文需求翻译成英文细节描述（运镜、风格、动作、光影等）。"
            },
            "duration": {
              "type": "integer",
              "description": "视频时长（秒），可选 4/5/8/10，默认 5。"
            },
            "size": {
              "type": "string",
              "description": "视频尺寸，可选：832x480(默认 横屏) / 480x832(竖屏) / 1024x576(高清横屏) / 576x1024(高清竖屏)"
            },
            "model": {
              "type": "string",
              "description": "视频模型：veo3(Pollinations Veo-3, 默认免费) / wan2.1(硅基流动, 需 key)"
            },
            "action": {
              "type": "string",
              "description": "generate=生成视频(默认)；status=查看各渠道可用状态"
            }
          },
          "required": [
            "prompt"
          ]
        }
      }
    },
    "set_camera": {
      "type": "function",
      "function": {
        "name": "set_camera",
        "description": "定位画布视口位置。target=\"center\"或\"chat:ID\"快速定位。",
        "parameters": {
          "type": "object",
          "properties": {
            "x": {
              "type": "number",
              "description": "画布平移的 X 坐标（像素）。正值向右，负值向左。不传则保持当前 X 不变。"
            },
            "y": {
              "type": "number",
              "description": "画布平移的 Y 坐标（像素）。正值向下，负值向上。不传则保持当前 Y 不变。"
            },
            "zoom": {
              "type": "number",
              "description": "缩放比例（1=100%）。注意：当前画布缩放已被禁用，此参数仅做记录不会实际生效。不建议调整。"
            },
            "animate": {
              "type": "boolean",
              "description": "是否使用动画过渡（默认 true，平滑移动到目标位置）"
            },
            "target": {
              "type": "string",
              "description": "快速定位目标。可选值：\"center\"=回到画布原点中心，\"chat:对话ID\"=定位到指定对话框。设置此值时 x/y 参数将被忽略。"
            }
          },
          "required": []
        }
      }
    },
    "locate_mouse": {
      "type": "function",
      "function": {
        "name": "locate_mouse",
        "description": "鼠标定位/控制（真实系统鼠标）。get=获取位置；set=移动（绝对x/y或相对dx/dy）；click=真实点击（左/右/双击）；scroll=滚动滚轮；move=画布高亮引导用户注意（target 指定元素）。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "get",
                "set",
                "click",
                "scroll",
                "move"
              ],
              "description": "操作类型：get=获取当前鼠标位置（默认）；set=真实移动系统鼠标；click=真实点击系统鼠标；scroll=真实滚动滚轮；move=在画布上高亮定位引导用户注意（纯前端）"
            },
            "x": {
              "type": "number",
              "description": "目标 X 坐标（屏幕坐标，像素）。set/click 操作时使用。"
            },
            "y": {
              "type": "number",
              "description": "目标 Y 坐标（屏幕坐标，像素）。set/click 操作时使用。"
            },
            "dx": {
              "type": "number",
              "description": "相对 X 位移（像素）。set/click 时与 x/y 二选一，如 dy=-100 表示向上移 100。"
            },
            "dy": {
              "type": "number",
              "description": "相对 Y 位移（像素）。set/click 时与 x/y 二选一，如 dy=-100 表示向上移 100。"
            },
            "button": {
              "type": "string",
              "description": "click 操作：left=左键（默认）/ right=右键 / double=双击。"
            },
            "times": {
              "type": "number",
              "description": "click 操作：点击次数，默认 1（button=double 时忽略）。"
            },
            "delta": {
              "type": "number",
              "description": "scroll 操作：滚动量，一格约 120，正=向上 负=向下（默认 -120）。"
            },
            "target": {
              "type": "string",
              "description": "目标元素选择器（如 \"#btn-settings\" 或 \".chatbox.active\"）。仅 move 操作：定位到该元素位置，优先于 x/y。"
            },
            "duration": {
              "type": "number",
              "description": "闪烁高亮持续时间（毫秒），默认 2000ms。仅 move 操作时有效。"
            }
          },
          "required": []
        }
      }
    },
    "control_keyboard": {
      "type": "function",
      "function": {
        "name": "control_keyboard",
        "description": "键盘控制。get=查询按键是否按下；press=真实敲击系统键盘按键/组合键（如 ctrl+s）；text=真实输入一段文本（支持中文）。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["get", "press", "text"],
              "description": "操作类型：get=查询按键状态（默认）；press=敲击按键；text=输入文本"
            },
            "keys": {
              "type": "string",
              "description": "press/get 操作：按键名或组合键，如 \"a\"、\"enter\"、\"ctrl+s\"、\"ctrl+shift+esc\"。可用：f1-f12、enter、esc、tab、space、backspace、delete、home、end、pageup、pagedown、up/down/left/right、ctrl、shift、alt、win、numpad0-9 及单个字母数字。"
            },
            "hold_ms": {
              "type": "number",
              "description": "press 操作：按住毫秒数（默认 0，按下后立即抬起）。"
            },
            "text": {
              "type": "string",
              "description": "text 操作：要输入的文本内容（支持中文）。"
            }
          },
          "required": []
        }
      }
    },
    "pixel_display": {
      "type": "function",
      "function": {
        "name": "pixel_display",
        "description": "像素显示器。向左下角面板发送PXL像素图/动画。静态:WxHB:RLE 动画:WxHB F帧数:R1|R2 动画带帧率:WxHB F帧数@fps:R1|R2。RLE从0(黑)开始交替计数。fps默认4,动画循环播放。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "show",
                "clear",
                "status"
              ],
              "description": "show=显示,clear=清除,status=查状态"
            },
            "title": {
              "type": "string",
              "description": "标题(可选)"
            },
            "data": {
              "type": "string",
              "description": "PXL数据。静态:16x16B:36,2,3,2,8,4,1,4,... 动画:16x16B F2:36,2,...|16,16,...  带fps:16x16B F4@8:R1|R2|R3|R4"
            },
            "fps": {
              "type": "integer",
              "description": "帧率(可选,默认4。也可在data中用@fps指定)"
            }
          },
          "required": [
            "action"
          ]
        }
      }
    },
    "send_email": {
      "type": "function",
      "function": {
        "name": "send_email",
        "description": "发送邮件，需预设 SMTP。支持纯文本和 HTML。",
        "parameters": {
          "type": "object",
          "properties": {
            "subject": {
              "type": "string",
              "description": "邮件主题（标题）"
            },
            "body": {
              "type": "string",
              "description": "邮件正文内容"
            },
            "to": {
              "type": "string",
              "description": "收件人邮箱地址。不传则使用设置中配置的默认收件人。"
            },
            "is_html": {
              "type": "boolean",
              "description": "正文是否为 HTML 格式，默认 false（纯文本）"
            }
          },
          "required": [
            "subject",
            "body"
          ]
        }
      }
    }
  },
  categories: {} // 分类统一在 tools-defs-categories.js 注册
});
