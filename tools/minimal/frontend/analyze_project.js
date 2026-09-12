// ========== analyze_project.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.8 - 项目分析 + 流程图生成

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['analyze_project']) {
    window.Tools.allTools['analyze_project'] = {
        type: 'function',
        function: {
            name: 'analyze_project',
            description: '项目分析工具。扫描项目目录结构，识别入口文件、顶层目录、路由/接口，自动生成 mermaid 流程图，并把完整分析结果存入共享上下文池（全局共享，不按对话隔离），供流程图每个节点和任意对话通过 read_shared_context 共同读取。actions：analyze=执行分析（可选 root 相对目录、max_depth），status=查询是否已有分析结果。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['analyze', 'status'],
                        description: '操作类型：analyze=分析当前项目并生成流程图+写入共享池，status=查询池中是否已有分析'
                    },
                    root: {
                        type: 'string',
                        description: '要分析的相对目录（默认项目根目录）'
                    },
                    max_depth: {
                        type: 'integer',
                        description: '目录遍历最大深度（默认 6，最大 10）'
                    }
                },
                required: ['action']
            }
        }
    };
}
