// ========== chat_manage.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['chat_manage']) {
    window.Tools.allTools['chat_manage'] = {
    chat_manage: {
        type: 'function',
        function: {
            name: 'chat_manage',
            description: '对话管理：create/close/move/send/list/arrange。新建对话、发送消息、排列对话框等。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['create', 'close', 'move', 'send', 'list', 'arrange'],
                        description: '操作类型：create=新建对话，close=关闭对话，move=移动对话位置，send=向对话发送消息，list=列出所有对话，arrange=按状态排列所有对话为一排'
                    },
                    chat_id: {
                        type: 'string',
                        description: '目标对话ID（如 cb1）。close/move/send 操作时需要。create 和 list 可省略。close 时传 "all" 关闭所有对话'
                    },
                    message: {
                        type: 'string',
                        description: '要发送的消息内容（send 操作时使用，create 操作时可附带初始消息自动发送）'
                    },
                    model_id: {
                        type: 'string',
                        description: '指定模型ID（create 操作可选，不传则用当前活跃对话的模型）'
                    },
                    x: {
                        type: 'integer',
                        description: '对话框左上角X坐标（move 操作时使用，create 操作可选指定位置）'
                    },
                    y: {
                        type: 'integer',
                        description: '对话框左上角Y坐标（move 操作时使用，create 操作可选指定位置）'
                    },
                    auto_send: {
                        type: 'boolean',
                        description: 'create 操作时是否自动发送 message（默认 false）。为 true 时会创建对话并立即发送 message'
                    }
                },
                required: ['action']
            }
        }
    },
    };
}
