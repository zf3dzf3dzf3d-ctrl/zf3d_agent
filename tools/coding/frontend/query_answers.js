// ========== query_answers.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['query_answers']) {
    window.Tools.allTools['query_answers'] = {
    query_answers: {
        type: 'function',
        function: {
            name: 'query_answers',
            description: '根据用户问题关键字精准查询AI回复答案。与recent_questions对应：recent_questions查用户问题，本工具查对应的AI答案。通过关键字匹配用户问题后，自动找到紧随其后的assistant回复作为答案。支持正则表达式、分页、指定窗口。适用于精准回溯历史问答。',
            parameters: {
                type: 'object',
                properties: {
                    keyword: {
                        type: 'string',
                        description: '必填。用户问题关键字，用于匹配历史问题。regex=true时作为正则表达式'
                    },
                    regex: {
                        type: 'boolean',
                        description: '是否将keyword作为正则表达式匹配。默认false（普通文本包含匹配），true时启用正则'
                    },
                    session_id: {
                        type: 'string',
                        description: '指定单个窗口ID查询（如 cb1）。不指定则查询全部窗口'
                    },
                    session_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '指定多个窗口ID数组查询'
                    },
                    limit: {
                        type: 'integer',
                        description: '每页返回条数，默认10，最大200。与offset配合使用实现分页'
                    },
                    offset: {
                        type: 'integer',
                        description: '起始位置（跳过多少条），默认0。与limit配合实现无限分页查询'
                    },
                    answer_max_length: {
                        type: 'integer',
                        description: '答案最大截取长度，默认2000字符'
                    },
                    include_question: {
                        type: 'boolean',
                        description: '是否在结果中包含原始问题内容，默认true'
                    }
                },
                required: ['keyword']
            }
        }
    },

    };
}
