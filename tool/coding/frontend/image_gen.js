// ========== image_gen.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['image_gen']) {
    window.Tools.allTools['image_gen'] = {
    image_gen: {
        type: 'function',
        function: {
            name: 'image_gen',
            description: 'AI 文生图工具：多渠道免费额度自动切换。用户说"画个XX/生成图片"时调用，返回图片 URL（用 markdown ![](url) 直接展示）。渠道：pollinations(免费无key，默认主力) / siliconflow / zhipu，自动失败切换+冷却恢复。',
            parameters: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: '画面描述（必填）。英文提示词效果更佳，可把中文需求翻译成英文细节描述。'
                    },
                    size: {
                        type: 'string',
                        description: '图片尺寸，可选：512x512、768x768、1024x1024(默认)、768x1024、1024x768、832x1216、1216x832'
                    },
                    action: {
                        type: 'string',
                        description: 'generate=生成图片(默认)；status=查看各渠道可用状态'
                    }
                },
                required: ['prompt']
            }
        }
    },
    };
}
