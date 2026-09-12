// ========== pixel_display.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['pixel_display']) {
    window.Tools.allTools['pixel_display'] = {
    pixel_display: {
        type: 'function',
        function: {
            name: 'pixel_display',
            description: '像素显示器。向左下角面板发送PXL像素图/动画。静态:WxHB:RLE 动画:WxHB F帧数:R1|R2 动画带帧率:WxHB F帧数@fps:R1|R2。RLE从0(黑)开始交替计数。fps默认4,动画循环播放。',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['show', 'clear', 'status'], description: 'show=显示,clear=清除,status=查状态' },
                    title: { type: 'string', description: '标题(可选)' },
                    data: { type: 'string', description: 'PXL数据。静态:16x16B:36,2,3,2,8,4,1,4,... 动画:16x16B F2:36,2,...|16,16,...  带fps:16x16B F4@8:R1|R2|R3|R4' },
                    fps: { type: 'integer', description: '帧率(可选,默认4。也可在data中用@fps指定)' }
                },
                required: ['action']
            }
        }
    },

    // ===== 正则搜索工具（始终正则模式，支持捕获组提取） =====
    };
}
