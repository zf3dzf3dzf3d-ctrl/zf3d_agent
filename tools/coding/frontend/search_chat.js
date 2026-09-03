// ========== search_chat.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['search_chat']) {
    window.Tools.allTools['search_chat'] = {
    search_chat: {
        type: 'function',
        function: {
            name: 'search_chat',
            description: '全局搜索对话内容。keyword/keywords 搜索，session_id 限定窗口。match_mode: any(OR)/all(AND)。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '单个搜索关键词（与 keywords 二选一）'
                    },
                    keywords: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个搜索关键词数组，支持同时搜索多个词（与 keyword 二选一）'
                    },
                    session_id: {
                        type: 'string',
                        description: '指定单个窗口ID搜索（如 cb12）。不指定则搜索全部窗口（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定多个窗口ID数组搜索（与 session_id 二选一）'
                    },
                    match_mode: {
                        type: 'string',
                        enum: ['any', 'all'],
                        description: '多关键词匹配模式：any=任一匹配即返回(OR,默认)，all=全部匹配才返回(AND)'
                    },
                    limit: {
                        type: 'integer',
                        description: '每个窗口最多返回的匹配数，默认50'
                    },
                    role: {
                        type: 'string',
                        description: '按角色过滤：user/assistant/tool/system。不传则不过滤'
                    }
                },
                required: []
            }
        }
    },
    };
}
