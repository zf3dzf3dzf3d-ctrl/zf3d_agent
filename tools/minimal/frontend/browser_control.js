// ========== browser_control.js - 工具定义 ==========
// 朱峰社区智能体无限 5.1.2 - 内置浏览器工具（Playwright 持久化会话）
// 后端执行逻辑: tools/minimal/backend/browser_control.py

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['browser_control']) {
    window.Tools.allTools['browser_control'] = {
    browser_control: {
        type: 'function',
        function: {
            name: 'browser_control',
            description: '内置浏览器工具（Playwright 持久化会话）：打开网页、截图、点击、填表、读取页面正文、执行 JS。登录态持久化。用户要求「打开某网站/看看这个网页/帮我登录/在网页上发帖/查一下这个页面的内容」时调用。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        description: '操作类型：open=新标签打开；goto=当前页跳转；back=后退；content=读取页面正文文本；screenshot=截图；click=点击（selector 或 text 二选一）；type=逐字输入；fill=清空后填入文本；press=按键；eval=执行 JS；tabs=列出标签页；close=关闭会话；file=读取截图返回 base64',
                        enum: ['open', 'goto', 'back', 'content', 'screenshot', 'click', 'type', 'fill', 'press', 'eval', 'tabs', 'close', 'file', 'track_save', 'track_note']
                    },
                    url: { type: 'string', description: '（open/goto）网址，可省略 https:// 自动补全' },                    selector: { type: 'string', description: "（click/type/fill）CSS 选择器，如 #kw、input[name='q']" },
                    text: { type: 'string', description: '（type/fill）要输入的文本；（click）要点击的可见文字（与 selector 二选一）' },
                    key: { type: 'string', description: '（press）按键名，如 Enter、Escape、Tab' },
                    script: { type: 'string', description: '（eval）要执行的 JS 表达式' },
                    session: { type: 'string', description: '会话名（默认 default）' },
                    headless: { type: 'boolean', description: '是否无头模式（默认 true）。想亲眼看浏览器窗口时传 false' },
                    all: { type: 'boolean', description: '（close）是否关闭所有会话' },
                    path: { type: 'string', description: '（file）截图文件绝对路径' },
                    text: { type: 'string', description: '（track_note）跟踪备注内容；（track_save）本次快照备注' },
                    session: { type: 'string', description: '跟踪对象名（track_save/track_note 用，默认 default；对应 项目记录/浏览器跟踪-<名>.md）' }
                },
                required: ['action']
            }
        }
    },
    };
}
