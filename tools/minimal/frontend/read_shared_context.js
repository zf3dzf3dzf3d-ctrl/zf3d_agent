// ========== read_shared_context.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.8 - 共享上下文池读取

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['read_shared_context']) {
    window.Tools.allTools['read_shared_context'] = {
        type: 'function',
        function: {
            name: 'read_shared_context',
            description: '读取共享上下文池。analyze_project 等工具写入的全局共享数据（不按对话隔离，流程图所有节点、所有对话都可读）。key 目前支持 project_analysis（项目分析结果）。part 可选 summary=摘要（默认）、mermaid=流程图、files=文件列表、routes=路由列表、all=全部。limit 限制列表返回条数（默认 200，最大 1000）。',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        enum: ['project_analysis'],
                        description: '要读取的数据键（默认 project_analysis）'
                    },
                    part: {
                        type: 'string',
                        enum: ['summary', 'mermaid', 'files', 'routes', 'all'],
                        description: '读取哪部分（默认 summary）'
                    },
                    limit: {
                        type: 'integer',
                        description: '列表类数据的最大返回条数（默认 200，最大 1000）'
                    }
                },
                required: []
            }
        }
    };
}
