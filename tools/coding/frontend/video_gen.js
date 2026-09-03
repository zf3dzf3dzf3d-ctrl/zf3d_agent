// ========== video_gen.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['video_gen']) {
    window.Tools.allTools['video_gen'] = {
    video_gen: {
        type: 'function',
        function: {
            name: 'video_gen',
            description: 'AI 文生视频工具：用户说"生成视频/做个XX视频/动起来"时调用，返回视频 URL（用 HTML <video> 标签直接展示）。渠道：pollinations(免费无key，默认主力，Veo-3 模型异步轮询) / siliconflow(Wan2.1 需 key)。自动失败切换+冷却恢复。生成完成后会自动在 Kite 画布上添加一个可拖拽的视频节点，并自动连接最近对话的曲线。',
            parameters: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: '视频内容描述（必填）。英文提示词效果更佳，可把中文需求翻译成英文细节描述（运镜、风格、动作、光影等）。'
                    },
                    duration: {
                        type: 'integer',
                        description: '视频时长（秒），可选 4/5/8/10，默认 5。'
                    },
                    fps: {
                        type: 'integer',
                        description: '视频帧率（FPS），范围 4~60，默认 30。帧率越高画面越流畅。'
                    },
                    size: {
                        type: 'string',
                        description: '视频尺寸，可选：832x480(默认 横屏) / 480x832(竖屏) / 1024x576(高清横屏) / 576x1024(高清竖屏)'
                    },
                    model: {
                        type: 'string',
                        description: '视频模型：veo3(Pollinations Veo-3, 默认免费) / wan2.1(硅基流动, 需 key)'
                    },
                    action: {
                        type: 'string',
                        description: 'generate=生成视频(默认)；status=查看各渠道可用状态'
                    }
                },
                required: ['prompt']
            }
        }
    },
    };
}
