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
            description: '获取/移动鼠标位置。可高亮闪烁引导用户注意，target 指定元素。',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['get', 'move', 'click'], description: '操作类型：get=获取当前鼠标位置（默认）；move=在画布上移动/闪烁定位到指定坐标引导用户注意；click=模拟点击指定坐标处的元素' },
                    x: { type: 'number', description: '目标 X 坐标（屏幕坐标，像素）。move/click 操作时使用。' },
                    y: { type: 'number', description: '目标 Y 坐标（屏幕坐标，像素）。move/click 操作时使用。' },
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
