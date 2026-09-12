// ========== recent_questions.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['recent_questions']) {
    window.Tools.allTools['recent_questions'] = {
    recent_questions: {
        type: 'function',
        function: {
            name: 'recent_questions',
            description: '查询近期用户问题。当对话中混入大量"刷新""继续"等噪音消息导致遗忘原始问题时，用此工具快速定位用户真实意图。支持按关键字筛选（keyword）或正则表达式匹配（regex=true），指定单个窗口(session_id)或多个窗口(session_ids)。支持分页查询：limit控制每页条数（默认100），offset控制起始位置，可无限翻页查询全部历史记录。返回结果中含has_more和next_offset提示是否还有更多。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '关键字筛选。传入后只返回包含该关键字的问题，更快定位。regex=true时作为正则表达式'
                    },
                    regex: {
                        type: 'boolean',
                        description: '是否将keyword作为正则表达式匹配。默认false（普通文本包含匹配），true时启用正则'
                    },
                    session_id: {
                        type: 'string',
                        description: '指定单个窗口ID查询（如 cb1）。不指定则查询全部窗口（与 session_ids 二选一）'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定多个窗口ID数组查询（与 session_id 二选一）'
                    },
                    limit: {
                        type: 'integer',
                        description: '每页返回条数，默认100。与offset配合使用实现分页，如limit=100&offset=0查第1-100条，limit=100&offset=100查第101-200条'
                    },
                    offset: {
                        type: 'integer',
                        description: '起始位置（跳过多少条），默认0。与limit配合实现无限分页查询'
                    },
                    filter_noise: {
                        type: 'boolean',
                        description: '是否过滤噪音消息（如"刷新""继续""好的"等），默认true'
                    }
                },
                required: []
            }
        }
    },


    };
}
