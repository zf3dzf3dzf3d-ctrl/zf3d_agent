// ========== set_camera.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['set_camera']) {
    window.Tools.allTools['set_camera'] = {
    set_camera: {
        type: 'function',
        function: {
            name: 'set_camera',
            description: '定位画布视口位置。target="center"或"chat:ID"快速定位。',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: '画布平移的 X 坐标（像素）。正值向右，负值向左。不传则保持当前 X 不变。' },
                    y: { type: 'number', description: '画布平移的 Y 坐标（像素）。正值向下，负值向上。不传则保持当前 Y 不变。' },
                    zoom: { type: 'number', description: '缩放比例（1=100%）。注意：当前画布缩放已被禁用，此参数仅做记录不会实际生效。不建议调整。' },
                    animate: { type: 'boolean', description: '是否使用动画过渡（默认 true，平滑移动到目标位置）' },
                    target: { type: 'string', description: '快速定位目标。可选值："center"=回到画布原点中心，"chat:对话ID"=定位到指定对话框。设置此值时 x/y 参数将被忽略。' }
                },
                required: []
            }
        }
    },
    };
}
