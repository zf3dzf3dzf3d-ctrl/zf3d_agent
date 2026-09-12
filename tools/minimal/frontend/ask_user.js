// ========== ask_user.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['ask_user']) {
    window.Tools.allTools['ask_user'] = {
    ask_user: {
        type: 'function',
        function: {
            name: 'ask_user',
            description: '向用户提问并等待回答，暂停 Agent 循环。简单模式只传 question；表单模式传 question+fields 数组（支持 text/select/radio/checkbox）。',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: '要问用户的问题或需要用户提供的内容说明'
                    },
                    fields: {
                        type: 'array',
                        description: '（表单模式，可选）多字段表单定义数组。每项格式：{type, label, name, options, placeholder, default, required}。type 可选 text/select/radio/checkbox；label 为字段显示名；name 为字段标识（用作返回值 key）；options 为选项数组（select/radio/checkbox 类型用，每项可为字符串或 {value,label} 对象）；placeholder 为输入提示；default 为默认值；required 是否必填（默认 true）。未传 fields 时退化为单行文本输入。',
                        items: {
                            type: 'object',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['text', 'select', 'radio', 'checkbox'],
                                    description: '字段类型：text=单行文本，select=下拉选择，radio=单选，checkbox=多选'
                                },
                                label: {
                                    type: 'string',
                                    description: '字段显示名称'
                                },
                                name: {
                                    type: 'string',
                                    description: '字段标识（用作返回值中的 key），省略时自动为 field1, field2...'
                                },
                                options: {
                                    type: 'array',
                                    description: '选项列表（select/radio/checkbox 类型用），每项可为字符串或 {value, label} 对象',
                                    items: {}
                                },
                                placeholder: {
                                    type: 'string',
                                    description: '输入提示文字（text/select 类型用）'
                                },
                                default: {
                                    description: '默认值（radio 传字符串，checkbox 传字符串数组）'
                                },
                                required: {
                                    type: 'boolean',
                                    description: '是否必填，默认 true'
                                }
                            },
                            required: ['type', 'label']
                        }
                    }
                },
                required: ['question']
            }
        }
    },
    };
}
