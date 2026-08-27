// ========== project_record.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['project_record']) {
    window.Tools.allTools['project_record'] = {
    project_record: {
        type: 'function',
        function: {
            name: 'project_record',
            description: '项目记录管理（存于「项目记录/」.md 文件）。list/read/write/append/search/delete，名称自动补 .md。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'read', 'write', 'append', 'search', 'delete'],
                        description: '操作类型：list=列出所有记录，read=读取记录内容，write=创建/覆盖记录，append=追加内容，search=搜索关键词，delete=删除记录'
                    },
                    name: {
                        type: 'string',
                        description: '记录名称（自动补 .md 后缀）。list 和 search 操作可省略。read 支持多个名称用逗号分隔（与 names 二选一）'
                    },
                    names: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（read 操作）多个记录名称数组，批量读取多条记录（与 name 二选一）'
                    },
                    content: {
                        type: 'string',
                        description: '写入或追加的内容（write/append 操作时使用）'
                    },
                    keyword: {
                        type: 'string',
                        description: '搜索关键词（search 操作时使用）'
                    }
                },
                required: ['action']
            }
        }
    },
    };
}
