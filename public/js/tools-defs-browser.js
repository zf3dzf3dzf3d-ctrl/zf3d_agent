// ========== tools-defs-browser.js ==========
// 内置浏览器工具：browser_control（Playwright 持久化会话，可打开网页/截图/点击/填表/读正文，登录态跨重启保留）
window.registerToolDefs({
  tools: {
    "browser_control": {
      "type": "function",
      "function": {
        "name": "browser_control",
        "description": "内置浏览器工具（Playwright，登录态持久化于 server/data/browser_profile/，跨重启保留）：打开网页、截图、点击、滚动、填表、读正文、执行 JS。用户要求「打开网站/看网页/帮我登录/网页发帖/查页面内容」时调用。【存档习惯】调查一个网站后应立即 map_site 抓全站链接 + archive_site 存入网站档案（public/项目记录/网站档案/），防止浏览后遗忘，方便后期复查。【站点记忆】open/goto 时会自动附带该站历史记忆（private/记忆/站点/，用户不可见）；调查中总结出该站的经验/教训（如选择器技巧、登录流程、注意事项）请用 action=site_note 沉淀（严禁写密码），下次打开自动回读，越用越聪明。",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["open", "newtab", "switchtab", "closetab", "goto", "back", "forward", "reload", "content", "snapshot", "screenshot", "click", "scroll", "wheel", "type", "fill", "press", "key", "eval", "tabs", "close", "file", "track_save", "track_note", "map_site", "archive_site", "site_note", "site_memory"],
              "description": "open=当前标签跳转/首次新开；newtab=新开一个标签页并直接打开 url（一个浏览器多网址并存，默认上限30个）；switchtab=切换活动标签（index=标签序号，或 ref 风格 index 从 tabs 结果取）；closetab=关闭指定标签（index 或 all）；goto=当前页跳转（结果自动附带 ref 快照）；back=后退；content=读取页面正文文本；snapshot=生成可交互元素 ref 快照；screenshot=截图；click=点击（ref/selector/text/x+y 四选一，推荐用快照里的 ref）；scroll=滚动页面（y=像素数 正数向下/负数向上，to=top/bottom，selector=滚动到该元素）；type=在输入框逐字输入；fill=清空后填入文本（ref 或 selector）；press=按键如 Enter；eval=执行 JS 表达式；tabs=列出所有标签页（含 index/url/title，供 switchtab/closetab 用）；close=关闭会话(all=true 关全部)；file=按 path 读取截图返回 base64；map_site=抓取当前页面同域全部链接；archive_site=抓链接落档网站档案；site_note=沉淀本站经验/教训到站点记忆（配 text，严禁写密码）；site_memory=读取站点记忆（配 domain 可选，默认当前站）"
            },
            "url": {
              "type": "string",
              "description": "（open/goto）网址，可省略 https:// 自动补全"
            },
            "selector": {
              "type": "string",
              "description": "（click/type/fill）CSS 选择器，如 #kw、input[name='q']"
            },
            "ref": {
              "type": "string",
              "description": "（click/fill/snapshot 推荐方式）元素 ref，来自最近一次 goto/snapshot 返回的快照，如 e12。比猜 selector 更准更快；页面跳转后失效需重新 snapshot"
            },
            "text": {
              "type": "string",
              "description": "（type/fill）要输入的文本；（click）要点击的可见文字（与 selector 二选一）；（archive_site）本次存档备注"
            },
            "limit": {
              "type": "number",
              "description": "（map_site/archive_site）抓取链接上限，默认 500，最大 2000"
            },
            "mode": {
              "type": "string",
              "enum": ["write", "diff"],
              "description": "（archive_site）write=追加合并落档（默认）；diff=不落档，仅对比已有档案返回新增/失效链接"
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
              "description": "会话名。【2026-10-02 默认每对话独立】：不传时自动用本对话专属会话 wb_c_<对话ID>（与工作台浏览器同一个 Chromium 实例，AI 操作实时显示在工作台画面里）。不同对话的会话完全隔离（独立标签组+独立登录态目录）。禁止显式传 'default'（会退回共享会话导致跨对话串台）；仅当你确实要跨对话共用时才显式传自定义会话名"
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
