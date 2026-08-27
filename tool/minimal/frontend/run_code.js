// ========== run_code.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['run_code']) {
    window.Tools.allTools['run_code'] = {
    run_code: {
        type: 'function',
        function: {
            name: 'run_code',
            description: '运行 shell 命令，返回 stdout/stderr/exit_code。code 单段，codes 数组批量。',
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: 'shell 命令（与 codes 二选一）'
                    },
                    timeout: {
                        type: 'integer',
                        description: '保留参数'
                    },
                    codes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                code: {
                                    type: 'string',
                                    description: '要执行的 shell 命令'
                                },
                                timeout: {
                                    type: 'integer',
                                    description: '保留参数'
                                }
                            },
                            required: ['code']
                        },
                        description: '批量代码数组（与 code 二选一）'
                    }
                }
            }
        }
    },

    };
}
