// ========== switch_port.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['switch_port']) {
    window.Tools.allTools['switch_port'] = {
    switch_port: {
        type: 'function',
        function: {
            name: 'switch_port',
            description: '切换本地智能体服务端口。直接传入目标端口即可；工具会校验端口、更新 private/port.txt，并可选启动新服务。适用于用户要求切换访问端口。',
            parameters: {
                type: 'object',
                properties: {
                    port: { type: 'integer', description: '目标端口，1024-65535。仅查询状态时可省略。' },
                    start: { type: 'boolean', description: '是否在写入后启动新端口服务，默认 true。' },
                    open_browser: { type: 'boolean', description: '切换成功后是否打开浏览器，默认 false。' },
                    status: { type: 'boolean', description: '仅查询当前端口状态，不进行切换。' }
                },
                required: []
            }
        }
    },
    };
}
