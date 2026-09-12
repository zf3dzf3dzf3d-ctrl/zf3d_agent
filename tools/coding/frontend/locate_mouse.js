// ========== locate_mouse.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['locate_mouse']) {
    window.Tools.allTools['locate_mouse'] = {
    locate_mouse: {
        type: 'function',
        function: {
            name: 'locate_mouse',
            description: '获取/移动鼠标位置。get=获取系统鼠标真实位置；set=真实移动系统鼠标（支持 dx/dy 相对位移，如 dy:-100 即上移100像素）；move=画布高亮引导；click=模拟点击元素。',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['get', 'set', 'move', 'click'], description: '操作类型：get=获取系统鼠标位置（默认）；set=真实移动系统鼠标；move=画布高亮定位引导用户注意；click=模拟点击指定坐标处的元素' },
                    x: { type: 'number', description: '目标 X 坐标（屏幕坐标，像素）。set/move/click 操作时使用（set 时为绝对坐标）。' },
                    y: { type: 'number', description: '目标 Y 坐标（屏幕坐标，像素）。set/move/click 操作时使用（set 时为绝对坐标）。' },
                    dx: { type: 'number', description: 'X 方向相对位移（像素），仅 set 操作有效。如 dx:100 表示右移100像素。与 x 互斥，dx 优先级低于 x。' },
                    dy: { type: 'number', description: 'Y 方向相对位移（像素），仅 set 操作有效。如 dy:-100 表示上移100像素。与 y 互斥，dy 优先级低于 y。' },
                    target: { type: 'string', description: '目标元素选择器（如 "#btn-settings" 或 ".chatbox.active"）。设置此值时会定位到该元素的位置，优先于 x/y。click 操作时会直接点击该元素。' },
                    duration: { type: 'number', description: '闪烁高亮持续时间（毫秒），默认 2000ms。仅 move 操作时有效。' }
                },
                required: []
            }
        }
    },

    // ===== 长期记忆工具（数据库持久化，跨对话复用） =====
    };
}
