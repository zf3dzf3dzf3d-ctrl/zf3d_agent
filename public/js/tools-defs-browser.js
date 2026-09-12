// ========== tools-defs-browser.js ==========
// 内置浏览器工具：browser_control（Playwright 持久化会话，可打开网页/截图/点击/填表/读正文，登录态跨重启保留）
window.registerToolDefs({
  tools: {
    "browser_control": {
      "type": "function",
      "function": {
        "name": "browser_control",
        "description": "内置浏览器工具（Playwright，登录态持久化于 server/data/browser_profile/，跨重启保留）：打开网页、截图、点击、滚动、填表、读正文、执行 JS。用户要求「打开网站/看网页/帮我登录/网页发帖/查页面内容」时调用。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["open", "goto", "back", "content", "screenshot", "click", "scroll", "type", "fill", "press", "eval", "tabs", "close", "file", "track_save", "track_note"],
              "description": "open=新标签打开网页；goto=当前页跳转；back=后退；content=读取页面正文文本；screenshot=截图；click=点击（selector/text/x+y 坐标 三选一）；scroll=滚动页面（y=像素数 正数向下/负数向上，to=top/bottom，selector=滚动到该元素）；type=在输入框逐字输入；fill=清空后填入文本；press=按键如 Enter；eval=执行 JS 表达式；tabs=列出标签页；close=关闭会话(all=true 关全部)；file=按 path 读取截图返回 base64"
            },
            "url": {
              "type": "string",
              "description": "（open/goto）网址，可省略 https:// 自动补全"
            },
            "selector": {
              "type": "string",
              "description": "（click/type/fill）CSS 选择器，如 #kw、input[name='q']"
            },
            "text": {
              "type": "string",
              "description": "（type/fill）要输入的文本；（click）要点击的可见文字（与 selector 二选一）"
            },
            "x": {
              "type": "number",
              "description": "（click）横坐标（像素，截图视口内），配合 y 用。元素定位困难时按坐标直接点"
            },
            "y": {
              "type": "number",
              "description": "（click）纵坐标（像素，截图视口内）；（scroll）滚动像素数，正数向下/负数向上"
            },
            "to": {
              "type": "string",
              "description": "（scroll）滚动目标：top=回顶部，bottom=到底部"
            },
            "key": {
              "type": "string",
              "description": "（press）按键名，如 Enter、Escape、Tab"
            },
            "script": {
              "type": "string",
              "description": "（eval）要执行的 JS 表达式，如 document.title"
            },
            "session": {
              "type": "string",
              "description": "会话名（默认 default）。不同会话独立标签组与独立登录态目录，一般不用传"
            },
            "headless": {
              "type": "boolean",
              "description": "是否无头模式（默认 true）。用户想亲眼看浏览器窗口时传 false"
            },
            "all": {
              "type": "boolean",
              "description": "（close）是否关闭所有会话"
            },
            "path": {
              "type": "string",
              "description": "（file）截图文件绝对路径，来自上一步返回的 screenshot 字段"
            },
            "text": {
              "type": "string",
              "description": "（track_note）跟踪备注内容；（track_save）本次快照备注"
            },
            "session": {
              "type": "string",
              "description": "跟踪对象名（track_save/track_note 用，默认 default；对应 public/项目记录/浏览器跟踪-<名>.md）"
            }
          },
          "required": ["action"]
        }
      }
    }
  }
});
