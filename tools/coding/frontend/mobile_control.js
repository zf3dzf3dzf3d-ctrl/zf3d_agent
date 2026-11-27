// mobile_control - 手机控制工具（前端定义）
// 后端: tools/coding/backend/mobile_control.py
// 通过 ADB 控制安卓手机：截屏→看屏→点击/滑动/输入→开App，PC 大脑 + 手机手脚
window.Tools = window.Tools || {};
Object.assign(window.Tools, {
  allTools: Object.assign(window.Tools.allTools || {}, {
    "mobile_control": {
      "type": "function",
      "function": {
        "name": "mobile_control",
        "description": "手机控制（安卓，需 USB 连接并开启 USB 调试，或 WiFi 无线调试）。actions：devices=列出设备；screenshot=截屏（保存PNG可查看）；ui=读取屏幕控件树（含坐标，推荐先用它定位元素）；tap=点击坐标(x,y)；swipe=滑动(x1,y1,x2,y2,duration)；text=输入文本（英文数字）；key=按键(back/home/recent/volume_up等)；app=启动/停止应用(op=launch/stop/list, package=包名)；shell=透传 adb shell 命令；wifi=无线连接(先USB开tcpip再connect ip:5555)。用户说「控制手机/操作手机/手机截屏/帮我开微信」时调用。典型流程：devices→ui或screenshot→tap/text/key→再screenshot确认。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["devices", "screenshot", "ui", "tap", "swipe", "text", "key", "app", "shell", "wifi"],
              "description": "操作类型（默认 devices）"
            },
            "device": { "type": "string", "description": "设备序列号（多设备时指定；单设备自动选择）" },
            "x": { "type": "number", "description": "tap：横坐标" },
            "y": { "type": "number", "description": "tap：纵坐标" },
            "x1": { "type": "number", "description": "swipe：起点x" },
            "y1": { "type": "number", "description": "swipe：起点y" },
            "x2": { "type": "number", "description": "swipe：终点x" },
            "y2": { "type": "number", "description": "swipe：终点y" },
            "duration": { "type": "number", "description": "swipe：时长毫秒（默认300）" },
            "text": { "type": "string", "description": "text：要输入的文本（英文/数字/符号）" },
            "key": { "type": "string", "description": "key：按键名 back/home/menu/power/volume_up/volume_down/enter/del/up/down/left/right/recent 等" },
            "op": { "type": "string", "enum": ["launch", "stop", "list"], "description": "app：launch=启动（默认）stop=强停 list=列出包名" },
            "package": { "type": "string", "description": "app：应用包名，如 com.tencent.mm（微信）" },
            "filter": { "type": "string", "description": "app list：按关键词过滤包名" },
            "command": { "type": "string", "description": "shell：要执行的 adb shell 命令" },
            "connect": { "type": "string", "description": "wifi：连接地址 ip:5555" }
          },
          "required": ["action"]
        }
      }
    }
  })
});
