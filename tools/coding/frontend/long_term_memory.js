// ========== long_term_memory.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['long_term_memory']) {
    window.Tools.allTools['long_term_memory'] = {
    long_term_memory: {
        type: 'function',
        function: {
            name: 'long_term_memory',
            description: '长期记忆管理（数据库持久化，跨对话复用）。save=保存记忆，get=读取单条或多条，search=搜索记忆，list=列出全部，delete=删除单条或多条。每条记忆含 title/content/keywords/tags。适合存储用户偏好、项目经验、工具用法等需要跨对话保留的稳定信息。',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['save', 'get', 'search', 'list', 'delete'], description: '操作类型：save=保存记忆，get=读取单条(需memory_id)或多条(需memory_ids)，search=关键词搜索，list=列出全部，delete=删除单条(需memory_id)或多条(需memory_ids)' },
                    title: { type: 'string', description: '记忆标题（save 时必填）' },
                    content: { type: 'string', description: '记忆内容（save 时必填）' },
                    keywords: { type: 'array', items: { type: 'string' }, description: '检索关键词（save 时可选；search 时与 keyword 二选一，支持多关键词搜索）' },
                    tags: { type: 'array', items: { type: 'string' }, description: '分类标签（save 时可选）' },
                    memory_id: { type: 'string', description: '记忆ID（get/delete 单条时用，与 memory_ids 二选一）' },
                    memory_ids: { type: 'array', items: { type: 'string' }, description: '记忆ID数组（get/delete 批量操作时用，与 memory_id 二选一）' },
                    keyword: { type: 'string', description: '搜索关键词（search 时必填，与 keywords 二选一）' },
                    match_mode: { type: 'string', enum: ['any', 'all'], description: '多关键词匹配模式：any=任一匹配(OR,默认)，all=全部匹配(AND)。需配合 keywords 使用' },
                    limit: { type: 'integer', description: '返回数量上限（search/list 时可选，默认20）' }
                },
                required: ['action']
            }
        }
    },

    // ===== 内存记忆工具（纯内存高速读写，不落盘，适合编程工具调用） =====
    };
}
